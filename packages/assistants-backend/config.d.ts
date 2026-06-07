/**
 * App-config schema for the Backstage AI Assistants backend plugin.
 *
 * Source of truth for the `assistants` config block — it drives Backstage's
 * app-config validation and visibility/secret enforcement at startup, and is
 * referenced from `package.json` via `"configSchema": "config.d.ts"`.
 *
 * Backstage's config-schema loader requires this file to export ONLY the
 * `Config` interface, so every supporting shape is inlined below rather than
 * declared as a separate exported interface.
 *
 * Visibility: every field here is backend-only by default (never bundled to the
 * frontend). The browser receives only the projection the plugin serves over
 * `GET /status` — assistant titles/descriptions, the model pool + defaults, and
 * the resolved `ui`. `apiKey` is additionally `@visibility secret` so it is
 * redacted everywhere (logs, frontend, etc.).
 *
 * Theme is intentionally NOT configurable: the chat uses one built-in palette
 * that follows Backstage's light/dark mode automatically.
 *
 * Note: `backend.actions.pluginSources` is owned by Backstage core (the actions
 * service config), not this schema, so it is intentionally not declared here.
 */
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
     * Maximum characters of a single tool result passed to the model (and
     * persisted in the conversation). Oversized results (e.g. a multi-MB code
     * search) are truncated to the head + tail with an elision marker so one
     * huge tool output can't overflow the model's context window or bloat the
     * stored history. Set to `0` to disable truncation. Defaults to 30000
     * (~7.5k tokens).
     */
    toolResultMaxChars?: number;

    /**
     * Register the built-in catalog/search/TechDocs actions under the
     * `assistants` source. Defaults to false.
     */
    registerCoreActions?: boolean;

    /**
     * External MCP (Model Context Protocol) servers whose tools are exposed to
     * assistants. Each server is connected with a static credential (the
     * configured `headers`) — i.e. one shared identity for all users (not yet
     * run-as-user). Assistants opt in per profile via `mcpServers`.
     */
    mcp?: {
      servers?: {
        [serverId: string]: {
          /**
           * Transport. `http` = Streamable HTTP, `sse` = Server-Sent Events,
           * `websocket` = WebSocket (all remote, use `url`); `stdio` spawns a
           * local process (use `command`). Defaults to `http`.
           */
          transport?: 'http' | 'sse' | 'websocket' | 'stdio';
          /** Endpoint URL for remote transports (http/sse/websocket). */
          url?: string;
          /**
           * Headers sent on every request (http/sse), e.g. an `Authorization`
           * bearer. Treat as secret.
           *
           * @visibility secret
           */
          headers?: { [name: string]: string };
          /** stdio: executable to spawn (e.g. `npx`, `node`, `docker`). */
          command?: string;
          /** stdio: arguments for the command. */
          args?: string[];
          /**
           * stdio: extra environment for the child process, merged over a safe
           * default env. Treat as secret.
           *
           * @visibility secret
           */
          env?: { [name: string]: string };
          /** stdio: working directory for the child process. */
          cwd?: string;
        };
      };
    };

    /**
     * LLM providers available to the plugin. One connection per provider id; the
     * union of all `models` forms the global model pool.
     */
    providers: {
      [providerId: string]: {
        /**
         * The AI-SDK factory to instantiate for this provider. Selects the
         * `@ai-sdk/*` package used to build the connection; model ids are
         * `<providerId>:<model>`.
         */
        type: 'openai' | 'anthropic' | 'azure' | 'openai-compatible';

        /**
         * Provider API key.
         *
         * @visibility secret
         */
        apiKey: string;

        /** Optional override for the provider base URL. */
        baseUrl?: string;

        /**
         * Untyped passthrough connection options, spread verbatim into the
         * selected AI-SDK factory. Exposes each provider's full native
         * connection surface without schema maintenance. Not
         * field-validated by Backstage's config schema.
         */
        options?: { [key: string]: unknown };

        /** Models exposed by this provider, e.g. `["gpt-5.5", "gpt-4o-mini"]`. */
        models: string[];

        /**
         * Optional per-model context-window sizes (max input tokens), keyed by
         * the model name as it appears in `models`. Surfaced to the UI to render
         * a context-usage gauge. Omit a model to leave its limit unknown.
         * e.g. `{ "gpt-5.5": 400000 }`.
         */
        contextWindows?: { [modelName: string]: number };
      };
    };

    /**
     * Global UI defaults, deep-merged into every profile's `ui`. Browser-safe.
     */
    ui?: {
      composer?: {
        /** Placeholder text shown in the empty message input. */
        placeholder?: string;
      };
      /** Starter prompts offered on an empty conversation. */
      suggestions?: Array<{
        /** Short label shown on the suggestion chip. */
        title: string;
        /** The text submitted when the chip is clicked. */
        prompt: string;
      }>;
    };

    /**
     * Configured assistant profiles, keyed by id. At least one must be defined.
     */
    profiles: {
      [profileId: string]: {
        /** Display title (shown in the assistant picker and welcome). */
        title: string;

        /** Short description shown in the assistant list / welcome. */
        description?: string;

        /**
         * Optional brand hex color (e.g. `"#c2410c"`) used to tint the
         * assistant's avatar in the nav. Purely cosmetic; browser-safe.
         */
        color?: string;

        /**
         * System prompt for this assistant. Backend-only; never sent to the
         * browser.
         */
        prompt: string;

        /** Access policy controlling who may use this profile. */
        access: {
          /** Any signed-in user may access this assistant. */
          allowAuthenticated?: boolean;
          /** Entity refs of users granted access (e.g. `user:default/jdoe`). */
          users?: string[];
          /** Entity refs of groups granted access (e.g. `group:default/platform`). */
          groups?: string[];
        };

        /**
         * Allowlist of Backstage action names exposed as tools for this profile.
         * Resolved per request from the actions registry, scoped to the caller.
         */
        actions?: string[];

        /**
         * MCP servers (from `assistants.mcp.servers`) this assistant exposes.
         * Each entry is a server id string (all of that server's tools) or an
         * object selecting a subset. Tools are namespaced `<serverId>__<tool>`.
         *
         * `tools`: omitted or `['*']` = all tools; `[]` = none; otherwise exactly
         * the named (un-namespaced) tools.
         */
        mcpServers?: Array<
          | string
          | {
              /** A configured `assistants.mcp.servers` id. */
              server: string;
              /** Allowlist of un-namespaced tool names (see above). */
              tools?: string[];
            }
        >;

        /**
         * Allowlist of `provider:model` ids this profile may use — a subset of
         * the global pool. Omit to allow the full pool.
         */
        models?: string[];

        /**
         * This profile's default model (`provider:model`). Must be within this
         * profile's `models` allowlist. Required when the allowlist excludes the
         * global `assistants.defaultModel`.
         */
        defaultModel?: string;

        /** Per-profile UI overrides, deep-merged over the global `assistants.ui`. */
        ui?: {
          composer?: {
            placeholder?: string;
          };
          suggestions?: Array<{
            title: string;
            prompt: string;
          }>;
        };
      };
    };
  };
}
