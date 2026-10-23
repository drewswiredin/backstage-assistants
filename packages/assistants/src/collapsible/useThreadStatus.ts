/**
 * Conversation status, derived entirely from the server snapshot — no client
 * state machine.
 *
 * The single source of truth is `GET /threads/status`: per conversation
 * `{ working, unread }` (+ `assistantId`). We refetch it on any Signals message
 * (delivered even while the tab is backgrounded) and when the tab becomes
 * visible — never on window focus. Signals is optional: a host app without
 * `@backstage/plugin-signals` polls the endpoint instead. While any turn runs it
 * also polls, because a turn on another backend replica may finish without its
 * signal reaching this browser. Every indicator is a
 * pure derivation:
 *   - `working` (in-flight) shows ALWAYS, even for the focused conversation
 *   - `unread` shows until you FOCUS the conversation (focusing marks it read)
 *   - rollups (assistant, nav, tab): `working` wins over `unread`
 *
 * Marking a conversation read also tells the other views in this browser tab
 * directly (the nav icon keeps its own snapshot), because the server's `read`
 * signal can be published on a replica this browser isn't connected to.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApiHolder } from '@backstage/core-plugin-api';
import { signalApiRef } from '@backstage/plugin-signals-react';
import type { AssistantsApi } from '../api';
import type { ConversationStatusRow } from '../api';

const NOTIFY_CHANNEL = 'assistants:threads';
/** Refetch cadence when the host app has no Signals API installed. */
const POLL_INTERVAL_MS = 10_000;
/** Refetch cadence while any conversation is working. */
const WORKING_POLL_INTERVAL_MS = 5_000;

/** This tab's views, told directly when one of them marks a conversation read. */
const readListeners = new Set<(threadId: string) => void>();

function markRead(api: AssistantsApi, threadId: string) {
  readListeners.forEach(listener => listener(threadId));
  void api.markThreadRead(threadId);
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
  const [rows, setRows] = useState<ConversationStatusRow[]>([]);
  const [tick, setTick] = useState(0);
  const focusedRef = useRef(focusedId);
  focusedRef.current = focusedId;

  const refresh = useCallback(async () => {
    const next = await api.getThreadsStatus();
    setRows(next);
    setTick(t => t + 1);
    // Focus is the only "read" action: converge the focused conversation on the
    // server so the rollups / nav / other tabs clear it too.
    const fid = focusedRef.current;
    if (fid && next.find(r => r.threadId === fid)?.unread) {
      markRead(api, fid);
    }
  }, [api]);

  // Signal-driven (delivered even while backgrounded), debounced, plus a refetch
  // when the tab becomes visible. No window-focus reconcile. Without Signals the
  // same refresh runs on a fixed interval instead.
  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 120);
    };
    const sub = signals?.subscribe(NOTIFY_CHANNEL, () => schedule());
    const poll = signals
      ? undefined
      : setInterval(() => void refresh(), POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
      sub?.unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [signals, refresh]);

  // While a turn runs, poll as well: its finish may come from a replica whose
  // signal never reaches this browser.
  const anyWorking = rows.some(r => r.working);
  useEffect(() => {
    if (!anyWorking) return undefined;
    const poll = setInterval(() => void refresh(), WORKING_POLL_INTERVAL_MS);
    return () => clearInterval(poll);
  }, [anyWorking, refresh]);

  // A conversation marked read by any view in this tab (this one included).
  useEffect(() => {
    const listener = (threadId: string) =>
      setRows(prev =>
        prev.map(r => (r.threadId === threadId ? { ...r, unread: false } : r)),
      );
    readListeners.add(listener);
    return () => {
      readListeners.delete(listener);
    };
  }, []);

  // Focusing a conversation marks it read (optimistically + on the server).
  useEffect(() => {
    if (focusedId) markRead(api, focusedId);
  }, [focusedId, api]);

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
