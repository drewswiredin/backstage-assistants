# Architecture

`backstage-assistants` is an in-portal AI chat for Backstage. assistant-ui renders the conversation, the Vercel AI SDK runs the model and tool loop, and Backstage supplies auth, the Actions registry, and the database; the plugin is thin glue between them. This file, [PRINCIPLES.md](PRINCIPLES.md), and [CONTEXT.md](../CONTEXT.md) are the spec, and a change to the design changes them in the same commit.

## Stack

| Package                                                              | Role                                                                                                                                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@assistant-ui/react`, `-core`, `-react-markdown`                    | Message and tool-call primitives; `useRemoteThreadListRuntime` is the one runtime for every assistant and conversation                                                                 |
| `@assistant-ui/react-ai-sdk`                                         | `useAISDKRuntime` and `AssistantChatTransport`, the bridge from `useChat` to the runtime; `respondToApproval`; sends registered frontend tools as `tools` and runs them in the browser |
| `ai`, `@ai-sdk/react`                                                | `streamText` tool loop, UI message streaming, `toolApproval`, persistence hooks; `useChat` on the client                                                                               |
| `@ai-sdk/openai`, `-anthropic`, `-azure`                             | Provider factories selected by the configured `type`; OpenAI-compatible gateways use the `openai` factory                                                                              |
| `@backstage/backend-plugin-api/alpha` (Actions), `@ai-sdk/mcp`       | Backstage actions run as the user; MCP servers run as a configured credential; both become AI SDK tools                                                                                |
| `@rjsf/core`, `-utils`, `-validator-ajv8`, `plugin-scaffolder-react` | Inline forms for `render_form`, rendering the host's scaffolder field extensions by name                                                                                               |
| `@backstage/backend-plugin-api`, `backend-openapi-utils`             | Plugin wiring, the typed OpenAPI router for `/status` and `/chat`, core services                                                                                                       |
| `coreServices.database` with `knex`                                  | The `threads`, `messages`, `stream_chunks`, `assistants`, and `assistants_meta` tables on SQLite, Postgres, or MySQL                                                                   |
| `vector` (pgvector), `pg_trgm`, `ai` `embedMany`                     | The knowledge index module: hybrid semantic, fuzzy, and keyword retrieval in the plugin's Postgres database                                                                            |
| `@backstage/plugin-signals-node`, `-react`                           | Real-time working and unread indicators; the browser polls when the host has no Signals API                                                                                            |
| `mermaid`, `remark-gfm`, `@material-ui/core` v4                      | Diagrams and GitHub-flavoured Markdown in replies; Backstage's component theme                                                                                                         |

The thread and composer components from assistant-ui's registry template are vendored under `packages/assistants/src/collapsible/surface/react-ui/` so they stay editable.

## System map

```mermaid
flowchart LR
  RT["Browser runtime\ncollapsible/"]
  PN["Panel\npanel/, embedded/"]
  ED["Admin editor\ncollapsible/admin/"]
  RO["Router\nrouter.ts, manage.ts"]
  TA["Tool assembly\nactions.ts, mcp.ts, clientTools.ts"]
  LP["AI SDK loop\nrouter.ts"]
  ST["Stores\nassistants.ts, threads.ts"]
  MP["MCP pool\nmcp.ts"]
  KI["Knowledge index\nmodule-semantic-search"]
  DB[("Database")]
  PV["LLM providers"]
  RT -->|"/chat /threads"| RO
  PN -->|"/chat /threads/:id"| RO
  ED -->|"/manage /capabilities"| RO
  RO -->|"per turn"| TA
  TA -->|"tools"| LP
  RO -->|"snapshot, rows"| ST
  LP -->|"persist turn"| ST
  LP -->|"model calls"| PV
  LP -->|"tool calls"| MP
  TA -->|"cached tools"| MP
  ST --> DB
  KI -->|"search-knowledge action"| TA
  KI -->|"embeddings"| PV
  KI --> DB
```

| Node              | Module path                                                              | Owns                                                                                         |
| ----------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Browser runtime   | `packages/assistants/src/collapsible/`                                   | One `useRemoteThreadListRuntime` per tab, the chrome, the surface seam                       |
| Panel             | `packages/assistants/src/panel/`, `embedded/`                            | The app root wrapper: the floating button, the side panel beside the page, one conversation  |
| Homepage composer | `packages/assistants/src/home.tsx`, `home/`                              | The "Ask the assistant" card; opens the panel with a first message through `usePanelControl` |
| Admin editor      | `packages/assistants/src/collapsible/admin/`                             | The `assistant.manage` dialog and client-side delta-validation                               |
| Router            | `packages/assistants-backend/src/router.ts`, `manage.ts`                 | Auth, permission and access checks, `/status`, `/chat`, `/threads`, `/manage`                |
| Tool assembly     | `packages/assistants-backend/src/actions.ts`, `mcp.ts`, `clientTools.ts` | `allowedTools` and the request's client tool declarations to AI SDK tools; result capping    |
| AI SDK loop       | `packages/assistants-backend/src/router.ts`                              | `streamText`, the approval map, persistence on start and finish, signals                     |
| Stores            | `packages/assistants-backend/src/assistants.ts`, `threads.ts`            | `AssistantStore` with its snapshot; `ThreadService`, the only message writer                 |
| MCP pool          | `packages/assistants-backend/src/mcp.ts`                                 | One client per server per process, the tool cache                                            |
| Knowledge index   | `packages/assistants-backend-module-semantic-search/src/`                | The index refresh task and the `search-knowledge` action                                     |
| Database          | Backstage `backend.database`                                             | The five plugin tables, plus the two knowledge index tables on Postgres                      |
| LLM providers     | `packages/assistants-backend/src/config.ts`                              | The AI SDK provider registry built from config                                               |

## Routes

Every route accepts user tokens only. `/chat` applies the per-assistant access policy, and `GET /threads`, `POST /threads`, and `/threads/status` filter or check by it; the per-thread routes and `/chat/resume` and `/chat/cancel` are scoped to the owning user. Handlers live in `router.ts`; `/capabilities` and `/manage/*` live in `manage.ts`.

| Method | Path                             | Gate               | Reads                                                                                                      | Writes                                                                           | Signals                              |
| ------ | -------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------ |
| GET    | `/status`                        | `assistant.use`    | snapshot, `actions.list`, MCP tool cache, the config floor                                                 |                                                                                  |                                      |
| POST   | `/chat`                          | `assistant.use`    | assistant row (DB), thread row, `actions.list`, pool                                                       | `messages`, `threads` `updated_at`, `model`, `last_tokens`, turn state, title    | turn-started, turn-finished, updated |
| GET    | `/chat/resume/:threadId`         | `assistant.use`    | thread row, `stream_chunks`                                                                                |                                                                                  |                                      |
| POST   | `/chat/cancel/:threadId`         | `assistant.use`    | `threads` turn state, abort handle                                                                         | `turn_cancel_requested`                                                          | turn-finished                        |
| GET    | `/threads`                       | `assistant.use`    | snapshot (access filter), `threads`; optional `?assistantId=`; unarchived, pinned first, then `updated_at` |                                                                                  |                                      |
| POST   | `/threads`                       | `assistant.use`    | snapshot (access check)                                                                                    | `threads` row                                                                    |                                      |
| GET    | `/threads/status`                | `assistant.use`    | snapshot, `threads` including turn state                                                                   |                                                                                  |                                      |
| GET    | `/threads/:id`                   | `assistant.use`    | `threads`                                                                                                  |                                                                                  |                                      |
| PATCH  | `/threads/:id`                   | `assistant.use`    | `threads`                                                                                                  | title, model, reasoning level, pinned, archived                                  |                                      |
| DELETE | `/threads/:id`                   | `assistant.use`    | `threads`                                                                                                  | `threads` and `messages` rows                                                    |                                      |
| POST   | `/threads/:id/read`              | `assistant.use`    | `threads`                                                                                                  | `last_read_at`                                                                   | read                                 |
| GET    | `/threads/:id/messages`          | `assistant.use`    | `messages`                                                                                                 |                                                                                  |                                      |
| GET    | `/capabilities`                  | `assistant.manage` | `actions.list`, model pool, MCP pool                                                                       |                                                                                  |                                      |
| GET    | `/manage/assistants`             | `assistant.manage` | `assistants` (DB)                                                                                          |                                                                                  |                                      |
| POST   | `/manage/assistants`             | `assistant.manage` | capabilities                                                                                               | `assistants` row, snapshot rebuild                                               |                                      |
| PUT    | `/manage/assistants/:id`         | `assistant.manage` | `assistants` row, capabilities                                                                             | `assistants` row, snapshot rebuild                                               |                                      |
| DELETE | `/manage/assistants/:id`         | `assistant.manage` | the default designation (refused for the default)                                                          | `assistants` row, snapshot rebuild                                               |                                      |
| PUT    | `/manage/assistants/:id/default` | `assistant.manage` | `assistants` row                                                                                           | `assistants_meta` `default_assistant`, the row's access opened, snapshot rebuild |                                      |

In the browser the page mounts at `/assistants` (`rootRouteRef`); `?assistant=<id>` focuses an assistant and `/assistants/threads/:threadId` (`threadRouteRef`) selects one conversation once, then the URL is replaced with the root path. A thread the caller cannot see is simply absent from the list, so it lands on the normal page with a notice.

`/status` and `/chat` sit on the typed OpenAPI router (`src/schema/openapi.yaml`); the other routes are plain Express sub-routers. The OpenAPI router's JSON parser runs ahead of every route, so `requestBodyLimit` (default `10mb`, sized for `/chat` attachments) is the body limit for all of them. `PATCH /threads/:id` rejects unknown fields; `POST /threads` answers 201; `/chat/cancel` always answers 204; `/chat/resume` answers 204 for an unknown, foreign, or expired stream.

## Chat turn

The browser sends `{ assistantId, modelId, threadId?, reasoningLevel?, messages, tools, page? }`, where `tools` is every registered client tool's declaration (assistant-ui's transport adds `description` and JSON Schema `parameters`; the runtime's fetch wrapper stamps each tool's `attributes`) and `page` is the panel's page context (`path`, `title?`, `entityRef?`), which the router appends to the turn's instructions after the assistant prompt as a note that names the page and the entity and points at `read_current_page`. The note describes that turn only and is never persisted; the page sends no `page`. The server persists the user message before streaming, so the conversation is durable the instant it is sent. A turn without `threadId` streams but is neither persisted, signalled, nor resumable.

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant R as Router
  participant L as AI SDK loop
  participant P as Provider
  participant T as Tool
  participant D as Database
  B->>R: POST /chat
  R->>R: assistant.use check
  R->>D: read assistant row, unknown 400
  R->>R: access policy? else 403
  R->>D: thread owned? else 404
  R->>R: modelId in allowlist? else 400
  R->>R: assemble tools
  R->>D: persist user message
  R-->>B: turn-started signal
  loop up to maxSteps
    L->>P: messages + tool schemas
    P-->>L: text or tool call
    L->>T: invoke as user or as configured
    T-->>L: result capped to toolResultMaxChars
  end
  L-->>B: stream UI messages
  L->>L: consumeStream to completion
  L->>D: onFinish persist turn
  R-->>B: turn-finished signal
```

Tool assembly splits `allowedTools` into bare action ids, `<serverId>__<tool>` entries whose prefix is a configured MCP server, and `<namespace>__<tool>` client tool names; the server segment is the server id with characters outside `[A-Za-z0-9_-]` replaced by `_`. Action ids are intersected with `actions.list({ credentials })`; unknown names are logged and skipped. MCP entries come from the pool cache and run as the server's configured credential. Client tools come from the request's `tools`: a declaration is offered when its name is a built-in (`render_form`, `download_file`, `read_current_page`) or in the allowlist, has the client-tool shape, collides with no server tool, and is within limits (30 per request, 4000-character description, 8 KB schema, `parameters` of type object); the rest are logged and dropped. Each becomes a tool with no `execute`. Client tool outputs arrive inside `messages` and are capped to `toolResultMaxChars` there, so the same budget applies before the model call and before persistence. Non-image file parts are inlined as `<attachment>` text before the model call. `reasoningLevel` (`low`, `medium`, `high`, `max`) is translated per provider type in `config.ts`.

The loop runs `streamText` with `stopWhen: stepCountIs(maxSteps)` (default 10) and one `AbortController` per thread. Usage from the last `finish-step` rides the assistant message as `metadata.usage`, and `replaceMessages` stores the total in `threads.last_tokens`. Usage falls back to the turn's total when no step reported any. Errors stream as a readable error part with the real reason, capped at 300 characters. A failed or denied tool call returns a `{ _error: true, message }` result rather than throwing, so the loop continues; every tool result, error or not, is truncated to `toolResultMaxChars` (default 30000, `0` disables), keeping the head and tail around an elision marker.

**Auto-title.** After a turn lands, `onFinish` runs `generateText` off the critical path when the title is still `New Chat`. The result is cut to 80 characters, saved with `updateThread`, and announced with an `updated` signal.

### Cancel and resume

```mermaid
sequenceDiagram
  participant B as Browser
  participant R as Router
  participant L as AI SDK loop
  participant F as stream_chunks
  B->>R: POST /chat/cancel/:threadId
  alt this replica runs the turn
    R->>L: abort this turn
  else another replica runs it
    R->>R: set turn_cancel_requested
    Note over R,L: that replica aborts on its next heartbeat
  end
  L-->>R: onAbort, turn-finished
  Note over B,L: a disconnect never aborts
  B->>R: GET /threads/status
  R-->>B: working: true
  B->>R: GET /chat/resume/:threadId
  R->>F: read rows by thread id
  F-->>B: buffered rows, then new rows every 300 ms until done
```

A running turn is recorded on its thread: `noteStarted` sets `turn_heartbeat_at`, the replica running the turn refreshes it every 5 s, and `noteFinished` clears it. `working` is a heartbeat younger than 30 s, so every replica reports the same and a replica that dies mid-turn stops reporting within 30 s.

Stop sets `turn_cancel_requested` on the caller's own running turn and aborts it at once when this process runs it; otherwise the running replica reads the flag on its next heartbeat and aborts. A dropped connection does not abort: `consumeStream` drives the turn to completion and `onFinish` persists it.

On entering a conversation the runtime hook checks the `working` flag and calls `resumeStream()`, which targets `/chat/resume/:threadId` with the thread id as the stream id. Any replica serves it from `stream_chunks`, which keeps the turn's rows 60 s after completion. The first row is written before the turn reads as working, so a working turn always has rows to replay; a resume that finds none answers 204. When the replica running a turn dies, the replay ends without a finish once the heartbeat goes stale, and the surface shows "Connection lost".

| End state    | Persisted                                             | Surface shows                                                              |
| ------------ | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| Stopped      | Partial reply, stamped `metadata.canceled: true`      | "Request interrupted", live via `interruptedTurns`, durable via the flag   |
| Errored      | The turn up to the error, including any partial reply | The streamed error part with the reason                                    |
| Disconnected | The full turn, written when the server finishes       | "Connection lost" in the tab that dropped; resume or reload shows the turn |

A clean close with no `finishReason`, outside a form or approval pause, is labelled as disconnected.

## Human in the loop

The approval gate is a global floor in config: `assistants.requireApproval` (action ids and tool names) ∪ each `mcp.servers.*.requireApproval` (tool names, folded in as `<serverId>__<tool>`). Per turn, the set is that floor ∩ the assistant's `allowedTools`. Each server-tool member gets a `toolApproval` entry, so the SDK emits `tool-approval-request` and skips `execute` until the user answers. Allow runs the tool under its normal identity; Deny returns an execution-denied result to the model. Client tools are never in the map, because assistant-ui skips a frontend tool's `execute` for a call that carries a server approval; the browser gates them instead (below). The gate withholds execution and never grants access; Backstage permissions still apply when an approved action invokes.

```mermaid
sequenceDiagram
  participant L as AI SDK loop
  participant B as Browser
  participant T as Tool
  L-->>B: tool-approval-request
  B->>B: Allow, Always allow, or Deny
  B->>L: addToolApprovalResponse
  alt approved
    L->>T: execute
    T-->>L: result
  else denied
    L->>L: execution-denied to model
  end
```

**Always allow** records an approved response with `reason: always:<tool>`. The `toolApproval` predicate reads it back from the message history, so that tool runs unprompted for the rest of the conversation. The grant is per tool and survives reloads because it lives in the persisted messages. Several gated calls of one tool in a single step collapse into one card with a count; the lowest-index call leads and the rest mirror its decision.

### Client tools

A client tool is contributed by any frontend plugin or module with `AssistantClientToolBlueprint`, which attaches to the assistants page's `clientTools` input. The page registers each tool with assistant-ui (`useAssistantTool`): a tool with `execute` as `type: frontend`, one without as `type: human`. assistant-ui then sends the tool's schema with every `/chat` request, runs `execute` in the browser once the model's call is complete and the server stream has ended, and renders the tool's card for the call. `isAvailable` is resolved once per page load; an unavailable tool is registered disabled, so it is neither sent nor run.

```mermaid
sequenceDiagram
  participant L as AI SDK loop
  participant R as Browser runtime
  participant C as Tool card
  participant S as Downstream system
  L-->>R: tool call, stream ends
  alt not read-only, destructive, or in the floor
    R->>C: human: approval
    C-->>R: resume approved or declined
  end
  alt tool declares auth
    R->>R: acquire silently
    opt nothing
      R->>C: human: connect
      C->>C: click: acquire interactively
      C-->>R: resume credential or dismissed
    end
  end
  R->>S: execute(input, credential) as the user
  S-->>R: output
  R->>R: addToolOutput, auto-send
  R->>L: POST /chat with the result
```

The runtime's `execute` wrapper runs the steps in order and returns a `{ _error: true, code, message }` result instead of throwing: `declined`, `not_authorized`, `timeout` (default 30 s, at most 120 s), `aborted` (the user stopped the turn), or `failed`. Approval precedes credential acquisition, so a declined call never prompts for a login. The prompts use assistant-ui's `human` interrupt: the card receives the request as `interrupt` and answers with `resume`. Connect runs the interactive acquisition in the click handler, so the provider's popup is never blocked, and hands the credential to the waiting `execute` through `resume`; the credential never enters a result, a request to the backend, or storage. The result is JSON round-tripped; a non-JSON value is a `failed` result. There is no Always allow for client tools. A prompt survives a page reload: assistant-ui re-runs a frontend tool call restored from history without a result, so the wrapper asks again (approval, then Connect if the credential is gone) and the turn resumes once answered.

`render_form`, `download_file`, and `read_current_page` are the plugin's own client tools, registered through the same blueprint. `render_form` has no `execute`: it renders through scaffolder's RJSF `Form` with the field registry from `formFieldsApiRef.loadFormFields()`, `ui:*` keys inside the schema are hoisted by `extractSchemaFromStep`, and submit returns `{ submitted: true, values }` while dismissal returns `{ submitted: false, cancelled: true }`. `download_file` renders a download chip from the call's input and its `execute` returns `{ delivered: true }`. `read_current_page` (`clientTools/builtin/pageSerializer.ts`) returns the rendered page as an outline: open dialogs and drawers first under a `[dialog: …]` line, then `main` (the body when there is none, with the chrome skipped), walking headings, text, `[button: …]`, `[link: …, current]`, `[tab: …, selected]`, `[input: label = value]`, tables as rows, alerts, and monospace regions cut to their first 80 lines or, with `find`, the 10 lines around each of the first 10 matches; capped at 12,000 characters with a marker. The panel and the strip are skipped; visibility is a layout check. None of the three is config-gated; an app disables `read_current_page` through its extension id.

`sendAutomaticallyWhen` flushes the turn once every tool part in the latest step is settled and at least one is client-driven: a client tool's output, unless it records that the user stopped the turn, or an answered approval. A server tool truncated at `maxSteps` is never auto-resumed.

## Authorization

| Order | Layer                       | Where                                                          | Rule                                                                                                                                                                                                                                                 |
| ----- | --------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `assistant.use` permission  | Every user-facing route; the page via `usePermission`          | Denied callers get 403 and never load the surface                                                                                                                                                                                                    |
| 2     | Per-assistant access policy | `/status` filter, `/chat`, `/threads` list, create, and status | `allowAuthenticated`, or `users` contains the caller, or `groups` meets `ownershipEntityRefs`; deny by default. The API defaults a missing policy to deny; the editor pre-fills open                                                                 |
| 3     | Tool selection              | Tool assembly                                                  | Backstage actions: `allowedTools` ∩ `actions.list(credentials)`, with per-resource checks at `invoke`. MCP tools: added directly, run as the server credential. Client tools: `allowedTools` ∩ the request's declarations, run in the user's browser |
| 4     | Approval gate               | `toolApproval` in the loop; the runtime's `execute` wrapper    | Floor ∩ `allowedTools` for server tools; the floor plus every non-read-only or destructive tool for client tools; a human checkpoint, not a permission                                                                                               |

`assistant.manage` gates `/manage/*`, `/capabilities`, and the gear. Both permissions live in `-common`, are registered with `coreServices.permissionsRegistry`, and are granted by the host's permission policy. Hiding the nav entry is the host app's job.

| Call                             | Runs as                                                                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `/chat`, `/threads*`, `/status`  | The signed-in user's token                                                                                                              |
| Backstage action `execute`       | The calling user's credentials, via `actions.invoke`                                                                                    |
| Built-in actions                 | On-behalf-of tokens for `search` and `techdocs`, minted from the caller                                                                 |
| `search-knowledge` result filter | An on-behalf-of `catalog` token minted from the caller                                                                                  |
| Knowledge index refresh task     | The plugin's service credentials for `catalog` and `techdocs`                                                                           |
| MCP tool `execute`               | The server's static `headers` or `env`; one identity for every user                                                                     |
| Client tool `execute`            | The user's browser, with a credential the user's own session or consent provides; the downstream system enforces the user's permissions |
| `/capabilities` action list      | The admin's credentials, so assignable can exceed runnable                                                                              |

A low-privilege user chatting with an assistant wired to a powerful MCP server gets that server's full configured access. Choose MCP servers and their credential scope deliberately. A client tool gives the model only what the user already has, since it runs as the user; the browser decides which tools to declare, but the allowlist decides which are offered, and a user forging a declaration can only run code in their own browser with their own credentials.

## State and lifetime

| Store                           | Where          | Scope                             | Written by                                                          | Lifetime                                                                      | Several replicas                               |
| ------------------------------- | -------------- | --------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------- |
| `threads`, `messages`           | DB             | Per `user_ref`                    | `ThreadService` from `/chat` and `/threads`                         | Durable                                                                       | Shared                                         |
| `assistants`, `assistants_meta` | DB             | Global                            | `AssistantStore` from `/manage`, seed-once                          | Durable                                                                       | Shared                                         |
| `assistants_knowledge_*`        | DB             | Global                            | The knowledge index refresh task, one replica per run               | Rebuildable cache; rebuilt when the embedding model changes                   | Shared                                         |
| Assistant snapshot              | Process memory | Global                            | Write-through on the editing replica                                | Lazy refresh after 60 s elsewhere                                             | Stale up to 60 s; `/chat` reads the row        |
| `stream_chunks`                 | DB             | Per thread, owner-checked on read | `StreamBuffer` from the `consumeSseStream` tee                      | Replaced by the next turn; deleted 60 s after completion; swept after an hour | Shared                                         |
| Turn state                      | DB             | Per thread                        | `noteStarted`, a 5 s heartbeat, `noteFinished`                      | Cleared on finish, abort, or error; stale after 30 s                          | Shared                                         |
| Abort handles                   | Process memory | Per thread                        | `/chat`                                                             | Cleared on finish, abort, or error                                            | A cancel elsewhere lands on the next heartbeat |
| MCP pool and tool cache         | Process memory | Per server                        | `maintainMcpConnections` every 2 min                                | Until shutdown; 5 min freshness for `/capabilities`                           | Each replica keeps its own                     |
| Runtime messages                | Browser memory | Per tab                           | `useChat` stream, history adapter load                              | Until unmount; never persisted                                                | n/a                                            |
| Thread status rows              | Browser memory | Per tab                           | `useThreadStatus` refetch                                           | Until unmount                                                                 | n/a                                            |
| `interruptedTurns` reasons      | Browser memory | Per message id                    | `useChat.onFinish`                                                  | Cleared on reload; the DB flag takes over                                     | n/a                                            |
| Model and effort refs           | React refs     | Per tab                           | Header pickers; PATCHed to the thread                               | Until unmount                                                                 | n/a                                            |
| Side pane collapsed             | `localStorage` | Per browser                       | The collapse control                                                | Persistent                                                                    | n/a                                            |
| Panel conversation, width, pick | `localStorage` | Per browser                       | `panelStorage` from the panel                                       | Persistent; the conversation is forgotten on "+" and "Open in Assistants"     | n/a                                            |
| Panel mode                      | React state    | Per tab                           | The button, Hide, Close, Escape, click-off, `PanelControl.open`     | Until reload; closed on load                                                  | n/a                                            |
| Default assistant               | DB             | Global                            | `setDefault` from "Make default", the seed, `ensureDefault` at init | Durable; read with the snapshot                                               | Shared                                         |
| Active assistant                | URL            | Per tab                           | `?assistant=<id>`, rewritten on each switch                         | Survives reload                                                               | n/a                                            |
| Nav icon status rows            | Browser memory | Per tab                           | `AssistantsNavIcon`'s own `useThreadStatus`                         | Until unmount                                                                 | n/a                                            |
| Scaffolder field registry       | Module memory  | Per tab                           | `render_form`'s first `loadFormFields()`                            | Until reload                                                                  | n/a                                            |
| Client tool prompts             | Browser memory | Per tool call                     | The runtime's `execute` wrapper via `human`                         | Until answered or the turn stops; a reload re-runs the call and asks again    | n/a                                            |

Turn state and the stream buffer are in the database, so `working`, Stop, and rejoining a running reply work on any replica. The abort handles live in process memory; a Stop received elsewhere reaches them through the heartbeat.

## Data model

`threads`

| Column                                       | Notes                                                           |
| -------------------------------------------- | --------------------------------------------------------------- |
| `id`                                         | Primary key, UUID                                               |
| `assistant_id`                               | Owning assistant; immutable                                     |
| `user_ref`                                   | Owner; every read and write is scoped to it                     |
| `title`                                      | 512 characters; defaults to `New Chat`, the auto-title sentinel |
| `model`, `reasoning_level`                   | Last model id; nullable chosen effort                           |
| `last_tokens`                                | Input plus output of the latest turn; drives the context gauge  |
| `turn_heartbeat_at`, `turn_cancel_requested` | Set while a turn runs; a Stop for the replica running it        |
| `pinned`, `archived`                         | List state                                                      |
| `created_at`, `updated_at`, `last_read_at`   | Timestamps; `last_read_at` nullable                             |

`stream_chunks`

| Column       | Notes                                                             |
| ------------ | ----------------------------------------------------------------- |
| `id`         | Auto-increment; the replay order                                  |
| `thread_id`  | The thread the turn runs on; one turn's rows per thread at a time |
| `turn_id`    | UUID per turn; a new id ends followers of the previous turn       |
| `data`       | UI message stream text, one 250 ms batch; `LONGTEXT` on MySQL     |
| `done`       | Set on the final row of a turn                                    |
| `created_at` | Drives the hourly sweep of abandoned rows                         |

`messages`

| Column         | Notes                                                 |
| -------------- | ----------------------------------------------------- |
| `id`           | Primary key; the assistant-ui message id              |
| `thread_id`    | Parent thread; deleted explicitly with the thread     |
| `parent_id`    | Prior message                                         |
| `role`         | `user`, `assistant`, or `system`                      |
| `content_json` | The `UIMessage` verbatim; `TEXT`, `LONGTEXT` on MySQL |
| `sort_order`   | Position in the thread                                |
| `created_at`   | Written, never read back                              |

`assistants`

| Column                                                 | Notes                                                                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                   | Server-generated UUID; immutable                                                                                                    |
| `title`                                                | Mirrored column for sorting                                                                                                         |
| `definition_json`                                      | `TEXT`, `LONGTEXT` on MySQL: `title`, `description?`, `color?`, `prompt`, `access`, `allowedTools`, `models`, `defaultModel`, `ui?` |
| `created_by`, `created_at`, `updated_by`, `updated_at` | Audit columns                                                                                                                       |

`assistants_meta` holds two keys: `seeded`, the seed-once marker with the seed timestamp, and `default_assistant`, the default assistant's id. The default is a single key rather than a column so there can never be two.

`assistants_knowledge_chunks` (knowledge index module, Postgres only)

| Column         | Notes                                                                         |
| -------------- | ----------------------------------------------------------------------------- |
| `id`           | SHA-256 of source, document key, and chunk position; stable across runs       |
| `source`       | `techdocs` or `catalog`                                                       |
| `entity_ref`   | The entity whose catalog read access gates the chunk                          |
| `location`     | TechDocs page path for `read-techdocs`, or the entity ref                     |
| `title`        | Heading path, `Site › Page › Section`                                         |
| `content`      | Up to ~1600 characters                                                        |
| `content_hash` | SHA-256 of the embedded text; unchanged hash = not re-embedded                |
| `embedding`    | `vector(n)` for the configured model; HNSW cosine index up to 2000 dimensions |
| `tsv`          | Generated `to_tsvector('english', title \|\| ' ' \|\| content)`; GIN index    |
| `updated_at`   | Last upsert                                                                   |

A GIN `gin_trgm_ops` index covers `title || ' ' || content`. `assistants_knowledge_meta` holds the index signature, `key = embedding`, `value = <embeddingModel>#<dimensions>`; a different signature drops and recreates `assistants_knowledge_chunks`. Both tables are a rebuildable cache, created by the module rather than migrations.

**Unread and recency.** `updated_at` moves only in `replaceMessages`: when a turn starts and when it lands. A new thread starts read: `last_read_at` is its creation time. `unread = updated_at > last_read_at` when `last_read_at` is set. Rename, model, effort, pin, and archive edits touch only their own fields, so editing a conversation never marks it unread or reorders the list.

Timestamps are ISO 8601 strings on every driver; `toIsoTimestamp` converts Postgres `Date` values so ordering and the unread compare see one format. Assistant rows that fail to parse are skipped on read. Threads whose assistant is gone are filtered out of every list but stay in the database with their messages. `messages.thread_id` cascades on delete.

## Frontend runtime

```mermaid
flowchart TB
  CP["CollapsiblePage\ncollapsible/CollapsiblePage.tsx"]
  SP["SidePane\ncollapsible/SidePane.tsx"]
  MC["ModelControls\ncollapsible/surface/ModelControls.tsx"]
  AD["AssistantAdminDialog\ncollapsible/admin/"]
  RP["AssistantRuntimeProvider"]
  RL["useRemoteThreadListRuntime\ncollapsible/threadListAdapter.ts"]
  RH["Per-thread runtime hook\ncollapsible/useAssistantRuntime.ts"]
  CS["ConversationSurface\ncollapsible/surface/"]
  API["AssistantsApi\napi/AssistantsApi.ts"]
  DD["AssistantDetailDialog\ncollapsible/AssistantDetailDialog.tsx"]
  TS["useThreadStatus, StatusDot\ncollapsible/"]
  CT["ClientToolRegistrations, ClientToolCall\nclientTools/"]
  BP["AssistantClientToolBlueprint\nclientTools/blueprint.ts"]
  NI["AssistantsNavIcon\nAssistantsNavIcon.tsx"]
  PN["AssistantsPanel\npanel/AssistantsPanel.tsx"]
  HC["AskAssistantCard\nhome/AskAssistantCard.tsx"]
  EA["EmbeddedAssistant\nembedded/EmbeddedAssistant.tsx"]
  SA["Single-thread adapter\ncollapsible/threadListAdapter.ts"]
  CA["clientToolsApiRef\nclientTools/api.ts"]
  PN --> EA
  HC -->|"usePanelControl open(prompt)"| PN
  EA --> SA
  SA --> RH
  EA --> CT
  EA --> CS
  CA --> PN
  CP --> SP
  CP --> DD
  CP --> TS
  NI --> TS
  RP --> CT
  BP -->|"tools input"| CA
  CA --> CP
  TS --> API
  CP -->|"composerControls"| MC
  EA -->|"composerControls"| MC
  CP --> AD
  CP --> RP
  RP --> RL
  RL --> RH
  RP --> CS
  RH --> API
  RL --> API
```

One runtime carries every conversation across all assistants; switching assistant or conversation never remounts it, so in-flight streams keep running. The thread-list adapter lists every thread over `/threads`; the page filters by the active assistant. New conversations are created only by the "+" control or the empty state's New chat button; typing never creates one. Deleting the active conversation lands on the assistant's most recent remaining one. Expanded, `SidePane` holds the assistant list, the conversation list, and the gear; collapsed, `CollapsiblePage` renders a 56 px rail with the same controls as icons. `?assistant=<id>` selects the initial assistant and follows every switch.

The runtime hook runs once per active thread: `useChat` wrapped by `useAISDKRuntime`. Its `AssistantChatTransport` wraps the authed fetch to inject `assistantId`, `modelId`, and `reasoningLevel`, copies the transport's `id` to `threadId`, and stamps each client tool's `attributes` onto the `tools` the transport built. When the request signal aborts it posts `/chat/cancel/:threadId`. Contributed client tools attach to `api:assistants/client-tools` (`clientToolsApiRef`), one registry the page and the panel both read, instead of a page input with multiple attachment points. `ClientToolsProvider` wraps the page with those tools and the approval floor from `/status`; `ClientToolRegistrations` registers them inside the runtime provider, so one registration serves every conversation. The history adapter is load-only over `/threads/:id/messages`, and its `append` is a no-op. The thread-list adapter's `generateTitle` returns an empty stream because the server writes titles.

**The panel.** `assistantsPanelModule` is a module for the `app` plugin whose one extension, `app-root-wrapper:app/assistants-panel`, renders `AssistantsPanel` around the app layout: inside the router and after sign-in, once per session, so it never remounts on navigation and a streaming answer survives it. A wrapper rather than an app-root element because the panel takes space from the page instead of covering it: the wrapper is a flex row of the page column (`flex: 1`, `min-width: 0`) and a sticky, clipping panel column whose width animates between 0, the strip, and the panel. The app adds the module to its features. The button (a floating action button with the plugin icon and the conversation's own status dot) is hidden on the Assistants page, for a user without `assistant.use`, and while `/status` lists no assistant. The panel has three states: closed (the button only), open (the panel, no button), and collapsed (a 48 px strip at the right edge with the icon and status dot; clicking it reopens). Hide (the header chevron, `Esc`, or a mousedown on the page outside the panel and any MUI modal, popper, or tooltip) collapses; Close (the x) returns to closed. No backdrop and no focus trap: the page beside it stays usable. Because the panel column clips and the page column shrinks, nothing ever reaches past the viewport (an overlay drawer's slide flashed a horizontal scrollbar and shifted the page). `Ctrl+/` toggles, the left edge resizes (also with arrow keys), and below the `xs` breakpoint it fills the screen. It remembers its conversation and width in `localStorage`; a conversation stays mounted while the panel is collapsed or closed so a stream keeps rendering, but only an open panel focuses it (`active`), so a reply that lands while the panel is hidden stays unread and the strip or the button shows the red dot until the panel opens again.

`EmbeddedAssistant` is the page's layering without the chrome: the `assistant.use` gate and `/status`, `ClientToolsProvider`, the base url, `useRemoteThreadListRuntime` over the single-thread adapter with the same `makeRuntimeHook`, `ClientToolRegistrations`, a header (avatar and title, "+", "Open in Assistants", hide, close), and `ConversationSurface` with a compact class. Its assistant is `resolvePanelAssistant`: the user's pick from the header menu when still accessible, else `defaultAssistant`, else the first accessible; the menu appears only with more than one accessible assistant, and a pick starts a fresh conversation under it (`panelStorage` remembers the pick). The header's history button fetches `GET /threads?assistantId=` when opened and lists the ten most recent conversations; picking one remembers it and remounts the surface on it. The model and effort start as the thread's saved choice (adopted once the thread lists) or the assistant's default, are changed from the composer's `ModelControls`, and are PATCHed to the thread. The single-thread adapter's `list()` returns the remembered thread fetched by id, or nothing (a 404 lists as nothing); `initialize()` creates the thread on the first send, and the surface reports the new id through `onThreadChange`. "+" and "Open in Assistants" forget the thread and remount the surface, so a conversation has one client at a time; the page then resumes any in-flight stream by thread id as it does for its own threads.

**The homepage composer.** `assistantsHomeModule` (the `./home` entry point, a module for this plugin) is one `HomePageWidgetBlueprint` widget, `home-page-widget:assistants/AskAssistant`, attached to the home page's public `widgets` input; the app's `page:home` `defaultConfig` places it by the name `AskAssistant`. `AskAssistantCard` reads `/status`, resolves the assistant the way the panel does, and renders one bar (avatar, text box, send) with no card header, so the widget has no `title`; it renders nothing for a user without `assistant.use`. Sending calls `usePanelControl().open({ assistantId, prompt })`: the panel wrapper provides `PanelControl` through a React context to everything it encloses, so no API or event bus is needed; `open` picks the assistant, forgets the panel's thread, opens the panel, and hands the prompt to the fresh surface, which appends it with `runtime.thread.append` once its thread list has loaded, exactly once. In an app without the panel the context is undefined and the card links to the page instead. `@backstage/plugin-home-react` is an optional peer dependency loaded only through `./home`, because a caret range on a `0.1.x` package in the plugin entry would duplicate it in a consumer on another minor.

The surface seam is `surface/index.ts`, which exports `ConversationSurface: FC<ConversationSurfaceProps>`. The props are `composerPlaceholder`, `suggestions`, `welcome`, `assistantColor`, `contextWindow`, `usedTokens`, `className`, and `composerControls`, a slot in the composer's second row (next to the attachment button) where the host renders `ModelControls`, the model and reasoning-effort pickers. The host owns the model and effort state and the thread PATCH; the page and the panel both render the pickers there, so they are in the same place on every surface. The surface reads the ambient runtime and owns no transport, auth, or chrome. The composer's attachment adapter caps files at 7 MB.

`AssistantAdminDialog` opens from the gear when `usePermission(assistantManagePermission)` allows. It loads `/manage/assistants` and `/capabilities` when it opens, edits one draft at a time, and refetches `/status` and the thread list after each save or delete.

**Duplicate core.** The history adapter is passed directly into `useAISDKRuntime`, not published through `RuntimeAdapterProvider` context. A consumer tree with two copies of `@assistant-ui/core` has two React contexts, the lookup returns undefined, and every conversation reopens blank. The adapter is created only once `remoteId` exists, so `useExternalHistory` never latches before the id resolves.

## Config and database seam

| Field                                                | Owner  | Why                                                            | Browser                                        |
| ---------------------------------------------------- | ------ | -------------------------------------------------------------- | ---------------------------------------------- |
| `providers.*.apiKey`                                 | config | Secret                                                         | no                                             |
| `providers.*` (`type`, `baseUrl`, `options`)         | config | Platform wiring                                                | no                                             |
| `providers.*.models[].contextWindow`, `reasoning`    | config | Per-model facts the picker and gauge need                      | yes                                            |
| `providers.*.models[].maxOutputTokens`               | config | Output ceiling passed to `streamText`                          | no                                             |
| `mcp.servers.*.headers`, `env`                       | config | Secret                                                         | no                                             |
| `mcp.servers.*` connection, `connectTimeoutMs`       | config | Platform wiring                                                | no                                             |
| `mcp.connectTimeoutMs`                               | config | Platform default for every server                              | no                                             |
| `requireApproval`, `mcp.servers.*.requireApproval`   | config | Safety floor; not weakenable at runtime                        | names via `/status`; badge via `/capabilities` |
| `maxSteps`, `toolResultMaxChars`, `requestBodyLimit` | config | Runtime guards                                                 | no                                             |
| `defaultModel`, `builtinActions`                     | config | Platform default; opt-in built-in actions                      | `defaultModel` only                            |
| `semanticSearch.embeddingModel`, `schedule`          | config | Platform wiring; the model's provider key stays in `providers` | no                                             |
| `definition.prompt`, `access`                        | DB     | Editable content and assignment                                | no; `/manage` only                             |
| `definition.allowedTools`                            | DB     | Editable assignment                                            | as tool summaries                              |
| `definition.title`, `description`, `color`, `ui`     | DB     | Editable content                                               | yes                                            |
| `definition.models`, `defaultModel`                  | DB     | Editable allowlist; empty means the full pool                  | yes                                            |

`/status` returns the browser-safe half: assistant summaries, each assistant's effective tools (client tools by name only, described in the browser), the model pool, the platform default, and the approval floor's tool names. Full definitions reach only the editor over `/manage/assistants`. `/chat` merges both halves: the platform instructions followed by the prompt become `instructions`, the pool resolves the model, and the floor becomes `toolApproval`.

A provider's `type` is `openai`, `anthropic`, `azure`, or `openai-compatible`; it selects the AI SDK factory, and `options` is spread verbatim into it. `openai`, `azure`, and `openai-compatible` models run on the chat-completions API. An MCP server's `transport` is `http` (default), `sse`, or `stdio`; `connectTimeoutMs` must be positive. A model id is `<providerId>:<model>`, resolved through the provider registry; the model segment may contain slashes. The pool is the union of every provider's `models[]`. The effective default is the stored one, else the platform default; with a restricted allowlist it is the stored one when listed, else the first entry.

Anthropic tool-argument normalisation runs when `resolveProviderType(modelId)` is `anthropic`, never on the provider id. A string or missing `input` on an assistant tool call is coerced to an object before the provider sees it.

The annotated YAML reference is in the [backend README](../packages/assistants-backend/README.md).

## Assistant management

```mermaid
sequenceDiagram
  participant E as Editor
  participant R as Router
  participant M as MCP pool
  participant S as AssistantStore
  participant D as Database
  E->>R: GET /capabilities
  R->>M: probe tools, 5 min cache
  R-->>E: actions, models, servers, floor
  E->>E: edit, delta-validate
  E->>R: POST or PUT /manage/assistants
  R->>R: structural validation, delta rule, default stays open
  R->>S: create or update
  S->>D: write row
  S->>S: rebuild snapshot
  E->>R: PUT /manage/assistants/:id/default
  R->>S: setDefault
  S->>D: open access, write default_assistant
  S->>S: rebuild snapshot
  E->>R: GET /status
```

| Rule                       | Behaviour                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Only live items addable    | A tool or model added relative to the previous row must exist in `/capabilities`, else `InputError`; a client tool name is checked for shape, since its live set is the browser's registry |
| Pre-existing grandfathered | Entries already on the row are never re-checked                                                                                                                                            |
| Removals always allowed    | Dropping any entry is free                                                                                                                                                                 |
| RED and AMBER              | RED: gone (action absent, model out of the pool, tool absent from a reachable server). AMBER: its server is unreachable                                                                    |
| Never auto-strip           | Save never removes stale entries; the admin prunes on demand                                                                                                                               |

Structural validation is strict: `title` and `prompt` non-empty, arrays of strings, `defaultModel` a string or null, `description` and `color` strings (`''` unsets), `ui` an object (`{}` is dropped), `access` optional and deny when absent, with `allowAuthenticated` a boolean. A changed `defaultModel` must be live or in the assistant's `models`. Create ignores any incoming `id`; `PUT` on an unknown id answers 404. `access.users` and `access.groups` are not checked for existence; a dangling ref grants nobody.

**Seed-once.** First init inserts one assistant titled `Assistant`: `allowAuthenticated: true`, `allowedTools` of `search-catalog`, `search-techdocs`, and `read-techdocs`, an empty model allowlist, and `defaultModel: null`. A `seeded` marker in `assistants_meta` is written in the same transaction and never cleared, so the seeded assistant is never resurrected. The built-in tools are skipped at `/chat` when `builtinActions` is off.

**The default assistant.** Exactly one assistant is the one every signed-in user gets. The designation is the `default_assistant` key in `assistants_meta`, a single value, so there is never more than one; the store reads it with each snapshot and `summaryFor` marks that assistant `isDefault`. `setDefault` opens the assistant (`allowAuthenticated: true`) and writes the key in one transaction. The manage routes refuse to delete it or to save it with `allowAuthenticated: false` until another is designated. The seed designates the seeded assistant; `ensureDefault` at init keeps a valid designation, else designates the oldest assistant already open to everyone (an upgrade changes nobody's access), else logs a warning and leaves none. `/status` lists the default first and names it in `defaultAssistant`. The panel opens it until the user picks another; the page rail shows it first.

The editor is a `90vh` master-detail dialog: an alphabetical list on the left, one draft on the right.

- Prompt, with the platform instructions read-only beneath it; description, colour with a live avatar preview, and per-assistant `ui` (placeholder, suggestions).
- Models from the pool with a starred default; the first added becomes the default and removing it promotes the next.
- Tools grouped by source (Backstage actions, Backstage client tools, each MCP server), each with a run-as icon, an approval badge when in the floor, and stale flags with a prune control. Client tools are offered from the tools registered in this browser; one no plugin registers any more is stale.
- Access as an "Any signed-in user" row plus user and group rows from the catalog; for the default assistant the first row is locked on.
- "Make default" (confirmed) designates the default; the list marks it with a chip, and Delete is disabled on it.
- Save is dirty-tracked; switching away with edits asks "Discard changes?"; Duplicate clones to a "(copy)" title; Delete confirms.

## Notifications

The backend publishes on the per-user channel `assistants:threads`.

| Signal          | Meaning                                        |
| --------------- | ---------------------------------------------- |
| `turn-started`  | A turn began; the conversation is working      |
| `turn-finished` | A turn ended, was stopped, or errored          |
| `updated`       | Thread metadata changed, such as an auto-title |
| `read`          | The thread was marked read in some view        |

Every indicator derives from one `GET /threads/status` snapshot. `working` is a fresh turn heartbeat on the thread; `unread` is `updated_at > last_read_at` in the database. Rollups per assistant and for `AssistantsNavIcon`: working beats unread. `AssistantsNavIcon` runs its own status subscription; the auto-registered nav entry uses the plain plugin icon and shows no status. The focused conversation shows working but never unread, and focusing it posts `/threads/:id/read`. `StatusDot` renders amber pulsing for working, solid red for unread, nothing for read.

The client refetches the snapshot 120 ms after any signal and on tab-visible, never on window focus. Without a Signals API it polls every 10 s. While any conversation is working it also polls every 5 s, because a turn that finishes on another replica may never deliver its signal. The thread list reloads 150 ms after an `updated` signal. Under polling the list reloads on each status tick, skipped on the first tick and while any turn runs, because a reload re-keys an in-flight thread.

The composer gauge shows `last_tokens` against the chosen model's `contextWindow`; without one the readout has no limit. When the history exceeds the window the composer shows "Context exceeded for the chosen model". The model picker is never filtered by context window.

## Runtime services

**MCP pool.** The plugin keeps one persistent client per configured server per process. A `coreServices.scheduler` task with local scope runs every 2 minutes with no initial delay. It connects what is not connected, re-lists tools into the cache, and drops a failed client so the next cycle reconnects; up to 5 servers refresh concurrently. Each connect and list is bounded by `connectTimeoutMs`, resolved per server, then global, then 8 s. The task's own timeout derives from the slowest server with a 60 s floor. `/status` reads the cache synchronously and opens nothing. `/capabilities` and `/manage` writes reuse a cache younger than 5 minutes and re-list otherwise, reporting `reachable` and `error` per server; a failed re-list keeps the last-known tools. `/chat` builds tool definitions from the cache and calls through the pooled client; a server with no live client returns a "not currently connected" tool result. A tool call is bounded by the turn's abort signal and a 60 s ceiling.

**Knowledge index.** With `assistants.semanticSearch` set, the database on Postgres, and the `vector` and `pg_trgm` extensions present, the module registers `search-knowledge` and a global-scope scheduler task (default every 30 minutes, 1 hour timeout, 15 s initial delay). A run embeds a probe to learn the model's dimensions and checks the signature, reads every published TechDocs site's MkDocs search index and every catalog entity except `Location` with the plugin's service credentials, chunks them, embeds only rows whose hash changed (batches of 96, one at a time), and deletes rows not seen, keeping those of entities whose site failed to load. `search-knowledge` embeds the query and up to three alternatives, then fuses by reciprocal rank (k = 60) one nearest-neighbour list per phrasing, each weighted 1/n for n phrasings; one any-word full-text list; one full-text list of the words found in three chunks or fewer; and one trigram list for query words absent from the index (word similarity ≥ 0.45), each weighted 1. Each list takes 30 candidates; query words are at least three characters, stopwords dropped, at most eight, plus up to eight adjacent pairs joined into one word, kept only when the index contains them. The top 40 candidates' entities are fetched with `getEntitiesByRefs` as the caller; chunks of entities the caller cannot read are dropped, results are deduplicated by location and title and by identical text, and the top `limit` (default 8, at most 20) are returned with 1500-character excerpts. Before the first run completes the action answers with an error pointing at keyword search: `query`, otherwise `search-techdocs` and `search-catalog`. The descriptions of `search-knowledge`, `search-catalog`, and `search-techdocs` each state the search order, since some MCP clients pass tool descriptions to the model but not server instructions. At startup the module runs `CREATE EXTENSION IF NOT EXISTS` for both extensions and stays off, logging the statements, if either is still missing; TechDocs search indexes are fetched eight at a time, and a site that answers 404 contributes nothing.

**AssistantStore snapshot.** The store keeps every definition in memory and rebuilds it after each create, update, delete, and at init. Synchronous reads (`get`, `list`) serve `/status`, the access filters, and `/threads*`. When the snapshot is older than 60 s a read starts one shared background refresh and returns immediately. `/chat` and `/manage` read the database row instead. Derived values are computed at read: `hasModelAllowlist`, effective models, and the effective default. A malformed access blob normalises to deny; malformed arrays normalise to empty.

**Stream buffer.** Before a turn reads as working, `StreamBuffer.begin` deletes the thread's previous rows and any row older than an hour, then writes an empty first row under a new turn id, so a rejoin finds the turn at once and never replays the previous one. `pipeUIMessageStreamToResponse` tees the SSE to `StreamBuffer.record`, which writes the accumulated text every 250 ms in order and a `done` row at the end, and deletes the turn's rows 60 s later. `/chat/resume/:threadId` checks thread ownership, then `follow` replays the rows by id and polls every 300 ms. It ends at `done`, when the client disconnects, when another turn id appears, or after 5 s without rows once the heartbeat is stale.

## Invariants

- The server is the only writer of message rows; the browser never persists message content.
- `New Chat` is the auto-title sentinel; a thread with any other title is never retitled.
- `threads.updated_at` moves only when a turn starts or lands.
- `/status` never opens an MCP connection and never returns a prompt or access policy.
- Safety gates live outside the database: the approval floor and runtime guards in config, management in the host's permission policy.
- Anthropic tool-argument normalisation keys on provider `type`, never on the provider id.
- Thread ownership is resolved before any side effect; a foreign thread is a plain 404.
- `allowedTools` is explicit; an empty list yields only `render_form` and `download_file`, and there is no wildcard.
- A client tool's credential is seen only by its `execute`: never a result, a request to the backend, a log, or storage.
- A client tool that is not read-only or is destructive asks for approval on every call; nothing in config or the editor can turn that off.
- A knowledge index result reaches the model only if the caller can read its entity in the catalog.
- There is never more than one default assistant, and while designated it is open to every signed-in user; nothing in the manage API can delete or close it.
