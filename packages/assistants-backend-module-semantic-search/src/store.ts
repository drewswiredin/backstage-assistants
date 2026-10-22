import type { DatabaseService } from '@backstage/backend-plugin-api';
import { randomUUID } from 'node:crypto';
import type { Chunk } from './chunk';
import type { KnowledgeMetadata } from './documents';

type Knex = Awaited<ReturnType<DatabaseService['getClient']>>;

const CHUNKS = 'assistants_knowledge_chunks';
const META = 'assistants_knowledge_meta';
const COLLECTIONS = 'assistants_knowledge_collections';
const SIGNATURE_KEY = 'embedding';
/** Bumped when the table's shape changes, so the next run rebuilds it. */
const SCHEMA_VERSION = 3;
/** The version {@link KnowledgeStore.ensureSchema} upgrades in place, keeping its embeddings. */
const UPGRADABLE_VERSION = 2;

/** The Postgres extensions the index needs. */
export const REQUIRED_EXTENSIONS = ['vector', 'pg_trgm'] as const;

/** pgvector's HNSW index covers up to 2000 dimensions; larger vectors scan exactly. */
const HNSW_MAX_DIMENSIONS = 2000;

/** A collection no search run has refreshed for this long is dropped. */
export const STALE_DAYS = 30;

/** Below the `pg_trgm` default of 0.6 so one typo in a five-letter word ("pilon" → "pylon") still matches. */
const FUZZY_THRESHOLD = 0.45;

/** Without pgvector 0.8's iterative scans, a filtered HNSW search widens its candidate list instead. */
const FALLBACK_EF_SEARCH = 400;

const METADATA_BATCH = 1000;

export interface StoredChunk {
  id: string;
  type?: string;
  entityRef?: string;
  location: string;
  title: string;
  content: string;
  metadata?: KnowledgeMetadata;
}

/** The chunks a search may return: these document types, and untyped chunks when `untyped`. */
export interface TypeFilter {
  types: string[];
  untyped: boolean;
}

/** One chunk in a retrieval list. */
export interface Hit {
  id: string;
  type?: string;
}

/** The document types the index holds; `untyped` when it holds runs of types not in config. */
export interface StoredTypes {
  types: string[];
  untyped: boolean;
}

export interface StoredHashes {
  hash: string;
  metadataHash: string | null;
}

/**
 * The knowledge index in the plugin's Postgres database: one row per chunk
 * carrying its embedding (pgvector), a generated full-text vector, and a
 * trigram index over its text.
 *
 * The table is a rebuildable copy of what Backstage search indexes, so it is
 * managed here rather than by migrations: changing the embedding model or its
 * dimensions drops and recreates it, and each document type refills on its
 * next search run.
 *
 * Each chunk belongs to a collection: the documents of one search document
 * type. A run of a type named in config is the collection of that name; any
 * other run joins the collection that already holds most of its locations (a
 * new one when none match). Only that collection's missing chunks are
 * deleted. A collection no run has refreshed in {@link STALE_DAYS} days (a
 * source removed from search, or an unnamed one whose locations all changed
 * at once) is dropped.
 */
export class KnowledgeStore {
  #iterativeScan?: Promise<boolean>;

  constructor(
    private readonly db: Knex,
    private readonly embeddingModelId: string,
  ) {}

  static isPostgres(db: Knex): boolean {
    return db.client.config.client === 'pg';
  }

  /**
   * Enables the required extensions where the connecting role may, and
   * returns the ones still missing. `pg_trgm` is trusted, so a database owner
   * can enable it; `vector` usually needs an admin.
   */
  async ensureExtensions(): Promise<string[]> {
    const missing: string[] = [];
    for (const extension of REQUIRED_EXTENSIONS) {
      try {
        await this.db.raw(`CREATE EXTENSION IF NOT EXISTS ${extension}`);
      } catch {
        // Not permitted for this role; checked below.
      }
      const { rows } = await this.db.raw(
        'SELECT 1 FROM pg_extension WHERE extname = ?',
        [extension],
      );
      if (rows.length === 0) {
        missing.push(extension);
      }
    }
    return missing;
  }

  /** Creates the table for this model's dimensions, rebuilding it if the model changed. */
  async ensureSchema(dimensions: number): Promise<void> {
    if (!Number.isInteger(dimensions) || dimensions < 1) {
      throw new Error(`Invalid embedding dimensions: ${dimensions}`);
    }
    const signature = (version: number) =>
      `${this.embeddingModelId}#${dimensions}#${version}`;

    await this.db.raw(
      `CREATE TABLE IF NOT EXISTS ${META} (key text PRIMARY KEY, value text NOT NULL)`,
    );
    const current = await this.db(META).where({ key: SIGNATURE_KEY }).first();
    if (current?.value === signature(SCHEMA_VERSION)) {
      return;
    }

    if (current?.value === signature(UPGRADABLE_VERSION)) {
      // Same model: add the type and metadata columns and keep the
      // embeddings. Each type takes its name and its metadata on its next run.
      await this.db.transaction(async tx => {
        await tx.raw(`
          ALTER TABLE ${CHUNKS}
            ADD COLUMN IF NOT EXISTS type text,
            ADD COLUMN IF NOT EXISTS metadata jsonb,
            ADD COLUMN IF NOT EXISTS metadata_hash text`);
        await tx.raw(
          `ALTER TABLE ${COLLECTIONS} ADD COLUMN IF NOT EXISTS type text`,
        );
        await tx.raw(
          `CREATE INDEX IF NOT EXISTS ${CHUNKS}_type ON ${CHUNKS} (type)`,
        );
        await tx(META)
          .where({ key: SIGNATURE_KEY })
          .update({ value: signature(SCHEMA_VERSION) });
      });
      return;
    }

    await this.db.transaction(async tx => {
      await tx.raw(`DROP TABLE IF EXISTS ${CHUNKS}`);
      await tx.raw(`DROP TABLE IF EXISTS ${COLLECTIONS}`);
      await tx.raw(`
        CREATE TABLE ${COLLECTIONS} (
          collection text PRIMARY KEY,
          type text,
          refreshed_at timestamptz NOT NULL DEFAULT now()
        )`);
      await tx.raw(`
        CREATE TABLE ${CHUNKS} (
          id text PRIMARY KEY,
          collection text NOT NULL,
          type text,
          entity_ref text,
          location text NOT NULL,
          title text NOT NULL,
          content text NOT NULL,
          content_hash text NOT NULL,
          metadata jsonb,
          metadata_hash text,
          embedding vector(${dimensions}) NOT NULL,
          tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || content)) STORED,
          updated_at timestamptz NOT NULL DEFAULT now()
        )`);
      if (dimensions <= HNSW_MAX_DIMENSIONS) {
        await tx.raw(
          `CREATE INDEX ${CHUNKS}_embedding ON ${CHUNKS} USING hnsw (embedding vector_cosine_ops)`,
        );
      }
      await tx.raw(`CREATE INDEX ${CHUNKS}_tsv ON ${CHUNKS} USING gin (tsv)`);
      await tx.raw(
        `CREATE INDEX ${CHUNKS}_location ON ${CHUNKS} (location, collection)`,
      );
      await tx.raw(
        `CREATE INDEX ${CHUNKS}_trgm ON ${CHUNKS} USING gin ((title || ' ' || content) gin_trgm_ops)`,
      );
      await tx.raw(`CREATE INDEX ${CHUNKS}_type ON ${CHUNKS} (type)`);
      await tx(META)
        .insert({ key: SIGNATURE_KEY, value: signature(SCHEMA_VERSION) })
        .onConflict('key')
        .merge();
    });
  }

  /** True once a run has built the table for the configured model. */
  async isReady(): Promise<boolean> {
    const { rows } = await this.db.raw(`SELECT to_regclass(?) AS t`, [META]);
    if (!rows[0]?.t) {
      return false;
    }
    const current = await this.db(META).where({ key: SIGNATURE_KEY }).first();
    return Boolean(current?.value.startsWith(`${this.embeddingModelId}#`));
  }

  /**
   * The collection a run belongs to. A run of a named type is the collection
   * of that name: the first such run takes over the unnamed collection holding
   * most of its locations, so an index built before the type was named keeps
   * its embeddings. Any other run joins the collection holding most of its
   * locations, or starts a new one.
   */
  async collectionFor(
    type: string | undefined,
    locations: string[],
  ): Promise<string> {
    if (type && (await this.hasCollection(type))) {
      return type;
    }
    const found = await this.collectionOf(locations, type !== undefined);
    if (!type) {
      return found ?? randomUUID();
    }
    if (found) {
      await this.db.transaction(async tx => {
        await tx(CHUNKS)
          .where({ collection: found })
          .update({ collection: type });
        await tx(COLLECTIONS)
          .where({ collection: found })
          .update({ collection: type });
      });
    }
    return type;
  }

  private async hasCollection(collection: string): Promise<boolean> {
    if (await this.db(COLLECTIONS).where({ collection }).first()) {
      return true;
    }
    return Boolean(await this.db(CHUNKS).where({ collection }).first('id'));
  }

  /** The collection holding most of these locations, if any holds one. */
  private async collectionOf(
    locations: string[],
    unnamedOnly: boolean,
  ): Promise<string | undefined> {
    if (locations.length === 0) {
      return undefined;
    }
    const query = this.db(CHUNKS)
      .select('collection')
      .whereRaw('location = ANY(?::text[])', [locations]);
    if (unnamedOnly) {
      query.whereNull('type');
    }
    const row = await query
      .groupBy('collection')
      .orderByRaw('count(*) DESC')
      .first();
    return row?.collection;
  }

  /**
   * Marks the collection refreshed as this type (none for an unnamed run),
   * and drops collections no run has refreshed in {@link STALE_DAYS} days.
   */
  async refreshed(collection: string, type?: string): Promise<number> {
    await this.db(COLLECTIONS)
      .insert({
        collection,
        type: type ?? null,
        refreshed_at: this.db.fn.now(),
      })
      .onConflict('collection')
      .merge();
    await this.db(CHUNKS)
      .where({ collection })
      .whereRaw('type IS DISTINCT FROM ?::text', [type ?? null])
      .update({ type: type ?? null });
    const stale = this.db(COLLECTIONS)
      .select('collection')
      .whereRaw(`refreshed_at < now() - make_interval(days => ?)`, [
        STALE_DAYS,
      ]);
    const dropped = await this.db(CHUNKS).whereIn('collection', stale).delete();
    await this.db(COLLECTIONS)
      .whereRaw(`refreshed_at < now() - make_interval(days => ?)`, [STALE_DAYS])
      .delete();
    return dropped;
  }

  /** Deletes every chunk of a type that is no longer copied. */
  async dropType(type: string): Promise<number> {
    const dropped = await this.db(CHUNKS)
      .where({ type })
      .orWhere({ collection: type })
      .delete();
    await this.db(COLLECTIONS)
      .where({ type })
      .orWhere({ collection: type })
      .delete();
    return dropped;
  }

  /** The document types the index holds. */
  async types(): Promise<StoredTypes> {
    const rows = await this.db(COLLECTIONS).distinct('type');
    return {
      types: rows.flatMap(row => (row.type ? [row.type] : [])).sort(),
      untyped: rows.some(row => !row.type),
    };
  }

  async hashes(): Promise<Map<string, StoredHashes>> {
    const rows = await this.db(CHUNKS).select(
      'id',
      'content_hash',
      'metadata_hash',
    );
    return new Map(
      rows.map(row => [
        row.id,
        { hash: row.content_hash, metadataHash: row.metadata_hash },
      ]),
    );
  }

  async upsert(
    collection: string,
    type: string | undefined,
    chunks: Chunk[],
    embeddings: number[][],
  ): Promise<void> {
    if (chunks.length === 0) {
      return;
    }
    await this.db(CHUNKS)
      .insert(
        chunks.map((chunk, i) => ({
          id: chunk.id,
          collection,
          type: type ?? null,
          entity_ref: chunk.entityRef ?? null,
          location: chunk.location,
          title: chunk.title,
          content: chunk.content,
          content_hash: chunk.hash,
          metadata: chunk.metadata ? JSON.stringify(chunk.metadata) : null,
          metadata_hash: chunk.metadataHash,
          embedding: this.db.raw('?::vector', [vectorLiteral(embeddings[i])]),
          updated_at: this.db.fn.now(),
        })),
      )
      .onConflict('id')
      .merge();
  }

  /** Rewrites the metadata of chunks whose text is unchanged. */
  async updateMetadata(chunks: Chunk[]): Promise<void> {
    for (let i = 0; i < chunks.length; i += METADATA_BATCH) {
      const batch = chunks.slice(i, i + METADATA_BATCH);
      await this.db.raw(
        `UPDATE ${CHUNKS} AS c
            SET metadata = v.metadata, metadata_hash = v.metadata_hash, updated_at = now()
           FROM unnest(?::text[], ?::jsonb[], ?::text[]) AS v(id, metadata, metadata_hash)
          WHERE c.id = v.id`,
        [
          batch.map(chunk => chunk.id),
          batch.map(chunk =>
            chunk.metadata ? JSON.stringify(chunk.metadata) : null,
          ),
          batch.map(chunk => chunk.metadataHash),
        ],
      );
    }
  }

  /** Deletes the collection's chunks that this run no longer has. */
  async deleteExcept(collection: string, keepIds: string[]): Promise<number> {
    return this.db(CHUNKS)
      .where({ collection })
      .whereRaw('NOT (id = ANY(?::text[]))', [keepIds])
      .delete();
  }

  /**
   * Nearest chunks to an embedding by cosine distance, up to `limit` of each
   * type, merged nearest first. Searching each type on its own keeps a large
   * source from filling every slot before ranking weighs the types.
   */
  async nearest(
    embedding: number[],
    limit: number,
    filter: TypeFilter,
  ): Promise<Hit[]> {
    const groups: TypeFilter[] = [
      ...filter.types.map(type => ({ types: [type], untyped: false })),
      ...(filter.untyped ? [{ types: [], untyped: true }] : []),
    ];
    const vector = vectorLiteral(embedding);
    const iterative = await this.iterativeScan();
    const rows = await Promise.all(
      groups.map(group =>
        this.db.transaction(async tx => {
          // A filtered HNSW search keeps scanning until it has `limit` rows
          // (pgvector 0.8), or else searches a wider candidate list.
          await (iterative
            ? tx.raw(
                `SELECT set_config('hnsw.iterative_scan', 'relaxed_order', true)`,
              )
            : tx.raw(`SELECT set_config('hnsw.ef_search', ?, true)`, [
                String(FALLBACK_EF_SEARCH),
              ]));
          const [clause, bindings] = typeClause(group);
          const result = await tx.raw(
            `WITH nearest AS MATERIALIZED (
               SELECT id, type, embedding <=> ?::vector AS distance FROM ${CHUNKS}
                WHERE ${clause}
                ORDER BY distance
                LIMIT ?
             )
             SELECT id, type, distance FROM nearest ORDER BY distance`,
            [vector, ...bindings, limit],
          );
          return result.rows as Array<Hit & { distance: number }>;
        }),
      ),
    );
    return rows
      .flat()
      .sort((a, b) => a.distance - b.distance)
      .map(toHit);
  }

  /** Chunks matching ANY of the words, ranked by how many and how densely; up to `limit` of each type. */
  async keyword(
    words: string[],
    limit: number,
    filter: TypeFilter,
  ): Promise<Hit[]> {
    if (words.length === 0) {
      return [];
    }
    const [clause, bindings] = typeClause(filter);
    const { rows } = await this.db.raw(
      perType(
        `SELECT id, type, ts_rank_cd(tsv, q) AS score
           FROM ${CHUNKS}, websearch_to_tsquery('english', ?) q
          WHERE tsv @@ q AND ${clause}`,
      ),
      [words.join(' or '), ...bindings, limit],
    );
    return rows.map(toHit);
  }

  /**
   * How many of the filter's chunks contain each word, counted up to `cap`: 0
   * for a word they lack (likely a misspelling), absent for a word Postgres
   * ignores as a stopword.
   */
  async documentFrequencies(
    words: string[],
    cap: number,
    filter: TypeFilter,
  ): Promise<Map<string, number>> {
    if (words.length === 0) {
      return new Map();
    }
    const [clause, bindings] = typeClause(filter);
    const { rows } = await this.db.raw(
      `SELECT w, (
          SELECT count(*) FROM (
            SELECT 1 FROM ${CHUNKS}
             WHERE tsv @@ plainto_tsquery('english', w) AND ${clause}
             LIMIT ?
          ) hits
        ) AS n
        FROM unnest(?::text[]) AS w
        WHERE numnode(plainto_tsquery('english', w)) > 0`,
      [...bindings, cap, words],
    );
    return new Map(
      rows.map((row: { w: string; n: string }) => [row.w, Number(row.n)]),
    );
  }

  /**
   * Chunks whose text contains a near spelling of the words, ranked by summed
   * trigram word similarity; up to `limit` of each type. Run only for words
   * the index lacks: a word that matches exactly is already covered by
   * {@link keyword}.
   */
  async fuzzy(
    words: string[],
    limit: number,
    filter: TypeFilter,
  ): Promise<Hit[]> {
    if (words.length === 0) {
      return [];
    }
    const text = `(title || ' ' || content)`;
    const [clause, bindings] = typeClause(filter);
    return this.db.transaction(async tx => {
      await tx.raw(
        `SELECT set_config('pg_trgm.word_similarity_threshold', ?, true)`,
        [String(FUZZY_THRESHOLD)],
      );
      const { rows } = await tx.raw(
        perType(
          `SELECT id, type, ${words
            .map(() => `word_similarity(?, ${text})`)
            .join(' + ')} AS score
             FROM ${CHUNKS}
            WHERE (${words.map(() => `? <% ${text}`).join(' OR ')})
              AND ${clause}`,
        ),
        [...words, ...words, ...bindings, limit],
      );
      return rows.map(toHit);
    });
  }

  /** Whether pgvector has iterative index scans (0.8 and later). */
  private iterativeScan(): Promise<boolean> {
    this.#iterativeScan ??= this.db
      .raw(`SELECT extversion FROM pg_extension WHERE extname = 'vector'`)
      .then(({ rows }) => {
        const [major, minor] = String(rows[0]?.extversion ?? '0')
          .split('.')
          .map(Number);
        return major > 0 || minor >= 8;
      });
    return this.#iterativeScan;
  }

  async chunks(ids: string[]): Promise<StoredChunk[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.db(CHUNKS)
      .select(
        'id',
        'type',
        'entity_ref',
        'location',
        'title',
        'content',
        'metadata',
      )
      .whereRaw('id = ANY(?::text[])', [ids]);
    return rows.map(row => ({
      id: row.id,
      ...(row.type ? { type: row.type } : {}),
      ...(row.entity_ref ? { entityRef: row.entity_ref } : {}),
      location: row.location,
      title: row.title,
      content: row.content,
      ...(row.metadata ? { metadata: row.metadata } : {}),
    }));
  }
}

/** The SQL condition, and its bindings, for the chunks a filter admits. */
function typeClause(filter: TypeFilter): [string, unknown[]] {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (filter.types.length > 0) {
    conditions.push('type = ANY(?::text[])');
    bindings.push(filter.types);
  }
  if (filter.untyped) {
    conditions.push('type IS NULL');
  }
  return [
    conditions.length > 0 ? `(${conditions.join(' OR ')})` : 'FALSE',
    bindings,
  ];
}

/**
 * Keeps the best `limit` rows of each type from a query selecting `id`,
 * `type`, and `score`, best first overall. The limit is the last binding.
 */
function perType(scored: string): string {
  return `SELECT id, type FROM (
      SELECT id, type, score,
             row_number() OVER (PARTITION BY type ORDER BY score DESC) AS n
        FROM (${scored}) scored
    ) ranked
    WHERE n <= ?
    ORDER BY score DESC`;
}

function toHit(row: { id: string; type?: string | null }): Hit {
  return { id: row.id, ...(row.type ? { type: row.type } : {}) };
}

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
