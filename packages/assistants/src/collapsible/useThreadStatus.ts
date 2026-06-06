/**
 * The single source of truth for conversation status on the client.
 *
 * Holds one status per conversation — `read | working | unread` (mutually
 * exclusive) — keyed by server thread id, seeded from `GET /threads/status` and
 * kept live by Backstage Signals (`turn-started` / `turn-finished`) plus focus
 * (viewing a conversation marks it read). EVERY indicator is derived from this
 * one map: the conversation dots, the per-agent rail rollup, and (later) the nav
 * icon — so they can never disagree.
 *
 * Why a server-seeded store and not pure client state: `working` and `unread`
 * are server truths (a generation runs server-side; a background reply finishing
 * is durable), so the client mirrors them — live via signals, reconciled on
 * window focus.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { signalApiRef } from '@backstage/plugin-signals-react';
import type { JsonObject } from '@backstage/types';
import type { AssistantsApi } from '../api';
import { fetchThreadStatus, markThreadRead } from './threadListAdapter';

const NOTIFY_CHANNEL = 'assistants:threads';

export type ConvStatus = 'read' | 'working' | 'unread';

interface Entry {
  assistantId: string;
  status: ConvStatus;
}

export interface ThreadStatusStore {
  /** Status of one conversation (by server thread id). Unknown → 'read'. */
  statusOf: (remoteId: string | undefined) => ConvStatus;
  /** Rollup status for an assistant — excludes the focused conversation. */
  agentStatus: (assistantId: string) => ConvStatus;
  /** Global rollup across every conversation (working wins, then unread). */
  overallStatus: ConvStatus;
  /** Mark a conversation read locally + on the server (call when it's focused). */
  markRead: (remoteId: string) => void;
  /** Increments on every `turn-finished`; consumers reload the list to refresh titles. */
  finishedTick: number;
}

export function useThreadStatus(
  api: AssistantsApi,
  activeConversationId: string | undefined,
): ThreadStatusStore {
  const signals = useApi(signalApiRef);
  const [map, setMap] = useState<ReadonlyMap<string, Entry>>(() => new Map());
  const [finishedTick, setFinishedTick] = useState(0);
  // Latest focused conversation, readable inside the signal handler.
  const activeRef = useRef(activeConversationId);
  activeRef.current = activeConversationId;

  const reconcile = useCallback(async () => {
    const rows = await fetchThreadStatus(api);
    setMap(() => {
      const next = new Map<string, Entry>();
      for (const r of rows) {
        let status: ConvStatus = 'read';
        if (r.working) status = 'working';
        else if (r.unread && r.threadId !== activeRef.current) status = 'unread';
        next.set(r.threadId, { assistantId: r.assistantId, status });
      }
      return next;
    });
  }, [api]);

  useEffect(() => {
    void reconcile();

    const sub = signals.subscribe(NOTIFY_CHANNEL, (msg: JsonObject) => {
      const { type, threadId, assistantId } = msg as {
        type?: string;
        threadId?: string;
        assistantId?: string;
      };
      if (!threadId || !assistantId) return;

      if (type === 'turn-started') {
        setMap(prev => {
          const next = new Map(prev);
          next.set(threadId, { assistantId, status: 'working' });
          return next;
        });
      } else if (type === 'turn-finished') {
        const isActive = threadId === activeRef.current;
        setMap(prev => {
          const next = new Map(prev);
          // If you're watching it, it's read; otherwise it's now unread.
          next.set(threadId, { assistantId, status: isActive ? 'read' : 'unread' });
          return next;
        });
        setFinishedTick(t => t + 1);
        // Persist the read for the conversation you're watching so OTHER views
        // (the nav icon, other tabs) converge via the 'read' signal below.
        if (isActive) void markThreadRead(api, threadId);
      } else if (type === 'read') {
        setMap(prev => {
          const next = new Map(prev);
          const cur = next.get(threadId);
          next.set(threadId, {
            assistantId: cur?.assistantId ?? assistantId,
            status: 'read',
          });
          return next;
        });
      } else if (type === 'updated') {
        // Metadata-only change (e.g. a new title); refresh the list, no status change.
        setFinishedTick(t => t + 1);
      }
    });

    // Self-heal any missed transitions (e.g. signal dropped while tab hidden).
    const onFocus = () => void reconcile();
    window.addEventListener('focus', onFocus);
    return () => {
      sub.unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, [signals, reconcile, api]);

  const markRead = useCallback(
    (remoteId: string) => {
      setMap(prev => {
        const cur = prev.get(remoteId);
        if (!cur || cur.status === 'read') return prev;
        const next = new Map(prev);
        next.set(remoteId, { assistantId: cur.assistantId, status: 'read' });
        return next;
      });
      void markThreadRead(api, remoteId);
    },
    [api],
  );

  const statusOf = useCallback(
    (remoteId: string | undefined): ConvStatus =>
      remoteId ? map.get(remoteId)?.status ?? 'read' : 'read',
    [map],
  );

  const agentStatus = useCallback(
    (assistantId: string): ConvStatus => {
      let unread = false;
      for (const [tid, e] of map) {
        if (e.assistantId !== assistantId || tid === activeRef.current) continue;
        if (e.status === 'working') return 'working';
        if (e.status === 'unread') unread = true;
      }
      return unread ? 'unread' : 'read';
    },
    [map],
  );

  const overallStatus = useMemo<ConvStatus>(() => {
    let unread = false;
    for (const e of map.values()) {
      if (e.status === 'working') return 'working';
      if (e.status === 'unread') unread = true;
    }
    return unread ? 'unread' : 'read';
  }, [map]);

  return { statusOf, agentStatus, overallStatus, markRead, finishedTick };
}
