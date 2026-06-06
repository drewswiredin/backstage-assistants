import type { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { resolvePackagePath } from '@backstage/backend-plugin-api';
import type { UIMessage } from 'ai';

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

type ThreadPatch = Partial<Pick<Thread, 'title' | 'model' | 'pinned' | 'archived'>>;

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

  /** This user's non-archived threads for an assistant, newest first, with unread. */
  async listThreads(userRef: string, assistantId: string): Promise<Thread[]> {
    const rows = await this.db('threads')
      .where({ user_ref: userRef, assistant_id: assistantId, archived: false })
      .orderBy([
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
    const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) fields.title = patch.title;
    if (patch.model !== undefined) fields.model = patch.model;
    if (patch.pinned !== undefined) fields.pinned = patch.pinned;
    if (patch.archived !== undefined) fields.archived = patch.archived;

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
  async listUserThreadStatuses(
    userRef: string,
  ): Promise<Array<{ threadId: string; assistantId: string; unread: boolean }>> {
    const rows = await this.db('threads')
      .where({ user_ref: userRef, archived: false })
      .select('id', 'assistant_id', 'updated_at', 'last_read_at');
    return rows.map(r => {
      const updatedAt = String(r.updated_at);
      const lastReadAt = r.last_read_at ? String(r.last_read_at) : null;
      return {
        threadId: r.id as string,
        assistantId: r.assistant_id as string,
        unread: lastReadAt ? new Date(updatedAt) > new Date(lastReadAt) : false,
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

      const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (model) fields.model = model;
      await trx('threads').where({ id: threadId }).update(fields);
      return true;
    });
  }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function toThread(row: Record<string, unknown>): Thread {
  const updatedAt = String(row.updated_at);
  const lastReadAt = row.last_read_at ? String(row.last_read_at) : null;
  return {
    id: row.id as string,
    assistantId: row.assistant_id as string,
    title: row.title as string,
    model: (row.model as string) ?? null,
    pinned: Boolean(row.pinned),
    archived: Boolean(row.archived),
    createdAt: String(row.created_at),
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
