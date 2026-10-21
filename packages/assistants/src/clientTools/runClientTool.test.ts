import type { ApiHolder } from '@backstage/core-plugin-api';
import {
  clientToolNeedsApproval,
  isAbortedResult,
  runClientTool,
  type RunClientToolDeps,
} from './runClientTool';
import type { AssistantClientTool, ClientToolInterrupt } from './types';

const apis = { get: () => undefined } as unknown as ApiHolder;

function deps(
  overrides: Partial<RunClientToolDeps> & {
    answers?: (payload: ClientToolInterrupt) => unknown;
  } = {},
) {
  const prompts: ClientToolInterrupt[] = [];
  const { answers, ...rest } = overrides;
  const d: RunClientToolDeps = {
    apis,
    signal: new AbortController().signal,
    requireApproval: new Set(),
    human: async payload => {
      prompts.push(payload);
      return answers ? answers(payload) : undefined;
    },
    ...rest,
  };
  return { deps: d, prompts };
}

const readTool = (
  execute: AssistantClientTool<any, any>['execute'],
  extra: Partial<AssistantClientTool<any, any>> = {},
): AssistantClientTool<any, any> => ({
  name: 'demo__read',
  description: 'reads',
  inputSchema: { type: 'object' },
  attributes: { readOnly: true },
  execute,
  ...extra,
});

describe('clientToolNeedsApproval', () => {
  it('gates writes, destructive tools, and the config floor', () => {
    const floor = new Set(['demo__read']);
    expect(
      clientToolNeedsApproval(
        { name: 'a__b', attributes: { readOnly: true } },
        new Set(),
      ),
    ).toBe(false);
    expect(
      clientToolNeedsApproval(
        { name: 'a__b', attributes: { readOnly: false } },
        new Set(),
      ),
    ).toBe(true);
    expect(
      clientToolNeedsApproval(
        { name: 'a__b', attributes: { readOnly: true, destructive: true } },
        new Set(),
      ),
    ).toBe(true);
    expect(
      clientToolNeedsApproval(
        { name: 'demo__read', attributes: { readOnly: true } },
        floor,
      ),
    ).toBe(true);
  });
});

describe('runClientTool', () => {
  it('runs a read-only tool without prompting and shapes the result', async () => {
    const { deps: d, prompts } = deps();
    const result = await runClientTool(
      readTool(async (input: { q: string }) => ({
        echo: input.q,
        when: undefined,
      })),
      { q: 'hi' },
      d,
    );
    expect(result).toEqual({ echo: 'hi' });
    expect(prompts).toEqual([]);
  });

  it('asks for approval first and declines without running', async () => {
    const execute = jest.fn(async () => ({ ok: true }));
    const { deps: d, prompts } = deps({ answers: () => ({ approved: false }) });
    const result = await runClientTool(
      readTool(execute, { attributes: { readOnly: false } }),
      { x: 1 },
      d,
    );
    expect(prompts).toEqual([
      {
        kind: 'approval',
        toolName: 'demo__read',
        title: undefined,
        input: { x: 1 },
      },
    ]);
    expect(execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({ _error: true, code: 'declined' });
  });

  it('runs after approval, and approval precedes the credential prompt', async () => {
    const execute = jest.fn(async () => ({ ok: true }));
    const { deps: d, prompts } = deps({
      answers: p => (p.kind === 'approval' ? { approved: true } : {}),
    });
    const result = await runClientTool(
      readTool(execute, {
        attributes: { readOnly: true, destructive: true },
        auth: {
          kind: 'custom',
          system: 'Demo',
          acquire: async () => 'secret',
        },
      }),
      {},
      d,
    );
    expect(prompts.map(p => p.kind)).toEqual(['approval']);
    expect(result).toEqual({ ok: true });
    expect(execute).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ credential: 'secret' }),
    );
  });

  it('shows Connect when silent acquisition yields nothing, then runs with the handed credential', async () => {
    const acquire = jest.fn(async ({ interactive }: { interactive: boolean }) =>
      interactive ? 'from-click' : undefined,
    );
    const execute = jest.fn(
      async (_i: unknown, ctx: { credential?: unknown }) => ({
        sawCredential: ctx.credential === 'from-click',
      }),
    );
    const { deps: d, prompts } = deps({
      answers: () => ({ credential: 'from-click' }),
    });
    const result = await runClientTool(
      readTool(execute, { auth: { kind: 'custom', system: 'Demo', acquire } }),
      {},
      d,
    );
    expect(acquire).toHaveBeenCalledWith(
      expect.objectContaining({ interactive: false }),
    );
    expect(prompts).toEqual([
      {
        kind: 'connect',
        toolName: 'demo__read',
        title: undefined,
        system: 'Demo',
      },
    ]);
    // The credential reaches execute and nothing else: never the result.
    expect(result).toEqual({ sawCredential: true });
    expect(JSON.stringify(result)).not.toContain('from-click');
  });

  it('returns not_authorized when the user dismisses Connect', async () => {
    const execute = jest.fn();
    const { deps: d } = deps({ answers: () => ({}) });
    const result = await runClientTool(
      readTool(execute, {
        auth: {
          kind: 'custom',
          system: 'Demo',
          acquire: async () => undefined,
        },
      }),
      {},
      d,
    );
    expect(execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({ _error: true, code: 'not_authorized' });
    expect((result as { message: string }).message).toContain('Demo');
  });

  it('uses the OAuth API silently with optional, and reports a failed acquire as not connected', async () => {
    const getAccessToken = jest.fn(async () => '');
    const holder = { get: () => ({ getAccessToken }) } as unknown as ApiHolder;
    const { deps: d, prompts } = deps({ apis: holder, answers: () => ({}) });
    await runClientTool(
      readTool(async () => ({}), {
        auth: {
          kind: 'oauth',
          system: 'GitHub',
          apiRef: { id: 'x' } as any,
          scopes: ['repo'],
        },
      }),
      {},
      d,
    );
    expect(getAccessToken).toHaveBeenCalledWith(['repo'], { optional: true });
    expect(prompts[0]).toMatchObject({ kind: 'connect', system: 'GitHub' });
  });

  it('turns a thrown error into a failed result', async () => {
    const { deps: d } = deps();
    const result = await runClientTool(
      readTool(async () => {
        throw new Error('boom');
      }),
      {},
      d,
    );
    expect(result).toEqual({ _error: true, code: 'failed', message: 'boom' });
  });

  it('times out a slow tool and aborts its signal', async () => {
    jest.useFakeTimers();
    try {
      let aborted = false;
      const { deps: d } = deps();
      const pending = runClientTool(
        readTool(
          (_i: unknown, ctx: { signal: AbortSignal }) =>
            new Promise((_, reject) => {
              ctx.signal.addEventListener('abort', () => {
                aborted = true;
                reject(new Error('aborted'));
              });
            }),
          { timeoutMs: 1000 },
        ),
        {},
        d,
      );
      jest.advanceTimersByTime(1001);
      const result = await pending;
      expect(aborted).toBe(true);
      expect(result).toMatchObject({ _error: true, code: 'timeout' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports a stopped turn as aborted, which never resumes the turn', async () => {
    const controller = new AbortController();
    const { deps: d } = deps({ signal: controller.signal });
    const pending = runClientTool(
      readTool(
        (_i: unknown, ctx: { signal: AbortSignal }) =>
          new Promise((_, reject) => {
            ctx.signal.addEventListener('abort', () => reject(new Error('x')));
          }),
      ),
      {},
      d,
    );
    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({ _error: true, code: 'aborted' });
    expect(isAbortedResult(result)).toBe(true);
    expect(isAbortedResult({ _error: true, code: 'failed' })).toBe(false);
  });

  it('rejects a result that is not JSON', async () => {
    const { deps: d } = deps();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = await runClientTool(
      readTool(async () => circular),
      {},
      d,
    );
    expect(result).toMatchObject({ _error: true, code: 'failed' });
  });
});
