import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import type { ElicitResult, ElicitationRequest } from '@ai-sdk/mcp';
import type { LoggerService } from '@backstage/backend-plugin-api';
import {
  parseElicitationSchema,
  validateElicitationContent,
  type ElicitationPrompt,
  type ElicitationResponseRequest,
  type ElicitationStatus,
} from '@drewswiredin/backstage-plugin-assistants-common';
import type { McpServerConfig } from './config';

/**
 * MCP elicitation: a server asks the user for input in the middle of a tool
 * call. `@ai-sdk/mcp` hands the request to the handler registered on the
 * client; the broker finds the tool call it belongs to, shows the question
 * on it (a preliminary tool output the browser renders as a form), and waits
 * for the answer from `POST /elicitations/:id`.
 *
 * Each call runs inside {@link ElicitationBroker.within}, an
 * `AsyncLocalStorage` scope. Over Streamable HTTP a server's question during
 * a call arrives on that call's response stream, read inside the call's
 * scope, so the handler knows exactly which call asked. A question that
 * arrives outside any call's scope (the standalone stream, stdio) goes to the
 * only call in flight on the client; with several calls of one user it goes
 * to one that hasn't asked yet (else one with nothing open), without naming
 * the tool; with several users'
 * calls (a busy shared server) it is refused. Questions on the same call
 * wait their turn.
 *
 * A question is stored in `mcp_elicitations` so the answer can arrive at any
 * replica: the replica running the call polls the row (and an answer posted
 * to it resolves at once). Once settled, the row keeps only the action (no
 * values) until it expires, so a late answer is told the question is gone.
 * The answer goes back to the server only; the model sees just the tool's
 * eventual result.
 *
 * `decline` and `cancel` mean the user: Decline, or Stop and timeout
 * (cancel). A question the broker can't show is answered with an error
 * instead ({@link ElicitationRefused}), so the server doesn't report a
 * user's cancellation: no call to tie it to, a browser that can't show
 * forms, more than three questions in one call, URL mode, or a schema
 * outside MCP's restricted subset.
 */

/** A question the broker can't show; the server gets it as an error. */
export class ElicitationRefused extends Error {
  constructor(reason: string) {
    super(`The client can't ask the user: ${reason}`);
    this.name = 'ElicitationRefused';
  }
}

/** Questions one tool call may ask. */
const MAX_PER_CALL = 3;
/** Wrong answers before a question is cancelled. */
const MAX_ATTEMPTS = 2;
const POLL_MS = 1000;

const STATUS_OF: Record<
  ElicitationResponseRequest['action'],
  ElicitationStatus
> = { accept: 'accepted', decline: 'declined', cancel: 'cancelled' };

/** A tool call in flight that a server may ask a question on. */
export interface ElicitationCall {
  userEntityRef: string;
  assistantId: string;
  threadId?: string;
  server: McpServerConfig;
  /** The un-namespaced tool. */
  tool: string;
  /** The browser that started the turn renders question forms. */
  renders: boolean;
  /** The turn's abort: a Stop cancels an open question. */
  signal?: AbortSignal;
  /** Show (or update) a question on the tool call. */
  show: (prompt: ElicitationPrompt) => void;
  /** Questions asked so far in this call. */
  asked: number;
  /** Told when a question opens (true) and settles (false). */
  onWait?: (waiting: boolean) => void;
  /** Settles when the call's open question does; the next one waits on it. */
  turn?: Promise<unknown>;
  /** Questions open or waiting their turn on the call. */
  pending?: number;
}

interface ElicitationRow {
  id: string;
  user_ref: string;
  thread_id: string | null;
  requested_schema_json: string;
  attempts: number;
  response_json: string | null;
  expires_at: Date | string;
}

export interface ElicitationBrokerOptions {
  db: Knex;
  logger: LoggerService;
  timeoutMs: number;
  pollMs?: number;
}

export class ElicitationBroker {
  private readonly db: Knex;
  private readonly logger: LoggerService;
  private readonly timeoutMs: number;
  private readonly pollMs: number;
  private readonly inFlight = new Map<object, Set<ElicitationCall>>();
  private readonly waiting = new Map<
    string,
    (answer: ElicitationResponseRequest) => void
  >();
  private readonly scope = new AsyncLocalStorage<ElicitationCall>();

  constructor(options: ElicitationBrokerOptions) {
    this.db = options.db;
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs;
    this.pollMs = options.pollMs ?? POLL_MS;
  }

  /** Mark `call` in flight on `client` until the returned function runs. */
  track(client: object, call: ElicitationCall): () => void {
    let calls = this.inFlight.get(client);
    if (!calls) {
      calls = new Set();
      this.inFlight.set(client, calls);
    }
    calls.add(call);
    return () => {
      calls!.delete(call);
      if (calls!.size === 0) this.inFlight.delete(client);
    };
  }

  /** Run `fn` (the call's `callTool`) as `call`, so its questions find it. */
  within<T>(call: ElicitationCall, fn: () => T): T {
    return this.scope.run(call, fn);
  }

  /**
   * The call a question belongs to, and whether that is certain (so the
   * question can name the tool), or why there is none.
   */
  private callFor(
    client: object,
  ): { call: ElicitationCall; exact: boolean } | { reason: string } {
    const calls = this.inFlight.get(client);
    const scoped = this.scope.getStore();
    if (scoped && calls?.has(scoped)) return { call: scoped, exact: true };
    if (!calls?.size) return { reason: 'no call is in flight' };
    const list = [...calls];
    if (list.length === 1) return { call: list[0], exact: true };
    if (new Set(list.map(c => c.userEntityRef)).size > 1) {
      return { reason: "several users' calls are in flight on the connection" };
    }
    // Prefer a call that hasn't asked yet, then one with nothing open.
    const call =
      list.find(c => !c.pending && c.asked === 0) ??
      list.find(c => !c.pending) ??
      list[0];
    return { call, exact: false };
  }

  /** The handler for a request a server sent on `client`. */
  async handle(
    client: object,
    server: McpServerConfig,
    request: ElicitationRequest,
  ): Promise<ElicitResult> {
    const params = request.params as ElicitationRequest['params'] & {
      mode?: string;
    };
    const found = this.callFor(client);
    const refuse = (reason: string): never => {
      this.logger.info(
        `MCP server '${server.id}' asked for input: refused (${reason})`,
      );
      if ('call' in found) this.audit(found.call, 'refused', [], found.exact);
      throw new ElicitationRefused(reason);
    };
    if (params.mode === 'url') refuse('URL-mode requests are not supported');
    if (!('call' in found)) return refuse(found.reason);
    const { call, exact } = found;
    if (!call.renders) refuse("the browser can't show forms");
    const parsed = parseElicitationSchema(params.requestedSchema);
    if ('unsupported' in parsed) refuse(parsed.unsupported);
    if (call.asked >= MAX_PER_CALL) {
      refuse(`more than ${MAX_PER_CALL} questions in one call`);
    }
    call.asked += 1;
    call.pending = (call.pending ?? 0) + 1;

    // One question at a time on a call: wait for the open one to settle.
    const before = call.turn;
    const asking = (async () => {
      try {
        await before?.catch(() => {});
        return await this.ask(server, call, exact, params);
      } finally {
        call.pending = (call.pending ?? 1) - 1;
      }
    })();
    call.turn = asking;
    return asking;
  }

  private async ask(
    server: McpServerConfig,
    call: ElicitationCall,
    exact: boolean,
    params: ElicitationRequest['params'],
  ): Promise<ElicitResult> {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + this.timeoutMs);
    const prompt: ElicitationPrompt = {
      id,
      server: server.id,
      serverTitle: server.userCredentials?.title ?? server.id,
      ...(exact ? { tool: call.tool } : {}),
      message: params.message,
      requestedSchema: params.requestedSchema,
      expiresAt: expiresAt.toISOString(),
      status: 'open',
    };
    // Settled questions past their expiry, and rows a crashed replica left.
    await this.db('mcp_elicitations')
      .where('expires_at', '<', new Date(Date.now() - 60_000))
      .delete();
    await this.db('mcp_elicitations').insert({
      id,
      user_ref: call.userEntityRef,
      thread_id: call.threadId ?? null,
      server_id: server.id,
      tool: call.tool,
      requested_schema_json: JSON.stringify(params.requestedSchema),
      attempts: 0,
      response_json: null,
      expires_at: expiresAt,
    });
    call.show(prompt);

    let answer: ElicitationResponseRequest | undefined;
    let status: ElicitationStatus;
    call.onWait?.(true);
    try {
      answer = await this.wait(id, expiresAt, call.signal);
      status = answer ? STATUS_OF[answer.action] : 'expired';
    } finally {
      call.onWait?.(false);
      this.waiting.delete(id);
      // Keep the row until it expires, so a late answer gets 410, but
      // without the answer's values.
      await this.db('mcp_elicitations')
        .where({ id })
        .update({
          response_json: JSON.stringify({ action: answer?.action ?? 'cancel' }),
        });
    }
    const answered =
      answer?.action === 'accept' ? Object.keys(answer.content ?? {}) : [];
    call.show({
      ...prompt,
      status,
      ...(status === 'accepted' ? { answered } : {}),
    });
    this.audit(call, answer?.action ?? 'cancel', answered, exact);
    if (answer?.action === 'accept') {
      return { action: 'accept', content: answer.content ?? {} };
    }
    return { action: answer?.action ?? 'cancel' };
  }

  /**
   * An answer from `userEntityRef`. 404 for an unknown question, 403 for
   * another user's, 410 for one already answered or expired, 400 with the
   * problems for an answer that doesn't fit (the second cancels it).
   */
  async respond(
    id: string,
    userEntityRef: string,
    body: unknown,
  ): Promise<{ status: number; errors?: string[] }> {
    const row = (await this.db('mcp_elicitations').where({ id }).first()) as
      | ElicitationRow
      | undefined;
    if (!row) return { status: 404 };
    if (row.user_ref !== userEntityRef) return { status: 403 };
    if (
      row.response_json !== null ||
      new Date(row.expires_at).getTime() < Date.now()
    ) {
      return { status: 410 };
    }
    const answer = body as Partial<ElicitationResponseRequest> | undefined;
    if (
      !answer ||
      !['accept', 'decline', 'cancel'].includes(answer.action as string)
    ) {
      return {
        status: 400,
        errors: ['action must be accept, decline, or cancel'],
      };
    }
    let settled: ElicitationResponseRequest = { action: answer.action! };
    if (answer.action === 'accept') {
      const parsed = parseElicitationSchema(
        JSON.parse(row.requested_schema_json),
      );
      const errors =
        'fields' in parsed
          ? validateElicitationContent(parsed.fields, answer.content)
          : [parsed.unsupported];
      if (errors.length > 0) {
        const attempts = row.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await this.settle(id, { action: 'cancel' });
          return {
            status: 400,
            errors: [...errors, 'The question was cancelled'],
          };
        }
        await this.db('mcp_elicitations').where({ id }).update({ attempts });
        return { status: 400, errors };
      }
      settled = {
        action: 'accept',
        content: answer.content as Record<string, unknown>,
      };
    }
    await this.settle(id, settled);
    return { status: 204 };
  }

  private async settle(
    id: string,
    answer: ElicitationResponseRequest,
  ): Promise<void> {
    await this.db('mcp_elicitations')
      .where({ id })
      .update({ response_json: JSON.stringify(answer) });
    this.waiting.get(id)?.(answer);
  }

  /** The answer, or undefined on timeout; `cancel` when the turn stops. */
  private wait(
    id: string,
    expiresAt: Date,
    signal?: AbortSignal,
  ): Promise<ElicitationResponseRequest | undefined> {
    return new Promise(resolve => {
      const cleanup: Array<() => void> = [];
      let finished = false;
      const finish = (answer: ElicitationResponseRequest | undefined) => {
        if (finished) return;
        finished = true;
        cleanup.forEach(fn => fn());
        resolve(answer);
      };
      const onAbort = () => finish({ action: 'cancel' });
      this.waiting.set(id, finish);
      const timer = setTimeout(
        () => finish(undefined),
        Math.max(0, expiresAt.getTime() - Date.now()),
      );
      // An answer posted to another replica lands in the row.
      const poll = setInterval(() => {
        this.db('mcp_elicitations')
          .where({ id })
          .first()
          .then((row: ElicitationRow | undefined) => {
            if (row?.response_json) finish(JSON.parse(row.response_json));
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

  /** `exact` is false when the question couldn't be tied to one tool. */
  private audit(
    call: ElicitationCall,
    action: string,
    fields: string[],
    exact: boolean,
  ) {
    this.logger.info('assistants.tool.audit', {
      user: call.userEntityRef,
      assistantId: call.assistantId,
      ...(call.threadId ? { threadId: call.threadId } : {}),
      server: call.server.id,
      ...(exact ? { tool: call.tool } : {}),
      decision: 'elicitation',
      action,
      fields,
    });
  }
}
