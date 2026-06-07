/**
 * Live, client-side record of assistant turns the user stopped this session,
 * keyed by the assistant message's stable (globally-unique) id.
 *
 * Why this exists: when the user clicks Stop, the backend stamps
 * `metadata.canceled` on the PERSISTED reply, which drives the "Request
 * interrupted" indicator for any client that loads the thread later (reload,
 * other tab). But the tab that clicked Stop holds the live, streamed message,
 * which never receives that server flag (the connection is closing). This store
 * bridges that one gap with the smallest possible mechanism — a Set + a
 * subscription — so the indicator shows immediately, without rewriting the
 * message array (which fights assistant-ui's tool tracking). Keyed by message id
 * means there is never a cross-conversation collision. Cleared on full reload,
 * where the server flag takes over.
 */
import { useSyncExternalStore } from 'react';

const ids = new Set<string>();
const listeners = new Set<() => void>();

/** Mark an assistant turn as user-interrupted (idempotent; notifies readers). */
export function markTurnInterrupted(messageId: string): void {
  if (ids.has(messageId)) return;
  ids.add(messageId);
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reactively report whether this assistant turn was interrupted this session. */
export function useTurnInterrupted(messageId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => ids.has(messageId),
  );
}
