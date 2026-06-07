/**
 * Conversation status, derived entirely from the server snapshot — no client
 * state machine.
 *
 * The single source of truth is `GET /threads/status`: per conversation
 * `{ working, unread }` (+ `assistantId`). We refetch it on any Signals message
 * (delivered even while the tab is backgrounded) and when the tab becomes
 * visible — never on window focus. Every indicator is a pure derivation:
 *   - `working` (in-flight) shows ALWAYS, even for the focused conversation
 *   - `unread` shows until you FOCUS the conversation (focusing marks it read)
 *   - rollups (agent, nav, tab): `working` wins over `unread`
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { signalApiRef } from '@backstage/plugin-signals-react';
import type { AssistantsApi } from '../api';
import {
  fetchThreadStatus,
  markThreadRead,
  type ConversationStatusRow,
} from './threadListAdapter';

const NOTIFY_CHANNEL = 'assistants:threads';

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
  agentStatus: (assistantId: string) => ConvStatus;
  /** Global rollup across every conversation (working wins, then unread). */
  overallStatus: ConvStatus;
  /** True while a turn is in flight for this conversation. */
  isWorking: (remoteId: string | undefined) => boolean;
  /** Bumps on each refresh — consumers reload the thread list to refresh titles. */
  tick: number;
}

export function useThreadStatus(
  api: AssistantsApi,
  focusedId: string | undefined,
): ThreadStatusStore {
  const signals = useApi(signalApiRef);
  const [rows, setRows] = useState<ConversationStatusRow[]>([]);
  const [tick, setTick] = useState(0);
  const focusedRef = useRef(focusedId);
  focusedRef.current = focusedId;

  const refresh = useCallback(async () => {
    const next = await fetchThreadStatus(api);
    setRows(next);
    setTick(t => t + 1);
    // Focus is the only "read" action: converge the focused conversation on the
    // server so the rollups / nav / other tabs clear it too.
    const fid = focusedRef.current;
    if (fid && next.find(r => r.threadId === fid)?.unread) {
      void markThreadRead(api, fid);
    }
  }, [api]);

  // Signal-driven (delivered even while backgrounded), debounced, plus a refetch
  // when the tab becomes visible. No window-focus reconcile.
  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 120);
    };
    const sub = signals.subscribe(NOTIFY_CHANNEL, () => schedule());
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      sub.unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [signals, refresh]);

  // Focusing a conversation marks it read (optimistically + on the server).
  useEffect(() => {
    if (!focusedId) return;
    setRows(prev =>
      prev.map(r => (r.threadId === focusedId ? { ...r, unread: false } : r)),
    );
    void markThreadRead(api, focusedId);
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

  const agentStatus = useCallback(
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

  return { statusOf, agentStatus, overallStatus, isWorking, tick };
}
