/**
 * Frontend plugin for Backstage AI Assistants.
 *
 * Targets the new frontend system; the plugin itself is published via the
 * `./alpha` subpath export. This entrypoint exposes the route refs and the
 * backend client API ref so host apps (e.g. a custom nav) can read the
 * browser-safe assistant list.
 *
 * @packageDocumentation
 */

export { rootRouteRef, threadRouteRef } from './routes';
export { assistantsApiRef } from './api';
export type { AssistantsApi, ConversationStatusRow, ThreadPatch } from './api';
/** Open the panel from a page component (undefined in an app without the panel). */
export { usePanelControl } from './panel/panelControl';
export type { PanelControl, PanelOpenOptions } from './panel/panelControl';
/** Nav-rail icon with a live working/unread status dot (for a host's custom nav). */
export { AssistantsNavIcon } from './AssistantsNavIcon';
/** Contribute a tool that runs in the user's browser, with their own credentials. */
export {
  AssistantClientToolBlueprint,
  clientToolDataRef,
  clientToolsApiRef,
} from './clientTools';
export type {
  AssistantClientTool,
  ClientToolsApi,
  ClientToolAuthRequirement,
  ClientToolContext,
  ClientToolInterrupt,
  ClientToolRenderProps,
} from './clientTools';
