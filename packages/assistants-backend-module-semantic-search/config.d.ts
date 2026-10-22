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
      /**
       * Results per `search-knowledge` answer unless the caller asks for a
       * number. Defaults to 8.
       */
      maxResults?: number;
      /**
       * Settings per Backstage search document type, keyed by the type name
       * search uses (`software-catalog`, `techdocs`, or a collator's own type).
       * Types left out are copied and ranked with the defaults.
       */
      types?: {
        [type: string]: {
          /**
           * Multiplies the type's fused score. Defaults to 1; 0 means its
           * chunks are never returned.
           */
          weight?: number;
          /**
           * Searched when the caller names no types. Defaults to true; false
           * makes the type opt-in (the model passes it in `types`).
           */
          default?: boolean;
          /** At most this many of the type's results in one answer. */
          maxResults?: number;
          /**
           * Copied into the index. Defaults to true; false stops copying it
           * and deletes its chunks on its next search run.
           */
          enabled?: boolean;
          /**
           * What the source holds, shown to the model in the tool
           * description, e.g. "ticket history, decisions and status".
           */
          description?: string;
        };
      };
    };
  };
}
