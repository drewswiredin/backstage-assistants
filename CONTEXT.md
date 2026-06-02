# backstage-assistants

A Backstage plugin that adds an in-portal AI chat experience. It stitches assistant-ui (chat UI) and the Vercel AI SDK (model + tool loop) into Backstage, exposing the Backstage Actions registry as the model's tools, executed with the calling user's own credentials.

## Language

**Assistant**:
A configured persona — its system prompt, access policy, tool allowlist, allowed models, and UI options. The single user-facing and canonical domain concept; what a user picks in the rail and chats with.
_Avoid_: Agent, Bot, Persona

**Profile**:
The YAML location that defines an Assistant (`assistants.profiles.{id}`). A naming-only term for the config entry — not a separate runtime concept from Assistant.
_Avoid_: using "profile" to mean a distinct domain object

**Agent**:
Not a v1 concept. Deliberately excluded to avoid ambiguity with Assistant.
_Avoid_: introducing "agent" anywhere in config, code, or UI

**Action**:
An entry in the Backstage Actions registry (a schema + handler), registered in-process via `actionsRegistryServiceRef`. The tool primitive. Not auto-populated by core Backstage — actions exist only when a plugin registers them (this plugin's core actions, or others). Consumed in-process via `actions.list`/`actions.invoke`; never over MCP for `/chat`.
_Avoid_: Tool (at the config/registry layer — see Tool)

**Tool**:
An AI SDK `tool()` handed to the model loop. Produced by adapting an Action that is in both the Assistant's allowlist and the caller's visible set. "Tool" is the model-facing word; "Action" is the Backstage-registry word for the same underlying capability.

**Allowlist**:
The Assistant's `actions[]` config — the set of Actions it is permitted to offer as tools. Explicit action names, or a wildcard. **Omitting it = no tools** (careful-by-default; never an implicit "all"). One of the two independent gates.

**Effective tools**:
What the model actually receives for a request = `Allowlist ∩ actions the caller can see`. The intersection of the two gates, computed per request.

**Two gates**:
The two independent authorization checks. (1) The Assistant **Allowlist** — what this Assistant may offer. (2) **User authorization** — what this user may do, enforced by Backstage: coarse (per-action `visibilityPermission`) for free at `actions.list({ credentials })`, fine-grained (per-resource/ownership) for free at `actions.invoke` because every tool runs as the user.

**Conversation**:
A single chat session with one Assistant — its ordered messages. The user-facing term. Owned by exactly one Assistant; ownership is immutable (a conversation can never move to another Assistant). Persists in the browser, not the server (ADR 0001), in a per-Assistant list keyed by `assistantId`. Lists are strictly siloed per Assistant — no unified cross-Assistant view. User scoping is implicit (the browser is the user boundary; nothing is user-keyed).
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
The inner chat component — message list, composer, tool-call rendering, and (later) generative UI. It consumes an assistant-ui runtime from context and owns no transport/auth/chrome. The plugin owns its **own** surface in-repo (seeded from the assistant-ui registry template); gen-ui owns a parallel one. They are kept swappable by the **surface seam**, not a shared dependency (ADR 0005). Distinct from the **chrome**.
_Avoid_: chat window (ambiguous — say "surface" for the replaceable unit, "chrome" for the frame)

**Surface seam**:
The single component boundary at which a conversation surface plugs in: a BYO-runtime `ConversationSurface: FC<ConversationSurfaceProps>` rendered inside the host's `AssistantRuntimeProvider`. The host owns runtime/transport/auth/chrome; the surface owns only presentation and reads the ambient runtime. Props are a thin, forward-compatible presentational bag (`composerPlaceholder`, `suggestions`, `welcome`, `className`). Routed through a `surface/` indirection module so swapping the plugin's in-repo surface for gen-ui's is one import (ADR 0005). This is assistant-ui's native runtime/surface split — not a custom abstraction.

**Chrome**:
The Backstage-side frame around the Conversation surface: assistant rail, conversation list, header model picker. Owned by the `backstage-assistants` plugin, not the gen-ui library.

**gen-ui library** (`@drewswiredin/gen-ui`):
The standalone, publishable library that owns *its* Conversation surface + generative-UI machinery (iframe artifacts, OpenUI, mermaid, trusted-component allowlist). BYO-runtime core + a minimal OpenAI-compatible/OpenRouter wrapper. Agent-agnostic — no Mastra. Consumed by its own demo app. **Not a dependency of the plugin** (ADR 0005): the two share only a copy-paste starting point and the **surface seam**, so a matured gen-ui can drop in via one import without ever being a build-time coupling.

**Access policy**:
The per-Assistant rule deciding who may use it (`allowAuthenticated` / `users[]` / `groups[]`). Deny by default. Distinct from per-tool permissions.
_Avoid_: permissions (reserve that for the per-tool Backstage permission checks)
