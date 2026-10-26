# @drewswiredin/backstage-plugin-assistants-common

Shared, browser-safe types and permissions for AI Assistants for Backstage:
the contract between the
[frontend](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants)
and
[backend](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants-backend)
packages. It has one runtime dependency, `@backstage/plugin-permission-common`.

It is installed transitively by both plugins. Depend on it directly when you
write a permission policy or a custom nav that references the plugin's
permissions:

```bash
# a permission policy
yarn --cwd packages/backend add @drewswiredin/backstage-plugin-assistants-common
# a custom nav
yarn --cwd packages/app add @drewswiredin/backstage-plugin-assistants-common
```

## Exports

Permissions:

| Export                      | `name`             | `action` | Gates                                              |
| --------------------------- | ------------------ | -------- | -------------------------------------------------- |
| `assistantUsePermission`    | `assistant.use`    | `read`   | the chat and the user-facing routes                |
| `assistantManagePermission` | `assistant.manage` | `update` | the admin editor, `/manage/*`, and `/capabilities` |
| `assistantsPermissions`     |                    |          | both, as an array                                  |

Types:

- `AssistantDefinition`: the canonical assistant shape (one row of the
  `assistants` table; the `/manage` API and admin editor's model), with
  `AssistantAccess` (its access policy) and `UiOptions`.
- `AssistantSummary` and `StatusResponse`: the browser-safe `/status`
  projection (no prompt, no access policy), with `ToolSummary` and
  `ModelOption`.
- `CapabilitiesResponse`: the editor's assignable inventory, with
  `CapabilityAction` and `McpServerCapability`.
- `AssistantId`, `ModelId` (`<providerId>:<model>`), `ReasoningLevel` and the
  `REASONING_LEVELS` constant (`low`, `medium`, `high`, `max`).
- `StatusResponse.requireApproval`: the global approval floor as tool names,
  which the browser uses to gate client tools.
- `StatusResponse.defaultAssistant`, and `isDefault` on `AssistantSummary` and
  `AssistantDefinition`: the default assistant, the one every signed-in user
  gets.
- `PageContext` (`path`, `title`, `entityRef`): the page a surface beside the
  page sends with a turn.

Client tools (the browser-to-backend contract for tools that run in the
user's browser; the blueprint itself is in the frontend package):

- `ClientToolAttributes` (`readOnly`, `destructive`, `idempotent`) and
  `ClientToolDeclaration`, the per-request declaration (`description`,
  JSON Schema `parameters`, `attributes`).
- `ClientToolError` and `ClientToolErrorCode` (`declined`, `not_authorized`,
  `timeout`, `aborted`, `failed`): the `_error` result a client tool returns
  instead of throwing.
- `CLIENT_TOOL_NAME_PATTERN` (`<namespace>__<tool>`), `BUILTIN_CLIENT_TOOLS`
  (`render_form`, `download_file`, `read_current_page`, `describe_portal`), `CLIENT_TOOL_LIMITS` (30 per request,
  4000-character description, 8192-character schema), and
  `isClientToolName`.

Per-user MCP servers (a server the browser calls with the user's own
token):

- `UserCredentialSpec` (on `AssistantSummary.userCredentials`): the sign-in a
  server needs, and `USER_CREDENTIALS_HEADER` (`x-assistants-credentials`),
  the header the browser sends the tokens in.
- `McpOAuthConnection`, `McpOAuthStatusResponse`, `McpOAuthStartResponse`, and
  `MCP_OAUTH_MESSAGE_TYPE`: the Connect flow for a server that runs its own
  OAuth.
- `StatusResponse.approveEachCall`: servers whose gated tools take no Always
  allow.
- `ApprovalPreview`, `ApprovalPreviewRequest`, `ApprovalPreviewResponse`,
  `StatusResponse.approvalPreviews`, and `resolvePreviewField`: the diff an
  approval card shows for a write.

Elicitation (an MCP server asking the user for input mid-call):

- `ElicitationPrompt`, `ElicitationStatus`, `ElicitationField`,
  `ElicitationOption`, and `ElicitationResponseRequest`.
- `parseElicitationSchema`, `validateElicitationContent`, and
  `isSensitiveElicitationField`: the shared schema parsing and validation.

Platform instructions:

- `PLATFORM_INSTRUCTIONS`: the fixed text the backend sends before every
  assistant's prompt; the editor shows it read-only.

## License

Apache-2.0
