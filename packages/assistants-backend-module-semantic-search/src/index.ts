/**
 * Knowledge index module for AI Assistants for Backstage.
 *
 * @packageDocumentation
 */

import { createBackendFeatureLoader } from '@backstage/backend-plugin-api';
import { assistantsModuleSemanticSearch } from './module';
import { searchModuleAssistantsKnowledge } from './searchModule';

export { assistantsModuleSemanticSearch, searchModuleAssistantsKnowledge };

/**
 * Both halves of the knowledge index, added with one `backend.add`: the
 * assistants module (the index and `search-knowledge`) and the search module
 * (the decorator that copies what Backstage search collects).
 *
 * @public
 */
export default createBackendFeatureLoader({
  loader: () => [
    assistantsModuleSemanticSearch,
    searchModuleAssistantsKnowledge,
  ],
});
