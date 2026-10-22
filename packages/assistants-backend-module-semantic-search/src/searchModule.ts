import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { searchIndexRegistryExtensionPoint } from '@backstage/plugin-search-backend-node/alpha';
import { readKnowledgeTypes } from './config';
import {
  AssistantsKnowledgeDecorator,
  KnowledgeTypeLabel,
  knowledgeFeedServiceRef,
} from './feed';

/**
 * The search side of the knowledge index: a decorator on every Backstage
 * search document type that hands each finished run's documents to
 * {@link assistantsModuleSemanticSearch}, plus a label on each type named in
 * `assistants.semanticSearch.types` so its runs arrive with their type.
 * Search indexes as before; the knowledge index copies what it collected, so
 * no source is read twice.
 *
 * @public
 */
export const searchModuleAssistantsKnowledge = createBackendModule({
  pluginId: 'search',
  moduleId: 'assistants-knowledge',
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        indexRegistry: searchIndexRegistryExtensionPoint,
        feed: knowledgeFeedServiceRef,
      },
      async init({ config, indexRegistry, feed }) {
        feed.tapped = true;
        indexRegistry.addDecorator({
          factory: new AssistantsKnowledgeDecorator(feed),
        });
        for (const [type, settings] of readKnowledgeTypes(config)) {
          indexRegistry.addDecorator({
            factory: new KnowledgeTypeLabel(feed, type, settings.enabled),
          });
        }
      },
    });
  },
});
