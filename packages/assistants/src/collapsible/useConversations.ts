import { useCallback, useEffect, useState } from 'react';
import type { UIMessage } from 'ai';

/**
 * A single locally-persisted chat conversation.
 *
 * @public
 */
export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  messages: UIMessage[];
}

/**
 * localStorage keys for a given assistant's conversation set. Keys are
 * namespaced by `assistantId` so each assistant owns an isolated set of
 * conversations (see the `:` suffix).
 */
function storageKeys(assistantId: string) {
  return {
    list: `ai-chat-conversations:${assistantId}`,
    activeId: `ai-chat-active-conversation-id:${assistantId}`,
  };
}

function generateId(): string {
  return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function load(listKey: string): Conversation[] {
  try {
    const raw = localStorage.getItem(listKey);
    return raw ? (JSON.parse(raw) as Conversation[]) : [];
  } catch {
    return [];
  }
}

function save(listKey: string, conversations: Conversation[]) {
  try {
    localStorage.setItem(listKey, JSON.stringify(conversations));
  } catch {
    // storage full or unavailable
  }
}

function getLastConversationId(conversations: Conversation[]): string | null {
  return (
    [...conversations].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )[0]?.id ?? null
  );
}

function loadActiveId(
  activeKey: string,
  conversations: Conversation[],
): string | null {
  try {
    const storedId = localStorage.getItem(activeKey);
    if (storedId && conversations.some(c => c.id === storedId)) {
      return storedId;
    }
  } catch {
    // storage unavailable
  }
  return getLastConversationId(conversations);
}

function saveActiveId(activeKey: string, activeId: string | null) {
  try {
    if (activeId) {
      localStorage.setItem(activeKey, activeId);
    } else {
      localStorage.removeItem(activeKey);
    }
  } catch {
    // storage unavailable
  }
}

function loadInitialState(assistantId: string) {
  const { list, activeId } = storageKeys(assistantId);
  const conversations = load(list);
  return { conversations, activeId: loadActiveId(activeId, conversations) };
}

/**
 * The shape returned by {@link useConversations}.
 *
 * @public
 */
export interface ConversationsState {
  /** Conversations sorted pinned-first, then most-recently-updated. */
  conversations: Conversation[];
  activeId: string | null;
  activeConversation: Conversation | null;
  createConversation: () => string;
  selectConversation: (id: string | null) => void;
  updateMessages: (id: string, messages: UIMessage[]) => void;
  renameConversation: (id: string, title: string) => void;
  pinConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
}

/**
 * Pattern-A localStorage conversation state (ported from Implementation 1):
 * create / select / rename / pin / delete, persisted on every change.
 *
 * Storage is namespaced by `assistantId` so switching assistants surfaces a
 * separate conversation set. Callers should also remount this hook (e.g. via a
 * React `key` on the owning component) when the assistant changes so the
 * initial state is re-seeded from the new namespace.
 *
 * @public
 */
export function useConversations(assistantId: string): ConversationsState {
  const { list: listKey, activeId: activeKey } = storageKeys(assistantId);

  const [initialState] = useState(() => loadInitialState(assistantId));
  const [conversations, setConversations] = useState<Conversation[]>(
    initialState.conversations,
  );
  const [activeId, setActiveId] = useState<string | null>(
    initialState.activeId,
  );

  // Persist on every change.
  useEffect(() => {
    save(listKey, conversations);
  }, [listKey, conversations]);

  useEffect(() => {
    saveActiveId(activeKey, activeId);
  }, [activeKey, activeId]);

  const activeConversation = conversations.find(c => c.id === activeId) ?? null;

  const createConversation = useCallback((): string => {
    const id = generateId();
    const now = new Date().toISOString();
    const conv: Conversation = {
      id,
      title: 'New Chat',
      createdAt: now,
      updatedAt: now,
      pinned: false,
      messages: [],
    };
    setConversations(prev => [conv, ...prev]);
    setActiveId(id);
    return id;
  }, []);

  const updateMessages = useCallback((id: string, messages: UIMessage[]) => {
    setConversations(prev =>
      prev.map(c => {
        if (c.id !== id) return c;
        return { ...c, messages, updatedAt: new Date().toISOString() };
      }),
    );
  }, []);

  const renameConversation = useCallback((id: string, title: string) => {
    setConversations(prev =>
      prev.map(c =>
        c.id === id ? { ...c, title, updatedAt: new Date().toISOString() } : c,
      ),
    );
  }, []);

  const pinConversation = useCallback((id: string) => {
    setConversations(prev =>
      prev.map(c =>
        c.id === id
          ? { ...c, pinned: !c.pinned, updatedAt: new Date().toISOString() }
          : c,
      ),
    );
  }, []);

  const deleteConversation = useCallback(
    (id: string) => {
      setConversations(prev => {
        const next = prev.filter(c => c.id !== id);
        if (activeId === id) {
          setActiveId(getLastConversationId(next));
        }
        return next;
      });
    },
    [activeId],
  );

  const selectConversation = useCallback((id: string | null) => {
    setActiveId(id);
  }, []);

  // Sort: pinned first, then by updatedAt desc.
  const sortedConversations = [...conversations].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return {
    conversations: sortedConversations,
    activeId,
    activeConversation,
    createConversation,
    selectConversation,
    updateMessages,
    renameConversation,
    pinConversation,
    deleteConversation,
  };
}
