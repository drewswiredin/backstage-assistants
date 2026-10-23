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
