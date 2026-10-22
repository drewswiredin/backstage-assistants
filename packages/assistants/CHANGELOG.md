# Changelog

All notable changes to `@drewswiredin/backstage-plugin-assistants`. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- `describe_portal`, a built-in client tool: what this Backstage instance offers (its plugins, its pages with their paths, the tabs on a catalog entity's page, and the client tools the browser can run), read from the app tree every new-frontend-system app builds, with or without the visualizer plugin. "What's in Backstage" and "where do I find X" get an answer with links. Disable it app-wide with `client-tool:assistants/describe-portal: false`. Requires common 0.15.1.

### Changed

- README: the homepage composer section says to add `@backstage/plugin-home-react` to the app (an optional peer dependency, which no package manager installs on its own), and the whole README is brought up to date with the panel, page context, and the homepage composer.

## 0.19.0 - 2026-10-22

### Added

- The homepage composer: `assistantsHomeModule` from the `./home` entry point adds `home-page-widget:assistants/AssistantComposer` to a `@backstage/plugin-home` home page, the panel's surface with the conversation hidden. `variant` sets its look: `bar` (one row, like a search bar), `padded` (default; the assistant picker and the full composer inside the card's padding), `full` (edge to edge), or `titled` (under a card header, `title` sets the text), and `width` sets the composer's width as a percentage of the card (100 for `bar`, 80 otherwise, by default). The first send creates the conversation and hands it to the panel, which continues it; without the panel it opens on the page. The `AssistantComposer` component is exported for an app's own card or page. `@backstage/plugin-home-react` is an optional peer dependency used only by that entry point.
- `usePanelControl`: a page component opens the panel, on a conversation or with a first message, through the context the panel wrapper provides.
- The panel's history button lists the assistant's earlier conversations; picking one continues it in the panel.

### Changed

- The composer's hint, when an assistant sets no placeholder of its own, is "Ask about your services, docs, or anything in Backstage…" instead of "Write a message...", on the page, the panel, and the homepage composer.
- The model and reasoning effort pickers moved from the page's thread header into the composer, and the panel's composer has them too. `ConversationSurface` gained a `composerControls` slot.

## 0.18.0 - 2026-10-22

### Added

- `read_current_page`, a built-in client tool: the rendered page as an outline (open dialogs first, then the content; headings, text, buttons, links, tabs, form fields, tables, alerts, and the first lines of long logs, with `find` for the lines around a term), so the assistant can answer "what does this mean" on any page. Disable it app-wide with `client-tool:assistants/read-current-page: false`.
- The panel sends the page it sits beside with every turn (path, title, catalog entity ref), so the assistant knows where the user is before it reads anything. Requires backend 0.20.0 for the note; an older backend ignores the field.

### Fixed

- A reply that lands while the panel is hidden or collapsed now shows the unread dot on the button or the strip. The hidden surface kept marking its conversation read; only an open panel focuses it now.

## 0.17.0 - 2026-10-22

### Added

- The panel: a floating button in the lower right of every page opens a side panel with one quick conversation, using the assistant's own suggestions and defaults; the page content makes room for it. "Open in Assistants" moves the conversation to the full page. It is `assistantsPanelModule`, a module for the `app` plugin that the app adds to its features. It opens the default assistant; a user with access to more than one picks another from the menu on the assistant's name, and the pick is remembered per browser. Hide (the chevron, `Esc`, or a click on the page) collapses it to a strip at the right edge; Close (the x) brings the button back; either way the conversation is kept. `Ctrl+/` toggles it, the left edge resizes it, and the last conversation is remembered per browser. Contributed client tools, approvals, forms, and attachments work in the panel as on the page.
- `threadRouteRef`: `/assistants/threads/:threadId` opens one conversation on the page. A conversation the caller cannot see lands on the normal page with a notice.
- `clientToolsApiRef`: the registry of contributed client tools, read by every surface that runs a conversation.
- The editor's "Make default" designates the default assistant, shown with a Default chip. The default assistant's "Any signed-in user" access is locked on, and it cannot be deleted until another is made the default. Requires backend 0.19.0.

### Changed

- `AssistantClientToolBlueprint` extensions attach to `api:assistants/client-tools` instead of the page, so the page and the panel share one registration. Contributors are unaffected; a tool is still one `make` call.

## 0.16.1 - 2026-10-21

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
