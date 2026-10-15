import type { Knex } from 'knex';
import { randomUUID } from 'crypto';
import type { LoggerService } from '@backstage/backend-plugin-api';

/** How often the replica running a turn writes its buffered stream. */
const FLUSH_MS = 250;
/** How often a follower reads new rows. */
const POLL_MS = 300;
/** How long a finished turn's rows stay for a late rejoin. */
const KEEP_AFTER_DONE_MS = 60_000;
/** Rows older than this are swept when any turn starts, whatever their state. */
const SWEEP_AFTER_MS = 60 * 60_000;
/** Silence after which a follower checks the turn is still running. */
const IDLE_CHECK_MS = 5_000;

/** What {@link StreamBuffer.follow} writes to and asks of its caller. */
export interface StreamFollower {
  /** Called once, before the first write, when there is a stream to follow. */
  start(): void;
  write(data: string): void;
  /** True once the client has gone. */
  closed(): boolean;
  /** Whether the turn is still running (its heartbeat is fresh). */
  running(): Promise<boolean>;
}

/**
 * Database-backed buffer of each running turn's UI message stream, keyed by
 * thread id, so `GET /chat/resume/:threadId` replays and follows a turn from
 * any backend replica.
 *
 * The replica running the turn appends the stream in batches every
 * {@link FLUSH_MS} and a final `done` row when it ends. A follower replays the
 * rows in order and polls for new ones every {@link POLL_MS} until `done`. A
 * thread holds one turn's rows at a time: {@link StreamBuffer.begin} replaces
 * them, and they are deleted {@link KEEP_AFTER_DONE_MS} after the turn ends.
 * Conversation history stays durable in `messages` regardless.
 */
export class StreamBuffer {
  constructor(
    private readonly db: Knex,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Start a turn's buffer: drop the thread's previous turn and any abandoned
   * rows, then write an empty first row so a rejoin finds the turn before its
   * first batch lands. Returns the turn id {@link StreamBuffer.record} takes.
   */
  async begin(threadId: string): Promise<string> {
    const turnId = randomUUID();
    const cutoff = new Date(Date.now() - SWEEP_AFTER_MS).toISOString();
    await this.db('stream_chunks').where('created_at', '<', cutoff).delete();
    await this.db('stream_chunks').where({ thread_id: threadId }).delete();
    await this.insert(threadId, turnId, '', false);
    return turnId;
  }

  /** Copy a turn's stream into the buffer as it is produced. */
  record(threadId: string, turnId: string, stream: ReadableStream<string>) {
    void this.pump(threadId, turnId, stream);
  }

  private async pump(
    threadId: string,
    turnId: string,
    stream: ReadableStream<string>,
  ): Promise<void> {
    let pending: string[] = [];
    // Writes are chained so batches land in order.
    let writing: Promise<void> = Promise.resolve();
    const flush = (done: boolean) => {
      const data = pending.join('');
      pending = [];
      if (data || done) {
        writing = writing
          .then(() => this.insert(threadId, turnId, data, done))
          .catch(error =>
            this.logger.warn('stream buffer write failed', {
              threadId,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
      }
      return writing;
    };
    const timer = setInterval(() => void flush(false), FLUSH_MS);
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) pending.push(value);
      }
    } catch {
      // Stream error — fall through so followers see the end.
    } finally {
      clearInterval(timer);
      await flush(true);
      setTimeout(() => {
        this.db('stream_chunks')
          .where({ thread_id: threadId, turn_id: turnId })
          .delete()
          .catch(() => {});
      }, KEEP_AFTER_DONE_MS).unref?.();
    }
  }

  private async insert(
    threadId: string,
    turnId: string,
    data: string,
    done: boolean,
  ): Promise<void> {
    await this.db('stream_chunks').insert({
      thread_id: threadId,
      turn_id: turnId,
      data,
      done,
      created_at: new Date().toISOString(),
    });
  }

  /**
   * Replay the thread's buffered turn and follow it to the end. Returns false,
   * without calling `start`, when the thread has no buffered turn.
   *
   * Ends at the `done` row, when the client goes, when the thread's next turn
   * replaces this one, or when the stream has been silent for
   * {@link IDLE_CHECK_MS} and the turn is no longer running (its replica
   * stopped without finishing it).
   */
  async follow(threadId: string, follower: StreamFollower): Promise<boolean> {
    let lastId = 0;
    let turnId: string | undefined;
    let quietSince = Date.now();
    for (;;) {
      if (follower.closed()) return true;
      const rows = await this.db('stream_chunks')
        .where({ thread_id: threadId })
        .andWhere('id', '>', lastId)
        .orderBy('id', 'asc')
        .select('id', 'turn_id', 'data', 'done');
      if (turnId === undefined) {
        if (rows.length === 0) return false;
        turnId = rows[0].turn_id as string;
        follower.start();
      }
      for (const row of rows) {
        if (row.turn_id !== turnId) return true;
        lastId = Number(row.id);
        if (row.data) follower.write(row.data as string);
        if (row.done) return true;
      }
      if (rows.length > 0) {
        quietSince = Date.now();
      } else if (
        Date.now() - quietSince > IDLE_CHECK_MS &&
        !(await follower.running())
      ) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, POLL_MS));
    }
  }
}
