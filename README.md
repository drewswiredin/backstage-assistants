# AI Assistants for Backstage

Configurable, in-portal AI assistants for Backstage whose tools are your
Backstage actions, run as the signed-in user. Create and manage assistants in an
in-app admin editor (stored in the plugin database), give each its own tools,
models, and prompt, and chat with them in a collapsible, multi-conversation
panel. Platform config — model providers, MCP servers, and the safety/approval
floor — lives in `app-config.yaml`.

It aims to be the most complete open-source AI chat plugin for Backstage — the
alternatives today are either minimal or hosted and paid.

## Screenshots

<!-- Drop docs/images/chat.png and editor.png (see docs/images/README.md). Referenced by raw URL pinned to the release tag so they also render on the npm package page. -->

![AI Assistants chat panel](https://raw.githubusercontent.com/drewswiredin/backstage-assistants/v1.0.0/docs/images/chat.png)

![Assistant admin editor](https://raw.githubusercontent.com/drewswiredin/backstage-assistants/v1.0.0/docs/images/editor.png)

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

We set out to build a robust, full-featured multi-assistant chat plugin for
Backstage by stitching prebuilt packages together — **glue, not build**. It
wires [assistant-ui](https://www.assistant-ui.com/) (chat UI + runtime), the
[Vercel AI SDK](https://sdk.vercel.ai/) (model + tool loop), and Backstage
(identity, the Actions registry, database, signals) with thin glue; the
capabilities are the libraries'.

No spec, no ADRs — the design lives in two living diagrams and a short set of
decision principles, updated alongside the code:

- [Architecture](docs/architecture.html)
- [Configuration flow](docs/config-flow.html)
- [Principles](docs/PRINCIPLES.md)

## Packages

| Package | Role |
| --- | --- |
| [`@drewswiredin/backstage-plugin-assistants`](packages/assistants) | Frontend plugin (new frontend system) |
| [`@drewswiredin/backstage-plugin-assistants-backend`](packages/assistants-backend) | Backend plugin |
| [`@drewswiredin/backstage-plugin-assistants-common`](packages/assistants-common) | Shared browser-safe types |

Install + wiring: [frontend README](packages/assistants/README.md). Full
configuration reference: [backend README](packages/assistants-backend/README.md).

## Publishing to the marketplace

Ready-to-use listing metadata lives in [`docs/marketplace/`](docs/marketplace): an
entry for the [backstage.io plugin directory](https://backstage.io/plugins) (submit
as a PR to `backstage/backstage`) and a `Plugin` entity for the in-product Backstage
**Extensions** / Marketplace catalog. Screenshots for both come from
[`docs/images/`](docs/images). The packages carry the `backstage` role metadata and
`backstage` / `backstage-plugin` keywords for npm/ecosystem discovery.

## License

Apache-2.0
