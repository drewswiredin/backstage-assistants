# @drewswiredin/backstage-plugin-assistants-backend

Backend for the Backstage AI Assistants plugin: serves assistant metadata,
streams chat completions, and runs Backstage actions as tools **on behalf of the
calling user** (respecting their permissions). Assistant definitions (prompt,
access, tools, models) live in the plugin **database** and are managed in an
in-app admin editor; `app-config.yaml` holds only the platform/safety surface
(providers, MCP servers, the `requireApproval` floor, UI defaults, limits).
Prompts, access policies, and API keys never reach the browser.

Pairs with the frontend plugin
[`@drewswiredin/backstage-plugin-assistants`](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants).

## Install

```bash
yarn --cwd packages/backend add @drewswiredin/backstage-plugin-assistants-backend
```

```ts
// packages/backend/src/index.ts
backend.add(import('@drewswiredin/backstage-plugin-assistants-backend'));
```

Requires the new backend system (`@backstage/backend-defaults`).

## Configuration

All options live under `assistants` in `app-config.yaml`. This block now holds
only the platform/safety surface — there is **no `profiles:` block**.

### Assistant definitions (database + admin editor)

Assistant definitions (title, description, prompt, access, tools, models) persist
in the plugin `assistants` table (`definition_json` TEXT, portable across SQLite
and Postgres). The table is seeded with one default assistant on first run.
Definitions are created, edited, and deleted at runtime via the **admin editor**
(a gear in the chat sidebar) — never in `app-config.yaml`. The
`assistant.manage` permission controls who may manage them.

```yaml
assistants:
  defaultModel: openrouter:google/gemini-2.5-flash # provider:model; must exist in a provider
  maxSteps: 8 # max tool-call steps per turn (default 10)
  builtinActions: true # register built-in catalog/TechDocs read tools

  # Global approval floor: these tools always pause for Allow/Deny in chat.
  requireApproval:
    - register-entity
    - unregister-entity
    - execute-template

  providers:
    openrouter:
      type: openai-compatible # openai | anthropic | azure | openai-compatible
      apiKey: ${OPENROUTER_API_KEY} # @visibility secret
      baseUrl: https://openrouter.ai/api/v1 # optional
      models: # object list: required name, optional contextWindow (drives the gauge)
        - name: google/gemini-2.5-flash
          contextWindow: 1048576
        - name: anthropic/claude-3.5-sonnet

  ui: # global UI defaults, deep-merged UNDER each assistant's own ui
    composer:
      placeholder: 'Send a message…'
    suggestions: []
```

### Config reference

| Key | Required | Description |
| --- | --- | --- |
| `defaultModel` | yes | Initial `provider:model`; must exist in a provider. |
| `maxSteps` | no | Max tool-call steps per turn (default `10`). |
| `builtinActions` | no | Register built-in catalog/TechDocs read tools (default `false`). |
| `toolResultMaxChars` | no | Max chars of a single tool result (head+tail truncation; `0` disables; default `30000`). |
| `requireApproval` | no | Global approval floor: action ids gated by Allow/Deny in chat. |
| `providers.<id>.type` | yes | `openai` \| `anthropic` \| `azure` \| `openai-compatible`. |
| `providers.<id>.apiKey` | yes | Provider key (`@visibility secret`). |
| `providers.<id>.baseUrl` | no | Base URL override. |
| `providers.<id>.models` | yes | Object list; each `{ name, contextWindow? }`. |
| `mcp.servers.<id>` | no | External MCP server connections (see MCP section). |
| `ui` | no | Global composer placeholder + starter suggestions (deep-merged under each assistant). |

### Example operating instructions

This package ships ready-to-use system prompts you can copy and tailor — after
install they're at
`node_modules/@drewswiredin/backstage-plugin-assistants-backend/examples/prompts/`:

- `general-assistant.md` — read-only catalog/TechDocs helper (scope, guardrails,
  search strategy, Markdown/Mermaid formatting).
- `devops-assistant.md` — adds write/scaffolding tools with a confirm-before-acting
  policy.

Open one and **paste** it into an assistant's prompt field in the admin editor —
prompts live in the DB definition, not `app-config.yaml`.

## Providers

Model ids are `<providerId>:<model>`, where `providerId` is your key under
`providers`. All four `type`s are built in **and their AI-SDK packages ship with
this plugin — no extra packages to install**. You can configure several providers
at once; the union of their `models` is the global pool.

**OpenAI-compatible** (OpenRouter, local gateways, etc.) — uses the OpenAI SDK
with a `baseUrl`:

```yaml
providers:
  openrouter:
    type: openai-compatible
    apiKey: ${OPENROUTER_API_KEY}
    baseUrl: https://openrouter.ai/api/v1
    models: [google/gemini-2.5-flash, anthropic/claude-3.5-sonnet]
# -> ids: openrouter:google/gemini-2.5-flash
```

**OpenAI**:

```yaml
providers:
  openai:
    type: openai
    apiKey: ${OPENAI_API_KEY}
    models: [gpt-4o, gpt-4o-mini]
# -> ids: openai:gpt-4o
```

**Anthropic**:

```yaml
providers:
  anthropic:
    type: anthropic
    apiKey: ${ANTHROPIC_API_KEY}
    models: [claude-3-5-sonnet-latest, claude-3-5-haiku-latest]
# -> ids: anthropic:claude-3-5-sonnet-latest
```

**Azure OpenAI / AI Foundry** — `models` are your **deployment names**; point
`baseUrl` at your endpoint and pass extra connection settings (e.g.
`apiVersion`) via `options`:

```yaml
providers:
  azure:
    type: azure
    apiKey: ${AZURE_API_KEY}
    baseUrl: https://<resource>.openai.azure.com # or your Foundry endpoint
    options:
      apiVersion: '2024-10-21'
    models: [my-gpt4o-deployment]
# -> ids: azure:my-gpt4o-deployment
```

## Tools (actions)

Assistants call Backstage **actions** as tools, executed with the caller's
credentials. Availability depends on what's registered in your backend:

- `builtinActions: true` provides `search-catalog`, `search-techdocs`, and
  `read-techdocs`.
- Additional actions (e.g. `query-catalog-entities`, `get-catalog-entity`,
  `register-entity`, `unregister-entity`, `execute-template`) come from the
  relevant action-providing plugins (catalog / scaffolder / TechDocs action
  modules, `@backstage/plugin-mcp-actions-backend`). Assign the action ids you
  want to an assistant's tool list in the editor.

> **Required:** Backstage's actions service only exposes actions from the plugin
> sources you allow. You **must** add `assistants` (and any other source whose
> actions you use, e.g. `catalog`, `scaffolder`) to
> `backend.actions.pluginSources` — otherwise an assistant's tools resolve to an
> empty list:
>
> ```yaml
> backend:
>   actions:
>     pluginSources:
>       - catalog
>       - scaffolder
>       - assistants # <-- needed for builtinActions / this plugin's tools
> ```

An assistant only sees the intersection of its `allowedTools` and the actions
the **calling user** may see/run.

## MCP servers (external tools)

Assistants can also call tools from external **MCP (Model Context Protocol)**
servers (GitHub, Atlassian, Azure DevOps, internal servers, …). Declare servers
under `assistants.mcp.servers`. An assistant opts in to individual MCP tools by
**selecting them in the editor**; each becomes a unified `allowedTools` entry
namespaced `<serverId>__<tool>` (and shows in the detail modal). There is no
per-assistant server allowlist in config.

Transports (the full `@modelcontextprotocol/sdk` client set):

- **`http`** (Streamable HTTP, default) / **`sse`** / **`websocket`** — remote,
  use `url` (`http`/`sse` also accept `headers`).
- **`stdio`** — spawn a local MCP server process: `command` (+ `args`, `env`,
  `cwd`).

```yaml
assistants:
  mcp:
    servers:
      # remote (Streamable HTTP) with a static auth header
      github:
        transport: http # http | sse | websocket | stdio
        url: https://api.githubcopilot.com/mcp/
        headers:
          Authorization: Bearer ${GITHUB_MCP_TOKEN} # @visibility secret
        # un-namespaced tool names that join the global approval floor as github__<tool>
        requireApproval: [create_pull_request]
      # local process over stdio
      filesystem:
        transport: stdio
        command: npx
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/data']
        env:
          SOME_TOKEN: ${SOME_TOKEN} # @visibility secret
        # cwd: /optional/working/dir
```

A server's tools are assigned to an assistant individually in the editor; the
selection lives in that assistant's unified `allowedTools` as namespaced
`<serverId>__<tool>` entries, applied to both `/chat` and the `/status` tool
listing (so the detail modal shows only the selected tools).

> **Per-server approval floor.** `assistants.mcp.servers.<id>.requireApproval`
> lists un-namespaced tool names that join the global approval floor as
> `<serverId>__<tool>` — see [Human-in-the-loop](#human-in-the-loop-approvals--forms).

> **Auth is a single static credential** (the configured `headers`) — i.e. one
> shared identity for all users, **not run-as-user**. Gate access with the
> assistant's `access` policy. (Per-user identity propagation — e.g. Entra OBO
> for Azure DevOps — is a planned enhancement.)

### MCP probing is server-side and scheduled

MCP tool inventories are refreshed **in the background, on a schedule** — a task
(`coreServices.scheduler`) probes every configured server every few minutes,
bounded by an ~8s per-server timeout, and keeps a warm cache. `GET /status` reads
that cache **synchronously**, so loading the plugin **never connects to an MCP
server or blocks on a slow/unreachable one** (a server's tools simply fill in on
the next warm cycle). `/chat` opens live connections per turn (closed when the
response finishes), and `/capabilities` (the editor) is served from the same warm
cache — keeping its per-server reachability and manual refresh. Tool listing for
an unreachable server is logged and skipped; it never breaks a turn or `/status`.

## Human-in-the-loop (approvals & forms)

Two ways a turn pauses for the user instead of running autonomously. Both are
enforced in the model loop, not requested of the model.

### Approval gate (`requireApproval`)

The approval gate is **global**, not per-assistant. List tool ids in top-level
`assistants.requireApproval` and/or a server's `mcp.servers.<id>.requireApproval`
and they are gated behind an explicit **Allow / Deny** in the chat before they
ever run:

```yaml
assistants:
  requireApproval: # confirmed before running, for every assistant allowed them
    - register-entity
    - unregister-entity
    - execute-template
```

These form a global approval floor; the effective set for an assistant is the
floor ∩ its `allowedTools` (a floored tool an assistant isn't given is simply
never hit). There is no per-assistant approval field.

For each gated tool the backend sets the AI SDK's `needsApproval` flag, so
`streamText` emits an approval request and **skips the tool's execution** until
the user answers — Allow runs it (under the same run-as-user identity), Deny
returns an `execution-denied` result to the model. This is deterministic and
code-enforced: it does not depend on the model choosing to ask. Names match
action ids or namespaced `<server>__<tool>` MCP tools; a name not in the
assistant's tool set is logged and ignored. It's a confirmation checkpoint,
**orthogonal to authorization** — Backstage's per-user permissions still apply
when an approved action invokes.

### Interactive forms (`render_form`)

The model can render an inline RJSF form instead of asking a string of questions
in chat — useful for structured, multi-field, or multiple-choice input. It's a
built-in **client-side** tool (always available, no config); the user fills and
submits, and the values flow back as the tool result. Forms render Backstage
**scaffolder field extensions** (owner / entity / repo pickers, plus any custom
field the host app has registered) resolved at runtime, so the model can reuse a
scaffolder template's parameter block verbatim. See the
[architecture §4](../../docs/architecture.html#hitl).

## Security

- Prompts and access policies are backend-only — never sent to the browser.
- `apiKey` is `@visibility secret` (redacted in logs/responses).
- The browser receives only a projection over `GET /status`: titles,
  descriptions, the model pool/defaults, the resolved tool list (name +
  description), and `ui`.

### Permissions

The plugin defines two Backstage permissions in
`@drewswiredin/backstage-plugin-assistants-common` (exported as
`assistantUsePermission`, `assistantManagePermission`, and the
`assistantsPermissions` array):

| Permission | `name` | Gates |
| --- | --- | --- |
| `assistantUsePermission` | `assistant.use` | the user-facing routes (`GET /status`, `POST /chat`, `POST /title`, `/threads`) and the chat surface |
| `assistantManagePermission` | `assistant.manage` | `/manage/*` + `/capabilities` and the admin editor (the gear) |

Both are enforced server-side via `coreServices.permissions` (403 when denied)
and gated client-side with `usePermission`. **Which assistants** an
`assistant.use` holder then sees is the separate per-assistant **access policy**
stored on each definition — orthogonal to these permissions.

#### Wiring it up — grant the permissions in a permission policy

Who holds each permission is decided by your app's
[`PermissionPolicy`](https://backstage.io/docs/permissions/writing-a-policy). A
fresh `create-app` backend installs
`@backstage/plugin-permission-backend-module-allow-all-policy`, which grants
**everything to everyone** — fine for trying the plugin out, but it restricts
nothing. To actually gate use and management, replace it with a policy that
authorizes the two permissions for the right users (here, by group membership):

```ts
// packages/backend/src/permissionPolicy.ts
import { createBackendModule } from '@backstage/backend-plugin-api';
import { policyExtensionPoint } from '@backstage/plugin-permission-node/alpha';
import {
  PermissionPolicy,
  PolicyQuery,
  PolicyQueryUser,
} from '@backstage/plugin-permission-node';
import {
  AuthorizeResult,
  PolicyDecision,
} from '@backstage/plugin-permission-common';

class AssistantsPolicy implements PermissionPolicy {
  async handle(
    req: PolicyQuery,
    user?: PolicyQueryUser,
  ): Promise<PolicyDecision> {
    const name = req.permission.name;
    if (name === 'assistant.use' || name === 'assistant.manage') {
      // Group memberships arrive as ownership entity refs on the caller.
      const groups = user?.info.ownershipEntityRefs ?? [];
      const isAdmin = groups.includes('group:default/assistants-admins');
      const isUser = groups.includes('group:default/assistants-users');
      const allowed = name === 'assistant.manage' ? isAdmin : isUser || isAdmin;
      return { result: allowed ? AuthorizeResult.ALLOW : AuthorizeResult.DENY };
    }
    // Leave every other plugin's permissions to your wider policy.
    return { result: AuthorizeResult.ALLOW };
  }
}

export default createBackendModule({
  pluginId: 'permission',
  moduleId: 'assistants-policy',
  register(reg) {
    reg.registerInit({
      deps: { policy: policyExtensionPoint },
      async init({ policy }) {
        policy.setPolicy(new AssistantsPolicy());
      },
    });
  },
});
```

Then wire it into the backend and drop the allow-all module (the policy
extension point accepts exactly one policy):

```ts
// packages/backend/src/index.ts
backend.add(import('@backstage/plugin-permission-backend'));
// backend.add(import('@backstage/plugin-permission-backend-module-allow-all-policy')); // remove
backend.add(import('./permissionPolicy'));
```

Grant `assistant.use` to anyone who may chat, and `assistant.manage` to admins
who may run the editor. Group membership comes from the caller's
`ownershipEntityRefs`, resolved by your auth provider from the catalog — so the
groups referenced above must exist and the users be members.

> **Default-allow, like every plugin.** With permissions disabled
> (`permission.enabled: false`, the default) or the allow-all policy in place,
> both permissions are granted to everyone. Gating takes effect only once you
> enable permissions **and** install a policy like the one above.

> **Working example in this repo.** The dev app ships a group-based policy at
> `packages/backend/src/permissionPolicy.ts` and a dev sign-in picker
> (`packages/app/src/modules/signIn`) that lets you log in as a no-access / user
> / admin identity to exercise all three roles end to end.

### Admin / management API

The admin editor is backed by `GET /capabilities` and the
`GET`/`POST`/`PUT`/`DELETE` `/manage/assistants` endpoints — all under
`/api/assistants`. Every one is gated by the `assistant.manage` permission and
returns **403** for callers who lack it.

- `GET /capabilities` returns the live, assignable inventory — Backstage actions,
  the model pool, each MCP server's reachability + tools, and the global approval
  floor — that feeds the editor's pickers.
- `GET`/`POST`/`PUT`/`DELETE /manage/assistants` read and mutate the full
  assistant definitions, including the prompt, access policy, and audit fields
  (creator/editor + timestamps).

## License

Apache-2.0
