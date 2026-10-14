import type { DatabaseService } from '@backstage/backend-plugin-api';
import type { Chunk } from './chunk';

type Knex = Awaited<ReturnType<DatabaseService['getClient']>>;

const CHUNKS = 'assistants_knowledge_chunks';
const META = 'assistants_knowledge_meta';
const SIGNATURE_KEY = 'embedding';

/** The Postgres extensions the index needs. */
export const REQUIRED_EXTENSIONS = ['vector', 'pg_trgm'] as const;

/** pgvector's HNSW index covers up to 2000 dimensions; larger vectors scan exactly. */
const HNSW_MAX_DIMENSIONS = 2000;

/** Below the `pg_trgm` default of 0.6 so one typo in a five-letter word ("pilon" → "pylon") still matches. */
const FUZZY_THRESHOLD = 0.45;

export interface StoredChunk {
  id: string;
  source: Chunk['source'];
  entityRef: string;
  location: string;
  title: string;
  content: string;
}

/**
 * The knowledge index in the plugin's Postgres database: one row per chunk
 * carrying its embedding (pgvector), a generated full-text vector, and a
 * trigram index over its text.
 *
 * The table is a rebuildable cache of TechDocs and the catalog, so it is
 * managed here rather than by migrations: changing the embedding model or its
 * dimensions drops and recreates it, and the next run refills it.
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
    const signature = `${this.embeddingModelId}#${dimensions}`;

    await this.db.raw(
      `CREATE TABLE IF NOT EXISTS ${META} (key text PRIMARY KEY, value text NOT NULL)`,
    );
    const current = await this.db(META).where({ key: SIGNATURE_KEY }).first();
    if (current?.value === signature) {
      return;
    }

    await this.db.transaction(async tx => {
      await tx.raw(`DROP TABLE IF EXISTS ${CHUNKS}`);
      await tx.raw(`
        CREATE TABLE ${CHUNKS} (
          id text PRIMARY KEY,
          source text NOT NULL,
          entity_ref text NOT NULL,
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

  async hashes(): Promise<Map<string, string>> {
    const rows = await this.db(CHUNKS).select('id', 'content_hash');
    return new Map(rows.map(row => [row.id, row.content_hash]));
  }

  async upsert(chunks: Chunk[], embeddings: number[][]): Promise<void> {
    if (chunks.length === 0) {
      return;
    }
    await this.db(CHUNKS)
      .insert(
        chunks.map((chunk, i) => ({
          id: chunk.id,
          source: chunk.source,
          entity_ref: chunk.entityRef,
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

  /** Deletes chunks not seen this run, except those of entities whose docs failed to load. */
  async deleteExcept(
    keepIds: string[],
    keepEntityRefs: string[],
  ): Promise<number> {
    return this.db(CHUNKS)
      .whereRaw('NOT (id = ANY(?::text[]))', [keepIds])
      .whereRaw('NOT (entity_ref = ANY(?::text[]))', [keepEntityRefs])
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

  /** The words that match nothing in the index exactly — likely misspellings. */
  async unknownWords(words: string[]): Promise<string[]> {
    if (words.length === 0) {
      return [];
    }
    const { rows } = await this.db.raw(
      `SELECT w FROM unnest(?::text[]) AS w
        WHERE NOT EXISTS (
          SELECT 1 FROM ${CHUNKS} WHERE tsv @@ plainto_tsquery('english', w)
        )`,
      [words],
    );
    return rows.map((row: { w: string }) => row.w);
  }

  /**
   * Chunks whose text contains a near spelling of the words, ranked by summed
   * trigram word similarity. Run only for {@link unknownWords}: a word that
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
      .select('id', 'source', 'entity_ref', 'location', 'title', 'content')
      .whereRaw('id = ANY(?::text[])', [ids]);
    return rows.map(row => ({
      id: row.id,
      source: row.source,
      entityRef: row.entity_ref,
      location: row.location,
      title: row.title,
      content: row.content,
    }));
  }
}

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
