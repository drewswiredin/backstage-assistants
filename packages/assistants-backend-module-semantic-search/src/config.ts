import { Config } from '@backstage/config';
import { InputError } from '@backstage/errors';
import { createAzure } from '@ai-sdk/azure';
import { createOpenAI } from '@ai-sdk/openai';
import type { EmbeddingModel } from 'ai';

/** How one Backstage search document type is copied and ranked. */
export interface KnowledgeTypeSettings {
  /** Multiplies the type's fused score; 0 means never returned. */
  weight: number;
  /** Searched when the caller names no types. */
  default: boolean;
  /** At most this many of the type's results in one answer. */
  maxResults?: number;
  /** Copied into the index at all. */
  enabled: boolean;
  /** What the source holds, for the tool description. */
  description?: string;
}

/** The settings of a type with no entry in `assistants.semanticSearch.types`. */
export const DEFAULT_TYPE_SETTINGS: KnowledgeTypeSettings = {
  weight: 1,
  default: true,
  enabled: true,
};

/** Results per answer when neither config nor the caller says. */
export const DEFAULT_MAX_RESULTS = 8;

/** The `assistants.semanticSearch` block, resolved. */
export interface SemanticSearchConfig {
  /** `<providerId>:<model>` as configured; part of the index signature. */
  embeddingModelId: string;
  embeddingModel: EmbeddingModel;
  /** Settings per configured document type. */
  types: Map<string, KnowledgeTypeSettings>;
  /** Results per answer unless the caller asks for a number. */
  maxResults: number;
}

/**
 * Reads `assistants.semanticSearch`, or `undefined` when it is absent (the module is
 * installed but off). The embedding model resolves against the same
 * `assistants.providers` block the chat models use, so keys live in one place.
 */
export function readSemanticSearchConfig(
  root: Config,
): SemanticSearchConfig | undefined {
  const settings = root.getOptionalConfig('assistants.semanticSearch');
  if (!settings) {
    return undefined;
  }

  const embeddingModelId = settings.getString('embeddingModel');
  const separator = embeddingModelId.indexOf(':');
  if (separator <= 0 || separator === embeddingModelId.length - 1) {
    throw new InputError(
      `assistants.semanticSearch.embeddingModel must be '<providerId>:<model>'; got '${embeddingModelId}'`,
    );
  }
  const providerId = embeddingModelId.slice(0, separator);
  const modelName = embeddingModelId.slice(separator + 1);

  const provider = root
    .getOptionalConfig('assistants.providers')
    ?.getOptionalConfig(providerId);
  if (!provider) {
    throw new InputError(
      `assistants.semanticSearch.embeddingModel references provider '${providerId}', which is not in assistants.providers`,
    );
  }

  const maxResults =
    settings.getOptionalNumber('maxResults') ?? DEFAULT_MAX_RESULTS;
  if (!Number.isInteger(maxResults) || maxResults < 1) {
    throw new InputError(
      `assistants.semanticSearch.maxResults must be a positive whole number; got ${maxResults}`,
    );
  }

  return {
    embeddingModelId,
    embeddingModel: buildEmbeddingModel(providerId, provider, modelName),
    types: readKnowledgeTypes(root),
    maxResults,
  };
}

/**
 * Reads `assistants.semanticSearch.types`: the document types named there,
 * with their defaults filled in. Types it leaves out are copied and ranked
 * with {@link DEFAULT_TYPE_SETTINGS}.
 */
export function readKnowledgeTypes(
  root: Config,
): Map<string, KnowledgeTypeSettings> {
  const types = new Map<string, KnowledgeTypeSettings>();
  const block = root.getOptionalConfig('assistants.semanticSearch.types');
  for (const type of block?.keys() ?? []) {
    const entry = block!.getConfig(type);
    const key = `assistants.semanticSearch.types.${type}`;
    const weight = entry.getOptionalNumber('weight') ?? 1;
    if (!(weight >= 0)) {
      throw new InputError(`${key}.weight must be 0 or more; got ${weight}`);
    }
    const maxResults = entry.getOptionalNumber('maxResults');
    if (
      maxResults !== undefined &&
      (!Number.isInteger(maxResults) || maxResults < 1)
    ) {
      throw new InputError(
        `${key}.maxResults must be a positive whole number; got ${maxResults}`,
      );
    }
    const description = entry.getOptionalString('description');
    types.set(type, {
      weight,
      default: entry.getOptionalBoolean('default') ?? true,
      ...(maxResults !== undefined ? { maxResults } : {}),
      enabled: entry.getOptionalBoolean('enabled') ?? true,
      ...(description ? { description } : {}),
    });
  }
  return types;
}

/**
 * The AI SDK embedding model for a configured provider. Anthropic has no
 * embeddings API, so only the OpenAI-shaped types qualify.
 */
function buildEmbeddingModel(
  providerId: string,
  provider: Config,
  modelName: string,
): EmbeddingModel {
  const type = provider.getString('type');
  const apiKey = provider.getString('apiKey');
  const baseURL = provider.getOptionalString('baseUrl');
  const options =
    (provider.getOptional('options') as Record<string, unknown>) ?? {};

  switch (type) {
    case 'openai':
    case 'openai-compatible':
      return createOpenAI({ apiKey, baseURL, ...options }).embedding(modelName);
    case 'azure':
      return createAzure({ apiKey, baseURL, ...options }).embedding(modelName);
    default:
      throw new InputError(
        `assistants.semanticSearch.embeddingModel: provider '${providerId}' is type '${type}', which has no embeddings API; use an openai, azure, or openai-compatible provider`,
      );
  }
}
