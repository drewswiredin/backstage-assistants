# Changelog

All notable changes to `@drewswiredin/backstage-plugin-assistants-common`. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.15.1 - 2026-10-22

### Added

- `describe_portal` joins the built-in client tool names, so the backend always offers it, and the platform instructions say when to call it.

## 0.15.0 - 2026-10-22

### Added

- `PageContext`: the page a surface beside the page sends with a turn (`path`, `title`, `entityRef`). `read_current_page` joins the built-in client tool names, and the platform instructions tell the model when to call it.

## 0.14.0 - 2026-10-22

### Added

- `StatusResponse.defaultAssistant`, and `isDefault` on `AssistantSummary` and `AssistantDefinition`: the default assistant, the one every signed-in user gets.

### Changed

- Backstage dependency ranges track the 1.56 release line.

## 0.13.0 - 2026-10-20

### Added

- The client tool contract: `ClientToolAttributes`, `ClientToolDeclaration`, `ClientToolError`, `ClientToolErrorCode`, `CLIENT_TOOL_NAME_PATTERN`, `BUILTIN_CLIENT_TOOLS`, `CLIENT_TOOL_LIMITS`, and `isClientToolName`.
- `StatusResponse.requireApproval`: the global approval floor as tool names.
- `ToolSummary.source` is `client` for a tool that runs in the user's browser.

### Changed

- `PLATFORM_INSTRUCTIONS` tell the model that a tool result with `_error: true` is a failure to explain, not retry, and what each `code` means.

## 0.12.0 - 2026-10-14

### Added

- `PLATFORM_INSTRUCTIONS`: the text the backend sends before every assistant's prompt.

## 0.11.0 - 2026-10-08

### Changed

- `TitleRequest` and `TitleResponse` are removed with the `POST /title` route.
- Backstage dependency ranges track the 1.54 release line.
- `engines.node` is `>=22.12`.

## 0.10.0 - 2026-09-03

### Changed

- Released alongside backend 0.16.0, which registers `assistantUsePermission`
  and `assistantManagePermission` with the permissions registry.
