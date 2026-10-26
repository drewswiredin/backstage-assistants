# AI Assistants for Backstage

[![npm](https://img.shields.io/npm/v/@drewswiredin/backstage-plugin-assistants)](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants)
[![CI](https://img.shields.io/github/actions/workflow/status/drewswiredin/backstage-assistants/ci.yml?branch=main&label=CI)](https://github.com/drewswiredin/backstage-assistants/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

AI Assistants for your developer portal.
Every answer comes from your catalog and docs. Every Backstage action runs as the user.

People ask questions on a full chat page, in a panel that opens beside any page
of your Backstage app, or from a composer on the home page. Assistants answer
from the catalog and TechDocs through the tools you give them, can read the page
the user is looking at, and can run Backstage actions (look up entities, search
docs, run a scaffolder template) with the permissions of the person asking.
They can also call MCP servers, which run under the credential you configure
for each server. Platform admins create assistants in-app with a prompt,
models, tools, and audience, and connect any model provider in app-config.

> Requires the new frontend system (`createApp` from
> `@backstage/frontend-defaults`) on Backstage 1.56 or later, and Node 22.12 or
> later. It does not mount in a legacy `packages/app` built on
> `@backstage/app-defaults`.

**Ask about a system.** The panel opens beside the catalog, and the assistant
searches the catalog and TechDocs, reads the pages it found, and answers with
tables, a Mermaid architecture diagram, and the gaps it noticed.

https://github.com/user-attachments/assets/5891c498-5181-42d7-81bb-1af57e4d465c

**Create a project from a template.** The assistant finds the scaffolder
template and renders its own form in the conversation, with the catalog's owner
and system pickers, then waits for approval before it runs.

https://github.com/user-attachments/assets/b0d3c659-8f9a-481c-b951-83532c3c0e12

**A tour.** The homepage composer in its four looks, the hand-off to the panel,
the full chat page, and creating an assistant: prompt, starter suggestions,
models, access, and tools.

https://github.com/user-attachments/assets/15649e1a-a80c-44c1-810e-fbe44fd18478

## What users get

- **Grounded answers.** Ask "who owns payments-api?" or "how do we onboard a
  service?" and get an answer sourced from the catalog and TechDocs, not the
  model's memory. Add the [semantic search module](packages/assistants-backend-module-semantic-search)
  and it finds pages by meaning and tolerates misspellings: "fix errored
  messages" finds the dead-letter runbook, "Pilon" finds Pylon. It covers
  everything your Backstage search indexes, Confluence or a wiki included,
  without reading any source a second time.
- **Backstage actions as the user.** Let an assistant act on Backstage: look up
  entities, search docs, or run a scaffolder template, as the user, with their
  permissions.
- **MCP servers.** Give an assistant tools outside Backstage. Each server runs
  under the one credential you configure for it, shared by everyone who uses
  the assistant.
- **Tools from your own plugins.** A frontend plugin can contribute tools
  that run in the browser as the user, with the user's own credentials, so an
  assistant can reach a system the portal already talks to as them (a
  Kubernetes cluster, a repository host behind their OAuth session). A tool
  that writes asks before every call.
- **Approval gate.** Require an Allow in the conversation before the actions
  you choose run (Always allow covers the rest of that conversation); nothing
  is gated by default and nothing runs behind the user's back.
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
  zoom; and hands back generated text files (CSV, JSON, code, SVG) as download chips.
  Markdown renders in full, tables and code included.
- **An assistant on every page.** A floating button opens a side panel for a
  quick question wherever you are; the page makes room for it. Pick another
  assistant, the model, and the reasoning effort in the panel, pick up an
  earlier conversation from its history, and move the conversation to the full
  page in one click.
- **Answers about the page you are on.** The panel tells the assistant which
  page it sits beside, and the assistant can read that page: "what does this
  mean", "which button do I press", "why is this pod failing". It also knows
  what your instance offers, its plugins, pages, and entity tabs, so "what's in
  Backstage" and "where are our API docs" get an answer with links. It works on
  any page, with no per-plugin code.
- **A composer on the home page.** Ask from the home page in one of four looks,
  from a search-bar style line to a titled card; the answer opens in the panel.
  The panel and the homepage composer are both opt-in for the app.
- **A full chat surface.** Attach images and text files, pick the model per
  conversation, set reasoning effort on models that support it, watch the
  context gauge, and copy or regenerate replies. Rename, pin, and delete
  conversations; open an assistant's details to see its tools and models.

## What admins get

- **In-app editor.** Create, edit, and delete assistants in-app; changes are
  live on save. One assistant is the default: the one every signed-in user
  gets and the panel and homepage composer open first.
- **Opt-in surfaces.** Add the panel and the homepage composer as app
  features; configure the composer's look, width, and title in app-config, and
  turn page reading off app-wide with one line.
- **Permissions.** Two Backstage permissions (`assistant.use`,
  `assistant.manage`) plus a per-assistant audience; works with your permission
  policy or the RBAC plugin.
- **Providers and storage.** Providers: OpenAI, Anthropic, Azure OpenAI, or any
  OpenAI-compatible endpoint. Database: SQLite, Postgres, or MySQL.

## Requirements

- Backstage 1.56 or later, on the new frontend system
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

| Package                                                                                                                          | Role                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [`@drewswiredin/backstage-plugin-assistants`](packages/assistants)                                                               | Frontend plugin (new frontend system)                                                                     |
| [`@drewswiredin/backstage-plugin-assistants-backend`](packages/assistants-backend)                                               | Backend plugin                                                                                            |
| [`@drewswiredin/backstage-plugin-assistants-common`](packages/assistants-common)                                                 | Shared browser-safe types                                                                                 |
| [`@drewswiredin/backstage-plugin-assistants-backend-module-semantic-search`](packages/assistants-backend-module-semantic-search) | Knowledge index: semantic and fuzzy search over everything Backstage search indexes (Postgres + pgvector) |

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
