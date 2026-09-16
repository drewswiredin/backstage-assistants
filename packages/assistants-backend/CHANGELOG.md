# Changelog

All notable changes to `@drewswiredin/backstage-plugin-assistants-backend`.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

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
- `@drewswiredin/backstage-plugin-assistants-common` is a caret range.

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
