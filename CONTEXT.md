# backstage-assistants

A Backstage plugin that adds an in-portal AI chat experience. It stitches assistant-ui (chat UI) and the Vercel AI SDK (model + tool loop) into Backstage, exposing Backstage actions (run with the calling user's own credentials) and configured MCP server tools (run under each server's credential) as the model's tools.

## Language

**Assistant**:
A configured persona — its system prompt, access policy, tool allowlist, allowed models, and UI options. The single user-facing and canonical domain concept; what a user picks in the rail and chats with.
_Avoid_: Agent, Bot, Persona

**Profile**:
Not a config concept. Assistant definitions live in the plugin DB (the `assistants` table) and are edited in the in-app admin editor — not config. There is no `profiles` config key.
_Avoid_: using "profile" to mean a distinct domain object, or a `profiles` config block

**Agent**:
Not a domain concept. Deliberately excluded to avoid ambiguity with Assistant.
_Avoid_: introducing "agent" anywhere in config, code, or UI

**Action**:
An entry in the Backstage Actions registry (a schema + handler), registered in-process via `actionsRegistryServiceRef`. The tool primitive. Not auto-populated by core Backstage — actions exist only when a plugin registers them (this plugin's core actions, or others). Consumed in-process via `actions.list`/`actions.invoke`; never over MCP for `/chat`.
_Avoid_: Tool (at the config/registry layer — see Tool)

**Tool**:
An AI SDK `tool()` handed to the model loop. Produced by adapting an Action that is in both the Assistant's allowlist and the caller's visible set, an MCP tool, or a Client tool's declaration. "Tool" is the model-facing word; "Action" is the Backstage-registry word for the same underlying capability.

**Client tool**:
A tool that runs in the user's browser, with the user's own browser credentials, contributed by any frontend plugin or module through `AssistantClientToolBlueprint`. Named `<namespace>__<tool>` (e.g. `kubernetes__get_workload_status`), with `attributes` (`readOnly`, `destructive`) that mirror the actions registry. The browser sends its declaration (description, JSON Schema, attributes) on every `/chat`; the backend offers it to the model with no `execute`, so the loop yields to the browser, which runs the tool and sends the result back. A client tool with `execute` runs code; one without is answered by its `render` (`render_form`). The runtime owns approval, credential acquisition and the Connect control, the time budget, and result shaping; the tool supplies only its declaration, `auth`, and `execute`. Never exposed over MCP. `render_form`, `download_file`, and `read_current_page` are the plugin's own client tools.
_Avoid_: frontend tool (assistant-ui's word for the same thing), browser action

**Allowlist**:
The Assistant's unified `allowedTools: string[]` — the set of tools it is permitted to offer. Each entry is a bare Backstage action id, a namespaced `<serverId>__<tool>` MCP tool, or a `<namespace>__<tool>` Client tool; explicit only, no wildcard. **Empty = no Backstage, MCP, or contributed client tools** (careful-by-default; never an implicit "all"); the built-in client tools `render_form`, `download_file`, and `read_current_page` are always present. One of the two independent gates.

**Effective tools**:
What the model actually receives for a request, resolved per turn from the Assistant's `allowedTools`. Backstage action entries are intersected with the actions the caller can see (the two gates); MCP-tool entries are added directly — they run as a configured shared credential (not the calling user), so there is no per-user gate on that path; Client tool entries are added when the browser declares them this request, and run as the user in the user's browser.

**Two gates**:
The two independent authorization checks (Backstage action tools). (1) The Assistant **Allowlist** — the `allowedTools` entries that name Backstage actions. (2) **User authorization** — what this user may do, enforced by Backstage: coarse (per-action `visibilityPermission`) for free at `actions.list({ credentials })`, fine-grained (per-resource/ownership) for free at `actions.invoke` because every Backstage action runs as the user. MCP tools in `allowedTools` bypass this user gate — they run as the configured shared server credential, not the caller.

**Approval gate**:
A GLOBAL config floor of tool ids that must be confirmed — Allow, Always allow, or Deny in chat — before they run: the top-level `assistants.requireApproval` (action ids, MCP and client tool names) ∪ each per-server `mcp.servers.*.requireApproval` (tool names). The per-turn approval set = this floor ∩ the Assistant's `allowedTools`. For server tools it feeds the AI SDK's `toolApproval` map so execution is paused **deterministically in the loop**; for Client tools the browser runtime pauses before `execute` with assistant-ui's `human` interrupt, and a Client tool that is not read-only or is destructive is gated whether or not it is in the floor. A human checkpoint enforced in code, not a model prompt. Not per-Assistant; config-only, so runtime assistant-editing can never weaken it. "Approval floor" names the same config list. Always allow grants a server tool for the rest of the conversation; the grant lives in the persisted message history. Client tools have no Always allow: every gated call asks. Orthogonal to the two gates and to authorization: it withholds execution pending consent; it never grants access. Backstage's per-user permissions still apply when an approved tool invokes.
_Avoid_: treating it as authorization (it is a checkpoint, not a permission), or as a per-Assistant setting

**Interactive form** (`render_form`):
A built-in Client tool the model calls to render an RJSF form inline in chat for human-in-the-loop input, instead of asking several questions in prose. No `execute`: the model composes the form (JSON Schema + uiSchema), the card renders it through scaffolder's RJSF `<Form>` plus the host app's field-extension registry — so owner/entity/repo pickers and any custom scaffolder field render by name — and the user's submit becomes the tool result. Always available; not config-gated. One of the two in-plugin generative-UI tools, with `download_file`.
_Avoid_: a bespoke form widget — it reuses scaffolder's fields

**Download file** (`download_file`):
A built-in Client tool the model calls to hand back a generated text file (CSV, JSON, Markdown, code, SVG). The card renders a download chip, with Copy for text and a fullscreen preview for SVG; its `execute` acknowledges the delivery and the turn resumes with that result. Always available; not config-gated.

**Read current page** (`read_current_page`):
A built-in Client tool the model calls to see what the user is looking at: the rendered page as an outline (open dialogs and drawers first, then `main`; headings, text, buttons, links, tabs, form fields, tables, alerts, the first lines of long monospace regions, `find` for the lines around a term), with the portal chrome and the Panel itself skipped. Pure DOM, no app state, so it works on any page with no per-plugin code (CopilotKit-style readable-state hooks would need the page's own component). Read-only; an app that does not want pages read disables `client-tool:assistants/read-current-page`.
_Avoid_: screenshot (a later vision fallback), page scraping

**Page context**:
What the Panel tells the backend about the page it sits beside, on every turn: the pathname, the document title, and the catalog entity ref when the path is an entity page (`PageContext` on `/chat`). The backend appends one note to that turn's instructions after the Assistant prompt and never persists it; the page itself sends none, since it is the chat.
_Avoid_: context injection, page state

**Platform instructions**:
The fixed text the backend sends before every Assistant's system prompt on every turn: what the conversation surface renders, formatting and symbols, safe Mermaid syntax, what a tool's `_error` result means, how to use `render_form` and `download_file`, and when to read the user's page with `read_current_page`. Facts about the surface, not a role; the Assistant's prompt follows and takes precedence. `PLATFORM_INSTRUCTIONS` in `-common`; shown read-only in the editor.
_Avoid_: system preamble, base prompt

**Built-in actions**:
`search-catalog`, `search-techdocs`, and `read-techdocs`: read-only Actions this plugin registers under the `assistants` source when `assistants.builtinActions` is true (default false). They call the search backend and TechDocs as the caller. The seeded Assistant's tools.

**Conversation**:
A single chat session with one Assistant — its ordered messages. The user-facing term. Owned by exactly one Assistant; ownership is immutable (a conversation can never move to another Assistant). Persists server-side in the plugin's own database, scoped to the owning user, and reaches the browser only through assistant-ui's remote thread-list + history adapters — the frontend is a pure view that never persists message content; the server is the single writer and the only durable copy. Lists are siloed per Assistant — no unified cross-Assistant view.
_Avoid_: Chat, Session (as a noun for stored history)

**Thread**:
assistant-ui's internal name for a Conversation. Use "Thread" only when referring to assistant-ui runtime APIs (thread-list runtime, `ThreadPrimitive`); use "Conversation" everywhere user-facing.

**Knowledge index**:
The optional `-backend-module-semantic-search` module's store: every published TechDocs section and every catalog entity except `Location`, chunked and embedded into the plugin's Postgres database (pgvector, `pg_trgm`, full-text), refreshed by a scheduled task, and served to assistants as the `search-knowledge` action. Results are filtered to entities the caller can read. A rebuildable cache, not domain data.
_Avoid_: RAG (as a user-facing name), vector store

**Provider**:
A configured connection to an LLM backend (`assistants.providers.{id}`). Carries a `type` discriminator selecting the AI-SDK factory (`openai` | `anthropic` | `azure` | `openai-compatible`), `apiKey` (secret), an optional `baseUrl`, a passthrough `options` bag spread verbatim into that factory, and `models[]`. The `id` is a free label that namespaces model ids. We wire the factory; we never implement a provider.
_Avoid_: Adapter (we don't write one — the `@ai-sdk/*` package is the provider)

**Model id**:
A `<providerId>:<model>` string (e.g. `myAzure:gpt-4o`, `openrouter:anthropic/claude-sonnet-4`) used everywhere a model is named — `defaultModel`, per-Assistant allowlist, the picker — and resolved through the AI-SDK provider registry. Note the model segment may itself contain slashes.

**Reasoning level**:
How hard a reasoning model thinks for one conversation: `low`, `medium`, `high`, or `max`, picked in the header for models marked `reasoning: true`. `max` is a position, sent as each provider's ceiling (Anthropic `max`, OpenAI `xhigh`); no level leaves the provider's default.
_Avoid_: thinking budget (tiers are relative, not token counts)

**Model pool**:
The union of every Provider's `models[]`. The global set of selectable models; an Assistant's `models[]` allowlist is a subset of it.

**Conversation surface**:
The inner chat component — message list, composer, tool-call rendering, approval cards, and generative UI (interactive RJSF forms, download chips). It consumes an assistant-ui runtime from context and owns no transport/auth/chrome. The plugin owns its surface in-repo (seeded from the assistant-ui registry template), plugged in at the **surface seam**. Distinct from the **chrome**.
_Avoid_: chat window (ambiguous — say "surface" for the replaceable unit, "chrome" for the frame)

**Surface seam**:
The single component boundary at which a conversation surface plugs in: a BYO-runtime `ConversationSurface: FC<ConversationSurfaceProps>` rendered inside the host's `AssistantRuntimeProvider`. The host owns runtime/transport/auth/chrome; the surface owns only presentation and reads the ambient runtime. Props are a thin, forward-compatible presentational bag (`composerPlaceholder`, `suggestions`, `welcome`, `assistantColor`, `contextWindow`, `usedTokens`, `className`). Routed through a `surface/` indirection module so swapping the surface is one import. This is assistant-ui's native runtime/surface split — not a custom abstraction.

**Chrome**:
The Backstage-side frame around the Conversation surface: assistant rail, conversation list, the thread header, the manage gear (`assistant.manage`). Owned by the `assistants` frontend plugin. The model and effort pickers are not chrome: they render inside the composer (`ModelControls` through the surface's `composerControls` slot) so the page and the Panel offer them in the same place.

**Rail**:
The assistant list on the left of the page — one entry per accessible Assistant, with its working / unread rollup. Picking one selects that Assistant's conversations.

**Default assistant**:
The one Assistant every signed-in user gets: exactly one, designated in the editor ("Make default", `PUT /manage/assistants/:id/default`), recorded as a single `assistants_meta` key so there can never be two. Designating opens its access to any signed-in user; it cannot be deleted or restricted until another is designated. The seeded assistant is the default from first start. `/status` lists it first and names it in `defaultAssistant`. The Panel opens it until the user picks another.
_Avoid_: primary assistant, global assistant, "default" for a model (that is the default model)

**Panel**:
The floating quick-chat surface: a button in the lower right of every page opens a side panel with one conversation at a time, the Assistant's defaults for model and reasoning, no conversation list. It opens the Default assistant; a user with more than one accessible Assistant picks another from the menu on the name, and the pick is remembered per browser (a pick that is no longer accessible falls back to the default). The history button lists the Assistant's earlier Threads (`GET /threads?assistantId=`); picking one remounts the surface on it. The model and effort pickers live in the composer, as everywhere. An app root wrapper, so the page column shrinks to make room (never an overlay); shipped as `assistantsPanelModule`, a module for the `app` plugin that the app adds to its features. Three states: closed (the button only), open (the panel, no button), and collapsed (a strip at the right edge; Hide, Escape, or a click on the page gets there, and the conversation is kept). Close (the x) returns to closed. A conversation started in the panel is an ordinary Thread; "Open in Assistants" moves it to the page (`/assistants/threads/:threadId`) and the panel forgets it, so a conversation has one owner at a time. The panel remembers its last conversation in the browser.
_Avoid_: widget, popup, chatbot, drawer (the MUI component, not the concept)

**Homepage composer**:
The composer on a `@backstage/plugin-home` home page, one widget (`AssistantComposer`) with four looks set by `variant`: `bar` (the composer alone on one row, like a search bar; no picker), `padded` (the assistant picker and the full composer, framed inside the card's padding), `full` (the same, edge to edge), and `titled` (`padded` under a card header). It is the Embedded surface in `composerOnly` mode (`bare` for the bar: no header, the surface's one-row composer); the thread viewport shows only its footer; no history or panel controls. The component is exported too, for an app's own card or page. The first send creates the Thread through the surface's own runtime, which reports the id; the card hands it to the Panel (`usePanelControl().open({ threadId })`, a React context the Panel wrapper provides to every page), the Panel lists and resumes it, and the card remounts on a fresh Thread. Without the Panel the Thread opens on the page. A way in, not a second chat: it keeps no conversation. Its own entry point (`/home`, `assistantsHomeModule`) so the `0.1.x` home-react peer is optional.
_Avoid_: home widget (the home plugin's word for any card), chat card

**Embedded surface**:
The component that renders one conversation outside the page (`embedded/EmbeddedAssistant.tsx`): the `assistant.use` gate, `/status`, the single-thread adapter under the page's runtime hook, the client tool registrations, and the Conversation surface in a compact density. The Panel is its first mount; a homepage composer would be another.
_Avoid_: mini chat, chat widget

**Client tool registry**:
The `api:assistants/client-tools` extension (`clientToolsApiRef`): every `AssistantClientToolBlueprint` extension attaches to its `tools` input, and the page and the panel read the tools from it. One registration, read wherever a conversation renders; the frontend system's way to share extensions across locations instead of multiple attachment points.

**Single-thread adapter**:
The thread-list adapter scoped to one conversation: `list()` is the remembered Thread (fetched by id; a 404 lists as nothing) or empty, and `initialize()` creates a Thread under the surface's Assistant on the first send. Same runtime shape as the page, so history, auto-send, resume, and client tools are unchanged.

**Access policy**:
The per-Assistant rule deciding who may use it (`allowAuthenticated` / `users[]` / `groups[]`), stored on the definition in the DB. Deny by default. It filters _which_ Assistants a user sees — distinct from the plugin **Permission**s (whether they may use the plugin at all) and from the per-tool Backstage checks at execution.
_Avoid_: calling it a permission (it is content/assignment, not a Backstage permission)

**Permission**:
A Backstage permission gating plugin access. Two, defined in `-common`: `assistant.use` (use the plugin — load the surface, chat) and `assistant.manage` (run the admin editor — create / edit / delete definitions). Authorized server-side on every route and gated client-side with `usePermission`; registered with `coreServices.permissionsRegistry` so permission UIs (e.g. the RBAC role editor) discover them; governed by the host app's permission policy. Distinct from the per-Assistant **Access policy** (which Assistants you see) and the per-tool Backstage checks at tool execution.
_Avoid_: an `assistants.admins` config allowlist (management is the `assistant.manage` permission, not config)

**Snapshot**:
The AssistantStore's in-memory copy of every assistant definition — write-through on the replica that served the edit, lazily refreshed every 60 s elsewhere. Read synchronously by `/status` and `/threads*`; `/chat` reads the DB row instead, so a turn never runs against a stale definition.

**Stream buffer**:
The `stream_chunks` rows holding a running turn's UI message stream, keyed by thread id, written in 250 ms batches by the replica running the turn and kept 60 s after it completes. `GET /chat/resume/:threadId` replays and follows them from any replica.

**Turn state**:
The running-turn record on a `threads` row: `turn_heartbeat_at`, refreshed every 5 s by the replica running the turn, and `turn_cancel_requested`, a Stop for that replica to pick up. A heartbeat younger than 30 s is `working`.

**Delta-validation**:
The editor's save rule: only _new_ additions are validated against live capabilities; pre-existing entries are grandfathered, surfaced as stale (RED gone / AMBER unverifiable), and pruned only on demand. Save is never blocked by stale entries.

**Seed-once**:
First init inserts one open Assistant (`allowAuthenticated: true`, the three built-in read-only tools, the platform-default model) and a marker row in `assistants_meta`. The marker means it is never resurrected once deleted or edited.
