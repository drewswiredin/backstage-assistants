/**
 * Browser-safe shared types for the Backstage AI Assistants plugin.
 *
 * Its one runtime dependency is `@backstage/plugin-permission-common`, for the
 * shared {@link assistantUsePermission} / {@link assistantManagePermission}
 * definitions. The app-config shape (providers, prompts, secrets,
 * the safety floor) lives in the backend's `config.d.ts` and its typed config
 * reader — never here. Assistant *definitions* live in the plugin database (the
 * `assistants` table, edited at runtime via the admin API/editor); their
 * canonical shape is {@link AssistantDefinition}, shared here because both the
 * backend store/manage API and the frontend editor consume it.
 *
 * This package declares what the backend may send to the browser (the
 * `/status` payload via {@link AssistantSummary}), the canonical assistant
 * definition ({@link AssistantDefinition}) used by the store / `/manage` API /
 * editor, and the live capability inventory ({@link CapabilitiesResponse}) that
 * feeds the editor's pickers.
 *
 * @packageDocumentation
 */

export * from './permissions';

/** Identifier for a configured assistant. @public */
export type AssistantId = string;

/**
 * Identifier for a model in `provider:model` format, e.g.
 * `"anthropic:claude-sonnet-4"`. The model segment may itself contain slashes
 * (e.g. `"openrouter:anthropic/claude-sonnet-4"`).
 *
 * @public
 */
export type ModelId = string;

/**
 * UI options for an assistant's chat surface.
 *
 * Used two ways: as the per-assistant `ui` stored on an
 * {@link AssistantDefinition}, and as the resolved value returned in
 * {@link AssistantSummary.ui} via `/status`. The resolved value is computed per
 * assistant as `deepMerge(global ui, assistant.ui)`: objects deep-merge, arrays
 * (e.g. `suggestions`) replace so an assistant can clear inherited values.
 *
 * @public
 */
export interface UiOptions {
  /** Composer (message input) options. */
  composer?: {
    /** Placeholder text shown in the empty message input. */
    placeholder?: string;
  };
  /** Starter prompt chips offered on an empty conversation. */
  suggestions?: Array<{
    /** Short label shown on the suggestion chip. */
    title: string;
    /** The text submitted when the chip is clicked. */
    prompt: string;
  }>;
}

/**
 * A tool (Backstage action) exposed to the browser for an assistant.
 *
 * @public
 */
export interface ToolSummary {
  /** The tool's id as the model sees it (MCP tools are namespaced `<src>__<tool>`). */
  name: string;
  /** Human-readable description of what the tool does (for tooltips/detail). */
  description?: string;
  /**
   * Where the tool comes from: `"backstage"` for built-in Backstage actions
   * (run as the calling user), or the configured MCP server id for MCP tools.
   * Used to group tools by source in the UI.
   */
  source?: string;
}

/**
 * Browser-safe projection of an assistant the caller may access.
 *
 * Prompts and access policies are deliberately excluded — they never leave the
 * backend. Models/defaultModel are the per-assistant allowlist projection (the
 * picker is limited to these); `ui` is the resolved, deep-merged value.
 *
 * @public
 */
export interface AssistantSummary {
  /** Identifier for the configured assistant. */
  id: AssistantId;
  /** Display title shown in the assistant rail and welcome. */
  title: string;
  /** Optional description shown in the assistant list / welcome. */
  description?: string;
  /**
   * Optional brand hex color (e.g. `"#c2410c"`) used to tint the assistant's
   * avatar in the nav. Purely cosmetic; sourced from the assistant definition.
   */
  color?: string;
  /**
   * The `provider:model` ids this assistant may use (its allowlist projected
   * from the global pool). Omitted when the assistant allows the full pool
   * (the derived `hasModelAllowlist` is false).
   */
  models?: ModelId[];
  /** This assistant's default `provider:model` selection. */
  defaultModel?: ModelId;
  /**
   * The tools (Backstage actions) available to the caller for this assistant —
   * its allowlist intersected with the actions this user may see (resolved
   * wildcard included). Name + description; no schemas.
   */
  tools?: ToolSummary[];
  /** Resolved UI options (deep-merge of global + per-assistant `ui`). */
  ui?: UiOptions;
}

/**
 * How hard a reasoning-capable model should think before answering — relative
 * effort, mapped to each provider's own knob server-side (OpenAI/Azure
 * `reasoningEffort`, Anthropic thinking budget).
 *
 * The same four tiers apply to every reasoning model: config only says WHETHER
 * a model reasons (`reasoning: true`), never which tiers it has. Sending no
 * level at all is always valid and leaves the provider's own default in force —
 * that, not a level, is how you opt out of tuning.
 *
 * @public
 */
export type ReasoningLevel = 'low' | 'medium' | 'high' | 'xhigh';

/** Every {@link ReasoningLevel}, in ascending order of effort. @public */
export const REASONING_LEVELS: ReasoningLevel[] = [
  'low',
  'medium',
  'high',
  'xhigh',
];

/**
 * A single selectable model in the global model pool.
 *
 * @public
 */
export interface ModelOption {
  /** Full `provider:model` id, e.g. `"anthropic:claude-sonnet-4"`. */
  id: ModelId;
  /** Provider id, e.g. `"anthropic"`. */
  provider: string;
  /** Model name, e.g. `"claude-sonnet-4"`. */
  model: string;
  /**
   * Context-window size in tokens (max input), if known from config. Drives the
   * composer's context-usage gauge; absent means the limit is unknown (the gauge
   * shows the token count without a percentage).
   */
  contextWindow?: number;
  /**
   * True when this model reasons, i.e. offers the {@link REASONING_LEVELS}
   * effort tiers. False/absent means no reasoning control — the chat hides the
   * effort picker and turns run at the provider's default.
   */
  reasoning?: boolean;
}

/**
 * Payload returned by `GET /api/assistants/status`.
 *
 * Assistants are filtered to those the caller may access. The model pool and
 * default selection are global; each assistant carries its own (possibly
 * narrower) model allowlist and default. Stays browser-safe — never a prompt or
 * access policy.
 *
 * @public
 */
export interface StatusResponse {
  assistants: AssistantSummary[];
  models: ModelOption[];
  defaultModel: ModelId;
}

/**
 * Request body for `POST /title` (and `POST /chat`). Tools/actions are never
 * accepted from the client — they are resolved server-side per turn.
 *
 * @public
 */
export interface TitleRequest {
  /** Id of the assistant to converse with. */
  assistantId: AssistantId;
  /** The `provider:model` id to use for this turn. */
  modelId: ModelId;
  /**
   * How hard the model should think on this turn. Only meaningful for a model
   * flagged {@link ModelOption.reasoning}; otherwise ignored server-side and the
   * provider's default applies.
   */
  reasoningLevel?: ReasoningLevel;
  /** The conversation as a non-empty array of UI messages. */
  messages: unknown[];
}

/**
 * Response returned by `POST /title`.
 *
 * @public
 */
export interface TitleResponse {
  /** The generated (or fallback) conversation title. */
  title: string;
}

/**
 * Access policy for an assistant — who may converse with it.
 *
 * Evaluated server-side with the ownership-ref check (`userEntityRef` /
 * `ownershipEntityRefs`) and default-deny: with `allowAuthenticated` false and
 * no `users` / `groups`, nobody but a matching ref may access it. Users/groups
 * are entity refs (e.g. `"user:default/jane"`, `"group:default/team-a"`);
 * dangling refs simply grant nobody. Never leaves the backend (excluded from
 * {@link AssistantSummary}).
 *
 * @public
 */
export interface AssistantAccess {
  /** When true, any signed-in user may access the assistant. */
  allowAuthenticated: boolean;
  /** Entity refs of individual users granted access. */
  users: string[];
  /** Entity refs of groups whose members are granted access. */
  groups: string[];
}

/**
 * The canonical assistant definition — one row of the plugin `assistants`
 * table, the shape mutated through the admin `/manage/assistants` API and
 * edited in the admin editor.
 *
 * This is the single source of truth for an assistant's content and
 * assignment; the browser-safe {@link AssistantSummary} is a projection of it
 * (no prompt, no access). Persisted as `definition_json` TEXT
 * (`JSON.stringify`, portable across SQLite/Postgres — not pg `jsonb`); the
 * `id` and `title` are also mirrored to columns.
 *
 * Derived-at-read values are NOT stored: `hasModelAllowlist = models.length > 0`;
 * effective models = the allowlist or the full pool; effective default model =
 * `defaultModel ?? platform default`. The approval set is global and computed at
 * read — the intersection of the global `requireApproval` floor (∪ per-server
 * `requireApproval`, namespaced `<serverId>__<tool>`) with `allowedTools` — so
 * there is no per-assistant approval field.
 *
 * @public
 */
export interface AssistantDefinition {
  /** Server-generated UUID, primary key, immutable. */
  id: AssistantId;
  /** Display title (editable; mirrored to a column for admin-list sorting). */
  title: string;
  /** Optional description shown in the assistant list / welcome. */
  description?: string;
  /** Optional brand hex color (e.g. `"#c2410c"`) for the assistant's avatar. */
  color?: string;
  /** The system prompt. Never leaves the backend. */
  prompt: string;
  /** Who may converse with this assistant. Never leaves the backend. */
  access: AssistantAccess;
  /**
   * Unified tool allowlist: bare Backstage action ids (run as the user) and
   * namespaced `<serverId>__<tool>` MCP tools (run as the configured server
   * credential). Resolved at `/chat` by splitting each entry; unknown entries
   * are tolerated (skipped).
   */
  allowedTools: string[];
  /**
   * The `provider:model` ids this assistant may use — an allowlist over the
   * global pool. Empty array means the full pool is allowed.
   */
  models: ModelId[];
  /**
   * The assistant's default `provider:model`, or `null` to fall back to the
   * platform default at read time.
   */
  defaultModel: ModelId | null;
  /** Optional per-assistant UI (deep-merged over the global `ui` at read). */
  ui?: UiOptions;
  /** Audit: entity ref of the creator (present in the manage view). */
  created_by?: string;
  /** Audit: ISO-8601 creation timestamp (present in the manage view). */
  created_at?: string;
  /** Audit: entity ref of the last editor (present in the manage view). */
  updated_by?: string;
  /** Audit: ISO-8601 last-edit timestamp (present in the manage view). */
  updated_at?: string;
}

/**
 * A Backstage action offered as an assignable tool in the editor — derived from
 * `actions.list(credentials)` scoped to the admin's visibility.
 *
 * @public
 */
export interface CapabilityAction {
  /** The action id (a bare, non-namespaced `allowedTools` entry). */
  id: string;
  /** Human-readable description of what the action does. */
  description?: string;
}

/**
 * One MCP server's reachability + tool inventory for the editor pickers,
 * derived from the cached `probeServerTools` probe. Per-server reachability is
 * surfaced rather than silently empty on failure: an unreachable server yields
 * `reachable: false` with `error` set and no `tools`.
 *
 * @public
 */
export interface McpServerCapability {
  /** The configured MCP server id (the `<serverId>` prefix of namespaced tools). */
  id: string;
  /** Whether the server was reachable when the inventory was built/cached. */
  reachable: boolean;
  /** The failure message when `reachable` is false. */
  error?: string;
  /** The server's advertised tools (empty when unreachable). */
  tools: Array<{
    /** The bare tool name (namespaced to `<serverId>__<name>` in `allowedTools`). */
    name: string;
    /** Human-readable description of what the tool does. */
    description?: string;
  }>;
}

/**
 * Payload returned by `GET /api/assistants/capabilities` (admin-gated) — the
 * live, assignable inventory that feeds the editor's pickers. Pickers offer
 * only live items; new additions are validated against this, pre-existing
 * assignments are grandfathered.
 *
 * @public
 */
export interface CapabilitiesResponse {
  /** Assignable Backstage actions (bare ids). */
  actions: CapabilityAction[];
  /** The global `provider:model` pool. */
  models: ModelOption[];
  /** MCP servers with reachability + tool inventories. */
  mcpServers: McpServerCapability[];
  /**
   * Tool ids in the global approval floor: the top-level `requireApproval`
   * action ids ∪ each MCP server's per-server `requireApproval` namespaced
   * `<serverId>__<tool>`. The editor flags any assigned tool in this set; the
   * effective per-turn approval set is this ∩ the assistant's `allowedTools`.
   */
  requireApproval: string[];
}
