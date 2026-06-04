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

A profile only ever sees the intersection of its `actions` allowlist and the
actions the **calling user** is permitted to see/run.

## Security

- Prompts and access policies are backend-only — never sent to the browser.
- `apiKey` is `@visibility secret` (redacted in logs/responses).
- The browser receives only a projection over `GET /status`: titles,
  descriptions, the model pool/defaults, the resolved tool list (name +
  description), and `ui`.

## License

Apache-2.0
