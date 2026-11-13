# AI Assistants for Backstage

[![npm](https://img.shields.io/npm/v/@drewswiredin/backstage-plugin-assistants)](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants)
[![CI](https://img.shields.io/github/actions/workflow/status/drewswiredin/backstage-assistants/ci.yml?branch=main&label=CI)](https://github.com/drewswiredin/backstage-assistants/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

Chat assistants that answer from your catalog and TechDocs, and run Backstage
actions and MCP tools as the signed-in user. Admins build them in-app.

**Docs: [drewswiredin.github.io/backstage-assistants](https://drewswiredin.github.io/backstage-assistants/)**

> Requires the new frontend system (`createApp` from
> `@backstage/frontend-defaults`) on Backstage 1.56 or later, and Node 22.12 or
> later. It does not mount in a legacy `packages/app` built on
> `@backstage/app-defaults`.

**Ask about a system.** The assistant searches the catalog and TechDocs, reads
the pages it found, and answers with tables and a Mermaid diagram.

https://github.com/user-attachments/assets/5891c498-5181-42d7-81bb-1af57e4d465c

**Create a project from a template.** The assistant shows the scaffolder
template's own form in the conversation, then waits for approval before it
runs.

https://github.com/user-attachments/assets/b0d3c659-8f9a-481c-b951-83532c3c0e12

**A tour.** The homepage composer, the panel, the chat page, and creating an
assistant.

https://github.com/user-attachments/assets/15649e1a-a80c-44c1-810e-fbe44fd18478

## Features

- Answers from the catalog and TechDocs, with optional
  [semantic search](docs/semantic-search.md) over everything Backstage search
  indexes.
- [Backstage actions](docs/tools.md) run as the user, with their permissions,
  including scaffolder templates with the template's own form.
- [MCP servers](docs/mcp.md), under a shared credential or as each user with
  their own sign-in.
- An [approval gate](docs/approvals.md) for the tools you choose.
- A chat page, a [panel beside any page](docs/frontend.md#panel) that can read
  that page, and a [homepage composer](docs/frontend.md#homepage).
- An in-app editor for assistants: prompt, models, tools, and audience.
- OpenAI, Anthropic, Azure OpenAI, or any OpenAI-compatible
  [provider](docs/providers.md); SQLite, Postgres, or MySQL.
- [Client tools](docs/client-tools.md) your own plugins contribute, which run
  in the browser with the user's credentials.

## Quick start

```bash
yarn --cwd packages/app add @drewswiredin/backstage-plugin-assistants
yarn --cwd packages/backend add @drewswiredin/backstage-plugin-assistants-backend
```

```ts
// packages/app/src/App.tsx
import { createApp } from '@backstage/frontend-defaults';
import assistantsPlugin from '@drewswiredin/backstage-plugin-assistants/alpha';

export default createApp({ features: [assistantsPlugin] });
```

```ts
// packages/backend/src/index.ts
backend.add(import('@drewswiredin/backstage-plugin-assistants-backend'));
```

```yaml
# app-config.yaml
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

backend:
  actions:
    pluginSources:
      - assistants
```

Open `/assistants` and talk to the seeded assistant. The full walkthrough is in
[Getting started](docs/getting-started.md).

## Packages

| Package                                                                                                                          | Role                                  |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| [`@drewswiredin/backstage-plugin-assistants`](packages/assistants)                                                               | Frontend plugin (new frontend system) |
| [`@drewswiredin/backstage-plugin-assistants-backend`](packages/assistants-backend)                                               | Backend plugin                        |
| [`@drewswiredin/backstage-plugin-assistants-common`](packages/assistants-common)                                                 | Shared types and permissions          |
| [`@drewswiredin/backstage-plugin-assistants-backend-module-semantic-search`](packages/assistants-backend-module-semantic-search) | Semantic search (Postgres + pgvector) |

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and
[SECURITY.md](SECURITY.md) for how to report a vulnerability.

## License

Apache-2.0. Includes MIT-licensed components from assistant-ui; see
[packages/assistants/THIRD_PARTY_NOTICES.md](packages/assistants/THIRD_PARTY_NOTICES.md).
