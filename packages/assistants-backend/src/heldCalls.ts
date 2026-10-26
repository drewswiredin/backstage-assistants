import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import {
  asSchema,
  type JSONSchema7,
  type TextStreamPart,
  type Tool,
  type ToolSet,
} from 'ai';
import {
  HELD_APPROVAL_PREFIX,
  heldToolCallId,
  type HeldCallAnswer,
} from '@drewswiredin/backstage-plugin-assistants-common';
import type { AssistantsTurnTool } from './modelProviders';
import { truncateToolResult } from './truncateToolResult';

/**
 * Held calls: the tool calls of a provider that runs its own tool loop (see
 * `AssistantsModelProvider.runsOwnToolLoop`) that need the user before they
 * can finish. With a plugin-run loop such a call ends the turn and the
 * browser's answer starts the next one; inside a provider's loop the call
 * can't end the turn, so it is held open instead:
 *
 * - A gated tool's call shows an approval card (an injected
 *   `tool-approval-request`) and waits for the decision.
 * - A client tool's call waits for the browser to run it and post the
 *   result.
 *
 * The browser answers through `POST /held-calls/:id`. Each held call is a row
 * in `held_calls`, so the answer can reach any replica: the replica holding
 * the call polls its row (an answer posted to it resolves at once). Once
 * settled the row keeps only that it was answered, until it expires.
 */

/** How long a held call waits for the user. */
export const HELD_CALL_TIMEOUT_MS = 10 * 60_000;
const POLL_MS = 1000;
/** How long `execute` waits for the stream to report the call it runs. */
const CORRELATE_TIMEOUT_MS = 15_000;

export { HELD_APPROVAL_PREFIX };
type HeldAnswer = HeldCallAnswer;

interface HeldCallRow {
  id: string;
  user_ref: string;
  response_json: string | null;
  expires_at: Date | string;
}

export interface HeldCallBrokerOptions {
  db: Knex;
  timeoutMs?: number;
  pollMs?: number;
}

export class HeldCallBroker {
  private readonly db: Knex;
  private readonly timeoutMs: number;
  private readonly pollMs: number;
  private readonly waiting = new Map<string, (answer: HeldAnswer) => void>();

  constructor(options: HeldCallBrokerOptions) {
    this.db = options.db;
    this.timeoutMs = options.timeoutMs ?? HELD_CALL_TIMEOUT_MS;
    this.pollMs = options.pollMs ?? POLL_MS;
  }

  /**
   * Hold call `id` for `userEntityRef` until the browser answers, the turn
   * stops (`signal`), or it times out (both undefined).
   */
  async hold(
    id: string,
    call: {
      userEntityRef: string;
      threadId?: string;
      kind: 'approval' | 'client-tool';
      tool: string;
      signal?: AbortSignal;
    },
  ): Promise<HeldAnswer | undefined> {
    const expiresAt = new Date(Date.now() + this.timeoutMs);
    // Settled calls past their expiry, and rows a crashed replica left.
    await this.db('held_calls')
      .where('expires_at', '<', new Date(Date.now() - 60_000))
      .delete();
    await this.db('held_calls').insert({
      id,
      user_ref: call.userEntityRef,
      thread_id: call.threadId ?? null,
      kind: call.kind,
      tool: call.tool,
      response_json: null,
      expires_at: expiresAt,
    });
    try {
      return await this.wait(id, expiresAt, call.signal);
    } finally {
      this.waiting.delete(id);
      await this.db('held_calls')
        .where({ id })
        .update({ response_json: JSON.stringify({ settled: true }) });
    }
  }

  /**
   * An answer from `userEntityRef`. 404 for an unknown call, 403 for another
   * user's, 410 for one already answered or expired, 400 for a malformed
   * answer.
   */
  async respond(
    id: string,
    userEntityRef: string,
    body: unknown,
  ): Promise<{ status: number }> {
    const row = (await this.db('held_calls').where({ id }).first()) as
      | HeldCallRow
      | undefined;
    if (!row) return { status: 404 };
    if (row.user_ref !== userEntityRef) return { status: 403 };
    if (
      row.response_json !== null ||
      new Date(row.expires_at).getTime() < Date.now()
    ) {
      return { status: 410 };
    }
    const answer = parseAnswer(body);
    if (!answer) return { status: 400 };
    await this.db('held_calls')
      .where({ id })
      .update({ response_json: JSON.stringify(answer) });
    this.waiting.get(id)?.(answer);
    return { status: 204 };
  }

  private wait(
    id: string,
    expiresAt: Date,
    signal?: AbortSignal,
  ): Promise<HeldAnswer | undefined> {
    return new Promise(resolve => {
      const cleanup: Array<() => void> = [];
      let finished = false;
      const finish = (answer: HeldAnswer | undefined) => {
        if (finished) return;
        finished = true;
        cleanup.forEach(fn => fn());
        resolve(answer);
      };
      const onAbort = () => finish(undefined);
      this.waiting.set(id, finish);
      const timer = setTimeout(
        () => finish(undefined),
        Math.max(0, expiresAt.getTime() - Date.now()),
      );
      // An answer posted to another replica lands in the row.
      const poll = setInterval(() => {
        this.db('held_calls')
          .where({ id })
          .first()
          .then((row: HeldCallRow | undefined) => {
            const answer = row?.response_json
              ? parseAnswer(JSON.parse(row.response_json))
              : undefined;
            if (answer) finish(answer);
          })
          .catch(() => {});
      }, this.pollMs);
      cleanup.push(
        () => clearTimeout(timer),
        () => clearInterval(poll),
        () => signal?.removeEventListener('abort', onAbort),
      );
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort);
    });
  }
}

function parseAnswer(body: unknown): HeldAnswer | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  if (typeof b.approved === 'boolean') {
    return {
      approved: b.approved,
      ...(typeof b.reason === 'string' ? { reason: b.reason } : {}),
    };
  }
  if (typeof b.error === 'string') return { error: b.error };
  if ('output' in b) return { output: b.output };
  return undefined;
}

/** A provider-executed tool call as the stream reports it. */
type ToolCallPart = Extract<TextStreamPart<ToolSet>, { type: 'tool-call' }>;

/** The same call regardless of key order in its input. */
export function stableKey(name: string, input: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (!v || typeof v !== 'object') return v;
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map(k => [k, sort((v as Record<string, unknown>)[k])]),
    );
  };
  return `${name}:${JSON.stringify(sort(input ?? {}))}`;
}

/**
 * Pairs a tool's `execute`, which the provider calls with only the name and
 * input, with the call the stream reported (its `toolCallId`), so a held
 * approval or a preliminary result lands on the right part. Calls with the
 * same name and input pair up in order.
 */
export class ToolCallCorrelator {
  private readonly calls = new Map<string, ToolCallPart[]>();
  private readonly waiters = new Map<
    string,
    Array<(c: ToolCallPart) => void>
  >();

  observe(part: TextStreamPart<ToolSet>): void {
    if (part.type !== 'tool-call') return;
    const key = stableKey(part.toolName, part.input);
    const waiter = this.waiters.get(key)?.shift();
    if (waiter) waiter(part);
    else this.calls.set(key, [...(this.calls.get(key) ?? []), part]);
  }

  /** The reported call for `name` and `input`, or undefined if none arrives. */
  take(
    name: string,
    input: unknown,
    timeoutMs = CORRELATE_TIMEOUT_MS,
  ): Promise<ToolCallPart | undefined> {
    const key = stableKey(name, input);
    const queued = this.calls.get(key)?.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise(resolve => {
      const pending: { timer?: ReturnType<typeof setTimeout> } = {};
      const waiter = (c: ToolCallPart) => {
        clearTimeout(pending.timer);
        resolve(c);
      };
      pending.timer = setTimeout(() => {
        const list = this.waiters.get(key) ?? [];
        this.waiters.set(
          key,
          list.filter(w => w !== waiter),
        );
        resolve(undefined);
      }, timeoutMs);
      this.waiters.set(key, [...(this.waiters.get(key) ?? []), waiter]);
    });
  }
}

/**
 * The provider's stream with parts injected by held calls (approval cards,
 * preliminary results), and every part shown to `observe` first. The source
 * is read eagerly, so held calls see their tool calls even while nobody
 * reads the result.
 */
export function withInjectedParts(
  source: ReadableStream<TextStreamPart<ToolSet>>,
  observe: (part: TextStreamPart<ToolSet>) => void,
): {
  stream: ReadableStream<TextStreamPart<ToolSet>>;
  inject: (part: TextStreamPart<ToolSet>) => void;
} {
  let controller!: ReadableStreamDefaultController<TextStreamPart<ToolSet>>;
  let closed = false;
  const stream = new ReadableStream<TextStreamPart<ToolSet>>({
    start(c) {
      controller = c;
      void (async () => {
        const reader = source.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            observe(value);
            controller.enqueue(value);
          }
          closed = true;
          controller.close();
        } catch (error) {
          closed = true;
          controller.error(error);
        }
      })();
    },
  });
  return {
    stream,
    inject: part => {
      if (!closed) controller.enqueue(part);
    },
  };
}

export interface LoopToolsOptions {
  /** The turn's tools as the plugin built them (client tools have no `execute`). */
  tools: ToolSet;
  /** Names in `tools` that run in the browser. */
  clientToolNames: ReadonlySet<string>;
  /**
   * The approval gate for a server tool's call: ask the user, skip (no gate,
   * or a standing grant), or refuse with a reason (an argument rule).
   */
  approvalFor: (
    name: string,
    input: unknown,
  ) => 'user-approval' | 'not-applicable' | { type: 'denied'; reason: string };
  /** Records an "Always allow" answer for the rest of the turn. */
  grantStanding: (name: string) => void;
  broker: HeldCallBroker;
  correlator: ToolCallCorrelator;
  inject: (part: TextStreamPart<ToolSet>) => void;
  userEntityRef: string;
  threadId?: string;
  /** The model messages of the turn, handed to `execute` as the AI SDK does. */
  messages: unknown[];
  toolResultMaxChars: number;
  signal: AbortSignal;
  /** Audit a decision on a gated call. */
  onDecision?: (name: string, approved: boolean, input: unknown) => void;
}

/** Thrown into the provider's loop; its message is the result the model sees. */
export class HeldCallError extends Error {}

/**
 * The turn's tools for a provider that runs its own loop: each `execute` runs
 * the tool as the plugin's own loop would, holding the call for the user
 * where it needs one.
 */
export async function buildLoopTools(
  options: LoopToolsOptions,
): Promise<Record<string, AssistantsTurnTool>> {
  const out: Record<string, AssistantsTurnTool> = {};
  for (const [name, tool] of Object.entries(options.tools)) {
    const inputSchema = (await asSchema((tool as Tool).inputSchema)
      .jsonSchema) as JSONSchema7;
    const description = (tool as Tool).description;
    out[name] = {
      // A description that depends on tool context has none to read here.
      ...(typeof description === 'string' ? { description } : {}),
      inputSchema,
      execute: (input, executeOptions) =>
        runLoopTool(options, name, tool as Tool, input, executeOptions),
    };
  }
  return out;
}

async function runLoopTool(
  options: LoopToolsOptions,
  name: string,
  tool: Tool,
  input: unknown,
  executeOptions?: { abortSignal?: AbortSignal },
): Promise<unknown> {
  const signal = executeOptions?.abortSignal ?? options.signal;
  const isClientTool = options.clientToolNames.has(name);
  // A call an argument rule refuses needs nothing from the stream.
  const decision = isClientTool
    ? 'not-applicable'
    : options.approvalFor(name, input);
  if (typeof decision === 'object') throw new HeldCallError(decision.reason);
  const call = await options.correlator.take(name, input);
  const toolCallId = call?.toolCallId ?? `call-${randomUUID()}`;

  if (isClientTool) {
    if (!call) {
      throw new HeldCallError(
        `The browser could not be reached to run ${name}.`,
      );
    }
    const answer = await options.broker.hold(heldToolCallId(toolCallId), {
      userEntityRef: options.userEntityRef,
      threadId: options.threadId,
      kind: 'client-tool',
      tool: name,
      signal,
    });
    if (!answer) {
      throw new HeldCallError(
        signal.aborted
          ? 'The user stopped the turn.'
          : `${name} timed out waiting for the browser.`,
      );
    }
    if ('error' in answer) throw new HeldCallError(answer.error);
    if ('output' in answer) {
      return truncateToolResult(answer.output, options.toolResultMaxChars);
    }
    throw new HeldCallError(`${name} returned no result.`);
  }

  if (decision === 'user-approval') {
    if (!call) {
      throw new HeldCallError(
        `${name} needs the user's approval, which could not be asked.`,
      );
    }
    const approvalId = `${HELD_APPROVAL_PREFIX}${randomUUID()}`;
    options.inject({
      type: 'tool-approval-request',
      approvalId,
      toolCall: call,
    });
    const answer = await options.broker.hold(approvalId, {
      userEntityRef: options.userEntityRef,
      threadId: options.threadId,
      kind: 'approval',
      tool: name,
      signal,
    });
    const approved = !!answer && 'approved' in answer && answer.approved;
    options.onDecision?.(name, approved, input);
    if (!approved) {
      throw new HeldCallError(
        answer
          ? 'The user denied this tool call.'
          : 'The approval was not given in time.',
      );
    }
    if ('reason' in answer && answer.reason === `always:${name}`) {
      options.grantStanding(name);
    }
  }

  if (!tool.execute) throw new HeldCallError(`${name} cannot run here.`);
  const result = await tool.execute(input, {
    toolCallId,
    messages: options.messages as never,
    abortSignal: signal,
    context: {},
  });
  // A tool that streams preliminary results (an MCP server's questions)
  // shows each on the call as it comes; the last is the result, which the
  // provider then reports as the call's final output.
  if (isAsyncIterable(result)) {
    let last: unknown;
    for await (const value of result) {
      last = value;
      if (call) {
        options.inject({
          type: 'tool-result',
          toolCallId,
          toolName: name,
          input,
          output: value,
          preliminary: true,
          providerExecuted: true,
          dynamic: true,
        } as TextStreamPart<ToolSet>);
      }
    }
    return last;
  }
  return result;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] ===
      'function'
  );
}
