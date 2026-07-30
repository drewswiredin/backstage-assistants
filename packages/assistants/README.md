# @drewswiredin/backstage-plugin-assistants

AI Assistants for Backstage — a polished, configurable chat experience for your
developer portal. Create one or more assistants in the in-app admin editor (each
with its own prompt, tools, models, access policy, and color; stored in the
plugin database); users chat with them
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

### A note on the pinned `@assistant-ui/*` versions

Every `@assistant-ui/*` dependency — plus `assistant-cloud` — is pinned to an
**exact** version rather than a caret range, and that is deliberate. Do not
loosen them.

`@assistant-ui/core` declares `@assistant-ui/tap` as a *peer* dependency, and
`tap` changed its API incompatibly between `0.5.x` (`tapState`,
`tapClientLookup`) and `0.9.x` (`resource`, `useResource`). Because it is a peer,
no package manager can resolve a conflict by nesting two copies: whichever `tap`
the tree happens to hoist is the one `core` gets. A single floating range
anywhere in the set is enough to drift `core` to the far side of that break, and
the failure does not appear at install time — it surfaces as missing-export
errors when the consumer bundles.

The set here is verified to sit on one generation together. Bump them as a
group, not individually.

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

> **Hide it from users without access.** The auto-registered nav entry is **not**
> permission-gated by default — a user without `assistant.use` would still see it
> and hit a "You are not permitted to use assistants" page on click. To hide the
> plugin entirely for them, render the nav entry yourself behind a
> `usePermission(assistantUsePermission)` check (`assistantUsePermission` comes
> from `@drewswiredin/backstage-plugin-assistants-common`): a custom
> `NavContentBlueprint` that `take('page:assistants')`s the auto entry and adds
> your own gated `SidebarItem`. This repo's dev app does exactly this in
> `packages/app/src/modules/nav/Sidebar.tsx`. See the
> [backend README](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants-backend#permissions)
> for granting `assistant.use` / `assistant.manage` via a permission policy.

> **Interactive forms & scaffolder pickers (optional).** Assistants can render
> inline RJSF forms (the `render_form` tool) for human-in-the-loop input. Those
> forms reuse Backstage **scaffolder field extensions** (owner / entity / repo
> pickers, plus any custom field), resolved at runtime from the app. If
> `@backstage/plugin-scaffolder` is registered (it is under feature discovery /
> `app.packages: all`), those pickers populate from the catalog; without it,
> forms still render with plain inputs. No extra wiring is required.

## Wire up the backend

```ts
// packages/backend/src/index.ts
backend.add(import('@drewswiredin/backstage-plugin-assistants-backend'));
```

## Configure

Add an `assistants` block to `app-config.yaml` — this is the platform/safety
surface only (providers, the safety floor). Minimal working
example (OpenRouter + the built-in catalog/TechDocs read tools):

```yaml
assistants:
  defaultModel: openrouter:google/gemini-2.5-flash
  builtinActions: true # registers the built-in catalog/TechDocs read tools
  providers:
    openrouter:
      type: openai-compatible
      apiKey: ${OPENROUTER_API_KEY}
      baseUrl: https://openrouter.ai/api/v1
      models:
        - name: google/gemini-2.5-flash
          contextWindow: 1048576
```

Assistants themselves are **not** configured here — sign in as an admin and use
the gear in the chat sidebar to create one (it seeds open to all signed-in users
with the built-in read tools).

Set the key in your environment (never commit it):

```bash
export OPENROUTER_API_KEY=sk-or-...
```

Also add `assistants` to the backend actions service so the tools are exposed
(otherwise an assistant's tools resolve to empty):

```yaml
backend:
  actions:
    pluginSources:
      - assistants # plus catalog / scaffolder etc. for their actions
```

See the
[backend README](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants-backend)
for the full configuration reference — the **platform** settings (model
providers, MCP servers, and the approval floor).
Per-assistant settings (prompt, access, tools, models)
are not config; they're managed in the in-app editor. Tool/action availability
depends on which action-providing plugins are installed in your backend; the
built-in read tools are provided by `builtinActions`.

## Manage assistants

Users with the `assistant.manage` permission see a gear in the chat sidebar that
opens the editor — create, edit, and delete assistants there. Grant
`assistant.manage` (and `assistant.use` for plugin access) to the right users in
your permission policy.

## License

Apache-2.0
