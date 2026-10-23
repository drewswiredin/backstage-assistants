import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { ConfigReader } from '@backstage/config';
import { MockLanguageModelV4 } from 'ai/test';
import type { AssistantDefinition } from '@drewswiredin/backstage-plugin-assistants-common';
import { readConfig } from './config';
import { closeMcpPool } from './mcp';
import {
  approvalDecisions,
  createRouter,
  unavailableServerInstructions,
} from './router';

const TOKEN = 'ghu_secret_token_value';

/** Every MCP client the mocked library opened. */
const opened: Array<{
  headers?: Record<string, string>;
  callTool: jest.Mock;
}> = [];

jest.mock('@ai-sdk/mcp', () => ({
  createMCPClient: jest.fn(
    async ({
      transport,
    }: {
      transport: { headers?: Record<string, string> };
    }) => {
      const client = {
        headers: transport.headers,
        listTools: jest.fn(async () => ({
          tools: [
            {
              name: 'create_or_update_file',
              inputSchema: { type: 'object' },
            },
            { name: 'get_file_contents', inputSchema: { type: 'object' } },
          ],
        })),
        callTool: jest.fn(
          async ({ arguments: args }: { arguments: { path: string } }) =>
            args.path === 'deploy.yaml'
              ? {
                  content: [
                    {
                      type: 'resource',
                      resource: { uri: 'x', text: 'replicas: 1\n' },
                    },
                  ],
                }
              : {
                  isError: true,
                  content: [{ type: 'text', text: '404 Not Found' }],
                },
        ),
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

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const streamOf = (parts: unknown[]) => ({
  stream: new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  }),
});

/** A model that writes to `main` (breaking the branch rule), then answers. */
function makeModel() {
  return new MockLanguageModelV4({
    doStream: [
      streamOf([
        { type: 'stream-start', warnings: [] },
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'github__create_or_update_file',
          input: JSON.stringify({
            owner: 'acme',
            repo: 'pylon',
            branch: 'main',
            path: 'deploy.yaml',
            content: 'replicas: 2\n',
          }),
        },
        {
          type: 'finish',
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
          usage,
        },
      ]),
      streamOf([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'done' },
        { type: 'text-end', id: 't1' },
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'stop' },
          usage,
        },
      ]),
    ] as never,
  });
}

const assistant: AssistantDefinition = {
  id: 'ops',
  title: 'Ops',
  prompt: 'You help with repositories.',
  models: [],
  allowedTools: ['github__create_or_update_file'],
  access: { allowAuthenticated: true, users: [], groups: [] },
} as unknown as AssistantDefinition;

async function startApp(model = makeModel()) {
  const config = readConfig(
    new ConfigReader({
      assistants: {
        providers: {
          openai: {
            type: 'openai',
            apiKey: 'placeholder',
            models: [{ name: 'gpt-test' }],
          },
        },
        defaultModel: 'openai:gpt-test',
        mcp: {
          servers: {
            github: {
              url: 'https://mcp.example.com/',
              userCredentials: { provider: 'github', host: 'github.com' },
              requireApproval: ['create_or_update_file'],
              argumentRules: {
                create_or_update_file: {
                  branch: { pattern: '^backstage-assistant/' },
                },
              },
              approvalPreview: {
                create_or_update_file: {
                  type: 'file',
                  fields: { path: 'path', content: 'content' },
                  base: {
                    tool: 'get_file_contents',
                    args: { owner: 'owner', repo: 'repo', path: 'path' },
                  },
                },
              },
            },
          },
        },
      },
    }),
  );
  const assistants = { ...config, resolveModel: () => model };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const threadService = {
    getThread: jest.fn(async () => ({ id: 'thread-1' })),
    replaceMessages: jest.fn(async () => {}),
    startTurn: jest.fn(async () => {}),
    heartbeatTurn: jest.fn(async () => false),
    endTurn: jest.fn(async () => {}),
    isTurnRunning: jest.fn(async () => false),
    updateThread: jest.fn(async () => {}),
    getMessages: jest.fn(async () => []),
  };
  const router = await createRouter({
    logger: logger as unknown as LoggerService,
    httpAuth: { credentials: jest.fn(async () => ({ principal: {} })) },
    userInfo: {
      getUserInfo: jest.fn(async () => ({
        userEntityRef: 'user:default/ana',
        ownershipEntityRefs: ['user:default/ana'],
      })),
    },
    permissions: {
      authorize: jest.fn(async () => [{ result: 'ALLOW' }]),
    },
    actions: { list: jest.fn(async () => ({ actions: [] })) },
    assistants,
    assistantStore: {
      getById: jest.fn(async () => assistant),
      effectiveModels: () => ['openai:gpt-test'],
      list: () => [assistant],
      getDefaultId: () => 'ops',
      summaryFor: (a: AssistantDefinition) => ({ id: a.id, title: a.title }),
    },
    threadService,
    streamBuffer: {
      begin: jest.fn(async () => 'turn-1'),
      record: jest.fn(),
      follow: jest.fn(async () => false),
    },
    signals: { publish: jest.fn(async () => {}) },
  } as never);
  // The backend's error middleware maps Backstage errors to statuses.
  const app = express()
    .use(router)
    .use(
      (
        error: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        res.status(error.name === 'InputError' ? 400 : 500).end();
      },
    );
  const server: Server = await new Promise(resolve => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, server, logger, threadService, model };
}

const credentialsHeader = {
  'x-assistants-credentials': Buffer.from(
    JSON.stringify({ github: TOKEN }),
  ).toString('base64'),
};

const chatBody = {
  assistantId: 'ops',
  modelId: 'openai:gpt-test',
  threadId: 'thread-1',
  messages: [
    { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'scale it' }] },
  ],
};

async function waitFor(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) {
    await new Promise(r => setTimeout(r, 20));
  }
}

let server: Server | undefined;
afterEach(async () => {
  server?.close();
  server = undefined;
  await closeMcpPool();
  opened.length = 0;
});

describe('/chat with a per-user MCP server', () => {
  it('connects as the user and keeps the token out of messages and logs', async () => {
    const app = await startApp();
    server = app.server;
    const response = await fetch(`${app.base}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...credentialsHeader },
      body: JSON.stringify(chatBody),
    });
    expect(response.status).toBe(200);
    await response.text();
    await waitFor(
      () => app.threadService.replaceMessages.mock.calls.length >= 2,
    );

    expect(opened[0].headers?.Authorization).toBe(`Bearer ${TOKEN}`);
    const stored = JSON.stringify(app.threadService.replaceMessages.mock.calls);
    expect(stored).toContain('done');
    expect(stored).not.toContain(TOKEN);
    const logged = JSON.stringify([
      app.logger.info.mock.calls,
      app.logger.warn.mock.calls,
      app.logger.error.mock.calls,
      app.logger.debug.mock.calls,
    ]);
    expect(logged).not.toContain(TOKEN);
  });

  it('denies a call that breaks an argument rule before asking, and audits it', async () => {
    const app = await startApp();
    server = app.server;
    const response = await fetch(`${app.base}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...credentialsHeader },
      body: JSON.stringify(chatBody),
    });
    const stream = await response.text();
    // Denied by the server on the spot (`isAutomatic`): the user is never asked.
    expect(stream).toContain('"type":"tool-approval-request"');
    expect(stream).toContain('"isAutomatic":true');
    expect(stream).toContain(
      `"approved":false,"reason":"create_or_update_file: 'branch' must match`,
    );
    expect(opened[0].callTool).not.toHaveBeenCalled();
    expect(app.logger.info).toHaveBeenCalledWith('assistants.tool.audit', {
      user: 'user:default/ana',
      assistantId: 'ops',
      threadId: 'thread-1',
      server: 'github',
      tool: 'create_or_update_file',
      decision: 'rejected-by-rule',
      target: {
        owner: 'acme',
        repo: 'pylon',
        branch: 'main',
        path: 'deploy.yaml',
      },
    });
  });

  it("offers no tools without the user's token and tells the model why", async () => {
    const app = await startApp();
    server = app.server;
    const response = await fetch(`${app.base}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(chatBody),
    });
    await response.text();
    const call = app.model.doStreamCalls[0];
    expect(call.tools ?? []).toEqual([]);
    expect(JSON.stringify(call.prompt)).toContain(
      `hasn't connected GitHub. Ask them to click \\"Connect GitHub\\"`,
    );
    expect(opened).toHaveLength(0);
  });
});

describe('/preview', () => {
  it('reads the current content as the user, and a missing file as new', async () => {
    const app = await startApp();
    server = app.server;
    const preview = (path: string) =>
      fetch(`${app.base}/preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...credentialsHeader },
        body: JSON.stringify({
          assistantId: 'ops',
          tool: 'github__create_or_update_file',
          input: { owner: 'acme', repo: 'pylon', path, content: 'x' },
        }),
      }).then(r => r.json());

    expect(await preview('deploy.yaml')).toEqual({
      files: [{ path: 'deploy.yaml', exists: true, content: 'replicas: 1\n' }],
    });
    expect(await preview('new.yaml')).toEqual({
      files: [{ path: 'new.yaml', exists: false }],
    });
    expect(opened).toHaveLength(1);
    expect(opened[0].headers?.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(opened[0].callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'get_file_contents',
        arguments: { owner: 'acme', repo: 'pylon', path: 'deploy.yaml' },
      }),
    );
  });

  it('refuses a tool the assistant has no preview for', async () => {
    const app = await startApp();
    server = app.server;
    const response = await fetch(`${app.base}/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...credentialsHeader },
      body: JSON.stringify({
        assistantId: 'ops',
        tool: 'github__get_file_contents',
        input: { path: 'deploy.yaml' },
      }),
    });
    expect(response.status).toBe(400);
  });
});

describe('approvalDecisions', () => {
  it('finds answered calls in the last assistant message that have not run', () => {
    expect(
      approvalDecisions([
        { role: 'user', parts: [] },
        {
          role: 'assistant',
          parts: [
            {
              type: 'tool-github__create_branch',
              state: 'approval-responded',
              input: { branch: 'backstage-assistant/x' },
              approval: { id: 'a1', approved: true },
            },
            {
              type: 'dynamic-tool',
              toolName: 'github__push_files',
              state: 'approval-responded',
              input: {},
              approval: { id: 'a2', approved: false },
            },
            {
              type: 'tool-github__get_me',
              state: 'output-available',
              approval: { id: 'a3', approved: true },
            },
          ],
        },
      ]),
    ).toEqual([
      {
        toolName: 'github__create_branch',
        approved: true,
        input: { branch: 'backstage-assistant/x' },
      },
      { toolName: 'github__push_files', approved: false, input: {} },
    ]);
  });
});

describe('unavailableServerInstructions', () => {
  const github = {
    id: 'github',
    transport: 'http' as const,
    userCredentials: {
      provider: 'github',
      title: 'GitHub',
      header: 'Authorization',
      scheme: 'Bearer',
    },
  };

  it('is nothing when every server is available', () => {
    expect(unavailableServerInstructions([])).toBeUndefined();
  });

  it('says to connect, or passes on why connecting failed', () => {
    expect(unavailableServerInstructions([{ server: github }])).toContain(
      'Ask them to click "Connect GitHub"',
    );
    expect(
      unavailableServerInstructions([{ server: github, error: 'HTTP 401' }]),
    ).toContain('failed (HTTP 401)');
  });
});
