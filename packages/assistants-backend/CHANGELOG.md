# Changelog

All notable changes to `@drewswiredin/backstage-plugin-assistants-backend`.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.22.0 - 2026-10-23

### Added

- MCP servers that run their own OAuth: `userCredentials.provider: oauth` signs each user in to the server's own authorization server (the MCP authorization spec) through `@ai-sdk/mcp`'s `auth()`: discovery, dynamic client registration (or a configured `clientId`, or `clientMetadataDocument: true`), PKCE, `resource`, the code exchange, and refresh. The backend stores each user's tokens AES-256-GCM encrypted with the new required `mcp.oauth.encryptionKey` (rotate with `previousEncryptionKeys`), refreshes them during the user's turns (before expiry, and once after a 401, one refresh at a time per user and server), and never sends them to the browser. New routes `GET /mcp/oauth/status`, `POST /mcp/:serverId/oauth/start`, `GET /mcp/oauth/callback` (bound to the starting user by `state` and Backstage's user cookie), `DELETE /mcp/:serverId/oauth` (revokes and deletes), and `GET /mcp/oauth/client-metadata/:serverId`. New tables `mcp_oauth_tokens`, `mcp_oauth_clients`, `mcp_oauth_state`.
- MCP elicitation: a server may stop mid-call to ask the user for input (`elicitation/create`, form mode). Its clients declare the capability; the question streams to the browser on the tool call as a preliminary tool output and never reaches the model; the answer arrives at `POST /elicitations/:id` (only from the user whose call it interrupts, validated against the server's form) and goes back to the server. Questions are stored in the new `mcp_elicitations` table so the answer can reach any replica. On by default for per-user servers; `mcp.servers.<id>.elicitation` overrides, and `mcp.elicitationTimeoutMs` (default 5 minutes) bounds the wait. Cancelled when it can't be tied to one call, on timeout, on Stop, after three per call, or while another is open in the conversation; URL mode and unsupported forms are declined. The call's 60-second ceiling doesn't count time the user spends answering. Each call's last outcome is saved on the reply as `metadata.elicitations`. Audited with field names only.

### Changed

- README: `argumentRules` are optional, and the example no longer restricts branch names.

## 0.21.0 - 2026-10-22

### Added

- Per-user MCP servers: `mcp.servers.<id>.userCredentials` connects a server with each signed-in user's own token instead of a shared credential, so the remote system limits every call to the user's access and attributes writes to them. The browser sends the token in the `x-assistants-credentials` header on each request; it is never stored, logged, or put in a message. Each user gets their own pooled connection, reused while the token is unchanged, closed after 10 minutes idle, at most 200 per replica. Without a token the server offers no tools and the model is told to ask the user to connect; a rejected token reaches the model with the server's message. The tool list is kept in the new `mcp_tool_cache` table for `/status` and the editor, which lists the server as the admin when they are signed in.
- `mcp.servers.<id>.argumentRules`: `pattern` or `equals` checks on tool arguments, enforced before the approval prompt (a breaking call is denied at once with the reason) and again before the call. A missing argument fails.
- `mcp.servers.<id>.approvalPreview` and `POST /preview`: the approval card shows a write as its target, commit message, and a diff against the current content, read with the configured read tool as the same user.
- An `assistants.tool.audit` log line for every gated MCP call (approved, denied, executed, failed) and every rule rejection, with the call's identifying arguments only.
- A per-user server's gated tools are approved call by call; `allowStandingApproval: true` offers Always allow.

## 0.20.2 - 2026-10-22

### Fixed

- A failed action call tells the model why. The actions service's error message is only the HTTP status ("Request failed with 400 Bad Request"); the tool result now appends the reason from the response body (the input validation issue, or the action's own message, never its stack) and carries `status`, so the model can correct its input and retry.

### Changed

- README and the general assistant prompt example: `search-knowledge` finds anything Backstage search indexes, and the prompt tells the model when to pass `types`.

## 0.20.1 - 2026-10-22

### Changed

- `describe_portal` is always offered: it is among the built-in client tools in common 0.15.1, which this release requires.
- README: the built-in client tools section covers `read_current_page`, `describe_portal`, and the per-turn page note.

## 0.20.0 - 2026-10-22

### Added

- `POST /chat` accepts `page`, the panel's page context. The turn's instructions end with a note naming the page and its catalog entity and pointing at `read_current_page`; the note is never persisted. `read_current_page` is a built-in client tool, always offered when the browser declares it.

## 0.19.0 - 2026-10-22

### Added

- The default assistant: exactly one assistant is the one every signed-in user gets. `PUT /manage/assistants/:id/default` designates it and opens its access to any signed-in user in the same transaction; it cannot be deleted or restricted (`allowAuthenticated: false`) until another is designated. The seeded assistant is the default from first start; an upgraded deployment designates its oldest assistant already open to every signed-in user, or none, with a warning, until an admin designates one. `/status` carries `defaultAssistant` and lists it first with `isDefault: true`; `GET /manage/assistants` carries `defaultAssistant` and `isDefault` on each definition. The designation lives in `assistants_meta`; no migration.

## 0.18.1 - 2026-10-21

### Changed

- `@backstage/backend-defaults` is no longer a dependency: thrown errors reach the root HTTP router's error middleware, which the host app provides. A consumer app no longer carries a second copy of `backend-defaults` for this plugin.
- Backstage dependency ranges track the 1.56 release line.

## 0.18.0 - 2026-10-20

### Added

- `POST /chat` accepts `tools`: the client tools the browser registers, each a description, a JSON Schema, and `attributes`. A declared tool is offered to the model without `execute` when it is a built-in or named in the assistant's `allowedTools`, its name is `<namespace>__<tool>`, it collides with no server tool, and it is within the limits (30 per request, 4000-character description, 8192-character schema). Everything else is dropped and logged. Client tool results are capped to the same budget as server tool results.
- `GET /status` returns `requireApproval`, the global approval floor, so the browser can gate a client tool named there.
- `allowedTools` accepts `<namespace>__<tool>` client tool names; the editor validates them in the browser, and `/status` lists them with `source: "client"`.
- The log line for a provider error carries the provider's response body.

### Changed

- `render_form` and `download_file` are declared by the frontend like any other client tool; the backend no longer defines them. Requires frontend 0.16.0.

## 0.17.7 - 2026-10-15

### Changed

- The `search-catalog` and `search-techdocs` descriptions state the search order: `search-knowledge` first when available, then keyword search (Backstage's `query` action when available, otherwise these tools), with nothing reported missing until both come back empty. They name their own filters as the reason to call them directly. `read-techdocs` accepts the location from any search result.

## 0.17.6 - 2026-10-15

### Fixed

- The working indicator and Stop hold across backend replicas. A running turn is recorded on its thread with a heartbeat every 5 seconds, so every replica reports it, and a Stop received by one replica reaches the one running the turn. A turn whose replica stops heartbeating stops showing as working within 30 seconds. Adds the `turn_heartbeat_at` and `turn_cancel_requested` columns to `threads`.
- Reopening a conversation mid-reply rejoins the live stream on any backend replica. The stream is buffered in the new `stream_chunks` table in 250 ms batches, replayed from the start and followed until the turn ends, and deleted 60 seconds after. Session affinity is no longer needed.

## 0.17.5 - 2026-10-14

### Added

- Every turn sends platform instructions before the assistant's prompt: what the chat renders, formatting and a monotone symbol set, Mermaid syntax that parses, and when to use `render_form` and `download_file`. The assistant's prompt takes precedence where they differ.

### Changed

- The example prompts drop the rendering and formatting rules the platform instructions now cover; `general-assistant.md` searches with `search-knowledge` first.

## 0.17.4 - 2026-10-14

### Changed

- `search-catalog` and `search-techdocs` point questions in the user's own words to `search-knowledge` when it is available.
- `read-techdocs` takes its `location` from `search-knowledge` or `search-techdocs` results.

## 0.17.3 - 2026-10-14

### Fixed

- A per-server `requireApproval` entry matches its tool when the server id contains a character outside `[a-zA-Z0-9_-]`, such as `:`. Those tools ran without approval.

### Changed

- The OpenAPI `AssistantSummary` includes `color` and `tools`, which `/status` returns.
- The README and config schema descriptions match the code: access-policy scope, the Azure provider example, and the routes table.

## 0.17.2 - 2026-10-12

### Changed

- `search-catalog` and `search-techdocs` describe what they match well (exact names and terms) and what they miss (misspellings, different wording), so a model can choose between them and other search tools.
- `search-catalog` and `search-techdocs` tell the model to query with two or three distinctive words and to retry with fewer or different words when nothing comes back.

## 0.17.1 - 2026-10-09

### Changed

- `search-techdocs` describes what it returns, how to page, and that its locations feed `read-techdocs`.
- `read-techdocs` names `search-techdocs` as the source of its `location`.

## 0.17.0 - 2026-10-08

### Changed

- Anthropic tool-argument normalisation applies to providers of `type: anthropic`, whatever their configured id.
- `POST /title` is removed; conversations are titled automatically on their first turn.
- The `x-resumable-stream-id` response header is gone; resume is keyed by thread id.
- Backstage dependency ranges track the 1.54 release line.
- Timestamps are written as ISO-8601 strings on Postgres.
- The MCP maintenance task is registered with local scope, one per process.
- `PATCH /threads/:id` validates its body.
- `read-techdocs` validates the requested path.
- JSON columns are `longtext` on MySQL.
- `engines.node` is `>=22.12`.
- `@drewswiredin/backstage-plugin-assistants-common` `^0.11.0`.

### Fixed

- `/chat` checks that the thread belongs to the calling user.

### Removed

- The `module` field in `package.json`.

## 0.16.1 - 2026-09-03

### Changed

- `ai` `^7.0.85` and `@ai-sdk/mcp` `^2.0.41`, matching the frontend's AI SDK
  family.

## 0.16.0 - 2026-09-03

### Added

- `assistant.use` and `assistant.manage` are registered with
  `coreServices.permissionsRegistry`, so they appear on
  `/.well-known/backstage/permissions/metadata` and in permission UIs.

### Fixed

- Every value under `mcp.servers.*.env` and `mcp.servers.*.headers` is
  `@visibility secret`.

## 0.15.0 - 2026-07-28

### Changed

- AI SDK 7 (`ai` `^7`), provider packages 4.x, and `@ai-sdk/mcp` for the MCP
  client. Requires Node 22.12 or later.
