# @drewswiredin/backstage-plugin-assistants-backend

The backend plugin of
[AI Assistants for Backstage](https://github.com/drewswiredin/backstage-assistants).
It streams replies, runs Backstage actions as tools with the calling user's
credentials, and calls MCP server tools under a configured credential or the
user's own token. Assistant definitions live in the plugin database and are
edited in-app; `app-config.yaml` holds providers, MCP servers, the approval
gate, and runtime limits.

Pairs with the frontend plugin,
[`@drewswiredin/backstage-plugin-assistants`](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants).

**Docs: [drewswiredin.github.io/backstage-assistants](https://drewswiredin.github.io/backstage-assistants/)**

## Requirements

- Backstage 1.56 or later on the new backend system
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

## Minimal configuration

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

The backend refuses to start until `assistants.defaultModel` and at least one
provider with one model are configured. The first start seeds one assistant,
open to every signed-in user; open `/assistants` and talk to it.

## Documentation

- [Getting started](https://drewswiredin.github.io/backstage-assistants/getting-started/)
- [Model providers](https://drewswiredin.github.io/backstage-assistants/providers/):
  OpenAI, Anthropic, Azure, OpenAI-compatible, and provider types from a
  backend module
- [Actions and tools](https://drewswiredin.github.io/backstage-assistants/tools/):
  Backstage actions, the built-in tools, and a recommended starter setup
- [MCP servers](https://drewswiredin.github.io/backstage-assistants/mcp/):
  shared credentials, per-user sign-in, and servers that run their own OAuth
- [Approvals](https://drewswiredin.github.io/backstage-assistants/approvals/)
  and [permissions](https://drewswiredin.github.io/backstage-assistants/permissions/)
- [Run in production](https://drewswiredin.github.io/backstage-assistants/production/):
  replicas, upgrades, logs, and troubleshooting
- [Security](https://drewswiredin.github.io/backstage-assistants/security/)
- [Reference](https://drewswiredin.github.io/backstage-assistants/reference/):
  configuration keys, startup errors, and HTTP routes

Example system prompts ship with this package, in `examples/prompts/`.

## License

Apache-2.0
