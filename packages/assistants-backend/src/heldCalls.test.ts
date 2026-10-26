import knexFactory, { type Knex } from 'knex';
import { jsonSchema, tool, type TextStreamPart, type ToolSet } from 'ai';
import {
  buildLoopTools,
  HELD_APPROVAL_PREFIX,
  HeldCallBroker,
  stableKey,
  ToolCallCorrelator,
  withInjectedParts,
  type LoopToolsOptions,
} from './heldCalls';
import { ThreadService } from './threads';

const ANA = 'user:default/ana';
const BO = 'user:default/bo';

function toolCall(toolName: string, input: unknown, toolCallId = 'toolu_1') {
  return {
    type: 'tool-call',
    toolCallId,
    toolName,
    input,
    providerExecuted: true,
    dynamic: true,
  } as TextStreamPart<ToolSet>;
}

async function until<T>(read: () => T | undefined): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise(r => setTimeout(r, 5));
  }
  throw new Error('timed out');
}

describe('stableKey', () => {
  it('ignores key order', () => {
    expect(stableKey('t', { b: 1, a: { d: 2, c: 3 } })).toBe(
      stableKey('t', { a: { c: 3, d: 2 }, b: 1 }),
    );
  });
});

describe('ToolCallCorrelator', () => {
  it('pairs a call reported before or after execute asks for it', async () => {
    const c = new ToolCallCorrelator();
    c.observe(toolCall('get', { ref: 'a' }, 'one'));
    expect((await c.take('get', { ref: 'a' }))?.toolCallId).toBe('one');

    const later = c.take('get', { ref: 'b' });
    c.observe(toolCall('get', { ref: 'b' }, 'two'));
    expect((await later)?.toolCallId).toBe('two');
  });

  it('pairs identical calls in order and gives up after the timeout', async () => {
    const c = new ToolCallCorrelator();
    c.observe(toolCall('get', {}, 'first'));
    c.observe(toolCall('get', {}, 'second'));
    expect((await c.take('get', {}))?.toolCallId).toBe('first');
    expect((await c.take('get', {}))?.toolCallId).toBe('second');
    expect(await c.take('get', {}, 10)).toBeUndefined();
  });
});

describe('withInjectedParts', () => {
  it('forwards the source, shows each part to observe, and takes injected parts', async () => {
    let push!: (part: TextStreamPart<ToolSet>) => void;
    let end!: () => void;
    const source = new ReadableStream<TextStreamPart<ToolSet>>({
      start(c) {
        push = p => c.enqueue(p);
        end = () => c.close();
      },
    });
    const seen: string[] = [];
    const { stream, inject } = withInjectedParts(source, p =>
      seen.push(p.type),
    );
    push(toolCall('get', {}));
    await until(() => (seen.length ? true : undefined));
    inject({ type: 'tool-approval-request', approvalId: 'held-x' } as never);
    end();
    const out: string[] = [];
    for await (const part of stream as unknown as AsyncIterable<
      TextStreamPart<ToolSet>
    >) {
      out.push(part.type);
    }
    expect(seen).toEqual(['tool-call']);
    expect(out).toEqual(['tool-call', 'tool-approval-request']);
  });
});

describe('HeldCallBroker and buildLoopTools', () => {
  let db: Knex;
  let broker: HeldCallBroker;

  beforeEach(async () => {
    db = knexFactory({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await new ThreadService(db).runMigrations();
    broker = new HeldCallBroker({ db, pollMs: 10 });
  });

  afterEach(async () => {
    await db.destroy();
  });

  /** Answer `id` once it is held (the row may not exist the moment it shows). */
  async function answer(id: string, user: string, body: unknown) {
    let status = 404;
    for (let i = 0; i < 100 && status === 404; i++) {
      status = (await broker.respond(id, user, body)).status;
      if (status === 404) await new Promise(r => setTimeout(r, 5));
    }
    return status;
  }

  function loop(overrides: Partial<LoopToolsOptions> = {}) {
    const injected: TextStreamPart<ToolSet>[] = [];
    const correlator = new ToolCallCorrelator();
    const runs: unknown[] = [];
    const granted: string[] = [];
    const decisions: Array<[string, boolean]> = [];
    const options: LoopToolsOptions = {
      tools: {
        'register-entity': tool({
          description: 'Register an entity',
          inputSchema: jsonSchema({
            type: 'object',
            properties: { url: { type: 'string' } },
          }),
          execute: async input => {
            runs.push(input);
            return { registered: true };
          },
        }),
        render_form: tool({
          inputSchema: jsonSchema({ type: 'object' }),
        }),
      },
      clientToolNames: new Set(['render_form']),
      approvalFor: name =>
        name === 'register-entity' ? 'user-approval' : 'not-applicable',
      grantStanding: name => granted.push(name),
      broker,
      correlator,
      inject: part => injected.push(part),
      userEntityRef: ANA,
      threadId: 't1',
      messages: [],
      toolResultMaxChars: 30000,
      signal: new AbortController().signal,
      onDecision: (name, approved) => decisions.push([name, approved]),
      ...overrides,
    };
    return { options, injected, correlator, runs, granted, decisions };
  }

  it('describes each tool with its JSON Schema', async () => {
    const { options } = loop();
    const tools = await buildLoopTools(options);
    expect(tools['register-entity'].description).toBe('Register an entity');
    expect(tools['register-entity'].inputSchema).toMatchObject({
      type: 'object',
      properties: { url: { type: 'string' } },
    });
  });

  it('holds a gated call for approval, then runs it', async () => {
    const { options, injected, correlator, runs, decisions } = loop();
    const tools = await buildLoopTools(options);
    const input = { url: 'https://example.com/catalog-info.yaml' };
    correlator.observe(toolCall('register-entity', input));
    const running = tools['register-entity'].execute(input);

    const request = await until(() =>
      injected.find(p => p.type === 'tool-approval-request'),
    );
    const approvalId = (request as { approvalId: string }).approvalId;
    expect(approvalId.startsWith(HELD_APPROVAL_PREFIX)).toBe(true);
    expect(runs).toEqual([]);

    expect(await answer(approvalId, BO, { approved: true })).toBe(403);
    expect(await answer(approvalId, ANA, { approved: true })).toBe(204);
    await expect(running).resolves.toEqual({ registered: true });
    expect(runs).toEqual([input]);
    expect(decisions).toEqual([['register-entity', true]]);
    expect(
      (await broker.respond(approvalId, ANA, { approved: true })).status,
    ).toBe(410);
  });

  it('tells the model when the user denies a gated call', async () => {
    const { options, injected, correlator, runs } = loop();
    const tools = await buildLoopTools(options);
    correlator.observe(toolCall('register-entity', {}));
    const running = tools['register-entity'].execute({});
    const request = await until(() =>
      injected.find(p => p.type === 'tool-approval-request'),
    );
    await answer((request as { approvalId: string }).approvalId, ANA, {
      approved: false,
    });
    await expect(running).rejects.toThrow('The user denied this tool call.');
    expect(runs).toEqual([]);
  });

  it('records an Always allow answer as a standing grant', async () => {
    const { options, injected, correlator, granted } = loop();
    const tools = await buildLoopTools(options);
    correlator.observe(toolCall('register-entity', {}));
    const running = tools['register-entity'].execute({});
    const request = await until(() =>
      injected.find(p => p.type === 'tool-approval-request'),
    );
    await answer((request as { approvalId: string }).approvalId, ANA, {
      approved: true,
      reason: 'always:register-entity',
    });
    await running;
    expect(granted).toEqual(['register-entity']);
  });

  it('refuses a call an argument rule denies without asking', async () => {
    const { options, injected } = loop({
      approvalFor: () => ({ type: 'denied', reason: 'url must be ours' }),
    });
    const tools = await buildLoopTools(options);
    await expect(tools['register-entity'].execute({})).rejects.toThrow(
      'url must be ours',
    );
    expect(injected).toEqual([]);
  });

  it('holds a client tool until the browser posts its result', async () => {
    const { options, correlator } = loop();
    const tools = await buildLoopTools(options);
    correlator.observe(
      toolCall('render_form', { title: 'New service' }, 'toolu_9'),
    );
    const running = tools.render_form.execute({ title: 'New service' });
    expect(
      await answer('tool-toolu_9', ANA, {
        output: { submitted: true, values: { name: 'svc' } },
      }),
    ).toBe(204);
    await expect(running).resolves.toEqual({
      submitted: true,
      values: { name: 'svc' },
    });
  });

  it('passes a browser error back to the model', async () => {
    const { options, correlator } = loop();
    const tools = await buildLoopTools(options);
    correlator.observe(toolCall('render_form', {}, 'toolu_e'));
    const running = tools.render_form.execute({});
    await answer('tool-toolu_e', ANA, { error: 'Dismissed' });
    await expect(running).rejects.toThrow('Dismissed');
  });

  it('gives up on a held call when the turn stops', async () => {
    const abort = new AbortController();
    const { options, correlator } = loop({ signal: abort.signal });
    const tools = await buildLoopTools(options);
    correlator.observe(toolCall('render_form', {}, 'toolu_s'));
    const running = tools.render_form.execute({});
    await new Promise(r => setTimeout(r, 20));
    abort.abort();
    await expect(running).rejects.toThrow('The user stopped the turn.');
  });

  it('rejects a malformed answer', async () => {
    const { options, correlator } = loop();
    const tools = await buildLoopTools(options);
    correlator.observe(toolCall('render_form', {}, 'toolu_m'));
    void tools.render_form.execute({}).catch(() => {});
    expect(await answer('tool-toolu_m', ANA, { nope: 1 })).toBe(400);
  });

  it('shows each preliminary result of a streaming tool on the call', async () => {
    const { options, correlator, injected } = loop({
      tools: {
        ask: tool({
          inputSchema: jsonSchema({ type: 'object' }),
          execute: async function* askProject() {
            yield { question: 'Which project?' };
            yield { answer: 'Pylon' };
          },
        }),
      },
      approvalFor: () => 'not-applicable',
    });
    const tools = await buildLoopTools(options);
    correlator.observe(toolCall('ask', {}, 'toolu_q'));
    await expect(tools.ask.execute({})).resolves.toEqual({ answer: 'Pylon' });
    expect(
      injected.map(p => p as { output?: unknown; preliminary?: boolean }),
    ).toEqual([
      expect.objectContaining({
        type: 'tool-result',
        toolCallId: 'toolu_q',
        output: { question: 'Which project?' },
        preliminary: true,
      }),
      expect.objectContaining({
        output: { answer: 'Pylon' },
        preliminary: true,
      }),
    ]);
  });
});
