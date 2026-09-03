/**
 * App-config schema for the Backstage AI Assistants backend plugin.
 *
 * Source of truth for the `assistants` config block — it drives Backstage's
 * app-config validation and visibility/secret enforcement at startup, and is
 * referenced from `package.json` via `"configSchema": "config.d.ts"`.
 *
 * Scope: this block holds the platform/safety surface — providers and the model
 * pool, MCP server connections, the global approval floor, and the runtime
 * limits. Assistant *definitions* (title/prompt/access/tools/
 * models) live in the plugin database (the `assistants` table, edited at runtime
 * via the admin API/editor); who may use the plugin and who may manage it are
 * the `assistant.use` / `assistant.manage` Backstage permissions.
 *
 * Backstage's config-schema loader requires this file to export ONLY the
 * `Config` interface, so every supporting shape is inlined below rather than
 * declared as a separate exported interface.
 *
 * Visibility: every field here is backend-only by default (never bundled to the
 * frontend). The browser receives only the projection the plugin serves over
 * `GET /status` — the accessible assistants, the model pool + defaults, and
 * each assistant's `ui`. `apiKey` and every value under `mcp.servers.*.env` /
 * `mcp.servers.*.headers` are additionally `@visibility secret` so they are
 * redacted everywhere (logs, frontend, DevTools config view, etc.). The secret
 * annotation sits on the index signature — on the leaf — because Backstage
 * applies visibility per leaf and an object-level annotation never reaches the
 * values under `additionalProperties`.
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
    builtinActions?: boolean;

    /**
     * Global approval floor: bare Backstage action ids whose execution must be
     * gated behind an explicit user Allow/Deny in the chat (deterministic,
     * enforced via the AI SDK's `toolApproval` map — not by prompting the model).
     * The effective approval set for an assistant is this list (∪ each MCP
     * server's per-server `requireApproval`, namespaced `<serverId>__<tool>`)
     * intersected with that assistant's `allowedTools`. There is no per-assistant
     * approval setting. A name not in any assistant's tools is simply never hit.
     */
    requireApproval?: string[];

    /**
     * External MCP (Model Context Protocol) servers whose tools are exposed to
     * assistants. Each server is connected with a static credential (the
     * configured `headers`) — i.e. one shared identity for all users (not yet
     * run-as-user). Assistants opt in by listing namespaced `<serverId>__<tool>`
     * entries in their `allowedTools`.
     */
    mcp?: {
      /**
       * Global default ceiling in milliseconds for connecting to an MCP server
       * and listing its tools (each bounded individually). Overridable per
       * server via `servers.<id>.connectTimeoutMs`. Defaults to 8000. Raise it
       * for slow-starting stdio servers (e.g. Python servers via `uvx` can take
       * ~10s to start).
       */
      connectTimeoutMs?: number;
      servers?: {
        [serverId: string]: {
          /**
           * Transport. `http` = Streamable HTTP, `sse` = Server-Sent Events
           * (both remote, use `url`); `stdio` spawns a local process (use
           * `command`). Defaults to `http`.
           */
          transport?: 'http' | 'sse' | 'stdio';
          /** Endpoint URL for remote transports (http/sse). */
          url?: string;
          /**
           * Headers sent on every request (http/sse), e.g. an `Authorization`
           * bearer. Every value is secret.
           */
          headers?: {
            /** @visibility secret */
            [name: string]: string;
          };
          /** stdio: executable to spawn (e.g. `npx`, `node`, `docker`). */
          command?: string;
          /** stdio: arguments for the command. */
          args?: string[];
          /**
           * stdio: extra environment for the child process, merged over a safe
           * default env. Every value is secret.
           */
          env?: {
            /** @visibility secret */
            [name: string]: string;
          };
          /** stdio: working directory for the child process. */
          cwd?: string;
          /**
           * Per-server override of the connect/list-tools timeout ceiling in
           * milliseconds. Falls back to the global `mcp.connectTimeoutMs`,
           * then the built-in 8000ms default.
           */
          connectTimeoutMs?: number;
          /**
           * Per-server approval floor: un-namespaced tool names of this server
           * whose execution must be gated behind an explicit user Allow/Deny.
           * Folded into the global approval set as `<serverId>__<toolName>` and
           * intersected with each assistant's `allowedTools`. Same deterministic
           * AI-SDK `toolApproval` gate as the top-level `requireApproval`.
           */
          requireApproval?: string[];
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

        /**
         * Models exposed by this provider. Each entry is an object with the
         * model `name` and an optional `contextWindow` (max input tokens,
         * surfaced to the UI to render a context-usage gauge; omit to leave the
         * limit unknown). Model ids in the pool are `<providerId>:<name>`.
         * e.g. `[{ name: "gpt-5.5", contextWindow: 400000 }, { name: "gpt-4o-mini" }]`.
         */
        models: Array<{
          /** Model name as the provider exposes it (the `<name>` in `<providerId>:<name>`). */
          name: string;
          /** Optional max input tokens for this model; drives the context-usage gauge. */
          contextWindow?: number;
          /**
           * Optional ceiling on tokens the model may generate per turn, sent as
           * the request's max output tokens. Omit to use the provider's own
           * default, which is right for models it recognises.
           *
           * Set it when a provider guesses badly for a model id it doesn't know:
           * `@ai-sdk/anthropic` falls back to 4096 for an id that doesn't look
           * like a Claude model (e.g. a bare Foundry deployment name), which is
           * not enough for a reasoning model to think AND answer — the turn ends
           * with tool calls but no reply.
           */
          maxOutputTokens?: number;
          /**
           * True when this model reasons — the chat then offers an effort
           * picker (low / medium / high / max) for it, translated per
           * provider (OpenAI and Azure `reasoningEffort`, Anthropic
           * `output_config.effort` with adaptive thinking). Omit for a
           * non-reasoning model: no picker, and turns run at the provider's own
           * default.
           *
           * Anthropic note: requires Claude 4.6 or later. Older models, whose
           * only thinking control is a `budget_tokens` value, are not supported
           * here — leave them unflagged.
           */
          reasoning?: boolean;
        }>;
      };
    };

    /**
     * Express body-parser size limit for `/chat` and `/title` requests (the
     * routes that carry conversation payloads, incl. inline attachments).
     * Default `'10mb'`.
     */
    requestBodyLimit?: string;
  };
}
