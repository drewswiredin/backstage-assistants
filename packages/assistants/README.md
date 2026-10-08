# @drewswiredin/backstage-plugin-assistants

AI Assistants for your developer portal.
Every answer comes from your catalog and docs. Every Backstage action runs as the user.

This is the frontend plugin of AI Assistants for Backstage, for the new
frontend system: a collapsible, multi-conversation chat panel at `/assistants`
and the in-app editor where admins create assistants. It pairs with:

- [`@drewswiredin/backstage-plugin-assistants-backend`](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants-backend),
  the backend (required)
- [`@drewswiredin/backstage-plugin-assistants-common`](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants-common),
  shared types and permissions (installed transitively)

![AI Assistants chat panel](https://raw.githubusercontent.com/drewswiredin/backstage-assistants/main/docs/images/chat.png)

![Assistant admin editor](https://raw.githubusercontent.com/drewswiredin/backstage-assistants/main/docs/images/editor.png)

## Requirements

- Backstage 1.54 or later, on the new frontend system
  (`@backstage/frontend-defaults` `createApp`) and the new backend system
  (`@backstage/backend-defaults`).
- Node 22.12 or later.
- React 18 and `react-router-dom` ^6.30.2 (peer dependencies).
- A plugin database for the backend: SQLite, Postgres, or MySQL.
- A model provider and API key: OpenAI, Anthropic, Azure OpenAI / AI Foundry,
  or any OpenAI-compatible endpoint such as [OpenRouter](https://openrouter.ai).
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

## Wire up

### Frontend

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

The page mounts at `/assistants`.

### Backend

```ts
// packages/backend/src/index.ts
backend.add(import('@drewswiredin/backstage-plugin-assistants-backend'));
```

### app-config

Add an `assistants` block to `app-config.yaml`. It holds the platform surface
only: providers, MCP servers, and the approval gate. A minimal working example,
using OpenRouter and the built-in catalog/TechDocs read tools, plus the
`backend.actions.pluginSources` entry that exposes those tools to assistants:

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
      - assistants # plus catalog / scaffolder etc. for their actions
```

Without `assistants` in `backend.actions.pluginSources`, an assistant's tools
resolve to an empty list.

Set the key in your environment (never commit it):

```bash
export OPENROUTER_API_KEY=sk-or-...
```

See the
[backend README](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants-backend)
for everything else: model providers, MCP servers, the approval gate, and
permissions. Per-assistant settings (prompt, access, tools, models) are not
config; they are managed in the in-app editor. Tool availability depends on
which action-providing plugins are installed in your backend; the built-in
read tools are provided by `builtinActions`.

## First run

On first start the backend seeds one assistant, open to every signed-in user,
with the three built-in read tools. Open `/assistants` and talk to it.

Users with the `assistant.manage` permission see a gear in the chat sidebar
that opens the editor to create, edit, and delete assistants. Under
create-app's default allow-all permission policy every signed-in user holds
both `assistant.use` and `assistant.manage`; grant them to the right users in
your permission policy, as described in the
[backend README](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants-backend#grant-assistantuse-and-assistantmanage).

## Customize the sidebar

The plugin's nav entry has the id `page:assistants`; in a custom
`NavContentBlueprint`, `take()` it to place it yourself.

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

## Reference

### Root entry exports

The plugin itself is the default export of the `./alpha` subpath. The package
root exports what a host app needs to integrate with it:

| Export                                                          | Purpose                                                                            |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `rootRouteRef`                                                  | Route ref for the `/assistants` page.                                              |
| `assistantsApiRef`                                              | API ref for the backend client (`AssistantsApi`): assistant list, threads, status. |
| `AssistantsNavIcon`                                             | Nav-rail icon with a live working/unread status dot, for a custom sidebar.         |
| `AssistantsApi`, `ConversationStatusRow`, `ThreadPatch` (types) | The client interface and its row/patch shapes.                                     |

### Forms and scaffolder pickers

Assistants can show an inline form (the `render_form` tool) built from
Backstage scaffolder field extensions (owner, entity, and repo pickers, plus
any custom field), resolved at runtime from the app. With
`@backstage/plugin-scaffolder` registered the pickers populate from the
catalog; without it, forms render with plain inputs.

A scaffolder template's parameters render as-is, `ui:field` and `ui:options`
included, so an assistant can show a template's own form in the conversation and
run the template with the submitted values. The backend README covers
[the actions that flow needs](https://github.com/drewswiredin/backstage-assistants/tree/main/packages/assistants-backend#run-a-scaffolder-template-from-the-conversation).

### Dependency versions

The `@assistant-ui/*` set, `assistant-cloud`, and the AI SDK (`ai`,
`@ai-sdk/react`) are declared as caret ranges matching what upstream declares
for itself, so a consumer resolves a single copy of each. Upstream moves the
family in lockstep; bump them as a group.

## License

Apache-2.0. Includes MIT-licensed components from assistant-ui, listed in
`THIRD_PARTY_NOTICES.md`, shipped with this package.
