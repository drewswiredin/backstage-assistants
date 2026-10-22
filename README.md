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

**A grounded answer.** The assistant answers from the catalog and TechDocs, with
a Mermaid diagram and a Markdown table.

![A grounded answer with a Mermaid diagram and a table](https://raw.githubusercontent.com/drewswiredin/backstage-assistants/main/docs/images/chat.png)

**A scaffolder form in the conversation.** The template's own parameters, with
its pickers, rendered inline.

![A scaffolder template form in the conversation](https://raw.githubusercontent.com/drewswiredin/backstage-assistants/main/docs/images/scaffolder-form.png)

**Tool approval.** `execute-template` waits for Allow, Always allow, or Deny
before it runs.

![An approval card for execute-template](https://raw.githubusercontent.com/drewswiredin/backstage-assistants/main/docs/images/tool-approval.png)

**Creating an assistant.** Prompt, starter suggestions, models, and who can use
it.

![The assistant editor](https://raw.githubusercontent.com/drewswiredin/backstage-assistants/main/docs/images/editor.png)

**Assigning tools.** Backstage actions run as the user; MCP tools run under
their server's configured credential.

![Tool assignment in the assistant editor](https://raw.githubusercontent.com/drewswiredin/backstage-assistants/main/docs/images/editor-tools.png)

**An assistant beside any page.** The panel opens next to the page you are on,
which makes room for it, and continues in the full chat page in one click.

<!-- screenshot: panel.png — the panel open beside an entity page, mid-answer -->

**About what is on screen.** Ask "what does this mean" or "which button do I
press" and the assistant reads the page you are looking at.

<!-- screenshot: panel-page-context.png — the panel answering a question about the page beside it, with the read_current_page chip -->

**On the home page.** One composer in four looks, from a search-bar style line
to a titled card; sending opens the panel on the answer.

![The homepage composer's four looks](https://raw.githubusercontent.com/drewswiredin/backstage-assistants/main/docs/images/home-composer-variants.png)

## What users get

- **Grounded answers.** Ask "who owns payments-api?" or "how do we onboard a
  service?" and get an answer sourced from the catalog and TechDocs, not the
  model's memory. Add the [semantic search module](packages/assistants-backend-module-semantic-search)
  and it finds pages by meaning and tolerates misspellings: "fix errored
  messages" finds the dead-letter runbook, "Pilon" finds Pylon.
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
  mean", "which button do I press", "why is this pod failing". It works on any
  page, with no per-plugin code.
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

| Package                                                                                                                          | Role                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [`@drewswiredin/backstage-plugin-assistants`](packages/assistants)                                                               | Frontend plugin (new frontend system)                                                          |
| [`@drewswiredin/backstage-plugin-assistants-backend`](packages/assistants-backend)                                               | Backend plugin                                                                                 |
| [`@drewswiredin/backstage-plugin-assistants-common`](packages/assistants-common)                                                 | Shared browser-safe types                                                                      |
| [`@drewswiredin/backstage-plugin-assistants-backend-module-semantic-search`](packages/assistants-backend-module-semantic-search) | Knowledge index: semantic and fuzzy search over TechDocs and the catalog (Postgres + pgvector) |

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
