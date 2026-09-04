import type { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { resolvePackagePath } from '@backstage/backend-plugin-api';
import type { UIMessage } from 'ai';
import { InputError } from '@backstage/errors';
import { REASONING_LEVELS } from '@drewswiredin/backstage-plugin-assistants-common';
import { toIsoTimestamp } from './timestamps';

/**
 * Server-side conversation persistence.
 *
 * Conversations live in the plugin's own database (Backstage `DatabaseService`)
 * and are the single source of truth — the frontend is a pure view over them via
 * assistant-ui's remote thread-list + history adapters. The server is the only
 * writer of message rows: `/chat` persists the completed turn on the AI SDK
 * loop's `onFinish` (see {@link ThreadService.replaceMessages}).
 *
 * Every method is scoped to the calling user's `userRef`. There is no path that
 * reads or writes another user's threads or messages.
 */

/** A persisted conversation thread (one chat session with one assistant). */
export interface Thread {
  id: string;
  assistantId: string;
  title: string;
  model: string | null;
  /** Reasoning effort last chosen for this thread; null = never chosen. */
  reasoningLevel: string | null;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  lastReadAt: string | null;
  /** Derived: `updatedAt > lastReadAt`. Only populated by {@link ThreadService.listThreads}. */
  unread: boolean;
}

/** A persisted message within a thread (an assistant-ui UI message, verbatim). */
export interface StoredMessage {
  id: string;
  parentId: string | null;
  role: string;
  /** The assistant-ui `UIMessage`, JSON-serialized. Stored opaquely. */
  contentJson: string;
  sortOrder: number;
}

/** The metadata fields a thread may be patched with. */
export type ThreadPatch = Partial<
  Pick<Thread, 'title' | 'model' | 'reasoningLevel' | 'pinned' | 'archived'>
>;

/** Longest title the `threads.title` column holds. */
const THREAD_TITLE_MAX_CHARS = 512;

/**
 * Validates a `PATCH /threads/:id` body: only the metadata fields, each of the
 * right type, and nothing else. Throws {@link InputError} (400) otherwise.
 */
export function parseThreadPatch(body: unknown): ThreadPatch {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new InputError('Request body must be a JSON object');
  }
  const allowed = ['title', 'model', 'reasoningLevel', 'pinned', 'archived'];
  const unknown = Object.keys(body).filter(k => !allowed.includes(k));
  if (unknown.length > 0) {
    throw new InputError(`Unknown field(s): ${unknown.join(', ')}`);
  }
  const { title, model, reasoningLevel, pinned, archived } = body as Record<
    string,
    unknown
  >;
  const patch: ThreadPatch = {};
  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim().length === 0) {
      throw new InputError('title must be a non-empty string');
    }
    if (title.length > THREAD_TITLE_MAX_CHARS) {
      throw new InputError(
        `title must be at most ${THREAD_TITLE_MAX_CHARS} characters`,
      );
    }
    patch.title = title;
  }
  if (model !== undefined) {
    if (model !== null && (typeof model !== 'string' || model.length === 0)) {
      throw new InputError('model must be a non-empty string or null');
    }
    patch.model = model;
  }
  if (reasoningLevel !== undefined) {
    if (
      reasoningLevel !== null &&
      !(REASONING_LEVELS as string[]).includes(reasoningLevel as string)
    ) {
      throw new InputError(
        `reasoningLevel must be one of ${REASONING_LEVELS.join(', ')} or null`,
      );
    }
    patch.reasoningLevel = reasoningLevel as ThreadPatch['reasoningLevel'];
  }
  if (pinned !== undefined) {
    if (typeof pinned !== 'boolean') {
      throw new InputError('pinned must be a boolean');
    }
    patch.pinned = pinned;
  }
  if (archived !== undefined) {
    if (typeof archived !== 'boolean') {
      throw new InputError('archived must be a boolean');
    }
    patch.archived = archived;
  }
  return patch;
}

export class ThreadService {
  constructor(private readonly db: Knex) {}

  /** Run the plugin's migrations (idempotent). Called once at plugin init. */
  async runMigrations(): Promise<void> {
    await this.db.migrate.latest({
      directory: resolvePackagePath(
        '@drewswiredin/backstage-plugin-assistants-backend',
        'migrations',
      ),
    });
  }

  // ---- Threads --------------------------------------------------------------

  /**
   * This user's non-archived threads, newest first, with unread. Scoped to one
   * assistant when `assistantId` is given, else ALL the user's threads (the
   * caller is responsible for filtering to currently-accessible assistants).
   */
  async listThreads(userRef: string, assistantId?: string): Promise<Thread[]> {
    const query = this.db('threads').where({
      user_ref: userRef,
      archived: false,
    });
    if (assistantId) {
      query.where({ assistant_id: assistantId });
    }
    const rows = await query.orderBy([
      { column: 'pinned', order: 'desc' },
      { column: 'updated_at', order: 'desc' },
    ]);
    return rows.map(toThread);
  }

  async getThread(userRef: string, threadId: string): Promise<Thread | null> {
    const row = await this.db('threads')
      .where({ id: threadId, user_ref: userRef })
      .first();
    return row ? toThread(row) : null;
  }

  async createThread(
    userRef: string,
    assistantId: string,
    model?: string,
  ): Promise<Thread> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.db('threads').insert({
      id,
      assistant_id: assistantId,
      user_ref: userRef,
      title: 'New Chat',
      model: model ?? null,
      pinned: false,
      archived: false,
      created_at: now,
      updated_at: now,
      last_read_at: now,
    });
    return (await this.getThread(userRef, id))!;
  }

  async updateThread(
    userRef: string,
    threadId: string,
    patch: ThreadPatch,
  ): Promise<Thread | null> {
    // Metadata edits (title / model / reasoning / pin / archive) must NOT bump updated_at:
    // unread is `updated_at > last_read_at`, so bumping it would falsely mark a
    // conversation unread after a rename or pin. updated_at moves only when a
    // turn lands (replaceMessages) — it tracks activity + recency, not edits.
    const fields: Record<string, unknown> = {};
    if (patch.title !== undefined) fields.title = patch.title;
    if (patch.model !== undefined) fields.model = patch.model;
    if (patch.reasoningLevel !== undefined)
      fields.reasoning_level = patch.reasoningLevel;
    if (patch.pinned !== undefined) fields.pinned = patch.pinned;
    if (patch.archived !== undefined) fields.archived = patch.archived;
    if (Object.keys(fields).length === 0) {
      return this.getThread(userRef, threadId);
    }

    const count = await this.db('threads')
      .where({ id: threadId, user_ref: userRef })
      .update(fields);
    return count > 0 ? this.getThread(userRef, threadId) : null;
  }

  /** Delete a thread and its messages. Returns false if the user doesn't own it. */
  async deleteThread(userRef: string, threadId: string): Promise<boolean> {
    return this.db.transaction(async trx => {
      const owned = await trx('threads')
        .where({ id: threadId, user_ref: userRef })
        .first();
      if (!owned) return false;
      // Delete messages explicitly rather than relying on FK cascade, which
      // SQLite does not enforce unless PRAGMA foreign_keys is on.
      await trx('messages').where({ thread_id: threadId }).delete();
      await trx('threads').where({ id: threadId, user_ref: userRef }).delete();
      return true;
    });
  }

  /** Mark a thread read. Returns the thread's assistantId, or null if not owned. */
  async markRead(userRef: string, threadId: string): Promise<string | null> {
    const row = await this.db('threads')
      .where({ id: threadId, user_ref: userRef })
      .first();
    if (!row) return null;
    await this.db('threads')
      .where({ id: threadId, user_ref: userRef })
      .update({ last_read_at: new Date().toISOString() });
    return row.assistant_id as string;
  }

  /**
   * Per-conversation status for ALL of this user's non-archived threads (across
   * every assistant) — the single source the client derives every indicator
   * from. `unread` (`updated_at > last_read_at`) is durable; the live `working`
   * flag is merged in by the router from its in-flight set. One cheap query.
   */
  async listUserThreadStatuses(userRef: string): Promise<
    Array<{
      threadId: string;
      assistantId: string;
      unread: boolean;
      tokens?: number;
    }>
  > {
    const rows = await this.db('threads')
      .where({ user_ref: userRef, archived: false })
      .select(
        'id',
        'assistant_id',
        'updated_at',
        'last_read_at',
        'last_tokens',
      );
    return rows.map(r => {
      const updatedAt = toIsoTimestamp(r.updated_at)!;
      const lastReadAt = toIsoTimestamp(r.last_read_at) ?? null;
      return {
        threadId: r.id as string,
        assistantId: r.assistant_id as string,
        unread: lastReadAt ? new Date(updatedAt) > new Date(lastReadAt) : false,
        tokens: typeof r.last_tokens === 'number' ? r.last_tokens : undefined,
      };
    });
  }

  // ---- Messages -------------------------------------------------------------

  /**
   * A thread's messages in order. Returns null when the thread doesn't exist or
   * isn't owned by this user (so the route can answer 404 — never leaking
   * another user's content).
   */
  async getMessages(
    userRef: string,
    threadId: string,
  ): Promise<StoredMessage[] | null> {
    const owned = await this.db('threads')
      .where({ id: threadId, user_ref: userRef })
      .first();
    if (!owned) return null;
    const rows = await this.db('messages')
      .where({ thread_id: threadId })
      .orderBy('sort_order', 'asc');
    return rows.map(toMessage);
  }

  /**
   * Persist the completed turn: make the thread's stored messages exactly match
   * the conversation the client streamed. Authoritative, idempotent (keyed by
   * message id via full replace), and scoped to an owned thread. Called only
   * from `/chat` `onFinish` — the server is the single writer.
   *
   * Returns false (without writing) if the user doesn't own the thread.
   */
  async replaceMessages(
    userRef: string,
    threadId: string,
    messages: UIMessage[],
    model?: string,
  ): Promise<boolean> {
    return this.db.transaction(async trx => {
      const owned = await trx('threads')
        .where({ id: threadId, user_ref: userRef })
        .first();
      if (!owned) return false;

      await trx('messages').where({ thread_id: threadId }).delete();
      if (messages.length > 0) {
        const now = new Date().toISOString();
        await trx('messages').insert(
          messages.map((m, i) => ({
            id: m.id,
            thread_id: threadId,
            parent_id: i > 0 ? messages[i - 1].id : null,
            role: m.role,
            content_json: JSON.stringify(m),
            sort_order: i,
            created_at: now,
          })),
        );
      }

      // Durable token tally for the composer gauge: the latest assistant turn's
      // total (input + output), read from its usage metadata. Left untouched when
      // no assistant message carries usage (e.g. the user-message persist at turn
      // start), so it retains the prior turn's value mid-turn.
      let lastTokens: number | undefined;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].role !== 'assistant') continue;
        const usage = (
          messages[i].metadata as
            | { usage?: { inputTokens?: number; outputTokens?: number } }
            | undefined
        )?.usage;
        if (usage) {
          lastTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
          break;
        }
      }

      const fields: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (model) fields.model = model;
      if (typeof lastTokens === 'number') fields.last_tokens = lastTokens;
      await trx('threads').where({ id: threadId }).update(fields);
      return true;
    });
  }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function toThread(row: Record<string, unknown>): Thread {
  const updatedAt = toIsoTimestamp(row.updated_at)!;
  const lastReadAt = toIsoTimestamp(row.last_read_at) ?? null;
  return {
    id: row.id as string,
    assistantId: row.assistant_id as string,
    title: row.title as string,
    model: (row.model as string) ?? null,
    reasoningLevel: (row.reasoning_level as string) ?? null,
    pinned: Boolean(row.pinned),
    archived: Boolean(row.archived),
    createdAt: toIsoTimestamp(row.created_at)!,
    updatedAt,
    lastReadAt,
    unread: lastReadAt ? new Date(updatedAt) > new Date(lastReadAt) : false,
  };
}

function toMessage(row: Record<string, unknown>): StoredMessage {
  return {
    id: row.id as string,
    parentId: (row.parent_id as string) ?? null,
    role: row.role as string,
    contentJson: row.content_json as string,
    sortOrder: row.sort_order as number,
  };
}
