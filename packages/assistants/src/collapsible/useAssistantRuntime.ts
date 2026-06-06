/**
 * Per-thread runtime for `useRemoteThreadListRuntime`: each thread gets its own
 * `useChat` wrapped by `useAISDKRuntime`, driven by OUR `/threads` thread-list
 * adapter rather than Assistant Cloud — so the frontend is a pure view of the
 * plugin's database.
 *
 * `AssistantChatTransport` awaits the thread-list adapter's `initialize()` before
 * the first send (creating the server thread) and puts its `remoteId` on the
 * request as `id`. A thin fetch wrapper adds `assistantId` + `modelId` and maps
 * `id -> threadId`, which is all the backend `/chat` needs to persist the turn.
 */
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useChat } from '@ai-sdk/react';
import {
  useAISDKRuntime,
  AssistantChatTransport,
  createResumableSessionStorage,
} from '@assistant-ui/react-ai-sdk';
import { useAui, useAuiState } from '@assistant-ui/react';
import type {
  AssistantId,
  ModelId,
} from '@drewswiredin/backstage-plugin-assistants-common';
import type { AssistantsApi } from '../api';

interface RuntimeHookOptions {
  api: AssistantsApi;
  baseUrl: string;
  assistantId: AssistantId;
  /** The currently selected model id (kept in a ref so the transport reads it live). */
  modelIdRef: RefObject<ModelId>;
}

/**
 * Wraps the authed fetch to inject the per-turn fields the backend `/chat`
 * expects. `AssistantChatTransport` builds the body (with the thread's `id` and
 * `messages`); we add `assistantId` + `modelId` and copy `id -> threadId`.
 */
function createInjectingFetch(
  baseFetch: typeof fetch,
  assistantId: AssistantId,
  modelIdRef: RefObject<ModelId>,
): typeof fetch {
  return async (input, init) => {
    let nextInit = init;
    if (init && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        body.assistantId = assistantId;
        body.modelId = modelIdRef.current;
        if (typeof body.id === 'string' && body.threadId === undefined) {
          body.threadId = body.id;
        }
        nextInit = { ...init, body: JSON.stringify(body) };
      } catch {
        // Non-JSON body — leave it untouched.
      }
    }
    return baseFetch(input, nextInit);
  };
}

/**
 * Returns the `runtimeHook` for `useRemoteThreadListRuntime`. Called once per
 * active thread; builds a `useChat` + `useAISDKRuntime` runtime whose transport
 * targets the backend `/chat`. History persistence is server-side (the history
 * adapter is load-only, injected via the thread-list adapter's `unstable_Provider`).
 */
export function makeRuntimeHook(options: RuntimeHookOptions) {
  const { api, baseUrl, assistantId, modelIdRef } = options;

  return function useRuntimeHook() {
    const threadChatId = useAuiState(state => state.threadListItem.id);
    const aui = useAui();

    const transport = useMemo(
      () =>
        new AssistantChatTransport({
          api: `${baseUrl}/chat`,
          fetch: createInjectingFetch(api.fetch, assistantId, modelIdRef),
          // Mid-flight resume: the transport stores the response's
          // x-resumable-stream-id (per thread) and, on remount with one stored,
          // reconnects via /chat/resume/:id. Cleared when it sees the finish event.
          resumable: {
            storage: createResumableSessionStorage({
              key: `aui-resume:${assistantId}:${threadChatId}`,
            }),
            resumeApi: (streamId: string) => `${baseUrl}/chat/resume/${streamId}`,
          },
        }),
      // Stable per thread instance (threadChatId is fixed within it).
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [threadChatId],
    );

    const chat = useChat({ id: threadChatId, transport });
    const runtime = useAISDKRuntime(chat);

    // Wire the transport to the runtime + this thread's list item so it can
    // initialize() the server thread and tag requests with its remoteId.
    transport.setRuntime(runtime);
    transport.__internal_setGetThreadListItem(() =>
      aui.threadListItem.source ? aui.threadListItem() : undefined,
    );

    // On (re)mount, if a stream was left in flight for this thread, rejoin it.
    const resumeFired = useRef(false);
    useEffect(() => {
      if (resumeFired.current) return;
      const adapter = transport.getResumableAdapter();
      if (!adapter?.storage.getStreamId()) return;
      resumeFired.current = true;
      chat.resumeStream().catch(() => adapter.storage.clear());
    }, [transport, chat]);

    return runtime;
  };
}
