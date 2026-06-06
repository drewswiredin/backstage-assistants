/**
 * Subscribes to the backend's per-user conversation Signals channel and exposes
 * the two live notification states the UI renders:
 *  - generating: a reply is in flight (pulsing indicator)
 *  - unread:     a reply finished where you weren't looking (red dot)
 *
 * Signals only push *transitions*, so we seed the ephemeral "generating" set
 * from `GET /threads/active` and the durable "unread" set from `GET /threads/unread`
 * on mount, then keep both current as `turn-started` / `turn-finished` arrive.
 *
 * Both the chat chrome and (later) the nav icon use this hook independently.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { signalApiRef } from '@backstage/plugin-signals-react';
import type { JsonObject } from '@backstage/types';
import type { AssistantsApi } from '../api';
import { fetchActiveThreads, fetchUnreadAssistantIds } from './threadListAdapter';

const NOTIFY_CHANNEL = 'assistants:threads';

export interface ThreadNotifications {
  /** Server thread ids currently generating a reply. */
  generatingThreadIds: ReadonlySet<string>;
  /** Assistant ids with at least one generating reply. */
  generatingAssistantIds: ReadonlySet<string>;
  /** Assistant ids with at least one unread conversation. */
  unreadAssistantIds: ReadonlySet<string>;
  /** Increments whenever a turn finishes — callers can use it to refresh server state. */
  finishedTick: number;
}

export function useThreadNotifications(api: AssistantsApi): ThreadNotifications {
  const signals = useApi(signalApiRef);
  // threadId -> assistantId for in-flight generations.
  const [generating, setGenerating] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [unreadAssistantIds, setUnreadAssistantIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [finishedTick, setFinishedTick] = useState(0);

  const refreshUnread = useCallback(async () => {
    setUnreadAssistantIds(new Set(await fetchUnreadAssistantIds(api)));
  }, [api]);

  useEffect(() => {
    let cancelled = false;

    // Seed live (generating) + durable (unread) state from the server.
    fetchActiveThreads(api).then(active => {
      if (!cancelled) {
        setGenerating(new Map(active.map(a => [a.threadId, a.assistantId])));
      }
    });
    void refreshUnread();

    const sub = signals.subscribe(NOTIFY_CHANNEL, (msg: JsonObject) => {
      const { type, threadId, assistantId } = msg as {
        type?: string;
        threadId?: string;
        assistantId?: string;
      };
      if (!threadId || !assistantId) return;

      if (type === 'turn-started') {
        setGenerating(prev => {
          const next = new Map(prev);
          next.set(threadId, assistantId);
          return next;
        });
      } else if (type === 'turn-finished') {
        setGenerating(prev => {
          if (!prev.has(threadId)) return prev;
          const next = new Map(prev);
          next.delete(threadId);
          return next;
        });
        setFinishedTick(t => t + 1);
        void refreshUnread();
      }
    });

    return () => {
      cancelled = true;
      sub.unsubscribe();
    };
  }, [signals, api, refreshUnread]);

  const generatingThreadIds = useMemo(
    () => new Set(generating.keys()),
    [generating],
  );
  const generatingAssistantIds = useMemo(
    () => new Set(generating.values()),
    [generating],
  );

  return {
    generatingThreadIds,
    generatingAssistantIds,
    unreadAssistantIds,
    finishedTick,
  };
}
