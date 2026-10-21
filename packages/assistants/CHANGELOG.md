# Changelog

All notable changes to `@drewswiredin/backstage-plugin-assistants`. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Changed

- The editor and the details dialog group contributed tools as "Backstage client tools" next to "Backstage actions": both run as the user, unlike the MCP server groups that follow.
- Backstage dependency ranges track the 1.56 release line. `@backstage/plugin-signals-react` is `^0.0.27`, so a 1.56 app installs one copy.

## 0.16.0 - 2026-10-20

### Added

- `AssistantClientToolBlueprint`: a plugin or module registers a tool that runs in the browser as the signed-in user. A tool declares `attributes` (`readOnly`, `destructive`, `idempotent`), and may declare `auth` (`oauth` through a Backstage OAuth API ref, or a `custom` acquirer), `render`, `isAvailable`, and `timeoutMs`. A tool that is not read-only, is destructive, or is named in the global `requireApproval` asks for approval before every call; a tool that needs a credential shows a Connect control first. Credentials never leave the browser. Only tools in the assistant's allowlist are offered.
- The assistant editor lists registered client tools under "Browser tools" and marks those that ask for approval; the details dialog groups them under "Browser".

### Changed

- `render_form` and `download_file` are client tools registered through the blueprint, with their descriptions and schemas in this package. Requires backend 0.18.0.

## 0.15.4 - 2026-10-15

### Fixed

- Working indicators clear when a turn finishes on another replica, even if its signal never arrives: while any turn runs, status is re-checked every 5 seconds.

## 0.15.3 - 2026-10-14

### Added

- The assistant editor shows the platform instructions read-only under the system prompt.

## 0.15.2 - 2026-10-14

### Changed

- The README documents the chat panel (pin, rename, details, copy, regenerate, context gauge), `?assistant=` links, Always allow, and Signals wiring.

## 0.15.1 - 2026-10-08

### Fixed

- An inline form mounts once its tool-call arguments finish streaming. A
  scaffolder picker reads `ui:options` once, on mount, so an `EntityPicker`
  mounted mid-stream listed every entity instead of its `catalogFilter`
  until the page was reloaded.

## 0.15.0 - 2026-10-08

### Changed

- Backstage dependency ranges track the 1.54 release line.
- `@backstage/plugin-signals` is optional: status updates use signals when the
  app has them and poll otherwise.
- `engines.node` is `>=22.12`.
- Peer ranges are React 18 (`react`, `react-dom` `^18`) and `react-router-dom`
  `^6.30.2`.
- `mermaid` `^11.16.1`; `@remixicon/react` `~4.8.0`.
- `THIRD_PARTY_NOTICES.md` ships in the package.
- `@drewswiredin/backstage-plugin-assistants-common` `^0.11.0`.

### Removed

- `@backstage/ui` dependency.

## 0.14.2 - 2026-09-03

### Fixed

- The `@assistant-ui/*` family, `assistant-cloud`, and the AI SDK (`ai`,
  `@ai-sdk/react`) are declared as caret ranges matching upstream, so a
  consumer resolves one copy of each and can bundle the plugin. The
  `@assistant-ui/core` patch is gone.

## 0.14.1 - 2026-09-03

### Fixed

- `@assistant-ui/core` is declared as a plain version range rather than a
  `patch:` spec, so the package installs outside this repo.

## 0.14.0 - 2026-09-03

### Changed

- Requires backend 0.16.0, which registers `assistant.use` and
  `assistant.manage` with the permissions registry.
