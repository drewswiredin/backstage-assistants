import type { DatabaseService } from '@backstage/backend-plugin-api';
import type { Chunk } from './chunk';

type Knex = Awaited<ReturnType<DatabaseService['getClient']>>;

const CHUNKS = 'assistants_knowledge_chunks';
const META = 'assistants_knowledge_meta';
const COLLECTIONS = 'assistants_knowledge_collections';
const SIGNATURE_KEY = 'embedding';
/** Bumped when the table's shape changes, so the next run rebuilds it. */
const SCHEMA_VERSION = 2;

/** The Postgres extensions the index needs. */
export const REQUIRED_EXTENSIONS = ['vector', 'pg_trgm'] as const;

/** pgvector's HNSW index covers up to 2000 dimensions; larger vectors scan exactly. */
const HNSW_MAX_DIMENSIONS = 2000;

/** A collection no search run has refreshed for this long is dropped. */
export const STALE_DAYS = 30;

/** Below the `pg_trgm` default of 0.6 so one typo in a five-letter word ("pilon" → "pylon") still matches. */
const FUZZY_THRESHOLD = 0.45;

export interface StoredChunk {
  id: string;
  entityRef?: string;
  location: string;
  title: string;
  content: string;
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
 * type. A run does not say which type it is, so it joins the collection that
 * already holds most of its locations (a new one when none match), and only
 * that collection's missing chunks are deleted. A collection no run has
 * refreshed in {@link STALE_DAYS} days (a source removed from search, or one
 * whose locations all changed at once) is dropped.
 */
export class KnowledgeStore {
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
    const signature = `${this.embeddingModelId}#${dimensions}#${SCHEMA_VERSION}`;

    await this.db.raw(
      `CREATE TABLE IF NOT EXISTS ${META} (key text PRIMARY KEY, value text NOT NULL)`,
    );
    const current = await this.db(META).where({ key: SIGNATURE_KEY }).first();
    if (current?.value === signature) {
      return;
    }

    await this.db.transaction(async tx => {
      await tx.raw(`DROP TABLE IF EXISTS ${CHUNKS}`);
      await tx.raw(`DROP TABLE IF EXISTS ${COLLECTIONS}`);
      await tx.raw(`
        CREATE TABLE ${COLLECTIONS} (
          collection text PRIMARY KEY,
          refreshed_at timestamptz NOT NULL DEFAULT now()
        )`);
      await tx.raw(`
        CREATE TABLE ${CHUNKS} (
          id text PRIMARY KEY,
          collection text NOT NULL,
          entity_ref text,
          location text NOT NULL,
          title text NOT NULL,
          content text NOT NULL,
          content_hash text NOT NULL,
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
      await tx(META)
        .insert({ key: SIGNATURE_KEY, value: signature })
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

  /** The collection holding most of these locations, if any holds one. */
  async collectionOf(locations: string[]): Promise<string | undefined> {
    if (locations.length === 0) {
      return undefined;
    }
    const row = await this.db(CHUNKS)
      .select('collection')
      .whereRaw('location = ANY(?::text[])', [locations])
      .groupBy('collection')
      .orderByRaw('count(*) DESC')
      .first();
    return row?.collection;
  }

  /** Marks the collection refreshed and drops collections no run has refreshed in {@link STALE_DAYS} days. */
  async refreshed(collection: string): Promise<number> {
    await this.db(COLLECTIONS)
      .insert({ collection, refreshed_at: this.db.fn.now() })
      .onConflict('collection')
      .merge();
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

  async hashes(): Promise<Map<string, string>> {
    const rows = await this.db(CHUNKS).select('id', 'content_hash');
    return new Map(rows.map(row => [row.id, row.content_hash]));
  }

  async upsert(
    collection: string,
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
          entity_ref: chunk.entityRef ?? null,
          location: chunk.location,
          title: chunk.title,
          content: chunk.content,
          content_hash: chunk.hash,
          embedding: this.db.raw('?::vector', [vectorLiteral(embeddings[i])]),
          updated_at: this.db.fn.now(),
        })),
      )
      .onConflict('id')
      .merge();
  }

  /** Deletes the collection's chunks that this run no longer has. */
  async deleteExcept(collection: string, keepIds: string[]): Promise<number> {
    return this.db(CHUNKS)
      .where({ collection })
      .whereRaw('NOT (id = ANY(?::text[]))', [keepIds])
      .delete();
  }

  /** Nearest chunks to an embedding by cosine distance. */
  async nearest(embedding: number[], limit: number): Promise<string[]> {
    const rows = await this.db(CHUNKS)
      .select('id')
      .orderByRaw('embedding <=> ?::vector', [vectorLiteral(embedding)])
      .limit(limit);
    return rows.map(row => row.id);
  }

  /** Chunks matching ANY of the words, ranked by how many and how densely. */
  async keyword(words: string[], limit: number): Promise<string[]> {
    if (words.length === 0) {
      return [];
    }
    const { rows } = await this.db.raw(
      `SELECT id FROM ${CHUNKS}, websearch_to_tsquery('english', ?) q
        WHERE tsv @@ q
        ORDER BY ts_rank_cd(tsv, q) DESC
        LIMIT ?`,
      [words.join(' or '), limit],
    );
    return rows.map((row: { id: string }) => row.id);
  }

  /**
   * How many chunks contain each word, counted up to `cap`: 0 for a word the
   * index lacks (likely a misspelling), absent for a word Postgres ignores as
   * a stopword.
   */
  async documentFrequencies(
    words: string[],
    cap: number,
  ): Promise<Map<string, number>> {
    if (words.length === 0) {
      return new Map();
    }
    const { rows } = await this.db.raw(
      `SELECT w, (
          SELECT count(*) FROM (
            SELECT 1 FROM ${CHUNKS} WHERE tsv @@ plainto_tsquery('english', w) LIMIT ?
          ) hits
        ) AS n
        FROM unnest(?::text[]) AS w
        WHERE numnode(plainto_tsquery('english', w)) > 0`,
      [cap, words],
    );
    return new Map(
      rows.map((row: { w: string; n: string }) => [row.w, Number(row.n)]),
    );
  }

  /**
   * Chunks whose text contains a near spelling of the words, ranked by summed
   * trigram word similarity. Run only for words the index lacks: a word that
   * matches exactly is already covered by {@link keyword}.
   */
  async fuzzy(words: string[], limit: number): Promise<string[]> {
    if (words.length === 0) {
      return [];
    }
    const text = `(title || ' ' || content)`;
    return this.db.transaction(async tx => {
      await tx.raw(
        `SELECT set_config('pg_trgm.word_similarity_threshold', ?, true)`,
        [String(FUZZY_THRESHOLD)],
      );
      const { rows } = await tx.raw(
        `SELECT id FROM ${CHUNKS}
          WHERE ${words.map(() => `? <% ${text}`).join(' OR ')}
          ORDER BY ${words
            .map(() => `word_similarity(?, ${text})`)
            .join(' + ')} DESC
          LIMIT ?`,
        [...words, ...words, limit],
      );
      return rows.map((row: { id: string }) => row.id);
    });
  }

  async chunks(ids: string[]): Promise<StoredChunk[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.db(CHUNKS)
      .select('id', 'entity_ref', 'location', 'title', 'content')
      .whereRaw('id = ANY(?::text[])', [ids]);
    return rows.map(row => ({
      id: row.id,
      ...(row.entity_ref ? { entityRef: row.entity_ref } : {}),
      location: row.location,
      title: row.title,
      content: row.content,
    }));
  }
}

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
