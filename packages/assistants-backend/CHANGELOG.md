# Changelog

All notable changes to `@drewswiredin/backstage-plugin-assistants-backend`.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
