/*
 * Portions of this file are adapted from AWS Labs' backstage-plugins-for-aws
 * (the `genai` plugin's `src/actions/*.ts`), Copyright Amazon.com, Inc. or its
 * affiliates, licensed under the Apache License, Version 2.0.
 *
 *   https://github.com/awslabs/backstage-plugins-for-aws
 *
 * Modifications by the backstage-assistants authors:
 *   - Consolidated the three core actions into a single module.
 *   - Registration is gated behind `assistants.builtinActions` and wired
 *     through this plugin's `register*CoreActions` entry point rather than the
 *     AWS extension-point plumbing.
 *   - Added the `actionsToTools` adapter (ActionsServiceAction -> AI SDK tool())
 *     which is original to this plugin and not derived from the AWS source.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

import {
  AuthService,
  BackstageCredentials,
  DiscoveryService,
  LoggerService,
} from '@backstage/backend-plugin-api';
import { JsonObject } from '@backstage/types';
import {
  ActionsRegistryService,
  ActionsService,
  ActionsServiceAction,
} from '@backstage/backend-plugin-api/alpha';
import { SearchResultSet } from '@backstage/plugin-search-common';
import { tool, jsonSchema, type Tool } from 'ai';
import { parse } from 'node-html-parser';
import TurndownService from 'turndown';
import { truncateToolResult } from './truncateToolResult';

/**
 * Dependencies needed to register the built-in core actions. Each action runs
 * its real work with the **caller's** credentials (minted on-behalf-of via the
 * auth service), never a static service token — this is what gives per-user
 * permission enforcement.
 */
export interface CoreActionsDeps {
  actionsRegistry: ActionsRegistryService;
  discovery: DiscoveryService;
  auth: AuthService;
}

/**
 * Registers the `search-catalog` action: a relevance-ordered search over the
 * Backstage catalog via the Search API. Adapted from the AWS `genai` plugin's
 * `catalogSearch.ts`.
 */
function registerSearchCatalogAction({
  actionsRegistry,
  discovery,
  auth,
}: CoreActionsDeps): void {
  actionsRegistry.register({
    name: 'search-catalog',
    title: 'Search Catalog',
    attributes: { destructive: false, readOnly: true, idempotent: true },
    description: `Search the Backstage catalog for entities. Results are ordered by relevance to the query.

Responses are paginated. To get the next page, pass the "nextPageCursor" value as the "pageCursor" parameter to the tool again.

DO NOT try to filter on kinds in the query string, always use the "kinds" parameter.
`,
    schema: {
      input: z =>
        z.object({
          query: z.string().describe('Search query'),
          kinds: z
            .string()
            .describe(
              'Comma-separated list of Backstage entity kinds. If not specified then all kinds are searched.',
            )
            .optional(),
          pageLimit: z
            .number()
            .describe('Number of results to return per page')
            .optional()
            .default(10),
          pageCursor: z
            .string()
            .describe('Cursor for the next page')
            .optional(),
        }),
      output: z => z.object({ response: z.string() }),
    },
    action: async ({ input, credentials }) => {
      const { kinds, pageCursor, query, pageLimit } = input;

      const filters: string[] = [];
      if (kinds) {
        kinds.split(',').forEach(kind => filters.push(`filters[kind]=${kind}`));
      }

      let fullQuery = `types[0]=software-catalog&term=${query}&pageLimit=${pageLimit}`;
      if (pageCursor) {
        fullQuery += `&pageCursor=${pageCursor}`;
      }
      if (filters.length > 0) {
        fullQuery += `&${filters.join('&')}`;
      }

      const url = `${await discovery.getBaseUrl('search')}/query?${fullQuery}`;
      const { token } = await auth.getPluginRequestToken({
        onBehalfOf: credentials,
        targetPluginId: 'search',
      });
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(
          `Catalog search failed (${response.status} ${response.statusText}): ${body}`,
        );
      }

      return { output: { response: body } };
    },
  });
}

/**
 * Registers the `search-techdocs` action: a relevance-ordered search over the
 * TechDocs index via the Search API. Adapted from the AWS `genai` plugin's
 * `techDocsSearch.ts`.
 */
function registerSearchTechDocsAction({
  actionsRegistry,
  discovery,
  auth,
}: CoreActionsDeps): void {
  actionsRegistry.register({
    name: 'search-techdocs',
    title: 'Search TechDocs',
    attributes: { destructive: false, readOnly: true, idempotent: true },
    description:
      'Searches the Backstage TechDocs internal documentation for the organization.',
    schema: {
      input: z =>
        z.object({
          query: z.string().describe('Search query'),
          pageLimit: z
            .number()
            .describe('Number of results to return per page')
            .optional()
            .default(5),
          pageCursor: z
            .string()
            .describe('Cursor for the next page')
            .optional(),
        }),
      output: z =>
        z.object({
          nextPageCursor: z.string().optional(),
          results: z.array(
            z.object({
              location: z.string(),
              title: z.string(),
              text: z.string(),
            }),
          ),
        }),
    },
    action: async ({ input, credentials }) => {
      const { pageCursor, query, pageLimit } = input;

      let fullQuery = `types[0]=techdocs&term=${query}&pageLimit=${pageLimit}`;
      if (pageCursor) {
        fullQuery += `&pageCursor=${pageCursor}`;
      }

      const url = `${await discovery.getBaseUrl('search')}/query?${fullQuery}`;
      const { token } = await auth.getPluginRequestToken({
        onBehalfOf: credentials,
        targetPluginId: 'search',
      });
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      // Surface the real upstream error (e.g. "Missing index for techdocs")
      // instead of blindly reading `.results` and throwing a generic TypeError.
      if (!response.ok) {
        throw new Error(
          `TechDocs search failed (${response.status} ${response.statusText}): ${await response.text()}`,
        );
      }
      const payload = (await response.json()) as SearchResultSet;

      return {
        output: {
          nextPageCursor: payload.nextPageCursor,
          results: payload.results.map(result => ({
            location: result.document.location,
            title: result.document.title,
            text: result.document.text,
          })),
        },
      };
    },
  });
}

/**
 * Registers the `read-techdocs` action: fetches a single TechDocs page and
 * returns its body rendered as Markdown. Adapted from the AWS `genai` plugin's
 * `techDocsRead.ts`.
 */
function registerReadTechDocsAction({
  actionsRegistry,
  discovery,
  auth,
}: CoreActionsDeps): void {
  const turndownService = new TurndownService();

  actionsRegistry.register({
    name: 'read-techdocs',
    title: 'Read TechDocs',
    attributes: { destructive: false, readOnly: true, idempotent: true },
    description: `Reads a specific page of Backstage TechDocs technical documentation and returns the content.

The location parameter can be found in TechDocs search results.

Alternatively the path to the root documentation page of a Backstage entity can be constructed as follows:

/docs/<namespace>/<kind>/<name>/

The response will be formatted as Markdown.`,
    schema: {
      input: z =>
        z.object({
          location: z.string().describe('Location path of the documentation'),
        }),
      output: z => z.object({ content: z.string() }),
    },
    action: async ({ input, credentials }) => {
      const url = new URL(
        `${await discovery.getBaseUrl('techdocs')}/static${input.location}`,
      );
      const pageUrl = `${url.origin}${url.pathname}`;

      const { token } = await auth.getPluginRequestToken({
        onBehalfOf: credentials,
        targetPluginId: 'techdocs',
      });
      const response = await fetch(
        `${pageUrl.endsWith('/') ? pageUrl : `${pageUrl}/`}index.html`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        },
      );
      if (!response.ok) {
        throw new Error(
          `Failed to read TechDocs page (${response.status} ${response.statusText}): ${await response.text()}`,
        );
      }
      const html = await response.text();

      const root = parse(html);
      const container = root.querySelector('.md-content');
      if (!container) {
        throw new Error('Failed to parse TechDocs page');
      }

      return {
        output: { content: turndownService.turndown(container.outerHTML) },
      };
    },
  });
}

/**
 * Registers all built-in core actions (`search-catalog`, `search-techdocs`,
 * `read-techdocs`) under the `assistants` source. Call this only when
 * `assistants.builtinActions` is true.
 *
 * Note: an action is only resolvable via {@link ActionsService} if `assistants`
 * is listed in the core `backend.actions.pluginSources` config.
 */
export function registerCoreActions(deps: CoreActionsDeps): void {
  registerSearchCatalogAction(deps);
  registerSearchTechDocsAction(deps);
  registerReadTechDocsAction(deps);
}

/**
 * Adapts a set of resolved {@link ActionsServiceAction}s to AI SDK
 * {@link Tool}s, keyed by action `name`.
 *
 * The listed action exposes its input schema as JSON Schema (not zod), so it is
 * wrapped with the AI SDK `jsonSchema()` helper. Each tool's `execute` closes
 * over the {@link ActionsService} and the **caller's** credentials and invokes
 * by the action's `id` — so the tool runs with the user's permissions, exactly
 * as `actions.list` was scoped. `ActionsServiceAction` itself has no
 * execute method; execution goes through `actions.invoke` on the service.
 *
 * A denied or failed invoke is caught and returned as a structured tool result
 * the model can explain — not thrown — so the turn continues.
 *
 * An oversized successful result is truncated to `toolResultMaxChars` (head+tail
 * with an elision marker) so one huge output can't overflow the model's context
 * window or bloat the persisted conversation. See {@link truncateToolResult}.
 */
export function actionsToTools(
  actions: ActionsServiceAction[],
  actionsService: ActionsService,
  credentials: BackstageCredentials,
  toolResultMaxChars: number,
): Record<string, Tool> {
  return Object.fromEntries(
    actions.map(a => [
      a.name,
      tool({
        description: a.description,
        inputSchema: jsonSchema(a.schema.input),
        execute: async input => {
          try {
            const result = await actionsService.invoke({
              id: a.id,
              input: input as JsonObject,
              credentials,
            });
            return truncateToolResult(result.output, toolResultMaxChars);
          } catch (error) {
            // Structured error result, not a throw — the model can explain it
            // and the multi-step loop continues. Cap the message too: an action
            // error can embed a full upstream response body, so the error path
            // is just as capable of overflowing the context window as success.
            return {
              _error: true,
              message: truncateToolResult(
                error instanceof Error ? error.message : String(error),
                toolResultMaxChars,
              ),
            };
          }
        },
      }),
    ]),
  );
}

/**
 * Resolves an assistant's tool allowlist from the actions the caller may see.
 *
 * Filters the credential-scoped action list down to the assistant's `actions`
 * by `name`; any allowlisted name that does not resolve to a visible action is
 * logged and skipped (non-fatal).
 */
export function selectAssistantActions(
  available: ActionsServiceAction[],
  allowlist: string[],
  logger: LoggerService,
): ActionsServiceAction[] {
  const byName = new Map(available.map(a => [a.name, a]));
  const selected: ActionsServiceAction[] = [];
  for (const name of allowlist) {
    const action = byName.get(name);
    if (action) {
      selected.push(action);
    } else {
      logger.warn(`Assistant action '${name}' is not available; skipping`, {
        action: name,
      });
    }
  }
  return selected;
}
