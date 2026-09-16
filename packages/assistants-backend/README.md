# @drewswiredin/backstage-plugin-assistants-backend

Backend for AI Assistants for Backstage. It serves assistant metadata, streams
replies, and runs Backstage actions as tools with the calling user's
credentials. Assistant definitions live in the plugin database and are edited
in-app; `app-config.yaml` holds providers, MCP servers, the approval gate, and
runtime limits.

Pairs with the frontend plugin
[`@drewswiredin/backstage-plugin-assistants`](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants).

## Contents

- [Requirements](#requirements)
- [Install](#install)
- [Minimal configuration](#minimal-configuration)
- [Configure a provider](#configure-a-provider)
- [Give an assistant Backstage actions](#give-an-assistant-backstage-actions)
- [Add an MCP server](#add-an-mcp-server)
- [Require approval before a tool runs](#require-approval-before-a-tool-runs)
- [Forms and downloads in the conversation](#forms-and-downloads-in-the-conversation)
- [Grant assistant.use and assistant.manage](#grant-assistantuse-and-assistantmanage)
- [Run in production](#run-in-production)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Reference](#reference)
- [License](#license)

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
provider with one model are configured; the exact messages are under
[Startup errors](#startup-errors).

## Minimal configuration

All plugin options live under `assistants` in `app-config.yaml`. The
`backend.actions.pluginSources` entry exposes this plugin's tools to
assistants; without it an assistant's tools resolve to an empty list.

```yaml
assistants:
  defaultModel: openrouter:anthropic/claude-sonnet-5
  builtinActions: true # the built-in catalog/TechDocs read tools
  providers:
    openrouter:
      type: openai-compatible
      apiKey: ${OPENROUTER_API_KEY}
      baseUrl: https://openrouter.ai/api/v1
      models:
        - name: anthropic/claude-sonnet-5
          contextWindow: 1000000

backend:
  actions:
    pluginSources:
      - assistants # plus catalog, scaffolder, etc. for their actions
```

Set the key in the backend's environment (never commit it):

```bash
export OPENROUTER_API_KEY=sk-or-...
```

Tables are created by migrations at startup; there is nothing to run. On a
healthy start the log shows `AI Assistants backend plugin initialized` with
model, default-model and assistant counts.

The first start seeds one assistant, open to every signed-in user, with the
three built-in read tools; open `/assistants` and talk to it. Assistants
(title, description, prompt, access, tools, models) are created, edited, and
deleted in the editor (the gear in the chat sidebar), never in
`app-config.yaml`. Under create-app's default allow-all permission policy every
signed-in user can use and manage assistants; see
[Grant assistant.use and assistant.manage](#grant-assistantuse-and-assistantmanage)
to gate either.

## Configure a provider

Model ids are `<providerId>:<model>`, where `providerId` is your key under
`providers`. All four `type`s are built in and their AI SDK packages ship with
this plugin. Several providers can be configured at once; the union of their
`models` is the pool. Every `models` entry is an object with a `name`;
`contextWindow`, `reasoning`, and `maxOutputTokens` are optional. A plain
string list fails validation at startup.

Each example below sits under `assistants.providers`.

OpenAI:

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

Anthropic:

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

Azure OpenAI / AI Foundry: `models` are your deployment names; point `baseUrl`
at your endpoint and pass extra connection settings such as `apiVersion` via
`options`:

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

OpenAI-compatible (OpenRouter, local gateways, and similar) uses the OpenAI SDK
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

### Per-model options

`contextWindow` is the model's input limit in tokens and drives the context
gauge in the chat header; omit it to leave the limit unknown.

`reasoning: true` marks a model that reasons. The chat then offers an effort
picker next to the model picker. Config says only whether a model reasons,
never which tiers it has (under `assistants.providers.<id>`):

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

Tiers are forwarded by name; nothing here invents token budgets. The picker
starts at Default and sends nothing, so the provider's own default stands;
there is no `off` tier. The tier is remembered per conversation. Reasoning
output renders as a collapsible Reasoning block in the chat, independent of
this setting.

Set `reasoning: true` only on Anthropic models Claude 4.6 or later; older
models reject the request. The `max` tier is sent as `xhigh` to OpenAI-style
providers.

`maxOutputTokens` caps the tokens a model may generate per turn; omit it and
the provider's own default stands. Symptom that calls for it: on an
Anthropic-type provider with a custom deployment name (not a plain `claude-*`
id), tool calls run normally and the turn ends with no reply, because
`@ai-sdk/anthropic` falls back to a 4096-token ceiling for an id it does not
recognize. Fix (under
`assistants.providers.<id>`):

```yaml
models:
  - name: my-foundry-deployment # a bare deployment name, not a Claude id
    reasoning: true
    maxOutputTokens: 128000
```

## Give an assistant Backstage actions

Assistants call Backstage actions as tools, executed with the caller's
credentials. `builtinActions: true` provides `search-catalog`,
`search-techdocs`, and `read-techdocs`. Additional actions (e.g.
`query-catalog-entities`, `get-catalog-entity`, `register-entity`,
`unregister-entity`, `execute-template`) come from the action-providing
plugins (catalog, scaffolder, and TechDocs action modules).

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

Any registered action can be given to an assistant: add its id to the
assistant's tool list (`allowedTools` in the API) in the editor. An assistant
only sees the intersection of its `allowedTools` and the actions the calling
user may see and run.

## Add an MCP server

Assistants can also call tools from external MCP (Model Context Protocol)
servers (GitHub, Atlassian, Azure DevOps, internal servers), declared under
`assistants.mcp.servers`. `http` (Streamable HTTP, the default) and `sse` are
remote: `url`, plus optional `headers`. `stdio` spawns a local process:
`command`, plus optional `args`, `env`, and `cwd`.

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
      # remote over SSE
      jira:
        transport: sse
        url: https://mcp.example.internal/sse
      # local process over stdio
      filesystem:
        transport: stdio
        command: npx
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/data']
        env:
          SOME_TOKEN: ${SOME_TOKEN}
        # cwd: /optional/working/dir
```

Connecting to a server and listing its tools is bounded by
`assistants.mcp.connectTimeoutMs` (default `8000`), overridable per server with
`servers.<id>.connectTimeoutMs`. Slow-starting stdio servers need more: a
Python server launched via `uvx` can take about 10 s just to start, and a
server that never connects inside the ceiling is retried every cycle without
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

A server's tools are assigned to an assistant individually in the editor; each
selected tool becomes an `allowedTools` entry namespaced `<serverId>__<tool>`,
and the detail modal shows only the selected tools. There is no per-assistant
server allowlist in config. The editor shows each server's reachability and
its last `error`, with a manual refresh.

Auth is a single static credential (the configured `headers`): one shared
identity for all users, not run-as-user. Gate access with the assistant's
`access` policy. To confirm individual tools before they run, list them in
`mcp.servers.<id>.requireApproval`; see
[Require approval before a tool runs](#require-approval-before-a-tool-runs).

Connections are opened in the background, never on the request path: a task
runs every 2 minutes to connect servers that are not connected yet, refresh
each server's tool inventory, and reconnect dropped connections, each step
bounded by that server's connect timeout. Loading the plugin never blocks on a
slow or unreachable server; its tools fill in on the next cycle. A server that
is not connected when a turn calls it yields a "not connected" tool result for
that turn; a failed refresh keeps the last-known tool list and shows in the
editor as `reachable: false`. See the
[architecture doc](../../docs/architecture.md#runtime-services) for the pool.

## Require approval before a tool runs

The approval gate is global, not per-assistant. List action ids in
`assistants.requireApproval` and a server's tool names in
`mcp.servers.<id>.requireApproval`; a listed tool is paused for an explicit
**Allow / Deny** in the conversation before it ever runs:

```yaml
assistants:
  requireApproval: # confirmed before running, for every assistant allowed them
    - register-entity
    - unregister-entity
    - execute-template
```

The gate is a config floor: the effective set for an assistant is this list
intersected with its `allowedTools`, so a gated tool an assistant is not given
is never hit, and there is no per-assistant approval field that could weaken
it. Names match action ids or namespaced `<server>__<tool>` MCP tools; a name
not in the assistant's tool set is logged and ignored.

What the user sees: the reply stops at the tool call and shows an approval
card. Allow runs the tool under the same run-as-user identity; Always allow
also skips the prompt for that tool for the rest of the conversation; Deny
returns an `execution-denied` result to the model. Several gated calls of the
same tool in one step collapse into one card. The pause is enforced in code,
not requested of the model. A turn waiting on the user survives navigation and
a page reload.

The gate is a confirmation checkpoint, orthogonal to authorization: Backstage's
per-user permissions still apply when an approved action invokes.

## Forms and downloads in the conversation

Two built-in client-side tools are always available and need no config.
`render_form` renders an inline RJSF form for structured, multi-field, or
multiple-choice input; the user fills and submits, and the values flow back as
the tool result. Forms render Backstage scaffolder field extensions (owner,
entity, and repo pickers, plus any custom field the host app has registered),
so the model can reuse a scaffolder template's parameter block verbatim.
`download_file` hands a generated file back as a download chip in the
conversation. Both pause the turn the way the approval gate does and survive a
page reload.

## Grant assistant.use and assistant.manage

The plugin defines two Backstage permissions in
`@drewswiredin/backstage-plugin-assistants-common` (exported as
`assistantUsePermission`, `assistantManagePermission`, and the
`assistantsPermissions` array):

| Permission                  | `name`             | `action` | Gates                                                                                 |
| --------------------------- | ------------------ | -------- | ------------------------------------------------------------------------------------- |
| `assistantUsePermission`    | `assistant.use`    | `read`   | the user-facing routes (`GET /status`, `POST /chat`, `/threads`) and the chat surface |
| `assistantManagePermission` | `assistant.manage` | `update` | `/manage/*` + `/capabilities` and the admin editor (the gear)                         |

Both are enforced server-side (403 when denied) and gated client-side with
`usePermission`. They are registered with `coreServices.permissionsRegistry`,
so they are published on
`GET /api/assistants/.well-known/backstage/permissions/metadata` and show up in
permission UIs that discover permissions through that endpoint (the RBAC role
editor, for one). Which assistants an `assistant.use` holder then sees is the
per-assistant access policy stored on each definition, orthogonal to these
permissions.

Default-allow, like every plugin: a create-app backend ships
`permission.enabled: true` with
`@backstage/plugin-permission-backend-module-allow-all-policy`, under which
every signed-in user holds both permissions; with `permission.enabled` unset or
`false` Backstage skips policy evaluation, with the same effect. Gating takes
effect once permissions are enabled and a policy like one of the two below is
installed.

To gate with your own
[`PermissionPolicy`](https://backstage.io/docs/permissions/writing-a-policy),
authorize the two permissions for the right users (here, by group membership):

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

With
[`@backstage-community/plugin-rbac-backend`](https://github.com/backstage/community-plugins/tree/main/workspaces/rbac)
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

## Run in production

### Replicas and session affinity

Run one backend replica, or pin session affinity for `/api/assistants/*`.
State that lives in process memory: the in-flight stream buffer that lets a
reload rejoin a running reply (kept for 60 seconds after a turn completes),
the `working` flag, the abort handle behind the Stop button, and a copy of
assistant definitions, updated immediately on the replica that edited them and
within 60 seconds on the others. The MCP connection pool is per process, with
its own maintenance task on each replica.

Turns always complete and persist on the replica that serves them, so without
affinity a reload still shows the full reply once it finishes; only live
resume and Stop are affected. Signals reach only clients connected to the
replica that emitted them unless your events service is configured for
cross-instance delivery; see the Backstage signals documentation.

### Upgrading and backups

Migrations are forward-only and run at startup. Upgrade the backend before or
with the database; a backend older than the database's newest migration fails
at startup with knex's "migration directory is corrupt". Back up the four
tables (`assistants`, `assistants_meta`, `threads`, `messages`) together before
upgrading.

### Logs

- Healthy start: `AI Assistants backend plugin initialized`, with `models`,
  `defaultModel`, `builtinActions`, and `assistants` counts.
- Per turn, at info: `chat turn started`, then `chat turn finished` or
  `chat turn aborted (stop)`; a failure logs `chat turn errored` at error with
  the provider's message.
- Warnings to expect: `Assistant action '<name>' is not available; skipping`
  (an `allowedTools` entry the actions service does not expose),
  `MCP server '<id>' tool listing failed: ...` (the last-known tool list stays
  in place), `requireApproval lists tool(s) not available to assistant '<id>':
...` (a gated name the assistant is not given), and `auto-title failed` (the
  conversation keeps its current title).

## Troubleshooting

| Symptom                                                                                                            | Cause                                                                                        | Fix                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| An assistant shows no tools; the log says `Assistant action '<name>' is not available; skipping`                   | `assistants` is missing from `backend.actions.pluginSources`, or `builtinActions` is `false` | Add the source; set `builtinActions: true` for the built-in read tools                                         |
| Backend exits with `assistants.defaultModel '<id>' is not one of the configured models`                            | `defaultModel` does not name a configured `<providerId>:<model>`                             | Fix `defaultModel`                                                                                             |
| Provider 401 or 403 under `chat turn errored`                                                                      | Wrong key, `baseUrl`, or Azure `apiVersion`; or the env var is not reaching the backend      | Check the key and URL; confirm the variable is set in the backend's environment                                |
| A turn ends with tool calls and no reply on an Anthropic-type provider with a custom deployment name               | The SDK falls back to a 4096 output-token ceiling for an id it does not recognise            | Set `maxOutputTokens` on the model                                                                             |
| An MCP server is never reachable; the log shows `MCP server '<id>' tool listing failed: ... timed out after <n>ms` | The server takes longer than `connectTimeoutMs` to start                                     | Raise `connectTimeoutMs` (uvx/npx servers often need 15000 to 20000)                                           |
| "You are not permitted to use assistants"                                                                          | The permission policy denies `assistant.use`                                                 | Grant `assistant.use`; see [Grant assistant.use and assistant.manage](#grant-assistantuse-and-assistantmanage) |
| The gear is missing from the sidebar                                                                               | The permission policy denies `assistant.manage`                                              | Grant `assistant.manage`                                                                                       |
| A reload does not rejoin a running reply                                                                           | More than 60 seconds since the turn completed, or the request reached a different replica    | Pin session affinity for `/api/assistants/*`; the finished reply is shown once the turn ends                   |

## Security

Prompts and access policies are backend-only and never sent to the browser.
`providers.*.apiKey` and every value under `mcp.servers.*.env` and
`mcp.servers.*.headers` are secret: redacted in logs, API responses, and the
DevTools config view. The browser receives only a projection over
`GET /status`: titles, descriptions, the model pool and defaults, the resolved
tool list (name and description), and `ui`.

What leaves the cluster: per turn the backend sends the configured model
provider the assistant's system prompt, the full conversation history
(including attachments as base64 and prior tool results), and the results of
tools called in that turn: catalog entities, TechDocs pages, MCP results.
Auto-title makes one extra model call on a conversation's first turn. The
caller's identity (user entity ref, groups, credentials) is not sent to the
provider. MCP servers receive only the tool arguments the model produces,
under the server's configured static credential.

What is stored: four tables in the plugin database: `assistants`
(`definition_json`, including the prompt and access policy), `assistants_meta`
(the seed-once marker), `threads`, and `messages`. Every message (user text,
attachments, assistant output, and tool results truncated at
`toolResultMaxChars`, default 30000) persists in `messages.content_json` until
the user deletes the conversation, which is a hard delete; nothing is retained
after that. Provider API keys and MCP secrets live only in config.

Untrusted content and prompt injection: everything a tool returns (TechDocs
pages, catalog entity fields, MCP results) is untrusted input to the model,
and a page an assistant reads can carry instructions the model may follow. The
approval gate (`requireApproval` and `mcp.servers.<id>.requireApproval`) is
the enforced checkpoint: a listed tool never runs without an explicit Allow in
the conversation, whatever the model was told. The gate defaults to empty, so
list every write-capable action (`register-entity`, `unregister-entity`,
`execute-template`, and any MCP tool that mutates) there. Backstage permissions
still apply to each approved action, since it runs as the calling user.

## Reference

### Configuration keys

All keys sit under `assistants`.

| Key                                       | Default    | Description                                                                                                                                                  |
| ----------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `defaultModel`                            | required   | Initial `<providerId>:<model>`; must exist in a provider.                                                                                                    |
| `maxSteps`                                | `10`       | Max tool-call steps per turn.                                                                                                                                |
| `builtinActions`                          | `false`    | Register built-in catalog/TechDocs read tools.                                                                                                               |
| `toolResultMaxChars`                      | `30000`    | Max chars of a single tool result (head+tail truncation; `0` disables).                                                                                      |
| `requireApproval`                         | `[]`       | Action ids gated by Allow / Deny in the conversation.                                                                                                        |
| `requestBodyLimit`                        | `10mb`     | Express body limit for `/chat`.                                                                                                                              |
| `providers.<id>.type`                     | required   | `openai` \| `anthropic` \| `azure` \| `openai-compatible`.                                                                                                   |
| `providers.<id>.apiKey`                   | required   | Provider key (secret).                                                                                                                                       |
| `providers.<id>.baseUrl`                  |            | Base URL override.                                                                                                                                           |
| `providers.<id>.options`                  |            | Untyped passthrough object spread into the `@ai-sdk/*` factory (e.g. Azure `apiVersion`). Not schema-validated; keep credentials out of it and use `apiKey`. |
| `providers.<id>.models`                   | required   | Object list; each `{ name, contextWindow?, reasoning?, maxOutputTokens? }`. A plain string list is rejected at startup.                                      |
| `providers.<id>.models[].contextWindow`   |            | Max input tokens; drives the context gauge.                                                                                                                  |
| `providers.<id>.models[].reasoning`       | `false`    | `true` if the model reasons; adds the effort picker (see Per-model options).                                                                                 |
| `providers.<id>.models[].maxOutputTokens` |            | Output-token ceiling; must be > 0. Only needed when the provider misjudges an unrecognized model id.                                                         |
| `mcp.connectTimeoutMs`                    | `8000`     | Global MCP connect/list-tools timeout ceiling in ms; must be > 0.                                                                                            |
| `mcp.servers.<id>`                        |            | External MCP server connections (see Add an MCP server).                                                                                                     |
| `mcp.servers.<id>.transport`              | `http`     | `http` \| `sse` \| `stdio`.                                                                                                                                  |
| `mcp.servers.<id>.url`                    | http/sse   | Endpoint URL; required for `http` and `sse`.                                                                                                                 |
| `mcp.servers.<id>.headers`                |            | Headers sent on every request (`http`/`sse`); values are secret.                                                                                             |
| `mcp.servers.<id>.command`                | stdio      | Executable to spawn; required for `stdio`.                                                                                                                   |
| `mcp.servers.<id>.args`                   |            | Arguments for `command` (`stdio`).                                                                                                                           |
| `mcp.servers.<id>.env`                    |            | Extra environment for the child process, merged over a safe default (`stdio`); values are secret.                                                            |
| `mcp.servers.<id>.cwd`                    |            | Working directory for the child process (`stdio`).                                                                                                           |
| `mcp.servers.<id>.connectTimeoutMs`       | the global | Per-server connect/list-tools ceiling; must be > 0.                                                                                                          |
| `mcp.servers.<id>.requireApproval`        | `[]`       | Tool names of this server gated by Allow / Deny.                                                                                                             |

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

### HTTP routes

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

### Admin API

The editor is backed by `GET /capabilities` and the `GET`/`POST`/`PUT`/`DELETE`
`/manage/assistants` endpoints under `/api/assistants`, all gated by
`assistant.manage` (403 for callers who lack it). `GET /capabilities` returns
the live, assignable inventory (Backstage actions, the model pool, each MCP
server's reachability and tools, and the approval gate) that feeds the
editor's pickers. `/manage/assistants` reads and mutates the full definitions,
including the prompt, access policy, and audit fields (creator, editor, and
timestamps).

### Example system prompts

This package ships system prompts you can copy and tailor; after install they
are at
`node_modules/@drewswiredin/backstage-plugin-assistants-backend/examples/prompts/`:

- `general-assistant.md`: read-only catalog/TechDocs helper (scope,
  guardrails, search strategy, Markdown/Mermaid formatting).
- `devops-assistant.md`: adds write/scaffolding tools with a
  confirm-before-acting policy.

Open one and paste it into an assistant's prompt field in the editor; prompts
live in the database definition, not `app-config.yaml`.

## License

Apache-2.0
