# @drewswiredin/backstage-plugin-assistants-backend

Backend for AI Assistants for Backstage. It serves assistant metadata, streams
replies, and runs Backstage actions as tools with the calling user's
credentials. Assistant definitions live in the plugin database and are edited
in-app; `app-config.yaml` holds providers, MCP servers, the approval gate, and
runtime limits.

Pairs with the frontend plugin
[`@drewswiredin/backstage-plugin-assistants`](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants).

## Requirements

- Backstage 1.54 or later on the new backend system
  (`@backstage/backend-defaults`).
- Node 22.12 or later.
- A plugin database: SQLite, Postgres, or MySQL.
- Recommended: `@backstage/plugin-signals-backend`, so working and unread
  status reaches the browser as Signals rather than by polling.

## Install

```bash
yarn --cwd packages/backend add @drewswiredin/backstage-plugin-assistants-backend
```

```ts
// packages/backend/src/index.ts
backend.add(import('@drewswiredin/backstage-plugin-assistants-backend'));
```

The backend refuses to start until `assistants.defaultModel` and at least one
provider with one model are configured. Tables are created by migrations at
startup; there is nothing to run. On a healthy start the log shows
`AI Assistants backend plugin initialized` with model, default-model and
assistant counts.

Under create-app's default allow-all permission policy every signed-in user
can use and manage assistants; see [Permissions](#permissions) to gate either.

Add `assistants` (and `catalog`, `scaffolder`, etc.) to
`backend.actions.pluginSources`, or an assistant's tools resolve to an empty
list; see [Tools](#tools-actions).

### Startup errors

Each of these is an `InputError` raised while reading config; the backend
exits with the message:

- `Unsupported provider type '<type>' for provider '<id>'`: `type` is not one
  of `openai`, `anthropic`, `azure`, `openai-compatible`.
- `assistants config must declare at least one model`: no provider has a
  `models` entry.
- `assistants.defaultModel '<id>' is not one of the configured models`:
  `defaultModel` is not `<providerId>:<model>` for a model in the pool.
- `assistants.mcp.servers.<id>.transport must be one of 'http', 'sse', 'stdio'`.
- `assistants.mcp.servers.<id>: stdio transport requires 'command'`.
- `assistants.mcp.servers.<id>: '<transport>' transport requires 'url'`: an
  `http` or `sse` server without `url`.
- `assistants.mcp.connectTimeoutMs must be a positive number of milliseconds`
  (or the per-server `assistants.mcp.servers.<id>.connectTimeoutMs`).
- `assistants model '<id>': maxOutputTokens must be a positive number of tokens`.

## Configuration

All options live under `assistants` in `app-config.yaml`. The block holds the
platform surface only.

### Assistant definitions (database + admin editor)

Assistant definitions (title, description, prompt, access, tools, models)
persist in the plugin `assistants` table. The table is seeded with one default
assistant on first run. Definitions are created, edited, and deleted at runtime
in the admin editor (a gear in the chat sidebar), never in `app-config.yaml`.
The `assistant.manage` permission controls who may manage them.

Minimal configuration:

```yaml
assistants:
  defaultModel: openrouter:anthropic/claude-sonnet-5
  builtinActions: true
  providers:
    openrouter:
      type: openai-compatible
      apiKey: ${OPENROUTER_API_KEY}
      baseUrl: https://openrouter.ai/api/v1
      models:
        - name: anthropic/claude-sonnet-5
          contextWindow: 1000000
```

Every option in one place:

```yaml
assistants:
  defaultModel: openrouter:anthropic/claude-sonnet-5 # <providerId>:<model>
  maxSteps: 8 # tool-call steps per turn (default 10)
  toolResultMaxChars: 30000 # per tool result; 0 disables truncation
  builtinActions: true # built-in catalog/TechDocs read tools
  requestBodyLimit: 10mb
  requireApproval: # tools that pause for Allow / Deny
    - register-entity
    - unregister-entity
    - execute-template
  providers:
    openrouter:
      type: openai-compatible # openai | anthropic | azure | openai-compatible
      apiKey: ${OPENROUTER_API_KEY}
      baseUrl: https://openrouter.ai/api/v1
      models:
        - name: anthropic/claude-sonnet-5
          contextWindow: 1000000 # drives the context gauge
          reasoning: true # offers the effort picker
        - name: openai/gpt-5.5
          contextWindow: 400000
          reasoning: true
  mcp:
    connectTimeoutMs: 8000
    servers:
      github:
        transport: http
        url: https://api.githubcopilot.com/mcp/
        headers:
          Authorization: Bearer ${GITHUB_MCP_TOKEN}
        requireApproval: [create_pull_request]
```

### Config reference

| Key                                       | Required | Description                                                                                                                                                  |
| ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `defaultModel`                            | yes      | Initial `<providerId>:<model>`; must exist in a provider.                                                                                                    |
| `maxSteps`                                | no       | Max tool-call steps per turn (default `10`).                                                                                                                 |
| `builtinActions`                          | no       | Register built-in catalog/TechDocs read tools (default `false`).                                                                                             |
| `toolResultMaxChars`                      | no       | Max chars of a single tool result (head+tail truncation; `0` disables; default `30000`).                                                                     |
| `requireApproval`                         | no       | Action ids gated by Allow / Deny in the conversation.                                                                                                        |
| `providers.<id>.type`                     | yes      | `openai` \| `anthropic` \| `azure` \| `openai-compatible`.                                                                                                   |
| `providers.<id>.apiKey`                   | yes      | Provider key (secret).                                                                                                                                       |
| `providers.<id>.baseUrl`                  | no       | Base URL override.                                                                                                                                           |
| `providers.<id>.options`                  | no       | Untyped passthrough object spread into the `@ai-sdk/*` factory (e.g. Azure `apiVersion`). Not schema-validated; keep credentials out of it and use `apiKey`. |
| `providers.<id>.models`                   | yes      | Object list; each `{ name, contextWindow?, reasoning?, maxOutputTokens? }`. A plain string list is rejected at startup.                                      |
| `providers.<id>.models[].maxOutputTokens` | no       | Output-token ceiling; must be > 0. Only needed when the provider misjudges an unrecognized model id.                                                         |
| `providers.<id>.models[].reasoning`       | no       | `true` if the model reasons; adds the effort picker (see Reasoning effort).                                                                                  |
| `mcp.connectTimeoutMs`                    | no       | Global MCP connect/list-tools timeout ceiling in ms; must be > 0 (default `8000`).                                                                           |
| `mcp.servers.<id>`                        | no       | External MCP server connections (see MCP section).                                                                                                           |
| `mcp.servers.<id>.transport`              | no       | `http` \| `sse` \| `stdio` (default `http`).                                                                                                                 |
| `mcp.servers.<id>.url`                    | http/sse | Endpoint URL; required for `http` and `sse`.                                                                                                                 |
| `mcp.servers.<id>.headers`                | no       | Headers sent on every request (`http`/`sse`); values are secret.                                                                                             |
| `mcp.servers.<id>.command`                | stdio    | Executable to spawn; required for `stdio`.                                                                                                                   |
| `mcp.servers.<id>.args`                   | no       | Arguments for `command` (`stdio`).                                                                                                                           |
| `mcp.servers.<id>.env`                    | no       | Extra environment for the child process, merged over a safe default (`stdio`); values are secret.                                                            |
| `mcp.servers.<id>.cwd`                    | no       | Working directory for the child process (`stdio`).                                                                                                           |
| `mcp.servers.<id>.connectTimeoutMs`       | no       | Per-server connect/list-tools ceiling; must be > 0 (overrides the global).                                                                                   |
| `mcp.servers.<id>.requireApproval`        | no       | Tool names of this server gated by Allow / Deny.                                                                                                             |
| `requestBodyLimit`                        | no       | Express body limit for `/chat` (default `10mb`).                                                                                                             |

### Example operating instructions

This package ships system prompts you can copy and tailor; after install they
are at
`node_modules/@drewswiredin/backstage-plugin-assistants-backend/examples/prompts/`:

- `general-assistant.md`: read-only catalog/TechDocs helper (scope,
  guardrails, search strategy, Markdown/Mermaid formatting).
- `devops-assistant.md`: adds write/scaffolding tools with a
  confirm-before-acting policy.

Open one and paste it into an assistant's prompt field in the admin editor;
prompts live in the database definition, not `app-config.yaml`.

## Providers

Model ids are `<providerId>:<model>`, where `providerId` is your key under
`providers`. All four `type`s are built in and their AI SDK packages ship with
this plugin; there are no extra packages to install. You can configure several
providers at once; the union of their `models` is the global pool.

Every `models` entry is an object with a `name`; `contextWindow`, `reasoning`,
and `maxOutputTokens` are optional. A plain string list fails validation at
startup.

Each example below sits under `assistants.providers`.

**OpenAI-compatible** (OpenRouter, local gateways, etc.) uses the OpenAI SDK
with a `baseUrl`:

```yaml
openrouter:
  type: openai-compatible
  apiKey: ${OPENROUTER_API_KEY}
  baseUrl: https://openrouter.ai/api/v1
  models:
    - name: anthropic/claude-sonnet-5
      contextWindow: 1000000
      reasoning: true
    - name: openai/gpt-5.5
      contextWindow: 400000
      reasoning: true
# ids: openrouter:anthropic/claude-sonnet-5, openrouter:openai/gpt-5.5
```

**OpenAI**:

```yaml
openai:
  type: openai
  apiKey: ${OPENAI_API_KEY}
  models:
    - name: gpt-5.5
      contextWindow: 400000
      reasoning: true
# ids: openai:gpt-5.5
```

**Anthropic**:

```yaml
anthropic:
  type: anthropic
  apiKey: ${ANTHROPIC_API_KEY}
  models:
    - name: claude-opus-5
      contextWindow: 1000000
      reasoning: true
    - name: claude-sonnet-5
      contextWindow: 1000000
      reasoning: true
# ids: anthropic:claude-opus-5, anthropic:claude-sonnet-5
```

**Azure OpenAI / AI Foundry**: `models` are your deployment names; point
`baseUrl` at your endpoint and pass extra connection settings (e.g.
`apiVersion`) via `options`:

```yaml
azure:
  type: azure
  apiKey: ${AZURE_API_KEY}
  baseUrl: https://<resource>.openai.azure.com # or your Foundry endpoint
  options:
    apiVersion: '2024-10-21'
  models:
    - name: my-gpt-5-5-deployment
      contextWindow: 400000
      reasoning: true
# ids: azure:my-gpt-5-5-deployment
```

## Reasoning effort

A model that reasons gets an effort picker in the chat header, next to the
model picker. Config says only whether a model reasons, never which tiers it
has (under `assistants.providers.<id>`):

```yaml
models:
  - name: gpt-5.5
    reasoning: true
  - name: my-small-deployment # no flag: no picker for this model
```

The tiers are fixed and the same for every reasoning model (low, medium, high,
max), translated to the provider's own knob at request time:

| Provider type                          | Sent as                                                         |
| -------------------------------------- | --------------------------------------------------------------- |
| `openai`, `openai-compatible`, `azure` | `reasoningEffort: <tier>` (`max` as `xhigh`)                    |
| `anthropic`                            | `thinking: { type: adaptive }` + `output_config.effort: <tier>` |

Tiers are forwarded by name; nothing here invents token budgets. The only
conversion is the top tier's spelling per provider.

> Set `reasoning: true` only on Anthropic models Claude 4.6 or later; older
> models reject the request. The `max` tier is sent as `xhigh` to OpenAI-style
> providers.

Behaviour worth knowing:

- Not choosing a tier is always valid. The picker starts at Default and sends
  nothing, leaving the provider's own default in force. That, not a disabled
  tier, is how you opt out of tuning, which is why there is no `off` (some
  reasoning models cannot be turned off at all).
- A non-reasoning model has no picker, and its turns carry no effort field.
- Switching to a non-reasoning model drops the tier back to Default rather than
  applying it to a model that never advertised reasoning.
- The tier is remembered per conversation, alongside the conversation's model.
- A tier sent for a model that is not flagged is ignored server-side (logged at
  debug) rather than failing the turn, so a client whose model changed under it
  does not break.

Reasoning output (where the model streams its thinking) renders as a
collapsible Reasoning block in the chat, independent of this setting.

## Output token ceiling

Each turn is capped by the provider's own per-model output limit, which is
correct for models it recognizes, so `maxOutputTokens` is normally omitted.

Set it when the provider guesses badly for an id it does not know (under
`assistants.providers.<id>`):

```yaml
models:
  - name: my-foundry-deployment # a bare deployment name, not a Claude id
    reasoning: true
    maxOutputTokens: 128000
```

`@ai-sdk/anthropic` falls back to 4096 for an id that does not look like a
Claude model. That is not enough for a reasoning model to think and answer:
tool calls each fit, so the turn appears to run normally, then ends with no
reply at all. A custom deployment name is the usual way to hit this; plain
`claude-*` ids fall back to 128000 instead.

The value is sent as the request's max output tokens and is never inferred:
omit it and the provider default stands.

## Tools (actions)

Assistants call Backstage actions as tools, executed with the caller's
credentials. Availability depends on what is registered in your backend:

- `builtinActions: true` provides `search-catalog`, `search-techdocs`, and
  `read-techdocs`.
- Additional actions (e.g. `query-catalog-entities`, `get-catalog-entity`,
  `register-entity`, `unregister-entity`, `execute-template`) come from the
  action-providing plugins (catalog, scaffolder, and TechDocs action modules).
  Any registered action can be given to an assistant: add its id to the
  assistant's tool list (`allowedTools` in the API) in the editor.

> **Required:** Backstage's actions service only exposes actions from the plugin
> sources you allow. Add `assistants` (and any other source whose actions you
> use, e.g. `catalog`, `scaffolder`) to `backend.actions.pluginSources`;
> otherwise an assistant's tools resolve to an empty list:
>
> ```yaml
> backend:
>   actions:
>     pluginSources:
>       - catalog
>       - scaffolder
>       - assistants # needed for builtinActions / this plugin's tools
> ```

An assistant only sees the intersection of its `allowedTools` and the actions
the calling user may see and run.

## MCP servers (external tools)

Assistants can also call tools from external MCP (Model Context Protocol)
servers (GitHub, Atlassian, Azure DevOps, internal servers). Declare servers
under `assistants.mcp.servers`. An assistant opts in to individual MCP tools by
selecting them in the editor; each becomes an `allowedTools` entry namespaced
`<serverId>__<tool>` (and shows in the detail modal). There is no per-assistant
server allowlist in config.

Transports (the `@ai-sdk/mcp` client set):

- `http` (Streamable HTTP, default) and `sse` are remote: use `url`, plus
  optional `headers`.
- `stdio` spawns a local MCP server process: `command`, plus optional `args`,
  `env`, and `cwd`.

```yaml
assistants:
  mcp:
    servers:
      # remote (Streamable HTTP) with a static auth header
      github:
        transport: http # http | sse | stdio
        url: https://api.githubcopilot.com/mcp/
        headers:
          Authorization: Bearer ${GITHUB_MCP_TOKEN}
        requireApproval: [create_pull_request] # gated as github__create_pull_request
      # local process over stdio
      filesystem:
        transport: stdio
        command: npx
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/data']
        env:
          SOME_TOKEN: ${SOME_TOKEN}
        # cwd: /optional/working/dir
```

**Connect timeout.** Connecting to a server and listing its tools is bounded by
`assistants.mcp.connectTimeoutMs` (default `8000`), overridable per server with
`servers.<id>.connectTimeoutMs`; resolution is per-server, then global, then
8000 ms. Slow-starting stdio servers need more: a Python server launched via
`uvx` can take about 10 s just to start, and a server that never finishes
connecting inside the ceiling is retried on every maintenance cycle without
ever coming up.

```yaml
assistants:
  mcp:
    connectTimeoutMs: 15000 # global default
    servers:
      atlassian:
        transport: stdio
        command: mcp-atlassian
        connectTimeoutMs: 20000 # this server starts slowly
```

A server's tools are assigned to an assistant individually in the editor; the
selection lives in that assistant's `allowedTools` as namespaced
`<serverId>__<tool>` entries, applied to both `/chat` and the `/status` tool
listing (so the detail modal shows only the selected tools).

> **Per-server approval.** `assistants.mcp.servers.<id>.requireApproval` lists
> un-namespaced tool names that join the approval gate as `<serverId>__<tool>`;
> see [Human-in-the-loop](#human-in-the-loop-approvals--forms).

> **Auth is a single static credential** (the configured `headers`): one shared
> identity for all users, not run-as-user. Gate access with the assistant's
> `access` policy.

### MCP connections are pooled and maintained server-side

The plugin holds one persistent client per configured server, opened and kept
open in the background, never on the request path. A scheduled task
(`coreServices.scheduler`) runs every 2 minutes: it connects any server that is
not connected yet, refreshes each server's tool inventory into a warm cache,
and reconnects one whose connection has dropped. Each connect and tool listing
is bounded by that server's connect timeout (default 8 s, see
[Connect timeout](#mcp-servers-external-tools)), so one slow or black-holed
server cannot stall the cycle.

Every read path is served from that pool:

- `GET /status` reads the cached inventory synchronously, so loading the plugin
  never connects to an MCP server or blocks on a slow or unreachable one (a
  server's tools fill in on the next cycle).
- `/chat` builds a turn's tools from the cache and executes them through the
  pooled connection; it opens and closes nothing. A server that is not
  currently connected yields a "not connected" tool result for that turn and
  is healed by the next cycle.
- `/capabilities` (the editor) reads the same pool, keeping its per-server
  reachability, `error` reporting, and manual refresh.

A failed refresh keeps the last-known tool list, so a transient blip does not
empty an assistant's tools; the failure is logged and surfaced as
`reachable: false`, never breaking a turn or `/status`. Connections are closed
only on plugin shutdown.

## Human-in-the-loop (approvals & forms)

Two ways a turn pauses for the user instead of running autonomously. Both are
enforced in the model loop, not requested of the model.

### Approval gate (`requireApproval`)

The approval gate is global, not per-assistant. List tool ids in top-level
`assistants.requireApproval` and/or a server's `mcp.servers.<id>.requireApproval`
and they are gated behind an explicit **Allow / Deny** in the conversation
before they ever run:

```yaml
assistants:
  requireApproval: # confirmed before running, for every assistant allowed them
    - register-entity
    - unregister-entity
    - execute-template
```

The gate is a config floor: the effective set for an assistant is this list
intersected with its `allowedTools` (a gated tool an assistant is not given is
never hit). There is no per-assistant approval field.

Each gated tool gets an entry in the AI SDK's `toolApproval` map, so
`streamText` emits an approval request and skips the tool's execution until
the user answers: Allow runs it (under the same run-as-user identity), Deny
returns an `execution-denied` result to the model. This is deterministic and
code-enforced: it does not depend on the model choosing to ask. Names match
action ids or namespaced `<server>__<tool>` MCP tools; a name not in the
assistant's tool set is logged and ignored. It is a confirmation checkpoint,
orthogonal to authorization: Backstage's per-user permissions still apply when
an approved action invokes.

### Client-side tools (`render_form`, `download_file`)

Two built-in client-side tools are always available (no config; they resolve
in the browser). `render_form` renders an inline RJSF form instead of asking a
string of questions in the conversation, for structured, multi-field, or
multiple-choice input; the user fills and submits, and the values flow back as
the tool result. Forms render Backstage scaffolder field extensions (owner,
entity, and repo pickers, plus any custom field the host app has registered)
resolved at runtime, so the model can reuse a scaffolder template's parameter
block verbatim. `download_file` hands a generated file back as a download chip
in the conversation.

Both are human-in-the-loop pauses in the same model loop: the stream stops at
the tool call, the browser renders the approval card or the form, and the
user's answer (Allow / Deny, or the submitted form values) is sent back as the
tool result, at which point the turn resumes. A turn waiting on the user
survives navigation and a page reload; it rejoins the stream where it left
off.

## Deployment and scaling

Run one backend replica, or pin session affinity for `/api/assistants/*`.
Several pieces of per-conversation state live in process memory: the in-flight
stream buffer that lets a reload rejoin a running reply, the `working` flag,
the abort handle behind the Stop button, and an in-memory copy of assistant
definitions, updated immediately on the replica that edited them and within 60
seconds on the others. The in-flight stream buffer is kept for 60 seconds after
a turn completes. The MCP connection pool is per process, with its own
maintenance task on each replica.

Turns always complete and persist on the replica that serves them, so with
several replicas and no affinity a reload still shows the full reply once it
finishes; only live resume and Stop are affected. Signals reach only clients
connected to the replica that emitted them unless your events service is
configured for cross-instance delivery; see the Backstage signals
documentation.

## Upgrading

Migrations are forward-only and run at startup. Upgrade the backend before or
with the database; a backend older than the database's newest migration fails
at startup with knex's "migration directory is corrupt". Back up the four
tables before upgrading.

## Security

- Prompts and access policies are backend-only and never sent to the browser.
- `providers.*.apiKey` and every value under `mcp.servers.*.env` and
  `mcp.servers.*.headers` are secret: redacted in logs, API responses, and the
  DevTools config view.
- The browser receives only a projection over `GET /status`: titles,
  descriptions, the model pool and defaults, the resolved tool list (name and
  description), and `ui`.

### What leaves the cluster

Per turn the backend sends the configured model provider the assistant's
system prompt, the full conversation history (including attachments as base64
and prior tool results), and the results of tools called in that turn:
catalog entities, TechDocs pages, MCP results. Auto-title makes one extra
model call on a conversation's first turn. The caller's identity (user entity
ref, groups, credentials) is not sent to the provider. MCP servers receive only
the tool arguments the model produces, under the server's configured static
credential.

### What is stored

Four tables in the plugin database: `assistants` (`definition_json`, including
the prompt and access policy), `assistants_meta` (the seed-once marker),
`threads`, and `messages`. Every message (user text, attachments, assistant
output, and tool results truncated at `toolResultMaxChars`, default 30000)
persists in `messages.content_json` until the user deletes the conversation,
which is a hard delete. Nothing is retained after that. Provider API keys and
MCP secrets live only in config. Back up all four tables together.

### Untrusted content and prompt injection

Everything a tool returns (TechDocs pages, catalog entity fields, MCP results)
is untrusted input to the model. A page an assistant reads can carry
instructions the model may follow. The approval gate (`requireApproval`, and
`mcp.servers.<id>.requireApproval`) is the enforced checkpoint: a listed tool
never runs without an explicit Allow in the conversation, whatever the model
was told. The gate defaults to empty, so list every write-capable action
(`register-entity`, `unregister-entity`, `execute-template`, and any MCP tool
that mutates) there. Backstage permissions still apply to each approved
action, since it runs as the calling user.

### Permissions

The plugin defines two Backstage permissions in
`@drewswiredin/backstage-plugin-assistants-common` (exported as
`assistantUsePermission`, `assistantManagePermission`, and the
`assistantsPermissions` array):

| Permission                  | `name`             | `action` | Gates                                                                                 |
| --------------------------- | ------------------ | -------- | ------------------------------------------------------------------------------------- |
| `assistantUsePermission`    | `assistant.use`    | `read`   | the user-facing routes (`GET /status`, `POST /chat`, `/threads`) and the chat surface |
| `assistantManagePermission` | `assistant.manage` | `update` | `/manage/*` + `/capabilities` and the admin editor (the gear)                         |

Both are enforced server-side via `coreServices.permissions` (403 when denied)
and gated client-side with `usePermission`. The plugin registers them with
`coreServices.permissionsRegistry` at init, so they are published on
`GET /api/assistants/.well-known/backstage/permissions/metadata` and show up in
permission UIs that discover plugins' permissions through that endpoint (the
RBAC role editor, for one). Which assistants an `assistant.use` holder then
sees is the separate per-assistant access policy stored on each definition,
orthogonal to these permissions.

#### Grant the permissions in a permission policy

Who holds each permission is decided by your app's
[`PermissionPolicy`](https://backstage.io/docs/permissions/writing-a-policy). A
fresh `create-app` backend installs
`@backstage/plugin-permission-backend-module-allow-all-policy`, which grants
everything to everyone: fine for trying the plugin out, but it restricts
nothing. To gate use and management, replace it with a policy that authorizes
the two permissions for the right users (here, by group membership):

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
`ownershipEntityRefs`, resolved by your auth provider from the catalog, so the
groups referenced above must exist and the users be members.

> **Default-allow, like every plugin.** A create-app backend ships
> `permission.enabled: true` with the allow-all policy, under which every
> signed-in user holds both permissions; with `permission.enabled` unset or
> `false` Backstage skips policy evaluation, with the same effect. Gating takes
> effect only once permissions are enabled and a policy like the one above is
> installed.

#### Or: grant them with the RBAC plugin

With [`@backstage-community/plugin-rbac-backend`](https://github.com/backstage/community-plugins/tree/main/workspaces/rbac)
in place of a hand-written policy, list the plugin so its permissions are
discoverable, then bind them to roles from the RBAC UI or a policy file:

```yaml
# app-config.yaml
permission:
  enabled: true
  rbac:
    pluginsWithPermission: [assistants]
```

```csv
# rbac-policy.csv
p, role:default/assistants-users, assistant.use, read, allow
p, role:default/assistants-admins, assistant.manage, update, allow
g, group:default/assistants-users, role:default/assistants-users
g, group:default/assistants-admins, role:default/assistants-admins
```

### Admin / management API

The admin editor is backed by `GET /capabilities` and the
`GET`/`POST`/`PUT`/`DELETE` `/manage/assistants` endpoints, all under
`/api/assistants`. Every one is gated by the `assistant.manage` permission and
returns 403 for callers who lack it.

- `GET /capabilities` returns the live, assignable inventory (Backstage
  actions, the model pool, each MCP server's reachability and tools, and the
  approval gate) that feeds the editor's pickers.
- `GET`/`POST`/`PUT`/`DELETE /manage/assistants` read and mutate the full
  assistant definitions, including the prompt, access policy, and audit fields
  (creator, editor, and timestamps).

## Reference: HTTP routes

All routes are under `/api/assistants`. `assistant.use` routes also apply the
per-assistant access policy and, for conversation routes, the owning user.

| Route                           | Permission         | Purpose                                                     |
| ------------------------------- | ------------------ | ----------------------------------------------------------- |
| `GET /status`                   | `assistant.use`    | Accessible assistants, model pool and defaults, tool lists. |
| `POST /chat`                    | `assistant.use`    | Run a turn; streams the reply.                              |
| `GET /chat/resume/:threadId`    | `assistant.use`    | Rejoin an in-flight reply's stream.                         |
| `POST /chat/cancel/:threadId`   | `assistant.use`    | Stop an in-flight reply.                                    |
| `GET /threads`                  | `assistant.use`    | List the caller's conversations.                            |
| `POST /threads`                 | `assistant.use`    | Create a conversation.                                      |
| `GET /threads/status`           | `assistant.use`    | Working and unread state per conversation.                  |
| `GET /threads/:id`              | `assistant.use`    | One conversation.                                           |
| `PATCH /threads/:id`            | `assistant.use`    | Rename, archive, or change the model or reasoning level.    |
| `DELETE /threads/:id`           | `assistant.use`    | Delete a conversation and its messages.                     |
| `POST /threads/:id/read`        | `assistant.use`    | Mark a conversation read.                                   |
| `GET /threads/:id/messages`     | `assistant.use`    | A conversation's messages.                                  |
| `GET /capabilities`             | `assistant.manage` | Assignable inventory for the editor.                        |
| `GET /manage/assistants`        | `assistant.manage` | All assistant definitions.                                  |
| `POST /manage/assistants`       | `assistant.manage` | Create an assistant.                                        |
| `GET /manage/assistants/:id`    | `assistant.manage` | One assistant definition.                                   |
| `PUT /manage/assistants/:id`    | `assistant.manage` | Replace an assistant definition.                            |
| `DELETE /manage/assistants/:id` | `assistant.manage` | Delete an assistant.                                        |

## Troubleshooting

| Symptom                                                                                                            | Cause                                                                                        | Fix                                                                                          |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| An assistant shows no tools; the log says `Assistant action '<name>' is not available; skipping`                   | `assistants` is missing from `backend.actions.pluginSources`, or `builtinActions` is `false` | Add the source; set `builtinActions: true` for the built-in read tools                       |
| Backend exits with `assistants.defaultModel '<id>' is not one of the configured models`                            | `defaultModel` does not name a configured `<providerId>:<model>`                             | Fix `defaultModel`                                                                           |
| Provider 401 or 403 under `chat turn errored`                                                                      | Wrong key, `baseUrl`, or Azure `apiVersion`; or the env var is not reaching the backend      | Check the key and URL; confirm the variable is set in the backend's environment              |
| A turn ends with tool calls and no reply on an Anthropic-type provider with a custom deployment name               | The SDK falls back to a 4096 output-token ceiling for an id it does not recognise            | Set `maxOutputTokens` on the model                                                           |
| An MCP server is never reachable; the log shows `MCP server '<id>' tool listing failed: ... timed out after <n>ms` | The server takes longer than `connectTimeoutMs` to start                                     | Raise `connectTimeoutMs` (uvx/npx servers often need 15000 to 20000)                         |
| "You are not permitted to use assistants"                                                                          | The permission policy denies `assistant.use`                                                 | Grant `assistant.use`; see [Permissions](#permissions)                                       |
| The gear is missing from the sidebar                                                                               | The permission policy denies `assistant.manage`                                              | Grant `assistant.manage`                                                                     |
| A reload does not rejoin a running reply                                                                           | More than 60 seconds since the turn completed, or the request reached a different replica    | Pin session affinity for `/api/assistants/*`; the finished reply is shown once the turn ends |

## License

Apache-2.0
