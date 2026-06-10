# backstage-assistants

A Backstage plugin that adds an in-portal AI chat experience. It stitches assistant-ui (chat UI) and the Vercel AI SDK (model + tool loop) into Backstage, exposing the Backstage Actions registry as the model's tools, executed with the calling user's own credentials.

## Language

**Assistant**:
A configured persona — its system prompt, access policy, tool allowlist, allowed models, and UI options. The single user-facing and canonical domain concept; what a user picks in the rail and chats with.
_Avoid_: Agent, Bot, Persona

**Profile**:
Not a config concept. Assistant definitions live in the plugin DB (the `assistants` table) and are edited in the in-app admin editor — not config. There is no `profiles` config key.
_Avoid_: using "profile" to mean a distinct domain object, or a `profiles` config block

**Agent**:
Not a v1 concept. Deliberately excluded to avoid ambiguity with Assistant.
_Avoid_: introducing "agent" anywhere in config, code, or UI

**Action**:
An entry in the Backstage Actions registry (a schema + handler), registered in-process via `actionsRegistryServiceRef`. The tool primitive. Not auto-populated by core Backstage — actions exist only when a plugin registers them (this plugin's core actions, or others). Consumed in-process via `actions.list`/`actions.invoke`; never over MCP for `/chat`.
_Avoid_: Tool (at the config/registry layer — see Tool)

**Tool**:
An AI SDK `tool()` handed to the model loop. Produced by adapting an Action that is in both the Assistant's allowlist and the caller's visible set. "Tool" is the model-facing word; "Action" is the Backstage-registry word for the same underlying capability.

**Allowlist**:
The Assistant's unified `allowedTools: string[]` — the set of tools it is permitted to offer. Each entry is a bare Backstage action id or a namespaced `<serverId>__<tool>` MCP tool; explicit only, no wildcard. **Empty = no tools** (careful-by-default; never an implicit "all"). One of the two independent gates.

**Effective tools**:
What the model actually receives for a request, resolved per turn from the Assistant's `allowedTools`. Backstage action entries are intersected with the actions the caller can see (the two gates); MCP-tool entries are added directly — they run as a configured shared credential (not the calling user), so there is no per-user gate on that path.

**Two gates**:
The two independent authorization checks (Backstage action tools). (1) The Assistant **Allowlist** — the `allowedTools` entries that name Backstage actions. (2) **User authorization** — what this user may do, enforced by Backstage: coarse (per-action `visibilityPermission`) for free at `actions.list({ credentials })`, fine-grained (per-resource/ownership) for free at `actions.invoke` because every Backstage action runs as the user. MCP tools in `allowedTools` bypass this user gate — they run as the configured shared server credential, not the caller.

**Approval gate**:
A GLOBAL config floor of tool ids that must be confirmed — an explicit Allow/Deny in chat — before they run: the top-level `assistants.requireApproval` (action ids) ∪ each per-server `mcp.servers.*.requireApproval` (tool names). The per-turn approval set = this floor ∩ the Assistant's `allowedTools`. Sets the AI SDK `needsApproval` flag so execution is paused **deterministically in the loop**, a human checkpoint enforced in code, not a model prompt. Not per-Assistant; config-only, so runtime assistant-editing can never weaken it. Orthogonal to the two gates and to authorization: it withholds execution pending consent; it never grants access. Backstage's per-user permissions still apply when an approved tool invokes.
_Avoid_: treating it as authorization (it is a checkpoint, not a permission), or as a per-Assistant setting

**Interactive form** (`render_form`):
A client-side tool the model calls to render an RJSF form inline in chat for human-in-the-loop input, instead of asking several questions in prose. No server `execute`: the model composes the form (JSON Schema + uiSchema), the surface renders it through scaffolder's RJSF `<Form>` plus the host app's field-extension registry — so owner/entity/repo pickers and any custom scaffolder field render by name — and the user's submit becomes the tool result. Always available; not config-gated. The in-plugin generative UI, distinct from the broader **gen-ui library**.
_Avoid_: a bespoke form widget — it reuses scaffolder's fields

**Conversation**:
A single chat session with one Assistant — its ordered messages. The user-facing term. Owned by exactly one Assistant; ownership is immutable (a conversation can never move to another Assistant). Persists server-side in the plugin's own database, scoped to the owning user, and reaches the browser only through assistant-ui's remote thread-list + history adapters — the frontend is a pure view, holding no conversation state of its own. Lists are siloed per Assistant — no unified cross-Assistant view.
_Avoid_: Chat, Session (as a noun for stored history)

**Thread**:
assistant-ui's internal name for a Conversation. Use "Thread" only when referring to assistant-ui runtime APIs (thread-list runtime, `ThreadPrimitive`); use "Conversation" everywhere user-facing.

**Provider**:
A configured connection to an LLM backend (`assistants.providers.{id}`). Carries a `type` discriminator selecting the AI-SDK factory (`openai` | `anthropic` | `azure` | `openai-compatible`), `apiKey` (secret), a passthrough `options` bag spread verbatim into that factory, and `models[]`. The `id` is a free label that namespaces model ids. We wire the factory; we never implement a provider.
_Avoid_: Adapter (we don't write one — the `@ai-sdk/*` package is the provider)

**Model id**:
A `<providerId>:<model>` string (e.g. `myAzure:gpt-4o`, `openrouter:anthropic/claude-sonnet-4`) used everywhere a model is named — `defaultModel`, per-Assistant allowlist, the picker — and resolved through the AI-SDK provider registry. Note the model segment may itself contain slashes.

**Model pool**:
The union of every Provider's `models[]`. The global set of selectable models; an Assistant's `models[]` allowlist is a subset of it.

**Conversation surface**:
The inner chat component — message list, composer, tool-call rendering, approval Allow/Deny, and generative UI (interactive RJSF forms). It consumes an assistant-ui runtime from context and owns no transport/auth/chrome. The plugin owns its **own** surface in-repo (seeded from the assistant-ui registry template); gen-ui owns a parallel one. They are kept swappable by the **surface seam**, not a shared dependency. Distinct from the **chrome**.
_Avoid_: chat window (ambiguous — say "surface" for the replaceable unit, "chrome" for the frame)

**Surface seam**:
The single component boundary at which a conversation surface plugs in: a BYO-runtime `ConversationSurface: FC<ConversationSurfaceProps>` rendered inside the host's `AssistantRuntimeProvider`. The host owns runtime/transport/auth/chrome; the surface owns only presentation and reads the ambient runtime. Props are a thin, forward-compatible presentational bag (`composerPlaceholder`, `suggestions`, `welcome`, `className`). Routed through a `surface/` indirection module so swapping the plugin's in-repo surface for gen-ui's is one import. This is assistant-ui's native runtime/surface split — not a custom abstraction.

**Chrome**:
The Backstage-side frame around the Conversation surface: assistant rail, conversation list, header model picker. Owned by the `backstage-assistants` plugin, not the gen-ui library.

**gen-ui library** (`@drewswiredin/gen-ui`):
The standalone, publishable library that owns *its* Conversation surface + generative-UI machinery (iframe artifacts, OpenUI, mermaid, trusted-component allowlist). BYO-runtime core + a minimal OpenAI-compatible/OpenRouter wrapper. Agent-agnostic — no Mastra. Consumed by its own demo app. **Not a dependency of the plugin**: the two share only a copy-paste starting point and the **surface seam**, so a matured gen-ui can drop in via one import without ever being a build-time coupling.

**Access policy**:
The per-Assistant rule deciding who may use it (`allowAuthenticated` / `users[]` / `groups[]`). Deny by default. Distinct from per-tool permissions.
_Avoid_: permissions (reserve that for the per-tool Backstage permission checks)
