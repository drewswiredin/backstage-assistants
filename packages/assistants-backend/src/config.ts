import { Config } from '@backstage/config';
import { InputError } from '@backstage/errors';
import {
  createProviderRegistry,
  ProviderRegistryProvider,
  LanguageModel,
} from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { ModelOption, ModelId, UiOptions } from '@drewswiredin/backstage-plugin-assistants-common';

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
 * the same shape used by the management (`assistants.admins`) allowlist; both
 * are evaluated with {@link isPolicyAccessible}.
 *
 * Lives in the backend (not derived from app-config anymore — assistant
 * definitions are DB rows) and is kept here so the store, the admin-gate check,
 * and the router all share one type + one evaluation helper.
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
 * Evaluates an {@link AssistantAccessPolicy} (or the `assistants.admins`
 * allowlist, which has the same shape) against a caller's ownership refs.
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
}

/**
 * The platform/safety surface read from the `assistants` config block.
 *
 * Assistant *definitions* are NOT here — they live in the plugin database and
 * are read through the assistant store. This config now exposes only the model
 * pool + resolver, the provider registry, the MCP server connections, the
 * global UI default, the runtime limits, the management allowlist, and the
 * global approval set.
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
   * Management allowlist (the `assistants.admins` block). Same shape +
   * evaluation as an assistant {@link AssistantAccessPolicy}; default-deny.
   * `canManage` is {@link isPolicyAccessible}(adminAllowlist, caller).
   */
  adminAllowlist: AssistantAccessPolicy;
  /**
   * The global approval floor as a flat set of tool ids: the top-level
   * `requireApproval` action ids ∪ each MCP server's per-server
   * `requireApproval` namespaced `<serverId>__<tool>`. The effective per-turn
   * approval set is this intersected with the assistant's `allowedTools`.
   */
  requireApproval: Set<string>;
  /** Resolve a `provider:model` id to an AI SDK {@link LanguageModel}. */
  resolveModel: (modelId: string) => LanguageModel;
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

/**
 * Reads and validates the `assistants` config block (the platform/safety
 * surface only — assistant definitions are DB rows, read via the store), builds
 * the AI SDK provider registry, and returns the model pool + resolver plus the
 * MCP servers, UI default, limits, management allowlist, and global approval
 * set.
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

    // Each model is an object `{ name, contextWindow? }`. The optional
    // `contextWindow` is surfaced to the UI's context-usage gauge.
    const modelConfigs = providerConfig.getConfigArray('models');
    for (const modelConfig of modelConfigs) {
      const name = modelConfig.getString('name');
      const contextWindow = modelConfig.getOptionalNumber('contextWindow');
      models.push({
        id: `${providerId}:${name}`,
        provider: providerId,
        model: name,
        ...(typeof contextWindow === 'number' ? { contextWindow } : {}),
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
  const serversConfig = root
    .getOptionalConfig('mcp')
    ?.getOptionalConfig('servers');
  if (serversConfig) {
    for (const serverId of serversConfig.keys()) {
      const sc = serversConfig.getConfig(serverId);
      const transport = sc.getOptionalString('transport') ?? 'http';
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

  // --- Management allowlist (assistants.admins) ---------------------------
  // Same shape + evaluation as an assistant access policy; default-deny.
  const adminsConfig = root.getOptionalConfig('admins');
  const adminAllowlist: AssistantAccessPolicy = {
    // Management is never granted to "any authenticated user" from config; the
    // allowlist is purely users/groups. Kept in the AccessPolicy shape so the
    // same `isPolicyAccessible` evaluator applies.
    allowAuthenticated: false,
    users: adminsConfig?.getOptionalStringArray('users') ?? [],
    groups: adminsConfig?.getOptionalStringArray('groups') ?? [],
  };

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
    adminAllowlist,
    requireApproval,
    resolveModel: (modelId: string) =>
      registry.languageModel(modelId as `${string}:${string}`),
  };
}
