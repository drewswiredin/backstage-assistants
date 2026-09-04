import { ConfigReader } from '@backstage/config';
import type { JsonObject } from '@backstage/types';
import { effectiveApprovalSet, readConfig } from './config';

const providers = {
  openai: {
    type: 'openai',
    apiKey: 'sk-test',
    models: [{ name: 'gpt-4o', contextWindow: 128000 }, { name: 'o3' }],
  },
};

function read(assistants: JsonObject) {
  return readConfig(new ConfigReader({ assistants }));
}

describe('readConfig', () => {
  it('parses an object-form models list into provider:model options', () => {
    const cfg = read({ providers, defaultModel: 'openai:gpt-4o' });
    expect(cfg.models).toEqual([
      {
        id: 'openai:gpt-4o',
        provider: 'openai',
        model: 'gpt-4o',
        contextWindow: 128000,
      },
      { id: 'openai:o3', provider: 'openai', model: 'o3' },
    ]);
    expect(cfg.defaultModel).toBe('openai:gpt-4o');
  });

  it('rejects a string-form models entry, naming the key', () => {
    expect(() =>
      read({
        providers: {
          openai: { type: 'openai', apiKey: 'sk-test', models: ['gpt-4o'] },
        },
        defaultModel: 'openai:gpt-4o',
      }),
    ).toThrow(/assistants\.providers\.openai\.models/);
  });

  it('applies the built-in defaults for the runtime limits', () => {
    const cfg = read({ providers, defaultModel: 'openai:gpt-4o' });
    expect(cfg.maxSteps).toBe(10);
    expect(cfg.toolResultMaxChars).toBe(30000);
    expect(cfg.requestBodyLimit).toBe('10mb');
    expect(cfg.builtinActions).toBe(false);
    expect(cfg.mcpServers.size).toBe(0);
  });

  it('leaves connectTimeoutMs unset when neither level configures it', () => {
    const cfg = read({
      providers,
      defaultModel: 'openai:gpt-4o',
      mcp: { servers: { docs: { url: 'http://mcp.local/docs' } } },
    });
    expect(cfg.mcpServers.get('docs')?.connectTimeoutMs).toBeUndefined();
  });

  it('resolves connectTimeoutMs per server, then global', () => {
    const cfg = read({
      providers,
      defaultModel: 'openai:gpt-4o',
      mcp: {
        connectTimeoutMs: 5000,
        servers: {
          fast: { url: 'http://mcp.local/fast' },
          slow: { url: 'http://mcp.local/slow', connectTimeoutMs: 30000 },
        },
      },
    });
    expect(cfg.mcpServers.get('fast')?.connectTimeoutMs).toBe(5000);
    expect(cfg.mcpServers.get('slow')?.connectTimeoutMs).toBe(30000);
  });

  it('rejects a non-positive connectTimeoutMs', () => {
    expect(() =>
      read({
        providers,
        defaultModel: 'openai:gpt-4o',
        mcp: { connectTimeoutMs: 0 },
      }),
    ).toThrow(/assistants\.mcp\.connectTimeoutMs/);
  });

  it('flattens the approval floor with per-server entries namespaced', () => {
    const cfg = read({
      providers,
      defaultModel: 'openai:gpt-4o',
      requireApproval: ['delete-entity'],
      mcp: {
        servers: {
          github: {
            url: 'http://mcp.local/github',
            requireApproval: ['create_issue'],
          },
        },
      },
    });
    expect([...cfg.requireApproval].sort()).toEqual([
      'delete-entity',
      'github__create_issue',
    ]);
  });

  it('rejects a defaultModel outside the pool', () => {
    expect(() => read({ providers, defaultModel: 'openai:nope' })).toThrow(
      /defaultModel/,
    );
  });
});

describe('effectiveApprovalSet', () => {
  const floor = new Set([
    'delete-entity',
    'github__create_issue',
    'jira__transition',
  ]);

  it('is the floor intersected with the assistant allowlist', () => {
    expect(
      effectiveApprovalSet(['search-catalog', 'delete-entity'], floor),
    ).toEqual(['delete-entity']);
  });

  it('matches namespaced <server>__<tool> entries', () => {
    expect(
      effectiveApprovalSet(
        ['github__create_issue', 'github__list_issues'],
        floor,
      ),
    ).toEqual(['github__create_issue']);
  });

  it('ignores floor entries the assistant cannot use', () => {
    expect(effectiveApprovalSet(['search-catalog'], floor)).toEqual([]);
    expect(effectiveApprovalSet([], floor)).toEqual([]);
  });

  it('is empty when no floor is configured', () => {
    expect(effectiveApprovalSet(['delete-entity'], new Set())).toEqual([]);
  });
});
