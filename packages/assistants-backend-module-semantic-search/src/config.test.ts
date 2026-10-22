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

  it('reads type settings with their defaults, and the result count', () => {
    const config = read({
      embeddingModel: 'local:nomic-embed-text',
      maxResults: 6,
      types: {
        techdocs: { weight: 1.2 },
        jira: {
          weight: 0.5,
          default: false,
          maxResults: 2,
          description: 'ticket history',
        },
        wiki: { enabled: false },
      },
    });
    expect(config?.maxResults).toBe(6);
    expect(Object.fromEntries(config!.types)).toEqual({
      techdocs: { weight: 1.2, default: true, enabled: true },
      jira: {
        weight: 0.5,
        default: false,
        maxResults: 2,
        enabled: true,
        description: 'ticket history',
      },
      wiki: { weight: 1, default: true, enabled: false },
    });
    expect(read({ embeddingModel: 'local:x' })?.maxResults).toBe(8);
  });

  it('rejects a negative weight and a fractional result cap', () => {
    expect(() =>
      read({ embeddingModel: 'local:x', types: { jira: { weight: -1 } } }),
    ).toThrow(/types.jira.weight/);
    expect(() =>
      read({ embeddingModel: 'local:x', types: { jira: { maxResults: 1.5 } } }),
    ).toThrow(/types.jira.maxResults/);
    expect(() => read({ embeddingModel: 'local:x', maxResults: 0 })).toThrow(
      /semanticSearch.maxResults/,
    );
  });
});
