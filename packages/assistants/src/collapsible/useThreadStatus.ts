/**
 * Conversation status, derived entirely from the server snapshot — no client
 * state machine.
 *
 * The single source of truth is `GET /threads/status`: per conversation
 * `{ working, unread }` (+ `assistantId`). One store per browser tab holds it,
 * shared by every view (the page, the panel, its button, the nav icon), so
 * they never disagree. It refetches on any Signals message (delivered even
 * while the tab is backgrounded) and when the tab becomes visible — never on
 * window focus. Signals is optional: a host app without
 * `@backstage/plugin-signals` polls the endpoint instead. While any turn runs it
 * also polls, because a turn on another backend replica may finish without its
 * signal reaching this browser. Every indicator is a pure derivation:
 *   - `working` (in-flight) shows ALWAYS, even for the focused conversation
 *   - `unread` shows until a view FOCUSES the conversation (focusing marks it read)
 *   - rollups (assistant, nav, tab): `working` wins over `unread`
 *
 * A response requested before a conversation was marked read (or before the
 * server confirmed it) can't bring its unread back: the read may have reached
 * a different replica, or the response may simply land late.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useApiHolder } from '@backstage/core-plugin-api';
import { signalApiRef } from '@backstage/plugin-signals-react';
import type { AssistantsApi } from '../api';
import type { ConversationStatusRow } from '../api';

const NOTIFY_CHANNEL = 'assistants:threads';
/** Refetch cadence when the host app has no Signals API installed. */
const POLL_INTERVAL_MS = 10_000;
/** Refetch cadence while any conversation is working. */
const WORKING_POLL_INTERVAL_MS = 5_000;

type SignalApi = {
  subscribe(channel: string, onMessage: () => void): { unsubscribe(): void };
};

interface Snapshot {
  rows: ConversationStatusRow[];
  /** Bumps on each applied refresh. */
  tick: number;
}

interface StatusStore {
  snapshot: Snapshot;
  listeners: Set<() => void>;
  /** Conversations a mounted view has focused, with how many views do. */
  focused: Map<string, number>;
  /**
   * Per conversation marked read: responses requested before this point can't
   * report it unread (`Infinity` until the server confirms the read).
   */
  readFloor: Map<string, number>;
  /** Orders requests and read confirmations. */
  clock: number;
  /** When the newest applied response was requested; older ones are dropped. */
  applied: number;
  views: number;
  stop?: () => void;
  workingPoll?: ReturnType<typeof setInterval>;
}

const stores = new WeakMap<AssistantsApi, StatusStore>();

function storeFor(api: AssistantsApi): StatusStore {
  let store = stores.get(api);
  if (!store) {
    store = {
      snapshot: { rows: [], tick: 0 },
      listeners: new Set(),
      focused: new Map(),
      readFloor: new Map(),
      clock: 0,
      applied: 0,
      views: 0,
    };
    stores.set(api, store);
  }
  return store;
}

function publish(store: StatusStore, snapshot: Snapshot) {
  store.snapshot = snapshot;
  store.listeners.forEach(listener => listener());
}

function markRead(api: AssistantsApi, store: StatusStore, threadId: string) {
  store.readFloor.set(threadId, Infinity);
  const settle = () => store.readFloor.set(threadId, ++store.clock);
  void api.markThreadRead(threadId).then(settle, settle);
  const { rows, tick } = store.snapshot;
  if (rows.some(r => r.threadId === threadId && r.unread)) {
    publish(store, {
      rows: rows.map(r =>
        r.threadId === threadId ? { ...r, unread: false } : r,
      ),
      tick,
    });
  }
}

async function refresh(api: AssistantsApi, store: StatusStore) {
  const requested = ++store.clock;
  let next: ConversationStatusRow[];
  try {
    next = await api.getThreadsStatus();
  } catch {
    return; // best-effort — the next signal or poll retries
  }
  if (requested < store.applied) return;
  store.applied = requested;
  const toMark: string[] = [];
  const rows = next.map(r => {
    if (!r.unread) return r;
    if (requested < (store.readFloor.get(r.threadId) ?? 0)) {
      return { ...r, unread: false };
    }
    // Focus is the only "read" action: converge a focused conversation on the
    // server so other tabs clear it too.
    if (store.focused.has(r.threadId)) toMark.push(r.threadId);
    return r;
  });
  publish(store, { rows, tick: store.snapshot.tick + 1 });
  toMark.forEach(threadId => markRead(api, store, threadId));

  // While a turn runs, poll as well: its finish may come from a replica whose
  // signal never reaches this browser.
  const anyWorking = rows.some(r => r.working);
  if (anyWorking && !store.workingPoll && store.views > 0) {
    store.workingPoll = setInterval(
      () => void refresh(api, store),
      WORKING_POLL_INTERVAL_MS,
    );
  } else if (!anyWorking && store.workingPoll) {
    clearInterval(store.workingPoll);
    store.workingPoll = undefined;
  }
}

/**
 * Signal-driven (delivered even while backgrounded), debounced, plus a refetch
 * when the tab becomes visible. No window-focus reconcile. Without Signals the
 * same refresh runs on a fixed interval instead.
 */
function start(
  api: AssistantsApi,
  store: StatusStore,
  signals: SignalApi | undefined,
) {
  void refresh(api, store);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void refresh(api, store), 120);
  };
  const sub = signals?.subscribe(NOTIFY_CHANNEL, () => schedule());
  const poll = signals
    ? undefined
    : setInterval(() => void refresh(api, store), POLL_INTERVAL_MS);
  const onVisible = () => {
    if (document.visibilityState === 'visible') void refresh(api, store);
  };
  document.addEventListener('visibilitychange', onVisible);
  store.stop = () => {
    if (timer) clearTimeout(timer);
    if (poll) clearInterval(poll);
    if (store.workingPoll) clearInterval(store.workingPoll);
    store.workingPoll = undefined;
    sub?.unsubscribe();
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/**
 * This tab started a turn: refetch now. A turn's start signal comes from the
 * replica that runs it, which may not be the one this browser listens to, so
 * without this nothing here would learn it is working (and start the poll that
 * catches its finish).
 */
export function refreshThreadStatus(api: AssistantsApi) {
  const store = stores.get(api);
  if (store && store.views > 0) void refresh(api, store);
}

export type ConvStatus = 'read' | 'working' | 'unread';

/** Collapse working/unread flags into the single status (working wins). */
export function toConvStatus(working: boolean, unread: boolean): ConvStatus {
  if (working) return 'working';
  if (unread) return 'unread';
  return 'read';
}

export interface ThreadStatusStore {
  /** Status of one conversation (by server thread id). */
  statusOf: (remoteId: string | undefined) => ConvStatus;
  /** Rollup for an assistant: working if any conv working, else unread if any unread. */
  assistantStatus: (assistantId: string) => ConvStatus;
  /** Global rollup across every conversation (working wins, then unread). */
  overallStatus: ConvStatus;
  /** True while a turn is in flight for this conversation. */
  isWorking: (remoteId: string | undefined) => boolean;
  /** Last turn's total tokens for a conversation (input + output), if known. */
  usageOf: (remoteId: string | undefined) => number | undefined;
  /** Bumps on each refresh — consumers reload the thread list to refresh titles. */
  tick: number;
}

export function useThreadStatus(
  api: AssistantsApi,
  focusedId: string | undefined,
): ThreadStatusStore {
  // Optional: `undefined` when the host app does not install Signals.
  const signals = useApiHolder().get(signalApiRef);
  const store = storeFor(api);
  const subscribe = useCallback(
    (listener: () => void) => {
      store.listeners.add(listener);
      return () => {
        store.listeners.delete(listener);
      };
    },
    [store],
  );
  const { rows, tick } = useSyncExternalStore(subscribe, () => store.snapshot);

  // The first mounted view starts the shared refresh; the last one stops it.
  useEffect(() => {
    store.views += 1;
    if (store.views === 1) start(api, store, signals);
    return () => {
      store.views -= 1;
      if (store.views === 0) {
        store.stop?.();
        store.stop = undefined;
      }
    };
  }, [api, store, signals]);

  // Focusing a conversation marks it read (optimistically + on the server).
  useEffect(() => {
    if (!focusedId) return undefined;
    store.focused.set(focusedId, (store.focused.get(focusedId) ?? 0) + 1);
    markRead(api, store, focusedId);
    return () => {
      const count = (store.focused.get(focusedId) ?? 1) - 1;
      if (count > 0) store.focused.set(focusedId, count);
      else store.focused.delete(focusedId);
    };
  }, [focusedId, api, store]);

  const statusOf = useCallback(
    (remoteId: string | undefined): ConvStatus => {
      if (!remoteId) return 'read';
      const r = rows.find(x => x.threadId === remoteId);
      if (!r) return 'read';
      if (r.working) return 'working'; // in-flight shows even when focused
      if (remoteId === focusedId) return 'read'; // focused → not unread
      return r.unread ? 'unread' : 'read';
    },
    [rows, focusedId],
  );

  const isWorking = useCallback(
    (remoteId: string | undefined): boolean =>
      !!remoteId && !!rows.find(x => x.threadId === remoteId)?.working,
    [rows],
  );

  const usageOf = useCallback(
    (remoteId: string | undefined): number | undefined =>
      remoteId ? rows.find(x => x.threadId === remoteId)?.tokens : undefined,
    [rows],
  );

  const assistantStatus = useCallback(
    (assistantId: string): ConvStatus => {
      let unread = false;
      for (const r of rows) {
        if (r.assistantId !== assistantId) continue;
        if (r.working) return 'working';
        if (r.unread && r.threadId !== focusedId) unread = true;
      }
      return unread ? 'unread' : 'read';
    },
    [rows, focusedId],
  );

  const overallStatus = useMemo<ConvStatus>(() => {
    let unread = false;
    for (const r of rows) {
      if (r.working) return 'working';
      if (r.unread && r.threadId !== focusedId) unread = true;
    }
    return unread ? 'unread' : 'read';
  }, [rows, focusedId]);

  return { statusOf, assistantStatus, overallStatus, isWorking, usageOf, tick };
}
