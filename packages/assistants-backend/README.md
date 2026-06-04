# @drewswiredin/backstage-plugin-assistants-backend

Backend for the Backstage AI Assistants plugin: serves assistant metadata,
streams chat completions, and runs Backstage actions as tools **on behalf of the
calling user** (respecting their permissions). Configuration lives entirely in
`app-config.yaml`; prompts, access policies, and API keys never reach the
browser.

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

All options live under `assistants` in `app-config.yaml`.

```yaml
assistants:
  # Initial model (provider:model). Must exist in a provider's models.
  defaultModel: openrouter:google/gemini-2.5-flash

  # Max tool-call steps per turn (default 10).
  maxSteps: 8

  # Register the built-in catalog/TechDocs tools (search-catalog,
  # search-techdocs, read-techdocs) under the `assistants` action source.
  registerCoreActions: true

  # One or more LLM providers. The union of all `models` is the global pool.
  providers:
    openrouter:
      type: openai-compatible # openai | anthropic | azure | openai-compatible
      apiKey: ${OPENROUTER_API_KEY} # secret — redacted everywhere
      baseUrl: https://openrouter.ai/api/v1 # optional override
      # options: { ... }              # passthrough opts spread into the AI-SDK factory
      models:
        - google/gemini-2.5-flash
        - anthropic/claude-3.5-sonnet

  # Global UI defaults, deep-merged into every profile (browser-safe).
  ui:
    composer:
      placeholder: 'Send a message…'
    suggestions: []

  # Assistant profiles, keyed by id. At least one is required.
  profiles:
    general:
      title: General Assistant
      description: Catalog + TechDocs helper for your developer portal.
      color: '#7df3e1' # optional avatar tint (hex)
      prompt: | # system prompt — backend-only
        You are a Backstage developer-portal assistant. Use your tools to look
        up catalog entities and documentation before answering.
      access:
        allowAuthenticated: true # any signed-in user
        # users:  [user:default/jdoe]
        # groups: [group:default/platform]
      actions: # tool allowlist (action names); '*' allows all visible
        - search-catalog
        - search-techdocs
        - read-techdocs
      models: # optional per-profile allowlist (subset of the pool)
        - openrouter:google/gemini-2.5-flash
      defaultModel: openrouter:google/gemini-2.5-flash
      ui:
        suggestions:
          - title: 'Who owns a service?'
            prompt: 'Who owns the payments service?'
```

### Config reference

| Key | Required | Description |
| --- | --- | --- |
| `defaultModel` | yes | Initial `provider:model`; must exist in a provider. |
| `maxSteps` | no | Max tool-call steps per turn (default `10`). |
| `registerCoreActions` | no | Register built-in catalog/TechDocs tools (default `false`). |
| `providers.<id>.type` | yes | `openai` \| `anthropic` \| `azure` \| `openai-compatible`. |
| `providers.<id>.apiKey` | yes | Provider key (`@visibility secret`). |
| `providers.<id>.baseUrl` | no | Base URL override. |
| `providers.<id>.options` | no | Passthrough opts spread into the AI-SDK factory. |
| `providers.<id>.models` | yes | Models exposed by this provider. |
| `ui` | no | Global composer placeholder + starter suggestions. |
| `profiles.<id>.title` | yes | Display name. |
| `profiles.<id>.description` | no | Shown in the picker / detail modal. |
| `profiles.<id>.color` | no | Avatar tint (hex). |
| `profiles.<id>.prompt` | yes | System prompt (backend-only). |
| `profiles.<id>.access` | yes | `allowAuthenticated` and/or `users` / `groups` entity refs. |
| `profiles.<id>.actions` | no | Tool allowlist (action names), or `'*'`. |
| `profiles.<id>.models` | no | Per-profile model allowlist (subset of pool). |
| `profiles.<id>.defaultModel` | conditional | Required if the allowlist excludes the global `defaultModel`. |
| `profiles.<id>.ui` | no | Per-profile UI overrides. |

> **Tip — externalize long prompts.** `prompt` (and any string field) can use
> Backstage's built-in file reference instead of an inline block:
>
> ```yaml
> profiles:
>   general:
>     prompt:
>       $file: ./prompts/general.md # relative to this config file; read at startup
> ```
>
> Keeps `app-config.yaml` readable and lets you author prompts in Markdown. Ship
> the `prompts/` files alongside your `app-config.yaml` on the backend.

### Example operating instructions

This package ships ready-to-use system prompts you can copy and tailor — after
install they're at
`node_modules/@drewswiredin/backstage-plugin-assistants-backend/examples/prompts/`:

- `general-assistant.md` — read-only catalog/TechDocs helper (scope, guardrails,
  search strategy, Markdown/Mermaid formatting).
- `devops-assistant.md` — adds write/scaffolding tools with a confirm-before-acting
  policy.

Copy one into your app and reference it with `$file` (install does **not** write
into your source tree):

```bash
mkdir -p packages/backend/prompts
cp node_modules/@drewswiredin/backstage-plugin-assistants-backend/examples/prompts/general-assistant.md \
   packages/backend/prompts/general-assistant.md
```

```yaml
profiles:
  general:
    prompt:
      $file: ./packages/backend/prompts/general-assistant.md
```

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

- `registerCoreActions: true` provides `search-catalog`, `search-techdocs`, and
  `read-techdocs`.
- Additional actions (e.g. `query-catalog-entities`, `get-catalog-entity`,
  `register-entity`, `unregister-entity`, `execute-template`) come from the
  relevant action-providing plugins (catalog / scaffolder / TechDocs action
  modules, `@backstage/plugin-mcp-actions-backend`). List the action names you
  want in a profile's `actions`.

> **Required:** Backstage's actions service only exposes actions from the plugin
> sources you allow. You **must** add `assistants` (and any other source whose
> actions you use, e.g. `catalog`, `scaffolder`) to
> `backend.actions.pluginSources` — otherwise a profile's tools resolve to an
> empty list:
>
> ```yaml
> backend:
>   actions:
>     pluginSources:
>       - catalog
>       - scaffolder
>       - assistants # <-- needed for registerCoreActions / this plugin's tools
> ```

A profile only ever sees the intersection of its `actions` allowlist and the
actions the **calling user** is permitted to see/run.

## MCP servers (external tools)

Assistants can also call tools from external **MCP (Model Context Protocol)**
servers (GitHub, Atlassian, Azure DevOps, internal servers, …). Declare servers
under `assistants.mcp.servers` and opt an assistant in via its `mcpServers`
allowlist. Their tools appear in the assistant's tool set (and the detail modal),
namespaced `<serverId>__<tool>`.

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
      # local process over stdio
      filesystem:
        transport: stdio
        command: npx
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/data']
        env:
          SOME_TOKEN: ${SOME_TOKEN} # @visibility secret
        # cwd: /optional/working/dir
  profiles:
    devops:
      # ...title / access / models
      mcpServers:
        - github # string form = all of github's tools
        - server: filesystem # object form = curate which tools
          tools: [read_file, list_directory]
```

**Per-tool allowlist** (`mcpServers[].tools`) — important when a server exposes
dozens/hundreds of tools (don't hand them all to the model):

| `tools` value | Result |
| --- | --- |
| omitted (or the string form `- github`) | all of that server's tools |
| `['*']` | all (explicit) |
| `[]` | none |
| `['a','b']` | exactly those (un-namespaced tool names) |

The allowlist is **per assistant** — each profile curates its own subset of a
shared server connection. Applied to both `/chat` and the `/status` tool listing
(so the detail modal shows only the allowed tools).

> **Auth is a single static credential** (the configured `headers`) — i.e. one
> shared identity for all users, **not run-as-user**. Gate access with the
> assistant's `access` policy and the `mcpServers` allowlist. (Per-user identity
> propagation — e.g. Entra OBO for Azure DevOps — is a planned enhancement.)

Notes: tool listings for `/status` are cached briefly; a server that's
unreachable is logged and skipped (it never breaks a turn or `/status`).
Connections are opened per turn and closed when the response finishes.

## Security

- Prompts and access policies are backend-only — never sent to the browser.
- `apiKey` is `@visibility secret` (redacted in logs/responses).
- The browser receives only a projection over `GET /status`: titles,
  descriptions, the model pool/defaults, the resolved tool list (name +
  description), and `ui`.

## License

Apache-2.0
