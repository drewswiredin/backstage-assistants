/**
 * Live, client-side record of how an assistant turn ENDED this session, keyed by
 * the assistant message's stable (globally-unique) id. Its job is to guarantee
 * that the tab which streamed a turn never shows a silent, reasonless ending.
 *
 * Two reasons:
 *   - `interrupted` — the user stopped the turn (or it was aborted).
 *   - `disconnected` — the stream dropped or the turn was cut off before it
 *     finished (network, or a provider stream that died server-side and escaped
 *     the SDK's error path). Distinct from a clean failure, which the AI SDK
 *     surfaces as a message error part (see MessageError) — that is not recorded
 *     here.
 *
 * Why this exists: the streamed message never receives the server's durable flag
 * (the connection is closing), so the live indicator would otherwise be missing.
 * The backend independently stamps the persisted reply, which drives the same
 * indicator for any client after a reload. Smallest possible mechanism — a Map +
 * a subscription — keyed by message id so there is never a cross-conversation
 * collision. Cleared on full reload, where the server flag takes over.
 */
import { useSyncExternalStore } from 'react';

export type TurnEndReason = 'interrupted' | 'disconnected';

const reasons = new Map<string, TurnEndReason>();
const listeners = new Set<() => void>();

/** Record how an assistant turn ended (idempotent per id; notifies readers). */
export function markTurnEnded(messageId: string, reason: TurnEndReason): void {
  if (reasons.get(messageId) === reason) return;
  reasons.set(messageId, reason);
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Reactively report how this assistant turn ended this session, or `undefined`
 * if it ended normally (or hasn't ended).
 */
export function useTurnEndReason(messageId: string): TurnEndReason | undefined {
  return useSyncExternalStore(subscribe, () => reasons.get(messageId));
}
