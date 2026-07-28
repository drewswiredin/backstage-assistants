import { Config } from '@backstage/config';
import { InputError } from '@backstage/errors';
import {
  createProviderRegistry,
  ProviderRegistryProvider,
  LanguageModel,
  type JSONValue,
} from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import {
  ModelOption,
  ModelId,
  UiOptions,
  type ReasoningLevel,
} from '@drewswiredin/backstage-plugin-assistants-common';

/**
 * The set of provider `type` discriminators whose AI-SDK factories we know how
 * to construct. Adding a new provider is one more value here plus a `case` in
 * {@link buildProvider}.
 */
const SUPPORTED_PROVIDER_TYPES = [
  'openai',
  'anthropic',
  'azure',
  'openai-compatible',
] as const;
type SupportedProviderType = (typeof SUPPORTED_PROVIDER_TYPES)[number];

function isSupportedProviderType(type: string): type is SupportedProviderType {
  return (SUPPORTED_PROVIDER_TYPES as readonly string[]).includes(type);
}

/**
 * An assistant's access policy — who may converse with it. Mirrors the shared
 * {@link @drewswiredin/backstage-plugin-assistants-common#AssistantAccess} and
 * is evaluated with {@link isPolicyAccessible}.
 *
 * Lives in the backend (assistant definitions are DB rows) and is kept here so
 * the store and the router share one type + one evaluation helper.
 */
export interface AssistantAccessPolicy {
  /** Any signed-in user may access. */
  allowAuthenticated: boolean;
  /** Entity refs of users granted access. */
  users: string[];
  /** Entity refs of groups granted access. */
  groups: string[];
}

/**
 * Evaluates an {@link AssistantAccessPolicy} against a caller's ownership refs.
 * Default-deny: an empty policy (no `allowAuthenticated`, no `users`/`groups`)
 * grants nobody.
 *
 * `userEntityRef` is the caller's own ref; `ownershipEntityRefs` is the set of
 * refs the caller owns/belongs to (user + groups), exactly as Backstage's
 * `BackstageUserInfo` exposes them. Matching is membership in either the
 * `users` list (by `userEntityRef`) or the `groups` list (by any
 * `ownershipEntityRefs`).
 *
 * @public
 */
export function isPolicyAccessible(
  policy: AssistantAccessPolicy,
  caller: { userEntityRef: string; ownershipEntityRefs: string[] },
): boolean {
  if (policy.allowAuthenticated) {
    return true;
  }
  if (policy.users.includes(caller.userEntityRef)) {
    return true;
  }
  return policy.groups.some(g => caller.ownershipEntityRefs.includes(g));
}

/** Supported MCP client transports (the full @modelcontextprotocol/sdk set). */
export type McpTransport = 'http' | 'sse' | 'websocket' | 'stdio';

/**
 * A configured external MCP server. Remote transports (`http`/`sse`/`websocket`)
 * use `url` (+ `headers` for http/sse); `stdio` spawns a local `command`.
 * Connected with a static credential (shared identity — not yet run-as-user).
 */
export interface McpServerConfig {
  id: string;
  transport: McpTransport;
  /** Endpoint URL for remote transports (http/sse/websocket). */
  url?: string;
  /** Request headers for http/sse (e.g. an Authorization bearer). */
  headers?: Record<string, string>;
  /** stdio: executable to spawn. */
  command?: string;
  /** stdio: command arguments. */
  args?: string[];
  /** stdio: extra environment for the child process (merged over safe defaults). */
  env?: Record<string, string>;
  /** stdio: working directory for the child process. */
  cwd?: string;
  /**
   * Ceiling for connecting to this server and listing its tools, resolved
   * per-server → global `assistants.mcp.connectTimeoutMs` at config read time;
   * absent = the built-in 8s default.
   */
  connectTimeoutMs?: number;
}

/**
 * The platform/safety surface read from the `assistants` config block.
 *
 * Assistant *definitions* are NOT here — they live in the plugin database and
 * are read through the assistant store. This config exposes the model pool +
 * resolver, the provider registry, the MCP server connections, the global UI
 * default, the runtime limits, and the global approval set.
 */
export interface AssistantsConfig {
  /**
   * Register the built-in catalog/search/TechDocs core actions under the
   * `assistants` source. Defaults to false. (Config key `builtinActions`.)
   */
  builtinActions: boolean;
  /** Configured external MCP servers keyed by id. */
  mcpServers: Map<string, McpServerConfig>;
  /** Flat, browser-safe list of every `provider:model` option (the pool). */
  models: ModelOption[];
  /** Global initial model selection (`provider:model`) — the platform default. */
  defaultModel: ModelId;
  /** Global UI defaults, deep-merged UNDER each assistant's own `ui`. */
  ui?: UiOptions;
  /** Maximum number of tool-call steps per turn. */
  maxSteps: number;
  /**
   * Maximum characters of a single tool result passed to the model (and
   * persisted). Oversized results are truncated head+tail with an elision
   * marker so one huge tool output can't overflow the context window. `0`
   * disables truncation. Default `30000`.
   */
  toolResultMaxChars: number;
  /** Express body-parser size limit for `/chat` and `/title` (default `'10mb'`). */
  requestBodyLimit: string;
  /**
   * The global approval floor as a flat set of tool ids: the top-level
   * `requireApproval` action ids ∪ each MCP server's per-server
   * `requireApproval` namespaced `<serverId>__<tool>`. The effective per-turn
   * approval set is this intersected with the assistant's `allowedTools`.
   */
  requireApproval: Set<string>;
  /** Resolve a `provider:model` id to an AI SDK {@link LanguageModel}. */
  resolveModel: (modelId: string) => LanguageModel;
  /**
   * The `providerOptions` that put a model at the requested effort tier, or
   * undefined when the model isn't flagged as reasoning — the caller then passes
   * nothing and the provider's own default applies. Translating here keeps every
   * provider-specific knob in config.
   */
  resolveReasoning: (
    modelId: string,
    level: ReasoningLevel,
  ) => Record<string, Record<string, JSONValue>> | undefined;
}

/**
 * Reads the global `ui` block (browser-safe) from raw config into the shared
 * {@link UiOptions} shape. Returns undefined when the block is absent.
 */
function readUi(uiConfig: Config | undefined): UiOptions | undefined {
  if (!uiConfig) {
    return undefined;
  }
  const ui: UiOptions = {};

  const composer = uiConfig.getOptionalConfig('composer');
  const placeholder = composer?.getOptionalString('placeholder');
  if (placeholder !== undefined) {
    ui.composer = { placeholder };
  }

  const suggestions = uiConfig.getOptionalConfigArray('suggestions');
  if (suggestions !== undefined) {
    ui.suggestions = suggestions.map(s => ({
      title: s.getString('title'),
      prompt: s.getString('prompt'),
    }));
  }

  return Object.keys(ui).length > 0 ? ui : undefined;
}

/**
 * Builds the AI-SDK provider factory selected by the provider's `type`
 * discriminator, spreading the passthrough `options` bag verbatim into the
 * factory and keeping the top-level `apiKey`/`baseUrl`.
 */
function buildProvider(
  type: SupportedProviderType,
  providerConfig: Config,
) {
  const apiKey = providerConfig.getString('apiKey');
  const baseUrl = providerConfig.getOptionalString('baseUrl');
  // Untyped passthrough bag, spread verbatim into the factory. Not
  // field-validated by the config schema.
  const options =
    (providerConfig.getOptional('options') as Record<string, unknown>) ?? {};

  switch (type) {
    case 'openai':
    case 'openai-compatible': {
      // Force the chat-completions API, NOT the `.languageModel` default —
      // which in @ai-sdk/openai is the OpenAI-proprietary Responses API. The
      // Responses API encodes multi-turn history as `item_reference` items,
      // which OpenAI-*compatible* endpoints (Ollama, Together, Groq, vLLM, …)
      // reject. Chat-completions is universal, so it's the right default for a
      // provider that accepts an arbitrary `baseUrl`.
      const openai = createOpenAI({ apiKey, baseURL: baseUrl, ...options });
      return Object.assign(openai, {
        languageModel: (id: string) => openai.chat(id),
      });
    }
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL: baseUrl, ...options });
    case 'azure': {
      // Same reasoning as openai: chat-completions for portability.
      const azure = createAzure({ apiKey, baseURL: baseUrl, ...options });
      return Object.assign(azure, {
        languageModel: (id: string) => azure.chat(id),
      });
    }
    default:
      // Unreachable — guarded by isSupportedProviderType before this is called.
      throw new InputError(`Unsupported AI provider type '${type}'`);
  }
}

// --- Reasoning effort -------------------------------------------------------
// Config says only WHETHER a model reasons (`reasoning: true`). The tiers
// themselves are fixed and provider-neutral, because Anthropic has no named
// levels at all — only a token budget — so the tiers have to be invented
// somewhere. Inventing them once here beats every operator inventing their own.

/**
 * Anthropic thinking budget per tier (its minimum is 1024).
 *
 * These are PLUGIN-OWNED defaults, not a per-deployment setting: the same class
 * of thing as a model's default context window, expected to move with model
 * generations and to be revised in a release here. Unlike OpenAI's tier NAMES —
 * which the provider re-tunes behind a stable label — an absolute budget doesn't
 * re-tune itself, so `high` drifts conservative as models improve. Getting one
 * wrong degrades quietly rather than erroring: too low just under-thinks, and
 * too high is clamped by the provider against the model's max output tokens
 * (the budget counts toward `max_tokens`, so it eats the answer allowance).
 *
 * Expected to be DELETED rather than tuned: `@ai-sdk/anthropic` already accepts
 * `thinking: { type: 'adaptive' }`, letting the model pick its own budget. Once
 * that is the norm, this branch becomes adaptive and these constants go away.
 */
const BUDGET_TOKENS: Record<ReasoningLevel, number> = {
  low: 2_048,
  medium: 8_192,
  high: 24_576,
  xhigh: 32_768,
};

/**
 * The `providerOptions` key a provider reads its own options under. This is the
 * AI-SDK provider NAME (fixed per package), NOT the configured provider id — a
 * provider configured as `myGpt` with type `openai` still reads `openai`.
 */
function providerOptionsKey(type: SupportedProviderType): string {
  // `openai-compatible` is built with createOpenAI, so it reads `openai` too.
  const byType: Record<SupportedProviderType, string> = {
    openai: 'openai',
    'openai-compatible': 'openai',
    azure: 'azure',
    anthropic: 'anthropic',
  };
  return byType[type];
}

/**
 * Translate a tier into the selected provider's own knob. OpenAI-shaped
 * providers take a `reasoningEffort` string; Anthropic takes a thinking budget
 * (which it counts toward `max_tokens` and clamps to the model's ceiling).
 */
function buildReasoningOptions(
  type: SupportedProviderType,
  level: ReasoningLevel,
): Record<string, Record<string, JSONValue>> {
  const key = providerOptionsKey(type);
  if (type === 'anthropic') {
    return {
      [key]: { thinking: { type: 'enabled', budgetTokens: BUDGET_TOKENS[level] } },
    };
  }
  return { [key]: { reasoningEffort: level } };
}

/**
 * Reads and validates the `assistants` config block (the platform/safety
 * surface only — assistant definitions are DB rows, read via the store), builds
 * the AI SDK provider registry, and returns the model pool + resolver plus the
 * MCP servers, UI default, limits, and global approval set.
 *
 * Throws {@link @backstage/errors#InputError} when the config is malformed: an
 * unsupported provider type, no models, a `defaultModel` not in the pool, or an
 * MCP server missing its transport's required connection field.
 *
 * @public
 */
export function readConfig(config: Config): AssistantsConfig {
  const root = config.getConfig('assistants');

  // --- Providers + models -------------------------------------------------
  const providersConfig = root.getConfig('providers');
  const providerIds = providersConfig.keys();
  /** Provider type per reasoning-capable `provider:model` id. */
  const reasoningTypeByModelId = new Map<string, SupportedProviderType>();

  const registryProviders: Record<string, ReturnType<typeof buildProvider>> = {};
  const models: ModelOption[] = [];

  for (const providerId of providerIds) {
    const providerConfig = providersConfig.getConfig(providerId);
    const type = providerConfig.getString('type');
    if (!isSupportedProviderType(type)) {
      throw new InputError(
        `Unsupported provider type '${type}' for provider '${providerId}'. ` +
          `Supported types: ${SUPPORTED_PROVIDER_TYPES.join(', ')}`,
      );
    }

    registryProviders[providerId] = buildProvider(type, providerConfig);

    // Each model is an object `{ name, contextWindow?, reasoning? }`. The
    // optional `contextWindow` is surfaced to the UI's context-usage gauge;
    // `reasoning: true` flags a model that offers the effort tiers.
    const modelConfigs = providerConfig.getConfigArray('models');
    for (const modelConfig of modelConfigs) {
      const name = modelConfig.getString('name');
      const id = `${providerId}:${name}`;
      const contextWindow = modelConfig.getOptionalNumber('contextWindow');
      const reasoning = modelConfig.getOptionalBoolean('reasoning') ?? false;
      if (reasoning) {
        reasoningTypeByModelId.set(id, type);
      }
      models.push({
        id,
        provider: providerId,
        model: name,
        ...(typeof contextWindow === 'number' ? { contextWindow } : {}),
        ...(reasoning ? { reasoning } : {}),
      });
    }
  }

  if (models.length === 0) {
    throw new InputError('assistants config must declare at least one model');
  }
  const modelIds = new Set(models.map(m => m.id));

  // The registry separator is the default ':', matching the `provider:model`
  // id format we assemble above and expose to the browser.
  const registry: ProviderRegistryProvider =
    createProviderRegistry(registryProviders);

  // --- Global default model -----------------------------------------------
  const defaultModel = root.getString('defaultModel');
  if (!modelIds.has(defaultModel)) {
    throw new InputError(
      `assistants.defaultModel '${defaultModel}' is not one of the configured models`,
    );
  }

  // --- Global UI defaults -------------------------------------------------
  const ui = readUi(root.getOptionalConfig('ui'));

  // --- External MCP servers ----------------------------------------------
  // Each server's optional per-server `requireApproval` (un-namespaced tool
  // names) is folded into the global approval set as `<serverId>__<tool>`.
  const mcpServers = new Map<string, McpServerConfig>();
  const requireApproval = new Set<string>();
  const mcpConfig = root.getOptionalConfig('mcp');
  // A non-positive ceiling would fail every connect instantly — reject it here
  // rather than let a typo look like an unreachable server.
  const readTimeout = (c: Config, path: string): number | undefined => {
    const ms = c.getOptionalNumber('connectTimeoutMs');
    if (ms !== undefined && ms <= 0) {
      throw new InputError(
        `${path}.connectTimeoutMs must be a positive number of milliseconds`,
      );
    }
    return ms;
  };
  // Global connect/probe timeout default; each server may override it. Left
  // undefined when unset so mcp.ts applies its built-in 8s default.
  const globalConnectTimeoutMs = mcpConfig
    ? readTimeout(mcpConfig, 'assistants.mcp')
    : undefined;
  const serversConfig = mcpConfig?.getOptionalConfig('servers');
  if (serversConfig) {
    for (const serverId of serversConfig.keys()) {
      const sc = serversConfig.getConfig(serverId);
      const transport = sc.getOptionalString('transport') ?? 'http';
      const connectTimeoutMs =
        readTimeout(sc, `assistants.mcp.servers.${serverId}`) ??
        globalConnectTimeoutMs;
      if (!['http', 'sse', 'websocket', 'stdio'].includes(transport)) {
        throw new InputError(
          `assistants.mcp.servers.${serverId}.transport must be one of ` +
            `'http', 'sse', 'websocket', 'stdio'`,
        );
      }
      const readStringMap = (key: string): Record<string, string> => {
        const out: Record<string, string> = {};
        const mapConfig = sc.getOptionalConfig(key);
        if (mapConfig) {
          for (const name of mapConfig.keys()) {
            out[name] = mapConfig.getString(name);
          }
        }
        return out;
      };

      if (transport === 'stdio') {
        const command = sc.getOptionalString('command');
        if (!command) {
          throw new InputError(
            `assistants.mcp.servers.${serverId}: stdio transport requires 'command'`,
          );
        }
        const env = readStringMap('env');
        mcpServers.set(serverId, {
          id: serverId,
          transport: 'stdio',
          command,
          args: sc.getOptionalStringArray('args'),
          env: Object.keys(env).length > 0 ? env : undefined,
          cwd: sc.getOptionalString('cwd'),
          connectTimeoutMs,
        });
      } else {
        const url = sc.getOptionalString('url');
        if (!url) {
          throw new InputError(
            `assistants.mcp.servers.${serverId}: '${transport}' transport requires 'url'`,
          );
        }
        mcpServers.set(serverId, {
          id: serverId,
          transport: transport as McpTransport,
          url,
          headers: readStringMap('headers'),
          connectTimeoutMs,
        });
      }

      // Per-server approval floor, namespaced into the global set.
      for (const tool of sc.getOptionalStringArray('requireApproval') ?? []) {
        requireApproval.add(`${serverId}__${tool}`);
      }
    }
  }

  // --- Global approval floor (top-level action ids) -----------------------
  for (const actionId of root.getOptionalStringArray('requireApproval') ?? []) {
    requireApproval.add(actionId);
  }

  // --- Runtime limits + builtin actions toggle ----------------------------
  const maxSteps = root.getOptionalNumber('maxSteps') ?? 10;
  const toolResultMaxChars =
    root.getOptionalNumber('toolResultMaxChars') ?? 30000;
  const requestBodyLimit = root.getOptionalString('requestBodyLimit') ?? '10mb';
  const builtinActions = root.getOptionalBoolean('builtinActions') ?? false;

  return {
    builtinActions,
    mcpServers,
    models,
    defaultModel,
    ui,
    maxSteps,
    toolResultMaxChars,
    requestBodyLimit,
    requireApproval,
    resolveModel: (modelId: string) =>
      registry.languageModel(modelId as `${string}:${string}`),
    resolveReasoning: (modelId: string, level: ReasoningLevel) => {
      const type = reasoningTypeByModelId.get(modelId);
      return type ? buildReasoningOptions(type, level) : undefined;
    },
  };
}
