# Backstage AI Assistants

A polished, configurable AI chat experience for Backstage. Define assistants in
`app-config.yaml` — each with its own system prompt, tool allowlist, model
allowlist, access policy, and color — and users chat with them in a collapsible,
multi-conversation UI: streaming responses, tool calls, Markdown/Mermaid,
per-conversation model selection, and background (concurrent) conversations with
unread indicators.

## Packages

| Package | Role |
| --- | --- |
| [`@drewswiredin/backstage-plugin-assistants`](packages/assistants) | Frontend plugin (new frontend system) |
| [`@drewswiredin/backstage-plugin-assistants-backend`](packages/assistants-backend) | Backend plugin |
| [`@drewswiredin/backstage-plugin-assistants-common`](packages/assistants-common) | Shared browser-safe types |

## Installing into a Backstage app

See the **[frontend plugin README](packages/assistants/README.md)** for the full
install + wiring guide, and the
**[backend plugin README](packages/assistants-backend/README.md)** for the
complete configuration reference. In short:

```bash
yarn --cwd packages/app add @drewswiredin/backstage-plugin-assistants
yarn --cwd packages/backend add @drewswiredin/backstage-plugin-assistants-backend
```

```ts
// packages/app/src/App.tsx
import assistantsPlugin from '@drewswiredin/backstage-plugin-assistants/alpha';
export default createApp({ features: [assistantsPlugin /* ... */] });

// packages/backend/src/index.ts
backend.add(import('@drewswiredin/backstage-plugin-assistants-backend'));
```

Then add an `assistants:` block to `app-config.yaml` and set your provider key
(e.g. `OPENROUTER_API_KEY`). The "Assistants" nav item registers automatically.

## Repository layout

This is a Yarn workspaces monorepo containing the three plugin packages plus a
co-located demo app (`packages/app`) and backend (`packages/backend`) used for
local development.

## Local development

```bash
yarn install
OPENROUTER_API_KEY=sk-or-... yarn start
```

This boots the demo app + backend with the plugin wired in. The key is read from
your environment (or a gitignored `.env`) — never commit it.

## License

Apache-2.0
