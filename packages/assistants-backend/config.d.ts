/**
 * App-config schema for the Backstage AI Assistants backend plugin.
 *
 * Source of truth for the `assistants` config block — it drives Backstage's
 * app-config validation and visibility/secret enforcement at startup, and is
 * referenced from `package.json` via `"configSchema": "config.d.ts"`.
 *
 * Visibility: every field here is backend-only by default (never bundled to the
 * frontend). The browser receives only the projection the plugin serves over
 * `GET /status` — assistant titles/descriptions, the model pool + defaults, and
 * the resolved `ui`. `apiKey` is additionally `@visibility secret` so it is
 * redacted everywhere (logs, frontend, etc.).
 *
 * Note: `backend.actions.pluginSources` is owned by Backstage core (the actions
 * service config), not this schema, so it is intentionally not declared here.
 */

/**
 * UI options for the chat surface. Set globally under `assistants.ui` and/or per
 * profile under `assistants.profiles.<id>.ui`; the effective value is a
 * deep-merge of the two — objects merge, arrays (e.g. `suggestions`) replace, so
 * a profile can clear inherited values. The resolved value is browser-safe and
 * returned via `/status`.
 *
 * Theme is intentionally NOT here: the chat uses one built-in palette that
 * follows Backstage's light/dark mode automatically.
 */
export interface AssistantsUiOptions {
  composer?: {
    /** Placeholder text shown in the empty message input. */
    placeholder?: string;
  };
  /** Starter prompts offered on an empty conversation. */
  suggestions?: Array<{
    /** Short label shown on the suggestion chip. */
    title: string;
    /** Optional secondary line under the title. */
    label?: string;
    /** The text submitted when the chip is clicked. */
    prompt: string;
  }>;
}

/**
 * Access policy controlling which users may use an assistant profile. Evaluated
 * per request against the caller's resolved identity. Deny by default — none of
 * the three granting nobody.
 */
export interface AssistantsAccessPolicy {
  /** Any signed-in user may access this assistant. */
  allowAuthenticated?: boolean;
  /** Entity refs of users granted access (e.g. `user:default/jdoe`). */
  users?: string[];
  /** Entity refs of groups granted access (e.g. `group:default/platform`). */
  groups?: string[];
}

/** A single configured assistant profile. */
export interface AssistantProfileConfig {
  /** Display title (shown in the assistant picker and welcome). */
  title: string;

  /** Short description shown in the assistant list / welcome. */
  description?: string;

  /**
   * System prompt for this assistant. Backend-only; never sent to the browser.
   */
  prompt: string;

  /** Access policy controlling who may use this profile. */
  access: AssistantsAccessPolicy;

  /**
   * Allowlist of Backstage action names exposed as tools for this profile.
   * Resolved per request from the actions registry, scoped to the caller.
   */
  actions?: string[];

  /**
   * Allowlist of `provider:model` ids this profile may use — a subset of the
   * global pool (`providers.*.models`). Omit to allow the full pool. Lets a
   * profile be restricted to specific (e.g. cheaper) models.
   */
  models?: string[];

  /**
   * This profile's default model (`provider:model`). Must be within this
   * profile's `models` allowlist. Required when the allowlist excludes the
   * global `assistants.defaultModel`.
   */
  defaultModel?: string;

  /** Per-profile UI overrides, deep-merged over the global `assistants.ui`. */
  ui?: AssistantsUiOptions;
}

export interface Config {
  assistants?: {
    /**
     * Initial model selection in `provider:model` format, e.g. `openai:gpt-5.5`.
     * Must be one of the configured provider models. The user may change it.
     */
    defaultModel: string;

    /** Maximum number of tool-call steps per turn. Defaults to 10. */
    maxSteps?: number;

    /**
     * Register the built-in catalog/search/TechDocs actions under the
     * `assistants` source. Defaults to false.
     */
    registerCoreActions?: boolean;

    /**
     * LLM providers available to the plugin. One connection per provider id; the
     * union of all `models` forms the global model pool.
     */
    providers: {
      [providerId: string]: {
        /**
         * Provider API key.
         *
         * @visibility secret
         */
        apiKey: string;

        /** Optional override for the provider base URL. */
        baseUrl?: string;

        /** Models exposed by this provider, e.g. `["gpt-5.5", "gpt-4o-mini"]`. */
        models: string[];
      };
    };

    /**
     * Global UI defaults, deep-merged into every profile's `ui`. Browser-safe.
     */
    ui?: AssistantsUiOptions;

    /**
     * Configured assistant profiles, keyed by id. At least one must be defined.
     */
    profiles: {
      [profileId: string]: AssistantProfileConfig;
    };
  };
}
