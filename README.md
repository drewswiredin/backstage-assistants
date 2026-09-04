# AI Assistants for Backstage

Configurable, in-portal AI assistants for Backstage whose tools are your
Backstage actions, run as the signed-in user. Create and manage assistants in an
in-app admin editor (stored in the plugin database), give each its own tools,
models, and prompt, and chat with them in a collapsible, multi-conversation
panel. Platform config — model providers, MCP servers, and the safety/approval
floor — lives in `app-config.yaml`.

## Requirements

- Backstage 1.53 or later, on the new frontend system
  (`@backstage/frontend-defaults` `createApp`) and the new backend system
  (`@backstage/backend-defaults`).
- Node 22.12 or later.
- React 18 and `react-router-dom` ^6.30.2 in the app.
- A plugin database: SQLite or Postgres (MySQL is supported).
- A model provider and API key — OpenAI, Anthropic, Azure OpenAI / AI Foundry,
  or any OpenAI-compatible endpoint such as [OpenRouter](https://openrouter.ai).
- Recommended: `@backstage/plugin-signals` in the app and
  `@backstage/plugin-signals-backend` in the backend. The frontend uses signals
  for live status when the app has them and polls when it does not.

## Screenshots

![AI Assistants chat panel](https://raw.githubusercontent.com/drewswiredin/backstage-assistants/main/docs/images/chat.png)

![Assistant admin editor](https://raw.githubusercontent.com/drewswiredin/backstage-assistants/main/docs/images/editor.png)

## Features

- **Multiple assistants** — created and edited in an in-app admin editor (stored
  in the plugin database), each with its own allowed tools, allowed models,
  system prompt, access policy, and color.
- **In-app admin editor** — users with the `assistant.manage` permission create,
  edit, and delete assistants from a gear in the chat sidebar; definitions
  persist in the plugin database, no redeploy to add or change an assistant.
- **Permission-gated** — two Backstage permissions govern the plugin:
  `assistant.use` (who may use it) and `assistant.manage` (who may run the
  editor), enforced server-side and honored by your permission policy (see the
  [backend README](packages/assistants-backend/README.md#permissions) for how to
  wire one up).
- **Concurrent conversations** — many streaming conversations across many
  assistants at once; switch between conversations and assistants without
  interrupting a reply in flight.
- **Actions as tools, run as the requesting user** — every registered Backstage
  action is available to an assistant and executes with the caller's own
  credentials, so Backstage permissions apply unchanged. External MCP servers
  can be added as tools too.
- **Tool approval** — any tool can require an explicit Allow / Deny in the chat
  before it runs; with per-tool "always allow" and one-click batch approval.
- **Server-side conversations + live resume** — persisted per user; a reply
  keeps running if you navigate away and rejoins the stream when you return.
- **Notifications** — working (reply in flight) and unread indicators, per
  conversation and per assistant.
- **Generative UI** — an assistant can render an interactive form inline
  (reusing Backstage scaffolder field pickers) to collect structured input.
- **Polished chat UI** — streaming, Markdown + Mermaid, message branching,
  per-conversation model selection, a context-usage gauge, and per-assistant
  color (hex, from config).

## Approach

Glue, not build: [assistant-ui](https://www.assistant-ui.com/) (chat UI +
runtime), the [Vercel AI SDK](https://sdk.vercel.ai/) (model + tool loop), and
Backstage (identity, the Actions registry, database, signals), wired with thin
glue. The design lives in [docs/PRINCIPLES.md](docs/PRINCIPLES.md) and two
diagrams, [docs/architecture.html](docs/architecture.html) and
[docs/config-flow.html](docs/config-flow.html) (HTML source; download and open
locally).

## Packages

| Package                                                                            | Role                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------- |
| [`@drewswiredin/backstage-plugin-assistants`](packages/assistants)                 | Frontend plugin (new frontend system) |
| [`@drewswiredin/backstage-plugin-assistants-backend`](packages/assistants-backend) | Backend plugin                        |
| [`@drewswiredin/backstage-plugin-assistants-common`](packages/assistants-common)   | Shared browser-safe types             |

Install + wiring: [frontend README](packages/assistants/README.md). Full
configuration reference: [backend README](packages/assistants-backend/README.md).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and
[SECURITY.md](SECURITY.md) for how to report a vulnerability.

## License

Apache-2.0. The frontend vendors MIT-licensed code from assistant-ui; see
[packages/assistants/THIRD_PARTY_NOTICES.md](packages/assistants/THIRD_PARTY_NOTICES.md).
