# Run in production

## Replicas

The plugin runs on several backend replicas with no session affinity. Running
turns and their streams are recorded in the database, so the working
indicator, the Stop button, and reopening a conversation mid-reply behave the
same on every replica. A reopened conversation replays the reply so far,
including reasoning and tool calls, and follows it about half a second behind
live. Stream rows are deleted 60 seconds after a turn completes.

Assistant definitions are cached per replica: updated immediately on the
replica that edited them and within 60 seconds on the others. The MCP
connection pool is per process, with its own maintenance task on each replica.

Signals reach only clients connected to the replica that emitted them unless
your events service is configured for cross-instance delivery; see the
Backstage signals documentation. While a turn runs the browser also polls its
status every 5 seconds, so indicators clear without that delivery.

## Upgrading and backups

Migrations are forward-only and run at startup. Upgrade the backend before or
with the database; a backend older than the database's newest migration fails
at startup with knex's "migration directory is corrupt". Back up the durable
tables together before upgrading: `assistants`, `assistants_meta`, `threads`,
`messages`, and, with MCP servers, `mcp_tool_cache`, `mcp_oauth_tokens`, and
`mcp_oauth_clients`. `stream_chunks`, `mcp_oauth_state`, and
`mcp_elicitations` hold only in-flight state and need no backup.

## Logs

- Healthy start: `AI Assistants backend plugin initialized`, with `models`,
  `defaultModel`, `builtinActions`, and `assistants` counts. Before it, on an
  upgrade from a version without the designation, `default assistant
designated: the oldest assistant open to every signed-in user`, or the
  warning `no default assistant` when none is open to everyone; designate one
  in the editor.
- At info, per designation: `default assistant designated` with the id and
  the acting admin.
- Per turn, at info: `chat turn started`, then `chat turn finished` or
  `chat turn aborted (stop)`; a failure logs `chat turn errored` at error with
  the provider's message and, for a provider error, the response body.
- Warnings to expect: `Assistant action '<name>' is not available; skipping`
  (an `allowedTools` entry the actions service does not expose),
  `MCP server '<id>' tool listing failed: ...` (the last-known tool list stays
  in place), `requireApproval lists tool(s) not available to assistant '<id>':
...` (a gated tool the assistant has that did not resolve this turn),
  `MCP server '<id>' not connected; '<tool>' skipped this turn`,
  `client tool '<name>' dropped: <reason>` (a browser declaration the backend
  will not offer: not in the allowlist, a bad name, a server-tool collision,
  or over a size limit), and `auto-title failed` (the conversation keeps its
  current title).
- At info, per turn with a gate: `Approval gate active for assistant '<id>'`.
- At info, per approval decision on any gated tool (a Backstage action logs
  `server: backstage`), per gated MCP call's outcome, and per argument-rule
  rejection:
  `assistants.tool.audit` with `user`, `assistantId`, `threadId`, `server`,
  `tool`, `decision`, and `target`.
- `MCP server '<id>' asked for input: refused (<reason>)` when a question
  can't be shown (no call to tie it to, a URL request, a browser without
  forms, or more than 3 in one call) and the server gets an error back.
- `MCP server '<id>' does not list tool(s) named in its config: ...` (any
  server: a `requireApproval`, `argumentRules`, or `approvalPreview` key, or a
  preview's `base.tool`, that matches no tool; a typo there leaves a write
  unguarded).
- Servers that run their own OAuth: `MCP server '<id>' connected` and
  `... disconnected` (with `user`), `MCP server '<id>' sign-in failed for <user>: ...`,
  `MCP server '<id>' token refresh failed for <user>: ...`, and
  `MCP server '<id>' sign-in expired; the user must connect again`. No token,
  code, or verifier is logged.
- Per-user servers: `MCP server '<id>' connect failed for <user>: ...` (the
  user's token was rejected or the server is down; the model is told), and
  at startup
  `MCP server '<id>' is per-user over stdio`.
- A provider failure reaches the conversation as `The assistant couldn't finish
this turn: <reason>` and logs `chat stream error surfaced to client`.

## Troubleshooting

| Symptom                                                                                                            | Cause                                                                                                   | Fix                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| An assistant shows no tools; the log says `Assistant action '<name>' is not available; skipping`                   | `assistants` is missing from `backend.actions.pluginSources`, or `builtinActions` is `false`            | Add the source; set `builtinActions: true` for the built-in read tools                                        |
| Backend exits with `assistants.defaultModel '<id>' is not one of the configured models`                            | `defaultModel` does not name a configured `<providerId>:<model>`                                        | Fix `defaultModel`                                                                                            |
| Provider 401 or 403 under `chat turn errored`                                                                      | Wrong key, `baseUrl`, or Azure `apiVersion`; or the env var is not reaching the backend                 | Check the key and URL; confirm the variable is set in the backend's environment                               |
| A turn ends with tool calls and no reply on an Anthropic-type provider with a custom deployment name               | The SDK falls back to a 4096 output-token ceiling for an id it does not recognise                       | Set `maxOutputTokens` on the model                                                                            |
| An MCP server is never reachable; the log shows `MCP server '<id>' tool listing failed: ... timed out after <n>ms` | The server takes longer than `connectTimeoutMs` to start                                                | Raise `connectTimeoutMs` (uvx/npx servers often need 15000 to 20000)                                          |
| "You are not permitted to use assistants"                                                                          | The permission policy denies `assistant.use`                                                            | Grant `assistant.use`; see [Grant assistant.use and assistant.manage](permissions.md)                         |
| The gear is missing from the sidebar                                                                               | The permission policy denies `assistant.manage`                                                         | Grant `assistant.manage`                                                                                      |
| "Connect GitHub" stays after signing in, or the sign-in popup fails                                                | The app has no `github` auth provider, or no `integrations` entry for the server's `host`               | Configure the auth provider and the integration; the provider id in `userCredentials` must match              |
| An OAuth sign-in popup shows the server's error about the redirect                                                 | The authorization server does not allow the backend's callback URL                                      | Allow `<backend>/api/assistants/mcp/oauth/callback` at the server, or have an admin issue a `clientId` for it |
| The popup says "started by a different Backstage user, or your Backstage session could not be confirmed"           | The browser sent no Backstage cookie to the callback (blocked third-party cookies, or a different host) | Serve the backend on the app's site, or allow its cookies; the cookie is issued on the backend's own domain   |
