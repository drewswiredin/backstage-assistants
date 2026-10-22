import {
  createExtensionBlueprint,
  createExtensionBlueprintParams,
  createExtensionDataRef,
} from '@backstage/frontend-plugin-api';
import type { JsonObject } from '@backstage/types';
import type { AssistantClientTool } from './types';

/**
 * Extension data carrying one {@link AssistantClientTool} to the assistants page.
 *
 * @public
 */
export const clientToolDataRef = createExtensionDataRef<
  AssistantClientTool<any, any>
>().with({ id: 'assistants.client-tool' });

/**
 * Contributes a client tool to the assistants page. Any plugin or app module
 * installs one extension per tool; nothing in the assistants plugin names the
 * contributor.
 *
 * @example
 * ```ts
 * AssistantClientToolBlueprint.make({
 *   name: 'browser-locale',
 *   params: defineParams =>
 *     defineParams({
 *       name: 'browser__get_locale',
 *       description: "The user's browser language and time zone.",
 *       inputSchema: { type: 'object', properties: {} },
 *       attributes: { readOnly: true },
 *       execute: async () => ({
 *         language: navigator.language,
 *         timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
 *       }),
 *     }),
 * });
 * ```
 *
 * @public
 */
export const AssistantClientToolBlueprint = createExtensionBlueprint({
  kind: 'assistant-client-tool',
  attachTo: { id: 'api:assistants/client-tools', input: 'tools' },
  output: [clientToolDataRef],
  dataRefs: { tool: clientToolDataRef },
  defineParams<TInput extends JsonObject, TOutput = unknown>(
    tool: AssistantClientTool<TInput, TOutput>,
  ) {
    return createExtensionBlueprintParams<AssistantClientTool<any, any>>(tool);
  },
  factory(params) {
    return [clientToolDataRef(params)];
  },
});
