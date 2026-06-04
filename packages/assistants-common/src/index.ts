/**
 * Browser-safe shared types for the Backstage AI Assistants plugin.
 *
 * No runtime dependencies. The app-config shape (providers, profiles, prompts,
 * access policies, secrets) lives in the backend's `config.d.ts` and its typed
 * config reader — never here. This package only declares what the backend is
 * allowed to send to the browser (the `/status` payload).
 *
 * @packageDocumentation
 */

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
 * Resolved, browser-safe UI options for an assistant's chat surface.
 *
 * Computed per assistant as `deepMerge(global ui, profile.ui)`: objects
 * deep-merge, arrays (e.g. `suggestions`) replace so a profile can clear
 * inherited values. Returned in {@link AssistantSummary.ui} via `/status`.
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
   * avatar in the nav. Purely cosmetic; sourced from per-profile config.
   */
  color?: string;
  /**
   * The `provider:model` ids this assistant may use (its allowlist projected
   * from the global pool). Omitted when the assistant allows the full pool.
   */
  models?: ModelId[];
  /** This assistant's default `provider:model` selection. */
  defaultModel?: ModelId;
  /**
   * Names of the tools (Backstage actions) available to the caller for this
   * assistant — its allowlist intersected with the actions this user may see
   * (resolved wildcard included). Names only; no schemas/descriptions.
   */
  tools?: string[];
  /** Resolved UI options (deep-merge of global + per-profile `ui`). */
  ui?: UiOptions;
}

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
}

/**
 * Payload returned by `GET /api/assistants/status`.
 *
 * Assistants are filtered to those the caller may access. The model pool and
 * default selection are global; each assistant carries its own (possibly
 * narrower) model allowlist and default.
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
