# AI Assistants for Backstage

[![npm](https://img.shields.io/npm/v/@drewswiredin/backstage-plugin-assistants)](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants)
[![CI](https://img.shields.io/github/actions/workflow/status/drewswiredin/backstage-assistants/ci.yml?branch=main&label=CI)](https://github.com/drewswiredin/backstage-assistants/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

AI Assistants for your developer portal.
Every answer comes from your catalog and docs. Every Backstage action runs as the user.

People ask questions in a side panel of your Backstage app. Assistants answer
from the catalog and TechDocs through the tools you give them, and can run
Backstage actions (look up entities, search docs, run a scaffolder template)
with the permissions of the person asking. They can also call MCP servers, which
run under the credential you configure for each server. Platform admins create
assistants in-app with a prompt, models, tools, and audience, and connect any
model provider in app-config.

> Requires the new frontend system (`createApp` from
> `@backstage/frontend-defaults`) on Backstage 1.54 or later, and Node 22.12 or
> later. It does not mount in a legacy `packages/app` built on
> `@backstage/app-defaults`.

![AI Assistants chat panel](https://raw.githubusercontent.com/drewswiredin/backstage-assistants/main/docs/images/chat.png)

![Assistant admin editor](https://raw.githubusercontent.com/drewswiredin/backstage-assistants/main/docs/images/editor.png)

## What users get

- **Grounded answers.** Ask "who owns payments-api?" or "how do we onboard a
  service?" and get an answer sourced from the catalog and TechDocs, not the
  model's memory.
- **Backstage actions as the user.** Let an assistant act on Backstage: look up
  entities, search docs, or run a scaffolder template, as the user, with their
  permissions.
- **MCP servers.** Give an assistant tools outside Backstage. Each server runs
  under the one credential you configure for it, shared by everyone who uses
  the assistant.
- **Approval gate.** Require an Allow / Deny in the conversation before the
  actions you choose run; nothing is gated by default and nothing runs behind
  the user's back.
- **Conversations that keep going.** Keep several conversations going across
  several assistants; leave the page mid-reply and come back to the finished
  answer.
- **Scaffolder templates in the conversation.** Ask for a new service and the
  assistant shows the template's own form in the conversation, with your owner,
  entity, and repo pickers. Submit it and the assistant runs the template as
  you.
- **Generative UI in the chat pane.** Replies are more than text. The
  assistant shows a form, with your scaffolder pickers, instead of asking one
  question at a time; draws Mermaid diagrams you can open fullscreen to pan and
  zoom; and hands back generated files as download chips, with a preview for
  images. Markdown renders in full, tables and code included.
- **A full chat surface.** Attach files, pick the model per conversation, and
  set reasoning effort on models that support it.

## What admins get

- **In-app editor.** Create, edit, and delete assistants in-app; changes are
  live on save.
- **Permissions.** Two Backstage permissions (`assistant.use`,
  `assistant.manage`) plus a per-assistant audience; works with your permission
  policy or the RBAC plugin.
- **Providers and storage.** Providers: OpenAI, Anthropic, Azure OpenAI, or any
  OpenAI-compatible endpoint. Database: SQLite, Postgres, or MySQL.

## Requirements

- Backstage 1.54 or later, on the new frontend system
  (`@backstage/frontend-defaults` `createApp`) and the new backend system
  (`@backstage/backend-defaults`).
- Node 22.12 or later.
- React 18 and `react-router-dom` ^6.30.2 in the app.
- A plugin database: SQLite, Postgres, or MySQL.
- A model provider and API key: OpenAI, Anthropic, Azure OpenAI / AI Foundry,
  or any OpenAI-compatible endpoint such as [OpenRouter](https://openrouter.ai).
- Recommended: `@backstage/plugin-signals` in the app and
  `@backstage/plugin-signals-backend` in the backend. The frontend uses Signals
  for live status when the app has them and polls when it does not.

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
[SECURITY.md](SECURITY.md) for how to report a vulnerability. The design lives
in [docs/PRINCIPLES.md](docs/PRINCIPLES.md) and
[docs/architecture.md](docs/architecture.md).

## License

Apache-2.0. Includes MIT-licensed components from assistant-ui; see
[packages/assistants/THIRD_PARTY_NOTICES.md](packages/assistants/THIRD_PARTY_NOTICES.md).
