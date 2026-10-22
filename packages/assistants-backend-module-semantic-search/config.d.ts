export interface Config {
  assistants?: {
    /**
     * The knowledge index: a copy of everything Backstage search indexes
     * (TechDocs, the catalog, and any other collator's documents), embedded
     * into the assistants plugin's Postgres database as each search run
     * finishes and served to assistants as the `search-knowledge` action.
     * Requires the search plugin in the same backend, and the `vector` and
     * `pg_trgm` extensions.
     */
    semanticSearch?: {
      /**
       * Embedding model in `<providerId>:<model>` format, resolved against
       * `assistants.providers`, e.g. `openai:text-embedding-3-small`. The
       * provider must be `openai`, `azure`, or `openai-compatible`. Changing it
       * rebuilds the index.
       */
      embeddingModel: string;
    };
  };
}
