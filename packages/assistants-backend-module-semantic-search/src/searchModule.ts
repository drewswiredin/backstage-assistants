import { createBackendModule } from '@backstage/backend-plugin-api';
import { searchIndexRegistryExtensionPoint } from '@backstage/plugin-search-backend-node/alpha';
import { AssistantsKnowledgeDecorator, knowledgeFeedServiceRef } from './feed';

/**
 * The search side of the knowledge index: a decorator on every Backstage
 * search document type that hands each finished run's documents to
 * {@link assistantsModuleSemanticSearch}. Search indexes as before; the
 * knowledge index copies what it collected, so no source is read twice.
 *
 * @public
 */
export const searchModuleAssistantsKnowledge = createBackendModule({
  pluginId: 'search',
  moduleId: 'assistants-knowledge',
  register(env) {
    env.registerInit({
      deps: {
        indexRegistry: searchIndexRegistryExtensionPoint,
        feed: knowledgeFeedServiceRef,
      },
      async init({ indexRegistry, feed }) {
        feed.tapped = true;
        indexRegistry.addDecorator({
          factory: new AssistantsKnowledgeDecorator(feed),
        });
      },
    });
  },
});
