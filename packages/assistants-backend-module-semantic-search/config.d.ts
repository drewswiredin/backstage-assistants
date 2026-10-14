import { SchedulerServiceTaskScheduleDefinitionConfig } from '@backstage/backend-plugin-api';

export interface Config {
  assistants?: {
    /**
     * The knowledge index: published TechDocs sections and catalog entities
     * (except `Location`) embedded into
     * the assistants plugin's Postgres database and served to assistants as the
     * `search-knowledge` action. Requires the `vector` and `pg_trgm`
     * extensions.
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
       * How often the index refreshes. Each run embeds only new and changed
       * content. Default: every 30 minutes, 1 hour timeout, 15 s initial
       * delay; a configured schedule replaces it.
       */
      schedule?: SchedulerServiceTaskScheduleDefinitionConfig;
    };
  };
}
