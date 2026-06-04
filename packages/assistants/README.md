# @drewswiredin/backstage-plugin-assistants

AI Assistants for Backstage — a polished, configurable chat experience for your
developer portal. Define one or more assistants in `app-config.yaml` (each with
its own prompt, tools, models, access policy, and color); users chat with them
in a collapsible, multi-conversation UI with streaming responses, tool calls,
Markdown/Mermaid rendering, per-conversation model selection, and background
(concurrent) conversations with unread indicators.

This is the **frontend** plugin (new frontend system). It pairs with:

- [`@drewswiredin/backstage-plugin-assistants-backend`](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants-backend) — the backend (required)
- [`@drewswiredin/backstage-plugin-assistants-common`](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants-common) — shared types (installed transitively)

## Requirements

- Backstage running the **new frontend system** (`@backstage/frontend-defaults` /
  `createApp`) and the **new backend system** (`@backstage/backend-defaults`).
- A model provider and API key (e.g. an [OpenRouter](https://openrouter.ai) key,
  or any OpenAI-compatible / OpenAI / Anthropic / Azure endpoint).

## Install

From your Backstage repo root:

```bash
# in the app package
yarn --cwd packages/app add @drewswiredin/backstage-plugin-assistants

# in the backend package
yarn --cwd packages/backend add @drewswiredin/backstage-plugin-assistants-backend
```

(The `-common` package is pulled in transitively; you don't add it directly.)

## Wire up the frontend

Add the plugin to your app's features. Its **"Assistants" nav item is registered
automatically** — no extra nav code needed.

```ts
// packages/app/src/App.tsx
import { createApp } from '@backstage/frontend-defaults';
import assistantsPlugin from '@drewswiredin/backstage-plugin-assistants/alpha';

export default createApp({
  features: [
    assistantsPlugin,
    // ...your other features
  ],
});
```

The page mounts at `/assistants`.

> Using a custom `NavContentBlueprint` to lay out your sidebar? The plugin's nav
> entry has the id `page:assistants` — `take()` it to place it yourself.

## Wire up the backend

```ts
// packages/backend/src/index.ts
backend.add(import('@drewswiredin/backstage-plugin-assistants-backend'));
```

## Configure

Add an `assistants` block to `app-config.yaml`. Minimal working example
(OpenRouter + one assistant open to all signed-in users, with the built-in
catalog/TechDocs read tools):

```yaml
assistants:
  defaultModel: openrouter:google/gemini-2.5-flash
  registerCoreActions: true # registers the built-in search/read tools
  providers:
    openrouter:
      type: openai-compatible
      apiKey: ${OPENROUTER_API_KEY}
      baseUrl: https://openrouter.ai/api/v1
      models:
        - google/gemini-2.5-flash
  profiles:
    general:
      title: General Assistant
      description: Catalog + TechDocs helper for your developer portal.
      prompt: |
        You are a Backstage developer-portal assistant. Use your tools to look
        up systems, services, teams, APIs, and documentation before answering.
      access:
        allowAuthenticated: true
      actions:
        - search-catalog
        - search-techdocs
        - read-techdocs
```

Set the key in your environment (never commit it):

```bash
export OPENROUTER_API_KEY=sk-or-...
```

Also add `assistants` to the backend actions service so the tools are exposed
(otherwise a profile's tools resolve to empty):

```yaml
backend:
  actions:
    pluginSources:
      - assistants # plus catalog / scaffolder etc. for their actions
```

See the
[backend README](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants-backend)
for the full configuration reference (providers, per-assistant access policies,
model allowlists, additional tools, and UI options). Tool/action availability
depends on which action-providing plugins are installed in your backend; the
three tools above are provided by `registerCoreActions`.

## License

Apache-2.0
