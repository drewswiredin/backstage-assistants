# Security

Prompts and access policies never reach the chat surface; only the
`assistant.manage` routes return them.
`providers.*.apiKey` and every value under `mcp.servers.*.env` and
`mcp.servers.*.headers` are secret: redacted in logs, API responses, and the
DevTools config view. The browser receives only a projection over
`GET /status`: titles, descriptions, the model pool and defaults, the resolved
tool list (name and description), the approval floor's tool names, and `ui`.

What leaves the cluster: per turn the backend sends the configured model
provider the platform instructions and the assistant's system prompt, the full conversation history
(including attachments as base64 and prior tool results), and the results of
tools called in that turn: catalog entities, TechDocs pages, MCP results.
Auto-title makes one extra model call on a conversation's first turn. The
caller's identity (user entity ref, groups, credentials) is not sent to the
provider. MCP servers receive only the tool arguments the model produces
and the user's answers to their own questions (elicitation), under the server's configured static credential or, for a per-user server, the
user's own token. A server that runs its own OAuth also gets, through its
authorization server, the sign-in requests, code exchanges, and refreshes.

What is stored: the tables in the plugin database: `assistants`
(`definition_json`, including the prompt and access policy), `assistants_meta`
(the seed-once marker), `threads`, `messages`, `stream_chunks`, which
holds a running reply's stream for 60 seconds after the turn completes, and
`mcp_tool_cache`, each per-user MCP server's tool list. A per-user MCP token
from a Backstage sign-in is never stored: it travels in the
`x-assistants-credentials` request header and lives only in that user's open
connection. For a server that runs its own OAuth the backend does store
tokens: `mcp_oauth_tokens` holds each connected user's access and refresh
token, AES-256-GCM encrypted with `mcp.oauth.encryptionKey`, until they
disconnect or the server refuses a refresh; `mcp_oauth_clients` the client the
backend registered (its secret encrypted); and `mcp_oauth_state` a sign-in in
progress (its PKCE verifier encrypted), deleted when the callback consumes it
or after ten minutes. `mcp_elicitations` holds an MCP server's open question; the
user's answer is in it only until the replica running the call picks it up,
after which the row keeps just the action until it expires. Every message (user text,
attachments, assistant output, and tool results truncated at
`toolResultMaxChars`, default 30000) persists in `messages.content_json` until
the user deletes the conversation, which is a hard delete; nothing is retained
after that. Deleting an assistant leaves its users' conversations in `threads`
and `messages`; they no longer appear in the UI. Provider API keys and MCP secrets live only in config.

Untrusted content and prompt injection: everything a tool returns (TechDocs
pages, catalog entity fields, MCP results, client tool results) is untrusted input to the model,
and a page an assistant reads can carry instructions the model may follow. The
approval gate (`requireApproval` and `mcp.servers.<id>.requireApproval`) is
the enforced checkpoint: a listed tool never runs without an explicit Allow in
the conversation, whatever the model was told. The gate defaults to empty, so
list every write-capable action (`register-entity`, `unregister-entity`,
`execute-template`, and any MCP tool that mutates) there. Backstage permissions
still apply to each approved Backstage action, since it runs as the calling
user. An approved MCP tool runs with its server's configured credential, so
Backstage permissions do not limit it; on a per-user server it runs with the
user's own token, so the remote system limits it to what the user may do, and
`argumentRules` hold whatever the model was told. A client tool runs in the user's browser
with the user's own credential for that system, so it can do only what the
user can; one that writes always asks first.

The browser declares client tools on each `/chat` request and the backend
offers the built-in client tools plus only the contributed ones in the
assistant's allowlist, so a user cannot attach
tools an admin did not assign. A forged declaration could only make the model
call code in that user's own browser with that user's own credentials.
