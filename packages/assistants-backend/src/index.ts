/**
 * Backend plugin for Backstage AI Assistants.
 *
 * @packageDocumentation
 */

export { assistantsPlugin as default } from './plugin';
export {
  assistantsModelProvidersExtensionPoint,
  type AssistantsModelProvider,
  type AssistantsModelProviderFactory,
  type AssistantsModelProvidersExtensionPoint,
  type AssistantsModelTurn,
  type AssistantsTurnTool,
} from './modelProviders';
