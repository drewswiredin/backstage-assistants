import knexFactory, { type Knex } from 'knex';
import type { ElicitationRequest } from '@ai-sdk/mcp';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { ElicitationPrompt } from '@drewswiredin/backstage-plugin-assistants-common';
import type { McpServerConfig } from './config';
import {
  ElicitationBroker,
  ElicitationRefused,
  type ElicitationCall,
} from './mcpElicitation';
import { ThreadService } from './threads';

const ANA = 'user:default/ana';
const BO = 'user:default/bo';

const server: McpServerConfig = {
  id: 'ado',
  transport: 'http',
  url: 'https://ado.example.com/mcp',
  userCredentials: {
    provider: 'microsoft',
    title: 'Azure DevOps',
    header: 'Authorization',
    scheme: 'Bearer',
  },
  elicitation: true,
};

const projectQuestion = (extra: Record<string, unknown> = {}) =>
  ({
    method: 'elicitation/create',
    params: {
      mode: 'form',
      message: 'Select the Azure DevOps project.',
      requestedSchema: {
        type: 'object',
        required: ['project'],
        properties: {
          project: {
            type: 'string',
            title: 'Project',
            oneOf: [
              { const: 'Pylon', title: 'Pylon' },
              { const: 'Tally', title: 'Tally' },
            ],
          },
        },
      },
      ...extra,
    },
  } as ElicitationRequest);

describe('ElicitationBroker', () => {
  let db: Knex;
  let broker: ElicitationBroker;
  let logger: LoggerService;
  const client = {};

  function callFor(overrides: Partial<ElicitationCall> = {}) {
    const shown: ElicitationPrompt[] = [];
    const call: ElicitationCall = {
      userEntityRef: ANA,
      assistantId: 'ops',
      threadId: 't1',
      server,
      tool: 'wit_my_work_items',
      renders: true,
      show: prompt => shown.push(prompt),
      asked: 0,
      ...overrides,
    };
    return { call, shown };
  }

  /** Wait for the question to be shown, then return it. */
  async function opened(shown: ElicitationPrompt[]) {
    for (let i = 0; i < 50 && shown.length === 0; i++) {
      await new Promise(r => setTimeout(r, 5));
    }
    return shown[0];
  }

  beforeEach(async () => {
    db = knexFactory({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await new ThreadService(db).runMigrations();
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as LoggerService;
    broker = new ElicitationBroker({
      db,
      logger,
      timeoutMs: 60_000,
      pollMs: 10,
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('shows the question on the one call in flight and returns the answer to the server', async () => {
    const { call, shown } = callFor();
    const release = broker.track(client, call);
    const pending = broker.handle(client, server, projectQuestion());
    const prompt = await opened(shown);
    expect(prompt).toMatchObject({
      server: 'ado',
      serverTitle: 'Azure DevOps',
      tool: 'wit_my_work_items',
      message: 'Select the Azure DevOps project.',
      status: 'open',
    });
    expect(
      await broker.respond(prompt.id, ANA, {
        action: 'accept',
        content: { project: 'Pylon' },
      }),
    ).toEqual({ status: 204 });
    expect(await pending).toEqual({
      action: 'accept',
      content: { project: 'Pylon' },
    });
    expect(shown[1]).toMatchObject({
      status: 'accepted',
      answered: ['project'],
    });
    release();

    // The audit names the fields, never their values.
    const audit = JSON.stringify((logger.info as jest.Mock).mock.calls);
    expect(audit).toContain('"decision":"elicitation"');
    expect(audit).toContain('"fields":["project"]');
    expect(audit).not.toContain('Pylon"');
    // Once answered the row keeps the action, not the values, and a late
    // answer is told the question is gone.
    expect(
      (await db('mcp_elicitations').where({ id: prompt.id }).first())
        .response_json,
    ).toBe('{"action":"accept"}');
    expect(await broker.respond(prompt.id, ANA, { action: 'cancel' })).toEqual({
      status: 410,
    });
  });

  it('tells the call while a question is open, so its ceiling can pause', async () => {
    const waits: boolean[] = [];
    const { call, shown } = callFor({ onWait: w => waits.push(w) });
    broker.track(client, call);
    const pending = broker.handle(client, server, projectQuestion());
    const prompt = await opened(shown);
    expect(waits).toEqual([true]);
    await broker.respond(prompt.id, ANA, { action: 'decline' });
    await pending;
    expect(waits).toEqual([true, false]);
  });

  it('takes an answer posted to another replica', async () => {
    const other = new ElicitationBroker({ db, logger, timeoutMs: 60_000 });
    const { call, shown } = callFor();
    broker.track(client, call);
    const pending = broker.handle(client, server, projectQuestion());
    const prompt = await opened(shown);
    await other.respond(prompt.id, ANA, { action: 'decline' });
    expect(await pending).toEqual({ action: 'decline' });
  });

  it("refuses, as an error rather than the user's cancel, when no call or several users' calls are in flight", async () => {
    await expect(
      broker.handle(client, server, projectQuestion()),
    ).rejects.toThrow(ElicitationRefused);
    broker.track(client, callFor().call);
    broker.track(client, callFor({ userEntityRef: BO }).call);
    await expect(
      broker.handle(client, server, projectQuestion()),
    ).rejects.toThrow("several users' calls are in flight");
  });

  it("refuses when the browser can't show forms, for URL mode, and for unsupported schemas", async () => {
    const headless = callFor({ renders: false });
    const release = broker.track(client, headless.call);
    await expect(
      broker.handle(client, server, projectQuestion()),
    ).rejects.toThrow("the browser can't show forms");
    release();
    const { call, shown } = callFor();
    broker.track(client, call);
    await expect(
      broker.handle(client, server, projectQuestion({ mode: 'url' })),
    ).rejects.toThrow(ElicitationRefused);
    await expect(
      broker.handle(
        client,
        server,
        projectQuestion({
          requestedSchema: {
            type: 'object',
            properties: { where: { type: 'object' } },
          },
        }),
      ),
    ).rejects.toThrow(ElicitationRefused);
    expect(shown).toHaveLength(0);
  });

  it('allows three questions per call', async () => {
    const { call } = callFor({ asked: 3 });
    broker.track(client, call);
    await expect(
      broker.handle(client, server, projectQuestion()),
    ).rejects.toThrow('more than 3 questions');
  });

  it('shows a question on the call whose scope it arrives in, naming its tool', async () => {
    const items = callFor({ tool: 'wit_my_work_items' });
    const teams = callFor({ tool: 'core_list_project_teams' });
    broker.track(client, items.call);
    broker.track(client, teams.call);
    const pending = broker.within(teams.call, () =>
      broker.handle(client, server, projectQuestion()),
    );
    const prompt = await opened(teams.shown);
    expect(prompt.tool).toBe('core_list_project_teams');
    expect(items.shown).toHaveLength(0);
    await broker.respond(prompt.id, ANA, { action: 'decline' });
    expect(await pending).toEqual({ action: 'decline' });
  });

  it("shows two questions at once on two of a user's calls, each answered on its own", async () => {
    const items = callFor({ tool: 'wit_my_work_items' });
    const teams = callFor({ tool: 'core_list_project_teams' });
    broker.track(client, items.call);
    broker.track(client, teams.call);
    // Neither arrives in a call's scope (the standalone stream).
    const first = broker.handle(client, server, projectQuestion());
    const second = broker.handle(client, server, projectQuestion());
    const a = await opened(items.shown);
    const b = await opened(teams.shown);
    // Which call asked is unknown, so neither names a tool.
    expect(a.tool).toBeUndefined();
    expect(b.tool).toBeUndefined();
    await broker.respond(b.id, ANA, {
      action: 'accept',
      content: { project: 'Tally' },
    });
    await broker.respond(a.id, ANA, {
      action: 'accept',
      content: { project: 'Pylon' },
    });
    expect(await first).toEqual({
      action: 'accept',
      content: { project: 'Pylon' },
    });
    expect(await second).toEqual({
      action: 'accept',
      content: { project: 'Tally' },
    });
  });

  it('asks a second question on the same call once the first is answered', async () => {
    const { call, shown } = callFor();
    broker.track(client, call);
    const first = broker.within(call, () =>
      broker.handle(client, server, projectQuestion()),
    );
    const second = broker.within(call, () =>
      broker.handle(client, server, projectQuestion()),
    );
    const a = await opened(shown);
    await new Promise(r => setTimeout(r, 20));
    expect(shown).toHaveLength(1);
    await broker.respond(a.id, ANA, { action: 'decline' });
    expect(await first).toEqual({ action: 'decline' });
    for (let i = 0; i < 50 && shown.length < 3; i++) {
      await new Promise(r => setTimeout(r, 5));
    }
    expect(shown.map(p => p.status)).toEqual(['open', 'declined', 'open']);
    await broker.respond(shown[2].id, ANA, { action: 'decline' });
    expect(await second).toEqual({ action: 'decline' });
  });

  it('refuses another user, unknown and settled questions, and a wrong answer twice', async () => {
    const { call, shown } = callFor();
    broker.track(client, call);
    const pending = broker.handle(client, server, projectQuestion());
    const prompt = await opened(shown);
    expect(await broker.respond('nope', ANA, { action: 'cancel' })).toEqual({
      status: 404,
    });
    expect(await broker.respond(prompt.id, BO, { action: 'cancel' })).toEqual({
      status: 403,
    });
    expect(
      await broker.respond(prompt.id, ANA, {
        action: 'accept',
        content: { project: 'Elsewhere' },
      }),
    ).toEqual({ status: 400, errors: ['Project must be one of the choices'] });
    expect(
      await broker.respond(prompt.id, ANA, { action: 'accept', content: {} }),
    ).toEqual({
      status: 400,
      errors: ['Project is required', 'The question was cancelled'],
    });
    expect(await pending).toEqual({ action: 'cancel' });
  });

  it('answers 410 once a question is settled', async () => {
    const { call, shown } = callFor();
    broker.track(client, call);
    const pending = broker.handle(client, server, projectQuestion());
    const prompt = await opened(shown);
    // Settled, but the waiting call hasn't deleted the row yet.
    await db('mcp_elicitations')
      .where({ id: prompt.id })
      .update({ response_json: '{"action":"decline"}' });
    expect(await broker.respond(prompt.id, ANA, { action: 'cancel' })).toEqual({
      status: 410,
    });
    await pending;
  });

  it('cancels on timeout and when the turn stops', async () => {
    const quick = new ElicitationBroker({
      db,
      logger,
      timeoutMs: 30,
      pollMs: 10,
    });
    const timed = callFor();
    quick.track(client, timed.call);
    expect(await quick.handle(client, server, projectQuestion())).toEqual({
      action: 'cancel',
    });
    expect(timed.shown[1].status).toBe('expired');

    const stop = new AbortController();
    const stopped = callFor({ signal: stop.signal, threadId: 't2' });
    const otherClient = {};
    broker.track(otherClient, stopped.call);
    const pending = broker.handle(otherClient, server, projectQuestion());
    await opened(stopped.shown);
    stop.abort();
    expect(await pending).toEqual({ action: 'cancel' });
    expect(stopped.shown[1].status).toBe('cancelled');
  });
});
