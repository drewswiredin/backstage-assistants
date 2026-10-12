import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { actionsRegistryServiceRef } from '@backstage/backend-plugin-api/alpha';
import { CatalogClient } from '@backstage/catalog-client';
import { registerSearchKnowledgeAction } from './action';
import { readSemanticSearchConfig } from './config';
import { runIndex } from './indexer';
import { collectDocuments } from './sources';
import { KnowledgeStore } from './store';

/**
 * The knowledge index for AI Assistants. Keeps TechDocs sections and catalog
 * entities embedded in the assistants plugin's Postgres database and registers
 * the `search-knowledge` action over them.
 *
 * Off (with a log line saying why) when `assistants.semanticSearch` is absent, the
 * database is not Postgres, or the `vector` / `pg_trgm` extensions are missing.
 *
 * @public
 */
export const assistantsModuleSemanticSearch = createBackendModule({
  pluginId: 'assistants',
  moduleId: 'semantic-search',
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        database: coreServices.database,
        scheduler: coreServices.scheduler,
        discovery: coreServices.discovery,
        auth: coreServices.auth,
        actionsRegistry: actionsRegistryServiceRef,
      },
      async init({
        config,
        logger,
        database,
        scheduler,
        discovery,
        auth,
        actionsRegistry,
      }) {
        const settings = readSemanticSearchConfig(config);
        if (!settings) {
          logger.info(
            'Knowledge index is off: set assistants.semanticSearch.embeddingModel to enable it',
          );
          return;
        }

        const db = await database.getClient();
        if (!KnowledgeStore.isPostgres(db)) {
          logger.warn(
            'Knowledge index is off: it needs the assistants plugin database on Postgres',
          );
          return;
        }

        const store = new KnowledgeStore(db, settings.embeddingModelId);
        const missing = await store.ensureExtensions();
        if (missing.length > 0) {
          logger.error(
            `Knowledge index is off: the ${missing.join(
              ' and ',
            )} extension is not enabled. ` +
              `Ask a database admin to run, in this plugin's database: ${missing
                .map(
                  extension => `CREATE EXTENSION IF NOT EXISTS ${extension};`,
                )
                .join(' ')}`,
          );
          return;
        }

        const catalog = new CatalogClient({ discoveryApi: discovery });

        registerSearchKnowledgeAction({
          actionsRegistry,
          store,
          catalog,
          auth,
          embeddingModel: settings.embeddingModel,
        });

        await scheduler.scheduleTask({
          id: 'assistants-semantic-search-index',
          // One replica refreshes the shared index.
          scope: 'global',
          ...settings.schedule,
          fn: () =>
            runIndex({
              store,
              embeddingModel: settings.embeddingModel,
              collect: () =>
                collectDocuments({ catalog, discovery, auth, config, logger }),
              logger,
            }),
        });
      },
    });
  },
});
