import { createApiRef } from '@backstage/core-plugin-api';
import type { AssistantClientTool } from './types';

/**
 * The client tools contributed to the app: every `AssistantClientToolBlueprint`
 * extension attaches to this API's `tools` input, and every surface that runs
 * a conversation (the page, the panel) reads them here. One registry, read
 * wherever a conversation renders, is the frontend system's way to share
 * extensions across locations.
 *
 * @public
 */
export interface ClientToolsApi {
  /** The contributed tools, in attachment order. */
  readonly tools: ReadonlyArray<AssistantClientTool<any, any>>;
}

/** @public */
export const clientToolsApiRef = createApiRef<ClientToolsApi>({
  id: 'plugin.assistants.client-tools',
});
