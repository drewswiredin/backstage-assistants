# @drewswiredin/backstage-plugin-assistants-common

Shared, browser-safe types and permissions for the Backstage AI Assistants
plugin — the contract between the
[frontend](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants)
and
[backend](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants-backend)
packages. It has one runtime dependency, `@backstage/plugin-permission-common`.

It is installed transitively by both plugins. Depend on it directly when you
write a permission policy or a custom nav that references the plugin's
permissions:

```bash
yarn --cwd packages/app add @drewswiredin/backstage-plugin-assistants-common
```

## Exports

Permissions:

| Export                      | `name`             | `action` | Gates                               |
| --------------------------- | ------------------ | -------- | ----------------------------------- |
| `assistantUsePermission`    | `assistant.use`    | `read`   | the chat and the user-facing routes |
| `assistantManagePermission` | `assistant.manage` | `update` | the admin editor and `/manage/*`    |
| `assistantsPermissions`     |                    |          | both, as an array                   |

Types:

- `AssistantDefinition` — the canonical assistant shape (one row of the
  `assistants` table; the `/manage` API and admin editor's model), with
  `AssistantAccess` (its access policy) and `UiOptions`.
- `AssistantSummary` and `StatusResponse` — the browser-safe `/status`
  projection (no prompt, no access policy), with `ToolSummary` and
  `ModelOption`.
- `CapabilitiesResponse` — the editor's assignable inventory, with
  `CapabilityAction` and `McpServerCapability`.
- `TitleRequest` / `TitleResponse` — the `/title` contract.
- `AssistantId`, `ModelId` (`provider:model`), `ReasoningLevel` and the
  `REASONING_LEVELS` constant (`low`, `medium`, `high`, `max`).

## License

Apache-2.0
