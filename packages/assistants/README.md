# @drewswiredin/backstage-plugin-assistants

AI Assistants for Backstage — a polished, configurable chat experience for your
developer portal. Create one or more assistants in the in-app admin editor (each
with its own prompt, tools, models, access policy, and color; stored in the
plugin database); users chat with them in a collapsible, multi-conversation UI
with streaming responses, tool calls, Markdown/Mermaid rendering,
per-conversation model selection, and background (concurrent) conversations
with unread indicators.

This is the **frontend** plugin (new frontend system only). It pairs with:

- [`@drewswiredin/backstage-plugin-assistants-backend`](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants-backend) — the backend (required)
- [`@drewswiredin/backstage-plugin-assistants-common`](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants-common) — shared types and permissions (installed transitively)

![AI Assistants chat panel](https://raw.githubusercontent.com/drewswiredin/backstage-assistants/main/docs/images/chat.png)

![Assistant admin editor](https://raw.githubusercontent.com/drewswiredin/backstage-assistants/main/docs/images/editor.png)

## Requirements

- Backstage 1.53 or later, on the new frontend system
  (`@backstage/frontend-defaults` `createApp`) and the new backend system
  (`@backstage/backend-defaults`).
- Node 22.12 or later.
- React 18 and `react-router-dom` ^6.30.2 (peer dependencies).
- A plugin database for the backend: SQLite or Postgres (MySQL is supported).
- A model provider and API key — OpenAI, Anthropic, Azure OpenAI / AI Foundry,
  or any OpenAI-compatible endpoint such as [OpenRouter](https://openrouter.ai).
- Recommended: `@backstage/plugin-signals` in the app (with
  `@backstage/plugin-signals-backend` in the backend). Working and unread
  indicators arrive over signals when the app has them; without them the
  plugin polls.

## Install

From your Backstage repo root:

```bash
# in the app package
yarn --cwd packages/app add @drewswiredin/backstage-plugin-assistants

# in the backend package
yarn --cwd packages/backend add @drewswiredin/backstage-plugin-assistants-backend
```

The `-common` package is pulled in transitively.

Yarn's package-age gate (`npmMinimalAgeGate`, 3 days in a create-app) resolves
a same-day release to the previous version; pin an exact version
(`yarn add <pkg>@<version>`) or set `npmMinimalAgeGate` in `.yarnrc.yml` to
take it immediately.

### Dependency versions

The `@assistant-ui/*` set, `assistant-cloud`, and the AI SDK (`ai`,
`@ai-sdk/react`) are declared as caret ranges matching what upstream declares
for itself, so a consumer resolves a single copy of each. Upstream moves the
family in lockstep; bump them as a group.

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

### Hide the nav item from users without access

The auto-registered nav entry is not permission-gated: a user without
`assistant.use` still sees it and lands on a "You are not permitted to use
assistants" page. To hide the plugin entirely for them, render the nav entry
yourself behind a `usePermission(assistantUsePermission)` check in a custom
`NavContentBlueprint` that `take()`s the auto entry:

```tsx
// packages/app/src/modules/nav/Sidebar.tsx
import { Sidebar, SidebarItem } from '@backstage/core-components';
import { NavContentBlueprint } from '@backstage/plugin-app-react';
import { usePermission } from '@backstage/plugin-permission-react';
import { AssistantsNavIcon } from '@drewswiredin/backstage-plugin-assistants';
import { assistantUsePermission } from '@drewswiredin/backstage-plugin-assistants-common';

function AssistantsSidebarItem() {
  const { allowed } = usePermission({ permission: assistantUsePermission });
  if (!allowed) {
    return null;
  }
  return (
    <SidebarItem
      icon={() => <AssistantsNavIcon />}
      to="/assistants"
      text="Assistants"
    />
  );
}

export const SidebarContent = NavContentBlueprint.make({
  params: {
    component: ({ navItems }) => {
      const nav = navItems.withComponent(item => (
        <SidebarItem icon={() => item.icon} to={item.href} text={item.title} />
      ));
      nav.take('page:assistants'); // consume the auto entry so it is not duplicated
      return (
        <Sidebar>
          {nav.take('page:catalog')}
          <AssistantsSidebarItem />
          {nav.rest({ sortBy: 'title' })}
        </Sidebar>
      );
    },
  },
});
```

See the
[backend README](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants-backend#permissions)
for granting `assistant.use` / `assistant.manage` via a permission policy.

### Root entry exports

The plugin itself is the default export of the `./alpha` subpath. The package
root exports what a host app needs to integrate with it:

| Export                                                          | Purpose                                                                            |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `rootRouteRef`                                                  | Route ref for the `/assistants` page.                                              |
| `assistantsApiRef`                                              | API ref for the backend client (`AssistantsApi`): assistant list, threads, status. |
| `AssistantsNavIcon`                                             | Nav-rail icon with a live working/unread status dot, for a custom sidebar.         |
| `AssistantsApi`, `ConversationStatusRow`, `ThreadPatch` (types) | The client interface and its row/patch shapes.                                     |

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
surface only (providers, the safety floor). Minimal working example, using
OpenRouter and the built-in catalog/TechDocs read tools:

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
providers, MCP servers, and the approval floor). Per-assistant settings
(prompt, access, tools, models) are not config; they're managed in the in-app
editor. Tool/action availability depends on which action-providing plugins are
installed in your backend; the built-in read tools are provided by
`builtinActions`.

## Manage assistants

Users with the `assistant.manage` permission see a gear in the chat sidebar that
opens the editor — create, edit, and delete assistants there. Under create-app's
default allow-all permission policy every signed-in user holds both
`assistant.use` and `assistant.manage`; grant them to the right users in your
permission policy.

## License

Apache-2.0. Vendored MIT-licensed code from assistant-ui is listed in
`THIRD_PARTY_NOTICES.md`, shipped with this package.
