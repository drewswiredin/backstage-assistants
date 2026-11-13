# Reference

## Configuration keys

All keys sit under `assistants`. `assistants.semanticSearch` belongs to the
[semantic search module](semantic-search.md#reference).

| Key                                       | Default                           | Description                                                                                                                                                                                                                                                             |
| ----------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defaultModel`                            | required                          | Initial `<providerId>:<model>`; must exist in a provider.                                                                                                                                                                                                               |
| `maxSteps`                                | `10`                              | Max tool-call steps per turn.                                                                                                                                                                                                                                           |
| `builtinActions`                          | `false`                           | Register built-in catalog/TechDocs read tools.                                                                                                                                                                                                                          |
| `toolResultMaxChars`                      | `30000`                           | Max chars of a single tool result (head+tail truncation; `0` disables).                                                                                                                                                                                                 |
| `requireApproval`                         | `[]`                              | Action ids, MCP tool names, and client tool names (built-ins included) gated by Allow / Deny in the conversation.                                                                                                                                                       |
| `requestBodyLimit`                        | `10mb`                            | JSON body limit for every plugin request, sized for `/chat` attachments.                                                                                                                                                                                                |
| `providers.<id>.type`                     | required                          | `openai` \| `anthropic` \| `azure` \| `openai-compatible`, or a type a backend module added.                                                                                                                                                                            |
| `providers.<id>.apiKey`                   | built-in types                    | Provider key (secret).                                                                                                                                                                                                                                                  |
| `providers.<id>.baseUrl`                  |                                   | Base URL override.                                                                                                                                                                                                                                                      |
| `providers.<id>.options`                  |                                   | Untyped passthrough object spread into the `@ai-sdk/*` factory (e.g. Azure `useDeploymentBasedUrls`). Not schema-validated; keep credentials out of it and use `apiKey`.                                                                                                |
| `providers.<id>.models`                   | required                          | Object list; each `{ name, contextWindow?, reasoning?, maxOutputTokens? }`. A plain string list is rejected at startup.                                                                                                                                                 |
| `providers.<id>.models[].contextWindow`   |                                   | Max input tokens; drives the context gauge.                                                                                                                                                                                                                             |
| `providers.<id>.models[].reasoning`       | `false`                           | `true` if the model reasons; adds the effort picker (see Per-model options).                                                                                                                                                                                            |
| `providers.<id>.models[].maxOutputTokens` |                                   | Output-token ceiling; must be > 0. Only needed when the provider misjudges an unrecognized model id.                                                                                                                                                                    |
| `mcp.connectTimeoutMs`                    | `8000`                            | Global MCP connect/list-tools timeout ceiling in ms; must be > 0.                                                                                                                                                                                                       |
| `mcp.servers.<id>`                        |                                   | External MCP server connections (see Add an MCP server).                                                                                                                                                                                                                |
| `mcp.servers.<id>.transport`              | `http`                            | `http` \| `sse` \| `stdio`.                                                                                                                                                                                                                                             |
| `mcp.servers.<id>.url`                    | http/sse                          | Endpoint URL; required for `http` and `sse`.                                                                                                                                                                                                                            |
| `mcp.servers.<id>.headers`                |                                   | Headers sent on every request (`http`/`sse`); values are secret.                                                                                                                                                                                                        |
| `mcp.servers.<id>.command`                | stdio                             | Executable to spawn; required for `stdio`.                                                                                                                                                                                                                              |
| `mcp.servers.<id>.args`                   |                                   | Arguments for `command` (`stdio`).                                                                                                                                                                                                                                      |
| `mcp.servers.<id>.env`                    |                                   | Extra environment for the child process, merged over a safe default (`stdio`); values are secret.                                                                                                                                                                       |
| `mcp.servers.<id>.cwd`                    |                                   | Working directory for the child process (`stdio`).                                                                                                                                                                                                                      |
| `mcp.servers.<id>.connectTimeoutMs`       | the global                        | Per-server connect/list-tools ceiling; must be > 0.                                                                                                                                                                                                                     |
| `mcp.servers.<id>.requireApproval`        | `[]`                              | Tool names of this server gated by Allow / Deny.                                                                                                                                                                                                                        |
| `mcp.servers.<id>.userCredentials`        |                                   | Connect per user: `{ provider, host?, scopes?, title?, header?, scheme?, env? }` (see Connect an MCP server per user); with `provider: oauth`, `{ scopes?, title?, clientId?, clientSecret?, clientMetadataDocument? }` (see Connect a server that runs its own OAuth). |
| `mcp.elicitationTimeoutMs`                | `300000`                          | How long an MCP server's question waits for the user, in ms; must be > 0.                                                                                                                                                                                               |
| `mcp.servers.<id>.elicitation`            | per user: `true`; shared: `false` | Let the server ask the user for input mid-call (see Let a server ask the user for input).                                                                                                                                                                               |
| `mcp.oauth.encryptionKey`                 | oauth                             | 32 bytes, base64; encrypts stored OAuth tokens. Secret. Required when a server uses `provider: oauth`.                                                                                                                                                                  |
| `mcp.oauth.previousEncryptionKeys`        |                                   | Earlier keys, still read after a rotation. Secret.                                                                                                                                                                                                                      |
| `mcp.servers.<id>.allowStandingApproval`  | `false`                           | Offer Always allow for a per-user server's gated tools.                                                                                                                                                                                                                 |
| `mcp.servers.<id>.argumentRules`          |                                   | `<tool>.<argument>: { pattern?, equals? }`, enforced before approval and before the call.                                                                                                                                                                               |
| `mcp.servers.<id>.approvalPreview`        |                                   | `<tool>: { type: file \| files, fields, base? }`: the approval card's write preview and diff.                                                                                                                                                                           |

## Startup errors

Each of these is an `InputError` raised while reading config; the backend
exits with the message. A missing `assistants` block, `defaultModel`,
`providers.<id>.apiKey`, or `providers.<id>.models` fails earlier with
Backstage's own missing-config error naming the key.

- `Unsupported provider type '<type>' for provider '<id>'`: `type` is not one
  of `openai`, `anthropic`, `azure`, `openai-compatible`, or a type a backend
  module added; the message lists them.
- `assistants config must declare at least one model`: no provider has a
  `models` entry.
- `assistants.defaultModel '<id>' is not one of the configured models`:
  `defaultModel` is not `<providerId>:<model>` for a model in the pool.
- `assistants.mcp.servers.<id>.transport must be one of 'http', 'sse', 'stdio'`.
- `assistants.mcp.servers.<id>: stdio transport requires 'command'`.
- `assistants.mcp.servers.<id>: '<transport>' transport requires 'url'`: an
  `http` or `sse` server without `url`.
- `assistants.mcp.connectTimeoutMs must be a positive number of milliseconds`
  (or the per-server `assistants.mcp.servers.<id>.connectTimeoutMs`).
- `assistants model '<id>': maxOutputTokens must be a positive number of tokens`.
- `assistants.mcp.servers.<id>: headers.<name> is the per-user token; remove the static value`
  (or `env.<name>` for stdio): a static credential where `userCredentials` puts the token.
- `assistants.mcp.servers.<id>.userCredentials: a stdio server takes the token in an environment variable; set 'env'`.
- `assistants.mcp.servers.<id>.userCredentials: provider 'oauth' needs a remote (http or sse) server`,
  `... clientSecret needs clientId`, or `... set clientId or clientMetadataDocument, not both`.
- `assistants.mcp.oauth.encryptionKey is required: ...`, or `... must be 32 bytes, base64` (also
  `assistants.mcp.oauth.previousEncryptionKeys[<n>] must be 32 bytes, base64`).
- `assistants.mcp.elicitationTimeoutMs must be a positive number of milliseconds`.
- `assistants.mcp.servers.<id>.argumentRules.<tool>.<argument>.pattern is not a valid regular expression: ...`,
  `... needs 'pattern' or 'equals'`, or `... .equals must be a string, number, or boolean`.
- `assistants.mcp.servers.<id>.approvalPreview.<tool>.type must be 'file' or 'files'`, or
  `....fields.<field> is required for type '<type>'`.

## HTTP routes

All routes are under `/api/assistants`. `/status`, `/chat`, `/preview`, and the
thread list, create, and status routes also apply the per-assistant access policy;
every conversation route is scoped to the owning user.

| Route                                      | Permission                         | Purpose                                                                                                       |
| ------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET /status`                              | `assistant.use`                    | Accessible assistants (the default first), model pool and defaults, tool lists, the approval floor's names.   |
| `POST /chat`                               | `assistant.use`                    | Run a turn; streams the reply. `tools` carries client tool declarations; `page` the panel's page context.     |
| `GET /chat/resume/:threadId`               | `assistant.use`                    | Rejoin an in-flight reply's stream.                                                                           |
| `POST /chat/cancel/:threadId`              | `assistant.use`                    | Stop an in-flight reply.                                                                                      |
| `GET /threads`                             | `assistant.use`                    | List the caller's conversations; `?assistantId=` filters.                                                     |
| `POST /threads`                            | `assistant.use`                    | Create a conversation.                                                                                        |
| `GET /threads/status`                      | `assistant.use`                    | Working, unread, and token count per conversation.                                                            |
| `GET /threads/:id`                         | `assistant.use`                    | One conversation.                                                                                             |
| `PATCH /threads/:id`                       | `assistant.use`                    | Rename, pin, archive, or change model or reasoning level.                                                     |
| `DELETE /threads/:id`                      | `assistant.use`                    | Delete a conversation and its messages.                                                                       |
| `POST /threads/:id/read`                   | `assistant.use`                    | Mark a conversation read.                                                                                     |
| `GET /threads/:id/messages`                | `assistant.use`                    | A conversation's messages.                                                                                    |
| `POST /preview`                            | `assistant.use`                    | The current content behind a pending write, for the approval card's diff.                                     |
| `POST /elicitations/:id`                   | `assistant.use`                    | Answer an MCP server's question; only the user whose call it interrupts.                                      |
| `POST /held-calls/:id`                     | `assistant.use`                    | Answer a call held inside a provider's own tool loop (an approval, or a client tool's result); only its user. |
| `GET /mcp/oauth/status`                    | `assistant.use`                    | The caller's connection to each server that runs its own OAuth.                                               |
| `POST /mcp/:serverId/oauth/start`          | `assistant.use`                    | Start a sign-in; returns the authorization URL.                                                               |
| `DELETE /mcp/:serverId/oauth`              | `assistant.use`                    | Disconnect: revoke, and delete the stored tokens.                                                             |
| `GET /mcp/oauth/callback`                  | none (`state` and the user cookie) | Where the authorization server returns the user; posts the outcome to the app window.                         |
| `GET /mcp/oauth/client-metadata/:serverId` | none                               | The client metadata document of a server with `clientMetadataDocument`.                                       |
| `GET /capabilities`                        | `assistant.manage`                 | Assignable inventory for the editor.                                                                          |
| `GET /manage/assistants`                   | `assistant.manage`                 | All assistant definitions.                                                                                    |
| `POST /manage/assistants`                  | `assistant.manage`                 | Create an assistant.                                                                                          |
| `PUT /manage/assistants/:id`               | `assistant.manage`                 | Replace an assistant definition.                                                                              |
| `DELETE /manage/assistants/:id`            | `assistant.manage`                 | Delete an assistant (not the default).                                                                        |
| `PUT /manage/assistants/:id/default`       | `assistant.manage`                 | Make an assistant the default; opens it to every signed-in user.                                              |

## Admin API

The editor is backed by `GET /capabilities` and the `/manage/assistants`
endpoints (`GET` and `POST` on the collection, `PUT` and `DELETE` by id, and
`PUT .../:id/default`) under `/api/assistants`, all gated by
`assistant.manage` (403 for callers who lack it). `GET /capabilities` returns
the live, assignable inventory (Backstage actions, the model pool, each MCP
server's reachability and tools, and the approval gate) that feeds the
editor's pickers. `/manage/assistants` reads and mutates the full definitions,
including the prompt, access policy, and audit fields (creator, editor, and
timestamps).

## Frontend exports

The plugin itself is the default export of the `./alpha` subpath, which also
exports `assistantsPanelModule` (see [Panel](frontend.md#panel)). The `./home` subpath
exports `assistantsHomeModule`, the `AssistantComposer` component, and its
`AssistantComposerVariant` type (see [Homepage](frontend.md#homepage)). The package root
exports what a host app needs to integrate with it:

| Export                                                                                                                          | Purpose                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `rootRouteRef`                                                                                                                  | Route ref for the `/assistants` page.                                                                                   |
| `threadRouteRef`                                                                                                                | Sub-route ref for one conversation, `/assistants/threads/:threadId`.                                                    |
| `assistantsApiRef`                                                                                                              | API ref for the backend client (`AssistantsApi`): assistant list, threads, status.                                      |
| `AssistantsNavIcon`                                                                                                             | Nav icon with a live working/unread dot; the nav entry's icon, for a sidebar item you build yourself.                   |
| `AssistantsApi`, `ConversationStatusRow`, `ThreadPatch` (types)                                                                 | The client interface and its row/patch shapes.                                                                          |
| `AssistantClientToolBlueprint`, `clientToolDataRef`                                                                             | Contribute a client tool (see [Client tools](client-tools.md)).                                                         |
| `clientToolsApiRef`, `ClientToolsApi` (type)                                                                                    | The registry of contributed client tools, read by every surface that runs a conversation.                               |
| `usePanelControl`, `PanelControl`, `PanelOpenOptions` (types)                                                                   | Open the panel from a page component, on a conversation or with a first message; undefined in an app without the panel. |
| `AssistantClientTool`, `ClientToolAuthRequirement`, `ClientToolContext`, `ClientToolRenderProps`, `ClientToolInterrupt` (types) | The client tool contract; `ClientToolInterrupt` is the approval or connect prompt a custom `render` receives.           |
