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

  it('namespaces per-server approval entries the way tool names are', () => {
    const cfg = read({
      providers,
      defaultModel: 'openai:gpt-4o',
      mcp: {
        servers: {
          'team:tools': {
            url: 'http://mcp.local/team',
            requireApproval: ['deploy'],
          },
        },
      },
    });
    expect([...cfg.requireApproval]).toEqual(['team_tools__deploy']);
  });

  it('rejects a defaultModel outside the pool', () => {
    expect(() => read({ providers, defaultModel: 'openai:nope' })).toThrow(
      /defaultModel/,
    );
  });

  it('resolves a provider type from the configured type, not the id', () => {
    const cfg = read({
      providers: {
        claude: {
          type: 'anthropic',
          apiKey: 'sk-ant-test',
          models: [{ name: 'claude-sonnet-4' }],
        },
        anthropic: {
          type: 'openai-compatible',
          apiKey: 'sk-test',
          baseUrl: 'http://llm.local/v1',
          models: [{ name: 'llama-3' }],
        },
      },
      defaultModel: 'claude:claude-sonnet-4',
    });
    expect(cfg.resolveProviderType('claude:claude-sonnet-4')).toBe('anthropic');
    expect(cfg.resolveProviderType('anthropic:llama-3')).toBe(
      'openai-compatible',
    );
    expect(cfg.resolveProviderType('anthropic:nope')).toBeUndefined();
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

describe('per-user MCP servers and guards', () => {
  const withServer = (server: JsonObject) =>
    read({
      providers,
      defaultModel: 'openai:gpt-4o',
      mcp: { servers: { github: server } },
    });

  it('reads userCredentials with the header defaults and the provider title', () => {
    const cfg = withServer({
      url: 'https://mcp.example.com/',
      headers: { 'X-MCP-Toolsets': 'repos' },
      userCredentials: { provider: 'github', host: 'github.com' },
    });
    expect(cfg.mcpServers.get('github')?.userCredentials).toEqual({
      provider: 'github',
      host: 'github.com',
      title: 'GitHub',
      header: 'Authorization',
      scheme: 'Bearer',
    });
  });

  it('rejects a static credential in the per-user header, ignoring case', () => {
    expect(() =>
      withServer({
        url: 'https://mcp.example.com/',
        headers: { authorization: 'Bearer shared' },
        userCredentials: { provider: 'github' },
      }),
    ).toThrow(/headers\.Authorization is the per-user token/);
  });

  it('requires env for a per-user stdio server and rejects a static value there', () => {
    expect(() =>
      withServer({
        transport: 'stdio',
        command: 'github-mcp-server',
        userCredentials: { provider: 'github' },
      }),
    ).toThrow(/set 'env'/);
    expect(() =>
      withServer({
        transport: 'stdio',
        command: 'github-mcp-server',
        env: { GITHUB_TOKEN: 'shared' },
        userCredentials: { provider: 'github', env: 'GITHUB_TOKEN' },
      }),
    ).toThrow(/env\.GITHUB_TOKEN is the per-user token/);
  });

  it("approves a per-user server's gated tools call by call unless it opts in", () => {
    const perCall = withServer({
      url: 'https://mcp.example.com/',
      userCredentials: { provider: 'github' },
      requireApproval: ['create_branch'],
    });
    expect([...perCall.requireApproval]).toEqual(['github__create_branch']);
    expect([...perCall.approveEachCall]).toEqual(['github__create_branch']);

    const standing = withServer({
      url: 'https://mcp.example.com/',
      userCredentials: { provider: 'github' },
      allowStandingApproval: true,
      requireApproval: ['create_branch'],
    });
    expect(standing.approveEachCall.size).toBe(0);

    const shared = withServer({
      url: 'https://mcp.example.com/',
      requireApproval: ['create_branch'],
    });
    expect(shared.approveEachCall.size).toBe(0);
  });

  it('compiles argument rules once and rejects bad ones', () => {
    const cfg = withServer({
      url: 'https://mcp.example.com/',
      argumentRules: {
        create_pull_request: {
          head: { pattern: '^backstage-assistant/' },
          draft: { equals: true },
        },
      },
    });
    const rules = cfg.mcpServers.get('github')?.argumentRules;
    expect(rules?.create_pull_request.head.pattern).toBeInstanceOf(RegExp);
    expect(rules?.create_pull_request.draft.equals).toBe(true);

    expect(() =>
      withServer({
        url: 'https://mcp.example.com/',
        argumentRules: { create_branch: { branch: { pattern: '(' } } },
      }),
    ).toThrow(/argumentRules\.create_branch\.branch\.pattern is not a valid/);
    expect(() =>
      withServer({
        url: 'https://mcp.example.com/',
        argumentRules: { create_branch: { branch: {} } },
      }),
    ).toThrow(/needs 'pattern' or 'equals'/);
  });

  it('reads approval previews and requires their fields', () => {
    const cfg = withServer({
      url: 'https://mcp.example.com/',
      approvalPreview: {
        create_or_update_file: {
          type: 'file',
          fields: { repo: '{owner}/{repo}', path: 'path', content: 'content' },
          base: { tool: 'get_file_contents', args: { path: 'path' } },
        },
      },
    });
    expect(
      cfg.mcpServers.get('github')?.approvalPreview?.create_or_update_file,
    ).toEqual({
      type: 'file',
      fields: { repo: '{owner}/{repo}', path: 'path', content: 'content' },
      base: { tool: 'get_file_contents', args: { path: 'path' } },
    });
    expect(() =>
      withServer({
        url: 'https://mcp.example.com/',
        approvalPreview: { push_files: { type: 'files', fields: {} } },
      }),
    ).toThrow(/fields\.files is required/);
  });
});

describe('servers that run their own OAuth', () => {
  const KEY = Buffer.alloc(32, 7).toString('base64');
  const withOAuth = (server: JsonObject, oauth?: JsonObject) =>
    read({
      providers,
      defaultModel: 'openai:gpt-4o',
      mcp: {
        ...(oauth ? { oauth } : {}),
        servers: { tracker: server },
      },
    });

  it('reads the server and the encryption keys', () => {
    const cfg = withOAuth(
      {
        url: 'https://mcp.example.com/v1/mcp',
        userCredentials: { provider: 'oauth', scopes: ['read:me'] },
      },
      {
        encryptionKey: KEY,
        previousEncryptionKeys: [Buffer.alloc(32, 1).toString('base64')],
      },
    );
    expect(cfg.mcpServers.get('tracker')?.userCredentials).toEqual({
      provider: 'oauth',
      scopes: ['read:me'],
      title: 'tracker',
      header: 'Authorization',
      scheme: 'Bearer',
    });
    expect(cfg.mcpOAuthKeys?.map(k => k.toString('base64'))).toEqual([
      KEY,
      Buffer.alloc(32, 1).toString('base64'),
    ]);
  });

  it('refuses to start without a valid encryption key', () => {
    const server = {
      url: 'https://mcp.example.com/v1/mcp',
      userCredentials: { provider: 'oauth', title: 'Tracker' },
    };
    expect(() => withOAuth(server)).toThrow(
      /assistants\.mcp\.oauth\.encryptionKey is required/,
    );
    expect(() => withOAuth(server, { encryptionKey: 'c2hvcnQ=' })).toThrow(
      /encryptionKey must be 32 bytes/,
    );
  });

  it('needs no key without such a server', () => {
    expect(
      withOAuth({
        url: 'https://mcp.example.com/',
        userCredentials: { provider: 'github' },
      }).mcpOAuthKeys,
    ).toBeUndefined();
  });

  it('rejects stdio and contradictory client settings', () => {
    const oauth = { encryptionKey: KEY };
    expect(() =>
      withOAuth(
        {
          transport: 'stdio',
          command: 'x',
          userCredentials: { provider: 'oauth', env: 'TOKEN' },
        },
        oauth,
      ),
    ).toThrow(/remote \(http or sse\)/);
    expect(() =>
      withOAuth(
        {
          url: 'https://mcp.example.com/',
          userCredentials: { provider: 'oauth', clientSecret: 's' },
        },
        oauth,
      ),
    ).toThrow(/clientSecret needs clientId/);
    expect(() =>
      withOAuth(
        {
          url: 'https://mcp.example.com/',
          userCredentials: {
            provider: 'oauth',
            clientId: 'c',
            clientMetadataDocument: true,
          },
        },
        oauth,
      ),
    ).toThrow(/not both/);
  });
});

describe('elicitation', () => {
  const withServers = (mcp: JsonObject) =>
    read({ providers, defaultModel: 'openai:gpt-4o', mcp });

  it('is on for per-user servers and off for shared ones unless set', () => {
    const cfg = withServers({
      servers: {
        mine: {
          url: 'https://a.example.com/',
          userCredentials: { provider: 'github' },
        },
        shared: { url: 'https://b.example.com/' },
        sharedOn: { url: 'https://c.example.com/', elicitation: true },
        mineOff: {
          url: 'https://d.example.com/',
          userCredentials: { provider: 'github' },
          elicitation: false,
        },
      },
    });
    expect(
      [...cfg.mcpServers.values()].map(s => [s.id, s.elicitation]),
    ).toEqual([
      ['mine', true],
      ['shared', false],
      ['sharedOn', true],
      ['mineOff', false],
    ]);
    expect(cfg.elicitationTimeoutMs).toBe(300_000);
  });

  it('reads and checks the timeout', () => {
    expect(
      withServers({ elicitationTimeoutMs: 1000 }).elicitationTimeoutMs,
    ).toBe(1000);
    expect(() => withServers({ elicitationTimeoutMs: 0 })).toThrow(
      /elicitationTimeoutMs must be a positive/,
    );
  });
});

describe('readConfig with contributed provider types', () => {
  const model = { specificationVersion: 'v4' } as never;
  const turns: unknown[] = [];
  const factory = jest.fn((_options: { providerId: string; config: any }) => {
    return {
      runsOwnToolLoop: true,
      languageModel: (name: string, turn: unknown) => {
        turns.push([name, turn]);
        return model;
      },
      reasoningOptions: (name: string, level: string) => ({
        claude: { effort: `${name}:${level}` },
      }),
    };
  });
  const assistants = {
    providers: {
      claude: {
        type: 'claude-subscription',
        models: [{ name: 'opus', reasoning: true }, { name: 'haiku' }],
      },
    },
    defaultModel: 'claude:opus',
  };

  beforeEach(() => {
    factory.mockClear();
    turns.length = 0;
  });

  it('builds the provider with its config block and resolves its models', () => {
    const cfg = readConfig(new ConfigReader({ assistants }), {
      providerTypes: new Map([['claude-subscription', factory]]),
    });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls[0][0].providerId).toBe('claude');
    expect(factory.mock.calls[0][0].config.getString('type')).toBe(
      'claude-subscription',
    );
    expect(cfg.models.map(m => m.id)).toEqual(['claude:opus', 'claude:haiku']);
    expect(cfg.resolveProviderType('claude:opus')).toBe('claude-subscription');
    expect(cfg.runsOwnToolLoop('claude:opus')).toBe(true);

    const turn = { tools: {}, abortSignal: new AbortController().signal };
    expect(cfg.resolveModel('claude:haiku', turn)).toBe(model);
    expect(turns).toEqual([['haiku', turn]]);
  });

  it('asks the provider for reasoning options only for reasoning models', () => {
    const cfg = readConfig(new ConfigReader({ assistants }), {
      providerTypes: new Map([['claude-subscription', factory]]),
    });
    expect(cfg.resolveReasoning('claude:opus', 'high')).toEqual({
      claude: { effort: 'opus:high' },
    });
    expect(cfg.resolveReasoning('claude:haiku', 'high')).toBeUndefined();
  });

  it('names contributed types when a type is unknown', () => {
    expect(() =>
      readConfig(
        new ConfigReader({
          assistants: {
            ...assistants,
            providers: {
              claude: { ...assistants.providers.claude, type: 'nope' },
            },
          },
        }),
        { providerTypes: new Map([['claude-subscription', factory]]) },
      ),
    ).toThrow(/Supported types: .*claude-subscription/);
  });

  it('runs no tool loop for built-in providers', () => {
    const cfg = read({ providers, defaultModel: 'openai:gpt-4o' });
    expect(cfg.runsOwnToolLoop('openai:gpt-4o')).toBe(false);
  });
});
