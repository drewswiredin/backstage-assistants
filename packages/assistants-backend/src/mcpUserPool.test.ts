import type { LoggerService } from '@backstage/backend-plugin-api';
import type { McpServerConfig } from './config';
import {
  buildMcpTools,
  closeMcpPool,
  maintainMcpConnections,
  userConnectionCount,
  type McpToolCallEvent,
} from './mcp';

/** Every client the mocked library opened, with the headers it was given. */
const opened: Array<{
  headers?: Record<string, string>;
  callTool: jest.Mock;
  close: jest.Mock;
}> = [];

jest.mock('@ai-sdk/mcp', () => ({
  createMCPClient: jest.fn(
    async ({
      transport,
    }: {
      transport: { headers?: Record<string, string> };
    }) => {
      if (transport.headers?.Authorization === 'Bearer revoked') {
        throw new Error('HTTP 401: Bad credentials');
      }
      const client = {
        headers: transport.headers,
        listTools: jest.fn(async () => ({
          tools: [
            { name: 'get_me', inputSchema: { type: 'object' } },
            { name: 'create_branch', inputSchema: { type: 'object' } },
          ],
        })),
        callTool: jest.fn(async () => ({
          content: [{ type: 'text', text: 'ok' }],
        })),
        close: jest.fn(async () => {}),
      };
      opened.push(client);
      return client;
    },
  ),
}));
jest.mock('@ai-sdk/mcp/mcp-stdio', () => ({
  Experimental_StdioMCPTransport: jest.fn(),
}));

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as LoggerService;

const github: McpServerConfig = {
  id: 'github',
  transport: 'http',
  url: 'https://mcp.example.com/',
  headers: { 'X-MCP-Toolsets': 'repos' },
  userCredentials: {
    provider: 'github',
    title: 'GitHub',
    header: 'Authorization',
    scheme: 'Bearer',
  },
  argumentRules: {
    create_branch: { branch: { pattern: /^backstage-assistant\// } },
  },
};
const selection = [{ server: github, tools: ['get_me', 'create_branch'] }];

const asUser = (userEntityRef: string, token?: string) => ({
  caller: {
    userEntityRef,
    credentials: token ? { github: token } : ({} as Record<string, string>),
  },
});

const run = (tool: unknown, input: unknown) =>
  (tool as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute(
    input,
    { toolCallId: 'c1', messages: [] },
  );

afterEach(async () => {
  await closeMcpPool();
  opened.length = 0;
  jest.useRealTimers();
});

describe('per-user MCP connections', () => {
  it("offers no tools without the user's token, and says why", async () => {
    const { tools, unavailable } = await buildMcpTools(
      selection,
      logger,
      0,
      asUser('user:default/ana'),
    );
    expect(tools).toEqual({});
    expect(unavailable).toEqual([{ server: github }]);
    expect(opened).toHaveLength(0);
  });

  it("connects with the user's token in the configured header", async () => {
    const { tools } = await buildMcpTools(
      selection,
      logger,
      0,
      asUser('user:default/ana', 'ghu_ana'),
    );
    expect(Object.keys(tools)).toEqual([
      'github__get_me',
      'github__create_branch',
    ]);
    expect(opened[0].headers).toEqual({
      'X-MCP-Toolsets': 'repos',
      Authorization: 'Bearer ghu_ana',
    });
  });

  it('gives two users two clients and reuses each while the token holds', async () => {
    await buildMcpTools(
      selection,
      logger,
      0,
      asUser('user:default/ana', 'ghu_ana'),
    );
    await buildMcpTools(
      selection,
      logger,
      0,
      asUser('user:default/bo', 'ghu_bo'),
    );
    await buildMcpTools(
      selection,
      logger,
      0,
      asUser('user:default/ana', 'ghu_ana'),
    );
    expect(opened).toHaveLength(2);
    expect(userConnectionCount()).toBe(2);
  });

  it('reconnects when the token changes and closes the old client', async () => {
    await buildMcpTools(
      selection,
      logger,
      0,
      asUser('user:default/ana', 'ghu_old'),
    );
    await buildMcpTools(
      selection,
      logger,
      0,
      asUser('user:default/ana', 'ghu_new'),
    );
    expect(opened).toHaveLength(2);
    expect(opened[0].close).toHaveBeenCalled();
    expect(opened[1].headers?.Authorization).toBe('Bearer ghu_new');
    expect(userConnectionCount()).toBe(1);
  });

  it("reports the server's message when it rejects the token", async () => {
    const { tools, unavailable } = await buildMcpTools(
      selection,
      logger,
      0,
      asUser('user:default/ana', 'revoked'),
    );
    expect(tools).toEqual({});
    expect(unavailable[0].error).toBe('HTTP 401: Bad credentials');
  });

  it('closes connections idle for ten minutes', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-22T10:00:00Z') });
    await buildMcpTools(
      selection,
      logger,
      0,
      asUser('user:default/ana', 'ghu_ana'),
    );
    jest.setSystemTime(Date.parse('2026-10-22T10:11:00Z'));
    await maintainMcpConnections([github], logger);
    expect(userConnectionCount()).toBe(0);
    expect(opened[0].close).toHaveBeenCalled();
  });

  it('keeps at most 200 connections, closing the least recently used', async () => {
    for (let i = 0; i < 201; i++) {
      await buildMcpTools(
        selection,
        logger,
        0,
        asUser(`user:default/u${i}`, `t${i}`),
      );
    }
    expect(userConnectionCount()).toBe(200);
    expect(opened[0].close).toHaveBeenCalled();
    expect(opened[200].close).not.toHaveBeenCalled();
  });

  it('rejects a call that breaks an argument rule without calling the server', async () => {
    const events: McpToolCallEvent[] = [];
    const { tools } = await buildMcpTools(selection, logger, 0, {
      ...asUser('user:default/ana', 'ghu_ana'),
      onCall: event => events.push(event),
    });
    expect(await run(tools.github__create_branch, { branch: 'main' })).toEqual({
      _error: true,
      message: `create_branch: 'branch' must match ^backstage-assistant\\/ (got "main")`,
    });
    expect(opened[0].callTool).not.toHaveBeenCalled();
    expect(events.map(e => e.outcome)).toEqual(['rejected-by-rule']);

    await run(tools.github__create_branch, { branch: 'backstage-assistant/x' });
    expect(opened[0].callTool).toHaveBeenCalledTimes(1);
    expect(events.map(e => e.outcome)).toEqual([
      'rejected-by-rule',
      'executed',
    ]);
  });

  it('leaves shared servers on the pooled connection', async () => {
    const shared: McpServerConfig = {
      id: 'docs',
      transport: 'http',
      url: 'http://docs',
    };
    await maintainMcpConnections([shared, github], logger);
    // Only the shared server is probed; the per-user one has no token to use.
    expect(opened).toHaveLength(1);
    const { tools } = await buildMcpTools(
      [{ server: shared, tools: ['get_me'] }],
      logger,
      0,
    );
    expect(Object.keys(tools)).toEqual(['docs__get_me']);
    expect(userConnectionCount()).toBe(0);
  });

  describe('a server that runs its own OAuth', () => {
    const tracker: McpServerConfig = {
      id: 'tracker',
      transport: 'http',
      url: 'https://tracker.example.com/mcp',
      userCredentials: {
        provider: 'oauth',
        title: 'Tracker',
        header: 'Authorization',
        scheme: 'Bearer',
      },
    };
    const trackerSelection = [{ server: tracker, tools: ['get_me'] }];

    /** A caller whose backend-held token is `current`, refreshed to `next` once refused. */
    function oauthCaller(current: string, next?: string) {
      const oauthToken = jest.fn(
        async (_server: McpServerConfig, options?: { rejected?: string }) =>
          options?.rejected ? next : current,
      );
      return {
        oauthToken,
        options: {
          caller: {
            userEntityRef: 'user:default/ana',
            // A token the browser sent for it is ignored.
            credentials: { tracker: 'from-browser' },
            oauthToken,
          },
        },
      };
    }

    it('connects with the backend-held token', async () => {
      const { options } = oauthCaller('at_1');
      const { tools } = await buildMcpTools(
        trackerSelection,
        logger,
        0,
        options,
      );
      expect(Object.keys(tools)).toEqual(['tracker__get_me']);
      expect(opened[0].headers?.Authorization).toBe('Bearer at_1');
    });

    it('offers no tools when the user is not connected', async () => {
      const { options } = oauthCaller(undefined as unknown as string);
      const { tools, unavailable } = await buildMcpTools(
        trackerSelection,
        logger,
        0,
        options,
      );
      expect(tools).toEqual({});
      expect(unavailable).toEqual([{ server: tracker }]);
    });

    it('refreshes a token refused at connect and connects again', async () => {
      const { options, oauthToken } = oauthCaller('revoked', 'at_2');
      const { tools } = await buildMcpTools(
        trackerSelection,
        logger,
        0,
        options,
      );
      expect(Object.keys(tools)).toEqual(['tracker__get_me']);
      expect(oauthToken).toHaveBeenLastCalledWith(tracker, {
        rejected: 'revoked',
      });
      expect(opened[0].headers?.Authorization).toBe('Bearer at_2');
    });

    it('refreshes a token refused mid-turn and retries the call once', async () => {
      const { options, oauthToken } = oauthCaller('at_1', 'at_2');
      const { tools } = await buildMcpTools(
        trackerSelection,
        logger,
        0,
        options,
      );
      opened[0].callTool.mockRejectedValueOnce(
        new Error('MCP HTTP Transport Error: POSTing to endpoint (HTTP 401): '),
      );
      expect(await run(tools.tracker__get_me, {})).toEqual([
        { type: 'text', text: 'ok' },
      ]);
      expect(oauthToken).toHaveBeenCalledWith(tracker, { rejected: 'at_1' });
      expect(opened[1].headers?.Authorization).toBe('Bearer at_2');
      expect(opened[1].callTool).toHaveBeenCalledTimes(1);
    });

    it('tells the model to reconnect when the refresh fails', async () => {
      const { options } = oauthCaller('at_1', undefined);
      const { tools } = await buildMcpTools(
        trackerSelection,
        logger,
        0,
        options,
      );
      opened[0].callTool.mockRejectedValueOnce(new Error('HTTP 401'));
      expect(await run(tools.tracker__get_me, {})).toEqual({
        _error: true,
        message: 'The Tracker sign-in expired; reconnect Tracker',
      });
    });
  });
});
