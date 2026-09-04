# Changelog

All notable changes to `@drewswiredin/backstage-plugin-assistants`. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Changed

- Backstage dependency ranges track the 1.54 release line.
- `@backstage/plugin-signals` is optional: status updates use signals when the
  app has them and poll otherwise.
- `engines.node` is `>=22.12`.
- Peer ranges are React 18 (`react`, `react-dom` `^18`) and `react-router-dom`
  `^6.30.2`.
- `mermaid` `^11.16.1`; `@remixicon/react` `~4.8.0`.
- `THIRD_PARTY_NOTICES.md` ships in the package.

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
