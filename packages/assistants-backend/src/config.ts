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
import { mcpToolName } from './mcp';
import {
  type ApprovalPreview,
  ModelOption,
  ModelId,
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
/**
 * The `type` discriminator of a configured provider — the AI-SDK package that
 * backs it. Distinct from the provider ID, which is a free label that only
 * namespaces model ids.
 *
 * @public
 */
export type SupportedProviderType = (typeof SUPPORTED_PROVIDER_TYPES)[number];

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

/**
 * The per-turn approval set: the global approval floor (top-level action ids ∪
 * per-server `<serverId>__<tool>` entries, as {@link readConfig} flattens it)
 * intersected with one assistant's `allowedTools`. Order follows
 * `allowedTools`; floor entries the assistant can't use are dropped.
 *
 * @public
 */
export function effectiveApprovalSet(
  allowedTools: readonly string[],
  requireApproval: ReadonlySet<string>,
): string[] {
  return allowedTools.filter(t => requireApproval.has(t));
}

/** Supported MCP client transports (the @ai-sdk/mcp set). */
export type McpTransport = 'http' | 'sse' | 'stdio';

/**
 * How a per-user MCP server receives the signed-in user's token. The browser
 * gets the token from Backstage's auth APIs (`provider`, `host`, `scopes`) and
 * sends it with each turn; the backend passes it to the server in `header`
 * (http/sse) or the `env` variable (stdio).
 */
export interface McpUserCredentials {
  /** The Backstage auth provider id, e.g. `github`. */
  provider: string;
  /** SCM host whose integration supplies the token, e.g. `github.com`. */
  host?: string;
  /** OAuth scopes to request; empty means the provider's defaults. */
  scopes?: string[];
  /** Display name for the sign-in, e.g. `GitHub`. */
  title: string;
  /** http/sse: the header the token is sent in. */
  header: string;
  /** http/sse: the prefix before the token, e.g. `Bearer`; empty sends the bare token. */
  scheme: string;
  /** stdio: the environment variable the token is set in. */
  env?: string;
}

/**
 * A server-side check on one tool argument, enforced before the call is
 * offered for approval and again before it runs. A missing argument fails.
 */
export interface ArgumentRule {
  /** The argument must be a string matching this expression. */
  pattern?: RegExp;
  /** The argument must equal this value. */
  equals?: string | number | boolean;
}

/** An approval preview as configured: the browser-side shape plus the read tool for a diff. */
export interface McpApprovalPreview {
  type: 'file' | 'files';
  fields: ApprovalPreview['fields'];
  /**
   * The server's read tool for the current content, with its arguments as
   * templates over the call's input (for `files`, over the input merged with
   * each file entry, so `path` is the file's path).
   */
  base?: { tool: string; args: Record<string, string> };
}

/**
 * A configured external MCP server. Remote transports (`http`/`sse`) use `url`
 * + `headers`; `stdio` spawns a local `command`.
 * Connected with a static credential (one shared identity for every user), or
 * per user with each user's own token when `userCredentials` is set.
 */
export interface McpServerConfig {
  id: string;
  transport: McpTransport;
  /** Endpoint URL for remote transports (http/sse). */
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
  /** Set for a per-user server: each user's calls carry their own token. */
  userCredentials?: McpUserCredentials;
  /** Checks on tool arguments, keyed by un-namespaced tool name, then argument. */
  argumentRules?: Record<string, Record<string, ArgumentRule>>;
  /** Approval-card previews, keyed by un-namespaced tool name. */
  approvalPreview?: Record<string, McpApprovalPreview>;
  /** The server's approval floor, un-namespaced (also folded into the global set). */
  requireApproval?: string[];
  /**
   * A per-user server's gated tools take a standing "Always allow" grant only
   * when this is true; otherwise every call is approved on its own.
   */
  allowStandingApproval?: boolean;
}

/**
 * The platform/safety surface read from the `assistants` config block.
 *
 * Assistant *definitions* are NOT here — they live in the plugin database and
 * are read through the assistant store. This config exposes the model pool +
 * resolver, the provider registry, the MCP server connections, the runtime
 * limits, and the global approval set.
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
  /** Maximum number of tool-call steps per turn. */
  maxSteps: number;
  /**
   * Maximum characters of a single tool result passed to the model (and
   * persisted). Oversized results are truncated head+tail with an elision
   * marker so one huge tool output can't overflow the context window. `0`
   * disables truncation. Default `30000`.
   */
  toolResultMaxChars: number;
  /** Express body-parser size limit for `/chat` (default `'10mb'`). */
  requestBodyLimit: string;
  /**
   * The global approval floor as a flat set of tool ids: the top-level
   * `requireApproval` action ids ∪ each MCP server's per-server
   * `requireApproval` namespaced `<serverId>__<tool>`. The effective per-turn
   * approval set is this intersected with the assistant's `allowedTools`.
   */
  requireApproval: Set<string>;
  /**
   * The approval-floor tools that take no standing "Always allow" grant: the
   * gated tools of per-user servers without `allowStandingApproval`.
   */
  approveEachCall: Set<string>;
  /** Resolve a `provider:model` id to an AI SDK {@link LanguageModel}. */
  resolveModel: (modelId: string) => LanguageModel;
  /**
   * The configured `type` of the provider a `provider:model` id belongs to, or
   * undefined for an id outside the pool. Provider-specific behaviour keys on
   * this, never on the provider id: `claude` with `type: anthropic` is
   * Anthropic; `anthropic` with `type: openai-compatible` is not.
   */
  resolveProviderType: (modelId: string) => SupportedProviderType | undefined;
  /**
   * The configured output-token ceiling for a model, or undefined to leave the
   * provider's own default in place. Only needed when a provider guesses badly
   * for a model id it doesn't recognise — see `maxOutputTokens` in config.d.ts.
   */
  resolveMaxOutputTokens: (modelId: string) => number | undefined;
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
 * Builds the AI-SDK provider factory selected by the provider's `type`
 * discriminator, spreading the passthrough `options` bag verbatim into the
 * factory and keeping the top-level `apiKey`/`baseUrl`.
 */
function buildProvider(type: SupportedProviderType, providerConfig: Config) {
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
// Config says only WHETHER a model reasons (`reasoning: true`); the tiers are
// fixed. A tier is a POSITION on a scale, not a literal string: the providers
// agree on low/medium/high but not on what the ceiling is called, so the top
// tier is translated per provider.

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
 * providers take `reasoningEffort`, Anthropic takes `effort` (sent as
 * `output_config.effort`) alongside adaptive thinking, which lets the model size
 * its own thinking rather than us handing it a token budget.
 *
 * The ceiling differs by provider: Anthropic's is `max`, OpenAI's is `xhigh`
 * (it has no `max`). Anthropic's `xhigh` only exists on Opus 4.7 and later —
 * Opus 4.6 and Sonnet 4.6 reject it while accepting `max` — so mapping our top
 * tier to `max` there covers every effort-capable Anthropic model, not just the
 * newest ones.
 *
 * Anthropic's older extended-thinking shape — `thinking: { type: 'enabled',
 * budgetTokens }` — is deliberately NOT used: current models reject it outright
 * ("not supported for this model. Use thinking.type.adaptive and
 * output_config.effort"), and it was the only branch that needed us to invent
 * absolute token budgets.
 */
function buildReasoningOptions(
  type: SupportedProviderType,
  level: ReasoningLevel,
): Record<string, Record<string, JSONValue>> {
  const key = providerOptionsKey(type);
  if (type === 'anthropic') {
    return {
      [key]: { thinking: { type: 'adaptive' }, effort: level },
    };
  }
  return {
    [key]: { reasoningEffort: level === 'max' ? 'xhigh' : level },
  };
}

/** Display names for the auth providers Backstage ships, for "Connect GitHub". */
const PROVIDER_TITLES: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  microsoft: 'Microsoft',
  google: 'Google',
  atlassian: 'Atlassian',
  okta: 'Okta',
  onelogin: 'OneLogin',
  bitbucket: 'Bitbucket',
  bitbucketServer: 'Bitbucket Server',
  openshift: 'OpenShift',
  vmwareCloud: 'VMware Cloud',
};

/** A server's `userCredentials` block, or undefined for a shared-credential server. */
function readUserCredentials(
  sc: Config,
  path: string,
  transport: string,
): McpUserCredentials | undefined {
  const uc = sc.getOptionalConfig('userCredentials');
  if (!uc) return undefined;
  const provider = uc.getString('provider');
  const env = uc.getOptionalString('env');
  if (transport === 'stdio' && !env) {
    throw new InputError(
      `${path}.userCredentials: a stdio server takes the token in an environment variable; set 'env'`,
    );
  }
  const scopes = uc.getOptionalStringArray('scopes');
  return {
    provider,
    ...(uc.getOptionalString('host') ? { host: uc.getString('host') } : {}),
    ...(scopes && scopes.length > 0 ? { scopes } : {}),
    title:
      uc.getOptionalString('title') ?? PROVIDER_TITLES[provider] ?? provider,
    header: uc.getOptionalString('header') ?? 'Authorization',
    scheme: uc.getOptionalString('scheme') ?? 'Bearer',
    ...(env ? { env } : {}),
  };
}

/** A server's `argumentRules`, with each pattern compiled once. */
function readArgumentRules(
  sc: Config,
  path: string,
): Record<string, Record<string, ArgumentRule>> | undefined {
  const rulesConfig = sc.getOptionalConfig('argumentRules');
  if (!rulesConfig) return undefined;
  const out: Record<string, Record<string, ArgumentRule>> = {};
  for (const toolName of rulesConfig.keys()) {
    const toolRules = rulesConfig.getConfig(toolName);
    out[toolName] = {};
    for (const arg of toolRules.keys()) {
      const rulePath = `${path}.argumentRules.${toolName}.${arg}`;
      const ruleConfig = toolRules.getConfig(arg);
      const rule: ArgumentRule = {};
      const pattern = ruleConfig.getOptionalString('pattern');
      if (pattern !== undefined) {
        try {
          rule.pattern = new RegExp(pattern);
        } catch (error) {
          throw new InputError(
            `${rulePath}.pattern is not a valid regular expression: ${
              (error as Error).message
            }`,
          );
        }
      }
      const equals = ruleConfig.getOptional('equals');
      if (equals !== undefined) {
        if (!['string', 'number', 'boolean'].includes(typeof equals)) {
          throw new InputError(
            `${rulePath}.equals must be a string, number, or boolean`,
          );
        }
        rule.equals = equals as string | number | boolean;
      }
      if (!rule.pattern && rule.equals === undefined) {
        throw new InputError(`${rulePath} needs 'pattern' or 'equals'`);
      }
      out[toolName][arg] = rule;
    }
  }
  return out;
}

const PREVIEW_FIELDS = [
  'repo',
  'branch',
  'path',
  'content',
  'files',
  'message',
] as const;

/** A server's `approvalPreview` renderers. */
function readApprovalPreviews(
  sc: Config,
  path: string,
): Record<string, McpApprovalPreview> | undefined {
  const previewsConfig = sc.getOptionalConfig('approvalPreview');
  if (!previewsConfig) return undefined;
  const out: Record<string, McpApprovalPreview> = {};
  for (const toolName of previewsConfig.keys()) {
    const previewPath = `${path}.approvalPreview.${toolName}`;
    const pc = previewsConfig.getConfig(toolName);
    const type = pc.getString('type');
    if (type !== 'file' && type !== 'files') {
      throw new InputError(`${previewPath}.type must be 'file' or 'files'`);
    }
    const fieldsConfig = pc.getConfig('fields');
    const fields: ApprovalPreview['fields'] = {};
    for (const key of PREVIEW_FIELDS) {
      const value = fieldsConfig.getOptionalString(key);
      if (value !== undefined) fields[key] = value;
    }
    const required = type === 'file' ? ['path', 'content'] : ['files'];
    for (const key of required) {
      if (!fields[key as keyof typeof fields]) {
        throw new InputError(
          `${previewPath}.fields.${key} is required for type '${type}'`,
        );
      }
    }
    const baseConfig = pc.getOptionalConfig('base');
    let base: McpApprovalPreview['base'];
    if (baseConfig) {
      const args: Record<string, string> = {};
      const argsConfig = baseConfig.getOptionalConfig('args');
      for (const name of argsConfig?.keys() ?? []) {
        args[name] = argsConfig!.getString(name);
      }
      base = { tool: baseConfig.getString('tool'), args };
    }
    out[toolName] = { type, fields, ...(base ? { base } : {}) };
  }
  return out;
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
  /** Provider type per `provider:model` id in the pool. */
  const providerTypeByModelId = new Map<string, SupportedProviderType>();
  /** Provider type per reasoning-capable `provider:model` id. */
  const reasoningTypeByModelId = new Map<string, SupportedProviderType>();
  /** Configured output-token ceiling per `provider:model` id. */
  const maxOutputTokensByModelId = new Map<string, number>();

  const registryProviders: Record<
    string,
    ReturnType<typeof buildProvider>
  > = {};
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
      providerTypeByModelId.set(id, type);
      if (reasoning) {
        reasoningTypeByModelId.set(id, type);
      }
      const maxOutputTokens = modelConfig.getOptionalNumber('maxOutputTokens');
      if (maxOutputTokens !== undefined) {
        if (maxOutputTokens <= 0) {
          throw new InputError(
            `assistants model '${id}': maxOutputTokens must be a positive number of tokens`,
          );
        }
        maxOutputTokensByModelId.set(id, maxOutputTokens);
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

  // --- External MCP servers ----------------------------------------------
  // Each server's optional per-server `requireApproval` (un-namespaced tool
  // names) is folded into the global approval set as `<serverId>__<tool>`.
  const mcpServers = new Map<string, McpServerConfig>();
  const requireApproval = new Set<string>();
  const approveEachCall = new Set<string>();
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
      if (!['http', 'sse', 'stdio'].includes(transport)) {
        throw new InputError(
          `assistants.mcp.servers.${serverId}.transport must be one of ` +
            `'http', 'sse', 'stdio'`,
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

      const path = `assistants.mcp.servers.${serverId}`;
      const userCredentials = readUserCredentials(sc, path, transport);
      const serverRequireApproval =
        sc.getOptionalStringArray('requireApproval') ?? [];
      const allowStandingApproval =
        sc.getOptionalBoolean('allowStandingApproval') ?? false;
      const guards = {
        ...(userCredentials ? { userCredentials } : {}),
        argumentRules: readArgumentRules(sc, path),
        approvalPreview: readApprovalPreviews(sc, path),
        requireApproval: serverRequireApproval,
        allowStandingApproval,
      };

      if (transport === 'stdio') {
        const command = sc.getOptionalString('command');
        if (!command) {
          throw new InputError(`${path}: stdio transport requires 'command'`);
        }
        const env = readStringMap('env');
        if (userCredentials?.env && userCredentials.env in env) {
          throw new InputError(
            `${path}: env.${userCredentials.env} is the per-user token; remove the static value`,
          );
        }
        mcpServers.set(serverId, {
          id: serverId,
          transport: 'stdio',
          command,
          args: sc.getOptionalStringArray('args'),
          env: Object.keys(env).length > 0 ? env : undefined,
          cwd: sc.getOptionalString('cwd'),
          connectTimeoutMs,
          ...guards,
        });
      } else {
        const url = sc.getOptionalString('url');
        if (!url) {
          throw new InputError(
            `${path}: '${transport}' transport requires 'url'`,
          );
        }
        const headers = readStringMap('headers');
        if (
          userCredentials &&
          Object.keys(headers).some(
            name => name.toLowerCase() === userCredentials.header.toLowerCase(),
          )
        ) {
          throw new InputError(
            `${path}: headers.${userCredentials.header} is the per-user token; remove the static value`,
          );
        }
        mcpServers.set(serverId, {
          id: serverId,
          transport: transport as McpTransport,
          url,
          headers,
          connectTimeoutMs,
          ...guards,
        });
      }

      // Per-server approval floor, namespaced into the global set. A per-user
      // server's gated tools are approved call by call unless it opts in.
      for (const tool of serverRequireApproval) {
        requireApproval.add(mcpToolName(serverId, tool));
        if (userCredentials && !allowStandingApproval) {
          approveEachCall.add(mcpToolName(serverId, tool));
        }
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
    maxSteps,
    toolResultMaxChars,
    requestBodyLimit,
    requireApproval,
    approveEachCall,
    resolveModel: (modelId: string) =>
      registry.languageModel(modelId as `${string}:${string}`),
    resolveProviderType: (modelId: string) =>
      providerTypeByModelId.get(modelId),
    resolveMaxOutputTokens: (modelId: string) =>
      maxOutputTokensByModelId.get(modelId),
    resolveReasoning: (modelId: string, level: ReasoningLevel) => {
      const type = reasoningTypeByModelId.get(modelId);
      return type ? buildReasoningOptions(type, level) : undefined;
    },
  };
}
