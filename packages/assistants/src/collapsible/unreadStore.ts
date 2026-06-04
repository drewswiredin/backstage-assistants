import { useSyncExternalStore } from 'react';

/**
 * Tracks which conversations have an unread assistant reply — i.e. a reply that
 * landed (often in the background, via the live-thread manager) while the user
 * was looking at a different conversation or assistant. Persisted to
 * localStorage and namespaced per assistant, so the unread state — and the red
 * dots driven by it — survive assistant switches and reloads.
 *
 * State is exposed through a version counter + plain getters rather than a
 * React-shaped snapshot: `useUnreadVersion()` subscribes a component to changes,
 * and {@link getUnreadIds} / {@link hasUnread} read the current values during
 * render. (Returning a fresh array as the snapshot would loop useSyncExternalStore.)
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let version = 0;

function key(assistantId: string): string {
  return `ai-chat-unread:${assistantId}`;
}

function read(assistantId: string): string[] {
  try {
    const raw = localStorage.getItem(key(assistantId));
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function write(assistantId: string, ids: string[]) {
  try {
    if (ids.length === 0) {
      localStorage.removeItem(key(assistantId));
    } else {
      localStorage.setItem(key(assistantId), JSON.stringify(ids));
    }
  } catch {
    // storage unavailable
  }
}

function emit() {
  version += 1;
  listeners.forEach(l => l());
}

/** Conversation ids with an unread reply for the given assistant. */
export function getUnreadIds(assistantId: string): string[] {
  return read(assistantId);
}

/** Whether a specific conversation has an unread reply. */
export function isConversationUnread(
  assistantId: string,
  conversationId: string,
): boolean {
  return read(assistantId).includes(conversationId);
}

/** Whether any of an assistant's conversations have an unread reply. */
export function hasUnread(assistantId: string): boolean {
  return read(assistantId).length > 0;
}

/** Flag a conversation as having an unread reply. */
export function markUnread(assistantId: string, conversationId: string) {
  const ids = read(assistantId);
  if (!ids.includes(conversationId)) {
    write(assistantId, [...ids, conversationId]);
    emit();
  }
}

/** Clear the unread flag for a conversation (e.g. when the user opens it). */
export function clearUnread(assistantId: string, conversationId: string) {
  const ids = read(assistantId);
  if (ids.includes(conversationId)) {
    write(
      assistantId,
      ids.filter(id => id !== conversationId),
    );
    emit();
  }
}

// A single, stable handler so add/removeEventListener reference-match. Reflects
// unread changes made in other tabs.
function onStorage(e: StorageEvent) {
  if (e.key && e.key.startsWith('ai-chat-unread:')) {
    emit();
  }
}

function subscribe(listener: Listener): () => void {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  };
}

/**
 * Subscribe a component to unread changes. Returns an opaque version number;
 * components re-render when it changes and then read values via
 * {@link getUnreadIds} / {@link isConversationUnread} / {@link hasUnread}.
 */
export function useUnreadVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
}
