import {
  coreServices,
  createBackendModule,
  type LoggerService,
} from '@backstage/backend-plugin-api';
import { actionsRegistryServiceRef } from '@backstage/backend-plugin-api/alpha';
import { CatalogClient } from '@backstage/catalog-client';
import { registerSearchKnowledgeAction } from './action';
import { readSemanticSearchConfig } from './config';
import { knowledgeFeedServiceRef } from './feed';
import { runIndex } from './indexer';
import {
  defaultRanker,
  knowledgeRankingExtensionPoint,
  typeSettingsOf,
  type KnowledgeRanker,
} from './ranking';
import { KnowledgeStore } from './store';

/**
 * The knowledge index for AI Assistants. Keeps a copy of everything Backstage
 * search indexes embedded in the assistants plugin's Postgres database, fed
 * by {@link searchModuleAssistantsKnowledge} as each search run finishes, and
 * registers the `search-knowledge` action over it. Runs are copied one at a
 * time, in the order they finish. Other modules can replace how results are
 * picked through `knowledgeRankingExtensionPoint`.
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
    let customRanker: KnowledgeRanker | undefined;
    env.registerExtensionPoint(knowledgeRankingExtensionPoint, {
      setRanker(ranker) {
        if (customRanker) {
          throw new Error('The knowledge ranker has already been set');
        }
        customRanker = ranker;
      },
    });

    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        database: coreServices.database,
        lifecycle: coreServices.lifecycle,
        discovery: coreServices.discovery,
        auth: coreServices.auth,
        actionsRegistry: actionsRegistryServiceRef,
        feed: knowledgeFeedServiceRef,
      },
      async init({
        config,
        logger,
        database,
        lifecycle,
        discovery,
        auth,
        actionsRegistry,
        feed,
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
        const settingsOf = typeSettingsOf(settings.types);
        const fallbackRanker = defaultRanker(settingsOf);

        registerSearchKnowledgeAction({
          actionsRegistry,
          store,
          catalog,
          auth,
          embeddingModel: settings.embeddingModel,
          types: settings.types,
          maxResults: settings.maxResults,
          ranker: () => customRanker ?? fallbackRanker,
        });

        let queue = Promise.resolve();
        feed.listen(({ type, documents }) => {
          queue = queue.then(() =>
            (type && !settingsOf(type).enabled
              ? dropType(store, type, logger)
              : runIndex({
                  store,
                  embeddingModel: settings.embeddingModel,
                  type,
                  documents,
                  logger,
                })
            ).catch(error =>
              logger.error('Knowledge index refresh failed', error),
            ),
          );
        });

        lifecycle.addStartupHook(() => {
          if (!feed.tapped) {
            logger.warn(
              'Knowledge index is empty: it copies what Backstage search indexes, and the search plugin (@backstage/plugin-search-backend) is not installed in this backend',
            );
          }
        });
      },
    });
  },
});

/** Deletes what the index holds of a type that is no longer copied. */
async function dropType(
  store: KnowledgeStore,
  type: string,
  logger: LoggerService,
): Promise<void> {
  if (!(await store.isReady())) {
    return;
  }
  const dropped = await store.dropType(type);
  if (dropped > 0) {
    logger.info('Knowledge index dropped a type that is not copied', {
      type,
      dropped,
    });
  }
}
