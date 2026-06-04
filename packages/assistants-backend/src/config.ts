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
import {
  AssistantSummary,
  ModelOption,
  ModelId,
  StatusResponse,
  UiOptions,
} from '@drewswiredin/backstage-plugin-assistants-common';

/**
 * The set of provider `type` discriminators whose AI-SDK factories we know how
 * to construct. Adding a new provider is one more value here plus a `case` in
 * {@link buildProvider} (ADR 0004).
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
 * Per-assistant access policy. Parsed from config; evaluated per request in the
 * router against the caller's {@link @backstage/backend-plugin-api#BackstageUserInfo}.
 */
export interface AssistantAccessPolicy {
  /** Any signed-in user may access the assistant. */
  allowAuthenticated: boolean;
  /** Entity refs of users granted access. */
  users: string[];
  /** Entity refs of groups granted access. */
  groups: string[];
}

/**
 * A fully parsed assistant. The prompt is backend-only and never leaves the
 * backend; `actions` is the per-assistant tool allowlist; `models`/`ui` are the
 * resolved (validated/merged) values used by the browser-safe projection.
 */
export interface AssistantDefinition {
  id: string;
  title: string;
  description?: string;
  /** Optional brand hex color used to tint the assistant's avatar in the nav. */
  color?: string;
  prompt: string;
  access: AssistantAccessPolicy;
  /** Backstage action names allowed as tools for this assistant. */
  actions: string[];
  /**
   * The `provider:model` ids this assistant may use. Always populated: either
   * the per-profile allowlist or the full pool when none was declared.
   */
  models: ModelId[];
  /** This assistant's default `provider:model`. */
  defaultModel: ModelId;
  /** Resolved UI options (deep-merge of global + per-profile `ui`). */
  ui?: UiOptions;
  /**
   * Whether this assistant declared an explicit `models` allowlist. When false
   * the assistant gets the full pool and `models` is omitted from `/status`.
   */
  hasModelAllowlist: boolean;
}

/**
 * The result of reading and validating the `assistants` config block.
 */
export interface AssistantsConfig {
  /**
   * Register the built-in catalog/search/TechDocs core actions under the
   * `assistants` source. Defaults to false.
   */
  registerCoreActions: boolean;
  /** Parsed assistants keyed by id. */
  assistants: Map<string, AssistantDefinition>;
  /** Flat, browser-safe list of every `provider:model` option (the pool). */
  models: ModelOption[];
  /** Global initial model selection (`provider:model`). */
  defaultModel: ModelId;
  /** Maximum number of tool-call steps per turn. */
  maxSteps: number;
  /** Resolve a `provider:model` id to an AI SDK {@link LanguageModel}. */
  resolveModel: (modelId: string) => LanguageModel;
}

/**
 * Deep-merges two {@link UiOptions} values: objects deep-merge, arrays (e.g.
 * `suggestions`) REPLACE so a profile can clear inherited values. Returns
 * undefined when both inputs are absent.
 */
function mergeUi(
  base: UiOptions | undefined,
  override: UiOptions | undefined,
): UiOptions | undefined {
  if (!base && !override) {
    return undefined;
  }
  const merged: UiOptions = {};

  const composer = { ...(base?.composer ?? {}), ...(override?.composer ?? {}) };
  if (Object.keys(composer).length > 0) {
    merged.composer = composer;
  }

  // Arrays replace: a present override wins outright; otherwise inherit base.
  const suggestions = override?.suggestions ?? base?.suggestions;
  if (suggestions) {
    merged.suggestions = suggestions;
  }

  return merged;
}

/**
 * Reads a profile's `ui` block (browser-safe) from raw config into the shared
 * {@link UiOptions} shape.
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

  return Object.keys(ui).length > 0 ? ui : {};
}

/**
 * Builds the AI-SDK provider factory selected by the provider's `type`
 * discriminator, spreading the passthrough `options` bag verbatim into the
 * factory and keeping the top-level `apiKey`/`baseUrl` (ADR 0004).
 */
function buildProvider(
  type: SupportedProviderType,
  providerConfig: Config,
) {
  const apiKey = providerConfig.getString('apiKey');
  const baseUrl = providerConfig.getOptionalString('baseUrl');
  // Untyped passthrough bag, spread verbatim into the factory. Not
  // field-validated by the config schema (ADR 0004).
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

function parseAccess(
  profileId: string,
  profileConfig: Config,
): AssistantAccessPolicy {
  // Total omission of the access block is almost always a mistake: with
  // deny-by-default evaluation it produces a silently-dead assistant nobody can
  // reach. Fail loudly instead. A present-but-empty block (e.g. only
  // `allowAuthenticated: false`) is an intentional lockout and stays valid.
  const access = profileConfig.getOptionalConfig('access');
  if (!access) {
    throw new InputError(
      `assistants.profiles.${profileId} must define an access policy ` +
        `(allowAuthenticated/users/groups)`,
    );
  }
  return {
    allowAuthenticated: access.getOptionalBoolean('allowAuthenticated') ?? false,
    users: access.getOptionalStringArray('users') ?? [],
    groups: access.getOptionalStringArray('groups') ?? [],
  };
}

/**
 * Reads and validates the `assistants` config block, builds the AI SDK provider
 * registry, and returns parsed assistants plus a model resolver.
 *
 * Throws {@link @backstage/errors#InputError} when the config is malformed: an
 * unsupported provider type, zero assistants, no models, a `defaultModel` not in
 * the pool, a per-profile model allowlist not ⊆ the pool, or a profile default
 * not within its allowlist.
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

    const modelNames = providerConfig.getStringArray('models');
    for (const model of modelNames) {
      models.push({
        id: `${providerId}:${model}`,
        provider: providerId,
        model,
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
  const globalUi = readUi(root.getOptionalConfig('ui'));

  // --- Profiles (assistants) ----------------------------------------------
  const profilesConfig = root.getConfig('profiles');
  const profileIds = profilesConfig.keys();
  if (profileIds.length === 0) {
    throw new InputError(
      'assistants config must define at least one profile',
    );
  }

  const assistants = new Map<string, AssistantDefinition>();
  for (const profileId of profileIds) {
    const profileConfig = profilesConfig.getConfig(profileId);

    // Per-profile model allowlist: subset of the pool; omit = full pool.
    const allowlist = profileConfig.getOptionalStringArray('models');
    const hasModelAllowlist = allowlist !== undefined;
    if (allowlist) {
      for (const id of allowlist) {
        if (!modelIds.has(id)) {
          throw new InputError(
            `assistants.profiles.${profileId}.models contains '${id}', ` +
              `which is not in the global model pool`,
          );
        }
      }
    }
    const profileModels = allowlist ?? Array.from(modelIds);

    // Effective default: the profile's own, else the global default — which
    // must be within the profile's allowlist. A restricted profile that
    // excludes the global default must declare its own `defaultModel`.
    const profileDefault =
      profileConfig.getOptionalString('defaultModel') ?? defaultModel;
    if (!profileModels.includes(profileDefault)) {
      throw new InputError(
        `assistants.profiles.${profileId}.defaultModel '${profileDefault}' ` +
          `is not within this profile's model allowlist`,
      );
    }

    assistants.set(profileId, {
      id: profileId,
      title: profileConfig.getString('title'),
      description: profileConfig.getOptionalString('description'),
      color: profileConfig.getOptionalString('color'),
      prompt: profileConfig.getString('prompt'),
      access: parseAccess(profileId, profileConfig),
      actions: profileConfig.getOptionalStringArray('actions') ?? [],
      models: profileModels,
      defaultModel: profileDefault,
      ui: mergeUi(globalUi, readUi(profileConfig.getOptionalConfig('ui'))),
      hasModelAllowlist,
    });
  }

  const maxSteps = root.getOptionalNumber('maxSteps') ?? 10;
  const registerCoreActions =
    root.getOptionalBoolean('registerCoreActions') ?? false;

  return {
    registerCoreActions,
    assistants,
    models,
    defaultModel,
    maxSteps,
    resolveModel: (modelId: string) =>
      registry.languageModel(modelId as `${string}:${string}`),
  };
}

/**
 * Projects a parsed {@link AssistantDefinition} to its browser-safe
 * {@link AssistantSummary} — never the prompt or access policy. A profile's
 * `models` is included only when it declared an explicit allowlist (omitted =
 * full pool, which the browser already has via the global `models`).
 */
export function toAssistantSummary(
  assistant: AssistantDefinition,
): AssistantSummary {
  return {
    id: assistant.id,
    title: assistant.title,
    description: assistant.description,
    color: assistant.color,
    models: assistant.hasModelAllowlist ? assistant.models : undefined,
    defaultModel: assistant.defaultModel,
    ui: assistant.ui,
  };
}

/**
 * Builds the browser-safe {@link StatusResponse}: the assistants the caller may
 * access (per `isAccessible`), projected to summaries, plus the global model
 * pool and default. Prompt and access policy never leave the backend.
 */
export function buildStatus(
  assistantsConfig: AssistantsConfig,
  isAccessible: (assistant: AssistantDefinition) => boolean,
): StatusResponse {
  const assistants = Array.from(assistantsConfig.assistants.values())
    .filter(isAccessible)
    .map(toAssistantSummary);

  return {
    assistants,
    models: assistantsConfig.models,
    defaultModel: assistantsConfig.defaultModel,
  };
}
