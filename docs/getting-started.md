# Getting started

## Requirements

- Backstage 1.56 or later, on the new frontend system
  (`@backstage/frontend-defaults` `createApp`) and the new backend system
  (`@backstage/backend-defaults`). The plugin does not mount in a legacy
  `packages/app` built on `@backstage/app-defaults`.
- Node 22.12 or later.
- React 18 and `react-router-dom` ^6.30.2 in the app (peer dependencies).
- A plugin database: SQLite, Postgres, or MySQL.
- A model provider and API key: OpenAI, Anthropic, Azure OpenAI / AI Foundry,
  or any OpenAI-compatible endpoint such as [OpenRouter](https://openrouter.ai);
  or a provider type a backend module adds.
- Recommended: `@backstage/plugin-signals` in the app and
  `@backstage/plugin-signals-backend` in the backend. The frontend uses Signals
  for live status when the app has them and polls when it does not.

## Install

From your Backstage repo root:

```bash
# in the app package
yarn --cwd packages/app add @drewswiredin/backstage-plugin-assistants

# in the backend package
yarn --cwd packages/backend add @drewswiredin/backstage-plugin-assistants-backend
```

The `-common` package is pulled in transitively. On release day, pin the
version (`yarn add @drewswiredin/backstage-plugin-assistants@<version>`);
Yarn's package-age gate otherwise resolves to the previous release for three
days.

## Add the frontend plugin

Add the plugin to your app's features. Its "Assistants" nav item is registered
automatically; no extra nav code is needed. (`/alpha` is Backstage's export
convention for new-frontend-system plugins, not a stability marker.)

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

The page mounts at `/assistants`; `?assistant=<id>` opens it on a given
assistant, and `/assistants/threads/<id>` opens one conversation. In an app
with `app.packages: all`, the plugin is discovered without the `features`
entry.

For live working and unread status, add Signals to the app (and
`@backstage/plugin-signals-backend` to the backend); without it the page polls
every 10 seconds:

```ts
import signalsPlugin from '@backstage/plugin-signals/alpha';

export default createApp({
  features: [assistantsPlugin, signalsPlugin],
});
```

The side panel and the homepage composer are separate, opt-in modules; see
[Chat page, panel, and homepage](frontend.md).

## Add the backend plugin

```ts
// packages/backend/src/index.ts
backend.add(import('@drewswiredin/backstage-plugin-assistants-backend'));
```

The backend refuses to start until `assistants.defaultModel` and at least one
provider with one model are configured; the exact messages are under
[Startup errors](reference.md#startup-errors).

## Configure

All plugin options live under `assistants` in `app-config.yaml`. It holds the
platform surface only: providers, MCP servers, and the approval gate. A
minimal working example, using OpenRouter and the built-in catalog/TechDocs
read tools, plus the `backend.actions.pluginSources` entry that exposes those
tools to assistants:

```yaml
assistants:
  defaultModel: openrouter:anthropic/claude-sonnet-5
  builtinActions: true # registers the built-in catalog/TechDocs read tools
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

Without `assistants` in `backend.actions.pluginSources`, an assistant's tools
resolve to an empty list.

Set the key in the backend's environment (never commit it):

```bash
export OPENROUTER_API_KEY=sk-or-...
```

Tables are created by migrations at startup; there is nothing to run. On a
healthy start the log shows `AI Assistants backend plugin initialized` with
the model count, the default model id, the `builtinActions` flag, and the
assistant count.

## First run

The first start seeds one assistant, open to every signed-in user, with the
three built-in read tools, and makes it the default. Open `/assistants` and
talk to it, or press `Ctrl+/` on any page if the panel is installed.

Assistants (title, description, prompt, access, tools, models) are created,
edited, and deleted in the editor, never in `app-config.yaml`. Users with the
`assistant.manage` permission see a gear in the chat sidebar that opens it.

Exactly one assistant is the default: the one every signed-in user gets and
the panel opens first. "Make default" in the editor designates it and opens
its access to any signed-in user; it cannot be deleted or restricted until
another is made the default. A deployment upgraded from a version without the
designation gets its oldest assistant already open to everyone as the default,
or a `no default assistant` warning in the log until an admin designates one.

Under create-app's default allow-all permission policy every signed-in user
holds both `assistant.use` and `assistant.manage`; see
[Permissions](permissions.md) to gate either.

## Next steps

- [Model providers](providers.md): OpenAI, Anthropic, Azure, and
  OpenAI-compatible endpoints, and per-model options.
- [Actions and tools](tools.md): the Backstage actions an assistant can call,
  and a recommended starter setup.
- [MCP servers](mcp.md): tools outside Backstage, under a shared credential or
  as each user.
- [Approvals](approvals.md): require an Allow before a tool runs.
