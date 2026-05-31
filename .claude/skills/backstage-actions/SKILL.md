---
name: backstage-actions
description: 'Use the Backstage Actions registry as the tool primitive for AI agents: registering actions with a schema + handler, listing/invoking them scoped to the caller''s BackstageCredentials, exposing them over MCP, and adapting an ActionsServiceAction to an AI SDK tool(). Use when wiring agent tools in the ai-agents-backend /chat flow or anywhere actions are produced/consumed. Triggers on: "Backstage actions", "actions registry", "actionsServiceRef", "actionsRegistryServiceRef", "mcp-actions", "agent tools", "register an action", "actions.list", "actions.invoke", "@backstage/backend-plugin-api/alpha".'
---

# Backstage Actions as the agent tool primitive

The **Actions registry** is Backstage's first-class, platform-owned tool primitive. An action is a named, schema-described, permission-aware unit of work that any backend plugin can register, and that any backend plugin can list and invoke **scoped to the calling user's credentials**. MCP is just one *exposure* of the registry (`@backstage/plugin-mcp-actions-backend`).

For the `ai-agents` plugin this means: do **not** invent a tool format, a `-node` tool extension point, or an MCP bridge for our own capabilities. An agent's tools are Backstage actions named in its allowlist, resolved per request, invoked as the user. This is also the design the AWS Labs `genai` plugin converged on (it deprecated its custom `addTools(...)` extension point in favor of the registry).

## Critical: verify against the installed alpha `.d.ts`, do not trust memory

The Actions API lives in **`@backstage/backend-plugin-api/alpha`**, which is **unstable** (`@alpha`). Symbols, fields, and the zod major version drift between releases. Before writing or reviewing code, read the actually-installed types:

```
node_modules/@backstage/backend-plugin-api/dist/alpha.d.ts
```

Grep it for `ActionsRegistryActionOptions`, `ActionsServiceAction`, `ActionsService`, `actionsServiceRef`, `actionsRegistryServiceRef`. Pin the dependency and treat the shapes below as a snapshot, not gospel. Known drift is catalogued in [references/api-shapes.md](references/api-shapes.md). The Actions service was **not present** in `backend-plugin-api@1.3.0/alpha` — it landed around `1.4.x`. If a project pins `^1.3.0` it must bump before using actions.

## Two services, two roles, one import path

Both refs are imported from `@backstage/backend-plugin-api/alpha`. They serve opposite roles:

| Ref | Role | Use when |
| --- | --- | --- |
| `actionsRegistryServiceRef` (`ActionsRegistryService`) | **REGISTER** actions | A plugin contributes a tool (e.g. our core `search-catalog`) |
| `actionsServiceRef` (`ActionsService`) | **LIST + INVOKE** actions | A plugin consumes tools (e.g. `/chat` resolving an agent's allowlist) |

Wire them as `registerInit` deps:

```ts
import {
  actionsRegistryServiceRef,
  actionsServiceRef,
} from '@backstage/backend-plugin-api/alpha';

env.registerInit({
  deps: {
    actionsRegistry: actionsRegistryServiceRef, // register
    actions: actionsServiceRef,                 // list + invoke
    // ...coreServices.logger, httpAuth, etc.
  },
  async init({ actionsRegistry, actions }) { /* ... */ },
});
```

## Registering an action

`actionsRegistry.register(options)` where options are `ActionsRegistryActionOptions`:

- `name` — kebab-case, no plugin prefix (the registry prefixes it with the plugin id → id is `pluginId:name`).
- `title`, `description` — human/agent-readable. The description is what the LLM sees; write it for the model.
- `schema.input` / `schema.output` — **functions that receive `z` and return a zod object**: `input: z => z.object({ ... })`. NOT a bare zod object, NOT JSON Schema. This is the most common mistake.
- `attributes?` — `{ readOnly?, destructive?, idempotent? }` (booleans). Doc-stated defaults: `destructive` defaults `true`, `readOnly`/`idempotent` default `false`.
- `action` — async handler receiving `{ input, logger, credentials }` and returning `{ output: <matches output schema> }` (or `void` if the output schema is void). The handler **must** run all real work as `credentials`.

```ts
import { ActionsRegistryService } from '@backstage/backend-plugin-api/alpha';
import { DiscoveryService, AuthService } from '@backstage/backend-plugin-api';

export const registerSearchCatalogAction = (deps: {
  actionsRegistry: ActionsRegistryService;
  discovery: DiscoveryService;
  auth: AuthService;
}) => {
  deps.actionsRegistry.register({
    name: 'search-catalog',
    title: 'Search Catalog',
    description:
      'Search the Backstage catalog for entities, ordered by relevance.',
    attributes: { readOnly: true, idempotent: true, destructive: false },
    schema: {
      input: z =>
        z.object({
          query: z.string().describe('Search query'),
          kinds: z
            .string()
            .describe('Comma-separated entity kinds')
            .optional(),
        }),
      output: z => z.object({ response: z.string() }),
    },
    action: async ({ input, credentials }) => {
      // Mint an on-behalf-of token from the CALLER's credentials, never a static token.
      const { token } = await deps.auth.getPluginRequestToken({
        onBehalfOf: credentials,
        targetPluginId: 'search',
      });
      const url = `${await deps.discovery.getBaseUrl('search')}/query?term=${input.query}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { output: { response: await res.text() } };
    },
  });
};
```

## Listing + invoking with the caller's credentials (the load-bearing point)

Both `list` and `invoke` take a `credentials: BackstageCredentials`. They are **credential-scoped**: `list` returns only actions the caller may see (actions with a denied `visibilityPermission` are filtered out), and `invoke` enforces the same on execution (denied → `404`, as if the action doesn't exist). Threading the *caller's* credentials — not a shared service token — is what gives per-user permission enforcement.

```ts
// In the /chat handler, `credentials` is the caller from httpAuth.credentials(req, { allow: ['user'] }).
const { actions: available } = await actions.list({ credentials }); // user-scoped
const selected = available.filter(a => agent.actions.includes(a.name));

const { output } = await actions.invoke({
  id: action.id,        // "pluginId:name", e.g. "ai-agents:search-catalog"
  input: someJsonObject,
  credentials,          // SAME credentials — runs as the user
});
```

`ActionsServiceAction` (what `list` returns) carries: `id`, `name`, `title`, `description`, `schema: { input: JSONSchema7; output: JSONSchema7 }`, `attributes`, and (newer versions) `pluginId`. Note `schema.input` here is **JSONSchema7**, not zod — the registry converts the registered zod schema to JSON Schema on the way out.

There is **no** `action.action(...)` method on `ActionsServiceAction`. To execute, you call `actions.invoke({ id, input, credentials })` on the **service**. Match `agent.actions` against `a.name`; pass `a.id` to `invoke`.

## Adapting an action to an AI SDK `tool()`

Adapt each selected `ActionsServiceAction` to an AI SDK `tool()`, closing over the caller's credentials in `execute`. Because `a.schema.input` is `JSONSchema7`, use the AI SDK `jsonSchema()` helper (not zod) for `inputSchema`. (See the `ai-sdk` skill for the `tool()` shape and `jsonSchema()` semantics — both are from `ai`.)

```ts
import { tool, jsonSchema } from 'ai';

function adaptToAiSdkTools(
  selected: ActionsServiceAction[],
  actions: ActionsService,
  credentials: BackstageCredentials,
) {
  return Object.fromEntries(
    selected.map(a => [
      a.name,
      tool({
        description: a.description,
        inputSchema: jsonSchema(a.schema.input), // JSONSchema7 → AI SDK schema
        execute: async input => {
          const { output } = await actions.invoke({
            id: a.id,
            input: input as Record<string, unknown>,
            credentials, // runs AS THE USER
          });
          return output;
        },
      }),
    ]),
  );
}
```

Hand the result to `streamText({ tools, ... })`. The credentials captured in the closure are the same ones used for `list`, so a user can never reach data through a tool that they couldn't reach directly.

## Exposing the registry over MCP

`@backstage/plugin-mcp-actions-backend` exposes registered actions as MCP tools at `/api/mcp-actions/v1`. This is orthogonal to our in-process adapter above — it is for *external* MCP clients (Cursor, Claude), not how `/chat` consumes tools.

```ts
backend.add(import('@backstage/plugin-mcp-actions-backend'));
```

Config knobs (see [references/config-and-mcp.md](references/config-and-mcp.md) for the full set):

```yaml
backend:
  actions:
    pluginSources: # which plugins' actions are allowed to register (REQUIRED to surface them)
      - ai-agents
      - catalog
mcpActions:
  name: 'My Company Backstage'
  namespacedToolNames: true # toolnames as "pluginId.name"
```

`backend.actions.pluginSources` is owned by **Backstage core**, not our config schema — an action is only resolvable (via `actions.list` or MCP) if its owning plugin id is listed there. Document it; do not declare it in `config.d.ts`.

## Rules

- Register zod (`input: z => z.object(...)`); list/invoke see JSON Schema (`a.schema.input: JSONSchema7`). Don't cross them.
- Always pass the **caller's** `credentials` to both `list` and `invoke`. Never a static/service token for user-initiated tool calls.
- Execute via `actions.invoke({ id, input, credentials })` on `ActionsService`. There is no method on the listed action object.
- Match the allowlist on `a.name`; invoke by `a.id`.
- Unknown action names in an agent's allowlist are non-fatal — log and skip.
- `@backstage/backend-plugin-api/alpha` is unstable: pin it, and re-verify shapes against the installed `dist/alpha.d.ts` before trusting this skill.

## References

- [references/api-shapes.md](references/api-shapes.md) — verbatim alpha type definitions and version drift (`1.4.3` → `1.9.1`).
- [references/config-and-mcp.md](references/config-and-mcp.md) — `backend.actions.*`, `mcpActions.*`, MCP auth/external-access tokens.
