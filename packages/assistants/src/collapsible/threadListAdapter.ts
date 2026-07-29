/**
 * `RemoteThreadListAdapter` backed by the plugin's `/threads` REST API, plus a
 * per-thread load-only `ThreadHistoryAdapter`. Plugs into
 * `useRemoteThreadListRuntime` so server-side conversations are the single
 * source of truth and the frontend holds no conversation state of its own.
 *
 * Message rows are written ONLY by the backend (`/chat` onFinish) — the history
 * adapter's `append` is a no-op. Titles are generated server-side on the first
 * completed turn, so `generateTitle` returns an empty stream.
 */
import type {
  RemoteThreadListAdapter,
  RemoteThreadMetadata,
  ThreadHistoryAdapter,
  GenericThreadHistoryAdapter,
  MessageFormatAdapter,
  MessageFormatItem,
  MessageFormatRepository,
  ExportedMessageRepository,
} from '@assistant-ui/core';
import type {
  AssistantId,
  ReasoningLevel,
} from '@drewswiredin/backstage-plugin-assistants-common';
import type { AssistantsApi } from '../api';

/** Browser-side mirror of the backend `Thread` row (see assistants-backend/threads.ts). */
interface ServerThread {
  id: string;
  assistantId: string;
  title: string;
  archived: boolean;
  pinned: boolean;
  model: string | null;
  reasoningLevel: string | null;
  updatedAt: string;
  lastReadAt: string | null;
  unread: boolean;
}

/** Server metadata carried through `RemoteThreadMetadata.custom` to the UI. */
export interface ThreadCustomMetadata {
  /** Owning assistant — lets one runtime span all agents (UI filters by it). */
  assistantId: string;
  unread: boolean;
  pinned: boolean;
  updatedAt: string;
  model: string | null;
  reasoningLevel: string | null;
  lastReadAt: string | null;
}

/** Flat conversation row the sidebar panels render (built from the runtime thread list). */
export interface ThreadSummary {
  /** assistant-ui local thread id — used for switch / rename / delete via the runtime. */
  id: string;
  /** Server thread id — used for read / pin API calls. Absent for an uninitialized new thread. */
  remoteId?: string;
  title: string;
  pinned: boolean;
  /** A reply finished here while you weren't looking. Mutually exclusive with `working`. */
  unread: boolean;
  /** A reply is currently in flight here (and you're not watching it). */
  working: boolean;
}

// ---------------------------------------------------------------------------
// Authed-fetch helper
// ---------------------------------------------------------------------------

function createApiHelper(api: AssistantsApi) {
  let baseUrl: string | undefined;
  const url = async (path: string): Promise<string> => {
    if (!baseUrl) baseUrl = await api.getBaseUrl();
    return `${baseUrl}${path}`;
  };
  const json = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await api.fetch(await url(path), {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      throw new Error(`${init?.method ?? 'GET'} ${path}: ${res.status}`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  };
  return { url, json };
}

// ---------------------------------------------------------------------------
// Thread-list adapter
// ---------------------------------------------------------------------------

export function createThreadListAdapter(
  api: AssistantsApi,
  getActiveAssistantId: () => AssistantId,
): RemoteThreadListAdapter {
  const h = createApiHelper(api);

  const toMetadata = (t: ServerThread): RemoteThreadMetadata => ({
    status: t.archived ? 'archived' : 'regular',
    remoteId: t.id,
    title: t.title,
    custom: {
      assistantId: t.assistantId,
      unread: t.unread,
      pinned: t.pinned,
      updatedAt: t.updatedAt,
      model: t.model,
      reasoningLevel: t.reasoningLevel,
      lastReadAt: t.lastReadAt,
    } satisfies ThreadCustomMetadata,
  });

  return {
    async list() {
      // ALL the user's threads across agents (the server filters to ones the
      // caller can currently access); the UI filters by the active agent. One
      // runtime spans the whole tab, so switching agent/conversation never
      // mounts/unmounts a runtime.
      const data = await h.json<{ threads: ServerThread[] }>(`/threads`);
      return { threads: (data.threads ?? []).map(toMetadata) };
    },

    async initialize(_threadId) {
      // A new thread is created under whichever agent is active right now.
      const thread = await h.json<ServerThread>(`/threads`, {
        method: 'POST',
        body: JSON.stringify({ assistantId: getActiveAssistantId() }),
      });
      return { remoteId: thread.id, externalId: undefined };
    },

    async fetch(remoteId) {
      return toMetadata(await h.json<ServerThread>(`/threads/${remoteId}`));
    },

    async rename(remoteId, title) {
      await h.json(`/threads/${remoteId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      });
    },

    async archive(remoteId) {
      await h.json(`/threads/${remoteId}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: true }),
      });
    },

    async unarchive(remoteId) {
      await h.json(`/threads/${remoteId}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: false }),
      });
    },

    async delete(remoteId) {
      await api.fetch(await h.url(`/threads/${remoteId}`), { method: 'DELETE' });
    },

    async generateTitle() {
      // Titles are generated + persisted server-side on the first completed turn
      // (backend /chat onFinish). The runtime requires this method, but there is
      // nothing to stream — return an empty, immediately-closed stream.
      return new ReadableStream({ start: c => c.close() }) as never;
    },

    // NOTE: no `unstable_Provider`. The history adapter is passed directly into
    // `useAISDKRuntime` (see useAssistantRuntime.ts) instead of being published
    // through `RuntimeAdapterProvider` context. Context only reaches
    // `react-ai-sdk` when it and `@assistant-ui/react` resolve to the same
    // physical `@assistant-ui/core`; a consumer tree that nests a second copy
    // breaks the handoff silently and every thread reopens blank.
  };
}

// ---------------------------------------------------------------------------
// Thread history adapter — LOAD ONLY (server is the single writer)
// ---------------------------------------------------------------------------

export function createHistoryAdapter(
  api: AssistantsApi,
  threadId: string,
): ThreadHistoryAdapter {
  const h = createApiHelper(api);

  async function loadItems<TMessage>(): Promise<MessageFormatItem<TMessage>[]> {
    try {
      const data = await h.json<{
        messages: Array<{
          id: string;
          parentId: string | null;
          role: string;
          contentJson: string;
        }>;
      }>(`/threads/${threadId}/messages`);
      return (data.messages ?? []).map(m => ({
        parentId: m.parentId,
        message: JSON.parse(m.contentJson) as TMessage,
      }));
    } catch (e) {
      // Never swallow this. A failed load renders an empty thread, which is
      // indistinguishable from a genuinely new conversation — so silence here
      // turns any backend or auth failure into a silent data-loss illusion that
      // is nearly impossible to diagnose in a deployed environment. Rethrow:
      // `useExternalHistory` catches it and logs "Failed to load message
      // history", so the real status code reaches the browser console.
      // eslint-disable-next-line no-console
      console.error(`[assistants] loading history for thread ${threadId}:`, e);
      throw e;
    }
  }

  return {
    // assistant-ui consumes history through the `withFormat` adapter below; these
    // base methods are required by the type but not exercised by that path. Loads
    // only — the server is the single writer (persisted by /chat at turn start +
    // onFinish), so the user message is durable the instant a turn is sent and
    // re-entry loads it even mid-flight.
    async load(): Promise<ExportedMessageRepository> {
      return { messages: [] };
    },
    async append() {},
    withFormat<TMessage, TStorageFormat extends Record<string, unknown>>(
      _format: MessageFormatAdapter<TMessage, TStorageFormat>,
    ): GenericThreadHistoryAdapter<TMessage> {
      return {
        async load(): Promise<MessageFormatRepository<TMessage>> {
          return { messages: await loadItems<TMessage>() };
        },
        async append() {},
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Unread
// ---------------------------------------------------------------------------

/** Mark a thread read on the server (clears its unread flag). Best-effort. */
export async function markThreadRead(
  api: AssistantsApi,
  threadId: string,
): Promise<void> {
  try {
    const baseUrl = await api.getBaseUrl();
    await api.fetch(`${baseUrl}/threads/${threadId}/read`, { method: 'POST' });
  } catch {
    // best-effort — unread is recomputed server-side on next list()
  }
}

/** Per-conversation status row from `GET /threads/status` (all the user's threads). */
export interface ConversationStatusRow {
  threadId: string;
  assistantId: string;
  unread: boolean;
  working: boolean;
  /** Last completed turn's total tokens (input + output) — drives the gauge. */
  tokens?: number;
}

/**
 * The status of every one of the user's conversations across all assistants —
 * the single source the client derives all indicators from. Best-effort:
 * returns [] on failure.
 */
export async function fetchThreadStatus(
  api: AssistantsApi,
): Promise<ConversationStatusRow[]> {
  try {
    const h = createApiHelper(api);
    const data = await h.json<{ threads: ConversationStatusRow[] }>(
      `/threads/status`,
    );
    return data.threads ?? [];
  } catch {
    return [];
  }
}

/**
 * Patch a thread's server-side fields the runtime adapter doesn't cover (pin,
 * model, reasoning level). Rename/archive/delete go through the runtime's
 * `ThreadListItemRuntime`.
 */
export async function patchThread(
  api: AssistantsApi,
  threadId: string,
  patch: {
    title?: string;
    model?: string;
    /** `null` clears the stored level (back to the provider default). */
    reasoningLevel?: ReasoningLevel | null;
    pinned?: boolean;
    archived?: boolean;
  },
): Promise<void> {
  const baseUrl = await api.getBaseUrl();
  await api.fetch(`${baseUrl}/threads/${threadId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}
