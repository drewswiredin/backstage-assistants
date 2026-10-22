import { ConfigReader } from '@backstage/config';
import { readSemanticSearchConfig } from './config';

const providers = {
  local: {
    type: 'openai-compatible',
    apiKey: 'x',
    baseUrl: 'http://localhost:11434/v1',
    models: [{ name: 'qwen' }],
  },
  claude: { type: 'anthropic', apiKey: 'x', models: [{ name: 'claude' }] },
};

const read = (semanticSearch?: object) =>
  readSemanticSearchConfig(
    new ConfigReader({ assistants: { providers, semanticSearch } }),
  );

describe('readSemanticSearchConfig', () => {
  it('is off without assistants.semanticSearch', () => {
    expect(read()).toBeUndefined();
  });

  it('resolves the embedding model against assistants.providers', () => {
    const config = read({ embeddingModel: 'local:nomic-embed-text' });
    expect(config?.embeddingModelId).toBe('local:nomic-embed-text');
    expect(config?.embeddingModel).toMatchObject({
      modelId: 'nomic-embed-text',
    });
  });

  it('rejects a malformed id, an unknown provider, and a provider without embeddings', () => {
    expect(() => read({ embeddingModel: 'nomic' })).toThrow(/<providerId>/);
    expect(() => read({ embeddingModel: 'missing:x' })).toThrow(
      /not in assistants.providers/,
    );
    expect(() => read({ embeddingModel: 'claude:x' })).toThrow(
      /no embeddings API/,
    );
  });
});
