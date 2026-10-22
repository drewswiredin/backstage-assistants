import { Config } from '@backstage/config';
import { InputError } from '@backstage/errors';
import { createAzure } from '@ai-sdk/azure';
import { createOpenAI } from '@ai-sdk/openai';
import type { EmbeddingModel } from 'ai';

/** The `assistants.semanticSearch` block, resolved. */
export interface SemanticSearchConfig {
  /** `<providerId>:<model>` as configured; part of the index signature. */
  embeddingModelId: string;
  embeddingModel: EmbeddingModel;
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

  return {
    embeddingModelId,
    embeddingModel: buildEmbeddingModel(providerId, provider, modelName),
  };
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
