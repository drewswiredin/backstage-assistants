import { useCallback, useEffect, useState } from 'react';
import type { UIMessage } from 'ai';
import type { ModelId } from '@drewswiredin/backstage-plugin-assistants-common';

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
  /**
   * The model last selected for this conversation. Restored when the chat is
   * reopened; absent means "use the assistant's default". The caller validates
   * it against the assistant's current allowlist and falls back to the default
   * when it's no longer available.
   */
  model?: ModelId;
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

/**
 * Persist a conversation's messages directly to an assistant's namespaced
 * storage, without going through the React hook. Used by the live-thread manager
 * to save a reply that finished in the background for an assistant other than
 * the one currently on screen (whose `useConversations` state isn't mounted).
 * No-op if the conversation no longer exists.
 *
 * @public
 */
export function persistConversationMessages(
  assistantId: string,
  conversationId: string,
  messages: UIMessage[],
) {
  const { list } = storageKeys(assistantId);
  const conversations = load(list);
  if (!conversations.some(c => c.id === conversationId)) {
    return;
  }
  save(
    list,
    conversations.map(c =>
      c.id === conversationId
        ? { ...c, messages, updatedAt: new Date().toISOString() }
        : c,
    ),
  );
}

interface InternalState {
  /** The assistant these conversations belong to (kept in state so saves never
   * cross namespaces during an assistant switch). */
  assistantId: string;
  conversations: Conversation[];
  activeId: string | null;
}

function loadInitialState(assistantId: string): InternalState {
  const { list, activeId } = storageKeys(assistantId);
  const conversations = load(list);
  return {
    assistantId,
    conversations,
    activeId: loadActiveId(activeId, conversations),
  };
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
  /** Persist the model selected for a conversation (does not reorder the list). */
  setConversationModel: (id: string, model: ModelId) => void;
}

/**
 * Pattern-A localStorage conversation state (ported from Implementation 1):
 * create / select / rename / pin / delete, persisted on every change.
 *
 * Storage is namespaced by `assistantId`. The hook re-seeds itself when
 * `assistantId` changes (the assistant id is held in state alongside the data),
 * so the owning component no longer needs to remount on assistant switch — which
 * lets background chat threads outlive an assistant change.
 *
 * @public
 */
export function useConversations(assistantId: string): ConversationsState {
  const [state, setState] = useState<InternalState>(() =>
    loadInitialState(assistantId),
  );

  // Re-seed synchronously when the assistant changes. Holding assistantId in the
  // same state object keeps the persistence effects below from writing one
  // assistant's conversations under another's key during the switch render.
  if (state.assistantId !== assistantId) {
    setState(loadInitialState(assistantId));
  }

  const { conversations, activeId } = state;
  const keys = storageKeys(state.assistantId);

  // Persist on every change.
  useEffect(() => {
    save(keys.list, conversations);
  }, [keys.list, conversations]);

  useEffect(() => {
    saveActiveId(keys.activeId, activeId);
  }, [keys.activeId, activeId]);

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
    setState(prev => ({
      ...prev,
      conversations: [conv, ...prev.conversations],
      activeId: id,
    }));
    return id;
  }, []);

  const updateMessages = useCallback((id: string, messages: UIMessage[]) => {
    setState(prev => ({
      ...prev,
      conversations: prev.conversations.map(c =>
        c.id === id ? { ...c, messages, updatedAt: new Date().toISOString() } : c,
      ),
    }));
  }, []);

  const renameConversation = useCallback((id: string, title: string) => {
    setState(prev => ({
      ...prev,
      conversations: prev.conversations.map(c =>
        c.id === id ? { ...c, title, updatedAt: new Date().toISOString() } : c,
      ),
    }));
  }, []);

  const pinConversation = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      conversations: prev.conversations.map(c =>
        c.id === id
          ? { ...c, pinned: !c.pinned, updatedAt: new Date().toISOString() }
          : c,
      ),
    }));
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setState(prev => {
      const next = prev.conversations.filter(c => c.id !== id);
      return {
        ...prev,
        conversations: next,
        activeId:
          prev.activeId === id ? getLastConversationId(next) : prev.activeId,
      };
    });
  }, []);

  const selectConversation = useCallback((id: string | null) => {
    setState(prev => ({ ...prev, activeId: id }));
  }, []);

  // Model changes don't bump updatedAt: switching model shouldn't reorder the
  // conversation list.
  const setConversationModel = useCallback((id: string, model: ModelId) => {
    setState(prev => ({
      ...prev,
      conversations: prev.conversations.map(c =>
        c.id === id ? { ...c, model } : c,
      ),
    }));
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
    setConversationModel,
  };
}
