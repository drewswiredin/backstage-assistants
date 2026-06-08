/**
 * Per-thread runtime for `useRemoteThreadListRuntime`: each thread gets its own
 * `useChat` wrapped by `useAISDKRuntime`, driven by OUR `/threads` thread-list
 * adapter rather than Assistant Cloud — so the frontend is a pure view of the
 * plugin's database.
 *
 * Recovery is entirely server-driven, keyed by the stable thread id:
 *   - History (incl. the user message, persisted by the backend at turn START)
 *     loads on mount via the thread-list adapter's load-only ThreadHistoryAdapter.
 *   - If the server reports a turn is in flight for this thread (the `working`
 *     status), we rejoin its live stream by the thread id — GET /chat/resume/:id,
 *     which the backend buffers per thread. No fragile per-turn id is captured.
 * So a remount (switching conversation/agent, route change, reload) recovers the
 * same way every time, and a backgrounded tab simply keeps streaming.
 */
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useChat } from '@ai-sdk/react';
import { useAISDKRuntime, AssistantChatTransport } from '@assistant-ui/react-ai-sdk';
import { useAui, useAuiState } from '@assistant-ui/react';
import type {
  AssistantId,
  ModelId,
} from '@drewswiredin/backstage-plugin-assistants-common';
import type { AssistantsApi } from '../api';
import { fetchThreadStatus } from './threadListAdapter';
import { markTurnInterrupted } from './interruptedTurns';

/** Verbose resume tracing for local debugging (open the browser console). */
const DEBUG = false;
const dbg = (...a: unknown[]) => {
  // eslint-disable-next-line no-console
  if (DEBUG) console.info('[aui-resume]', ...a);
};

interface RuntimeHookOptions {
  api: AssistantsApi;
  baseUrl: string;
  /** The active agent — tags a brand-new thread before it has server metadata. */
  getActiveAssistantId: () => AssistantId;
  /** The currently selected model id (kept in a ref so the transport reads it live). */
  modelIdRef: RefObject<ModelId>;
}

/**
 * Wraps the authed fetch to inject the per-turn fields the backend `/chat`
 * expects. `AssistantChatTransport` builds the body (with the thread's `id` and
 * `messages`); we add `assistantId` + `modelId` and copy `id -> threadId`.
 * `getAssistantId` is read per request so each thread targets its OWN agent (one
 * runtime spans all agents).
 */
function createInjectingFetch(
  baseFetch: typeof fetch,
  baseUrl: string,
  getAssistantId: () => AssistantId,
  modelIdRef: RefObject<ModelId>,
): typeof fetch {
  return async (input, init) => {
    let nextInit = init;
    if (init && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        body.assistantId = getAssistantId();
        body.modelId = modelIdRef.current;
        if (typeof body.id === 'string' && body.threadId === undefined) {
          body.threadId = body.id;
        }
        // The composer Stop aborts THIS request's signal (only on stop — not on
        // navigate-away/reload/unmount). Tell the backend to abort the
        // server-side turn, so Stop actually cancels generation instead of just
        // disconnecting (which would otherwise keep running + persist the full turn).
        const threadId = body.threadId;
        if (typeof threadId === 'string' && init.signal) {
          init.signal.addEventListener(
            'abort',
            () => {
              void baseFetch(`${baseUrl}/chat/cancel/${threadId}`, {
                method: 'POST',
              }).catch(() => {});
            },
            { once: true },
          );
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
 * targets the backend `/chat`, and rejoins an in-flight stream by thread id when
 * the server says the thread is working.
 */
export function makeRuntimeHook(options: RuntimeHookOptions) {
  const { api, baseUrl, getActiveAssistantId, modelIdRef } = options;

  return function useRuntimeHook() {
    const threadChatId = useAuiState(state => state.threadListItem.id);
    const remoteId = useAuiState(state => state.threadListItem.remoteId) as
      | string
      | undefined;
    const threadAssistantId = useAuiState(
      state =>
        (state.threadListItem.custom as { assistantId?: string } | undefined)
          ?.assistantId,
    ) as AssistantId | undefined;
    const aui = useAui();

    // The resume target is the stable thread id, read live (local ids churn).
    const remoteIdRef = useRef<string | undefined>(remoteId);
    remoteIdRef.current = remoteId;

    // This thread's agent: its own metadata once known, else the active agent
    // (a brand-new draft). Read live by the transport so /chat always targets
    // the right assistant even though one runtime spans every agent.
    const assistantIdRef = useRef<AssistantId>(
      threadAssistantId ?? getActiveAssistantId(),
    );
    assistantIdRef.current = threadAssistantId ?? getActiveAssistantId();

    const transport = useMemo(
      () =>
        new AssistantChatTransport({
          api: `${baseUrl}/chat`,
          fetch: createInjectingFetch(
            api.fetch,
            baseUrl,
            () => assistantIdRef.current,
            modelIdRef,
          ),
          resumable: {
            // Reconnect by the THREAD id — the backend buffers the in-flight SSE
            // per thread. We don't capture/store a per-turn id: getStreamId just
            // yields the thread id so resumeStream() targets /chat/resume/:id;
            // WHETHER to resume is decided by the server `working` flag below.
            storage: {
              getStreamId: () => remoteIdRef.current ?? null,
              setStreamId: () => {},
              clear: () => {},
            },
            resumeApi: (id: string) => `${baseUrl}/chat/resume/${id}`,
          },
        }),
      // Stable for the life of this thread instance; storage reads remoteId live.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    const chat = useChat({
      id: threadChatId,
      transport,
      // When the user clicks Stop, the AI SDK reports the aborted turn here.
      // Record it by the message's stable id so this tab shows "Request
      // interrupted" immediately; the backend independently stamps the persisted
      // reply, which drives the same indicator for any client after a reload.
      onFinish: ({ message, isAbort }) => {
        if (isAbort && message) markTurnInterrupted(message.id);
      },
      // Resume the turn automatically once the user submits an interactive
      // `render_form` (a client-side tool: the model emits the call, the form UI
      // supplies the result via addResult). Mirrors AI SDK's
      // lastAssistantMessageIsCompleteWithToolCalls — it scopes to the LATEST
      // step (parts after the final `step-start`), so this fires exactly once:
      // after the model continues, the form is in a prior step and no longer
      // matches (otherwise the completed part would keep matching → infinite
      // re-send). Scoped to render_form so a SERVER tool truncated at maxSteps is
      // never auto-resumed (which could run away).
      sendAutomaticallyWhen: ({ messages }) => {
        const last = messages[messages.length - 1];
        if (!last || last.role !== 'assistant') return false;
        const parts = (last.parts ?? []) as Array<{
          type?: string;
          state?: string;
        }>;
        const lastStepStart = parts.reduce(
          (idx, p, i) => (p.type === 'step-start' ? i : idx),
          -1,
        );
        const latestStepTools = parts
          .slice(lastStepStart + 1)
          .filter(p => typeof p.type === 'string' && p.type.startsWith('tool-'));
        return (
          latestStepTools.length > 0 &&
          latestStepTools.some(p => p.type === 'tool-render_form') &&
          latestStepTools.every(
            p => p.state === 'output-available' || p.state === 'output-error',
          )
        );
      },
    });
    const runtime = useAISDKRuntime(chat);

    // Wire the transport to the runtime + this thread's list item so it can
    // initialize() the server thread and tag requests with its remoteId.
    transport.setRuntime(runtime);
    transport.__internal_setGetThreadListItem(() =>
      aui.threadListItem.source ? aui.threadListItem() : undefined,
    );

    // When the server reports an in-flight turn for this thread, rejoin its live
    // stream. History is loaded separately by the thread-list adapter. Runs once
    // per remoteId; never fights a turn already streaming locally.
    const chatRef = useRef(chat);
    chatRef.current = chat;
    const resumedFor = useRef<string | undefined>(undefined);
    useEffect(() => {
      if (!remoteId || resumedFor.current === remoteId) return;
      if (chatRef.current.status === 'streaming' || chatRef.current.status === 'submitted') {
        resumedFor.current = remoteId; // a local turn already owns the stream
        return;
      }
      resumedFor.current = remoteId;
      void (async () => {
        try {
          const rows = await fetchThreadStatus(api);
          const working = rows.find(r => r.threadId === remoteId)?.working ?? false;
          dbg('resume check', { remoteId, working });
          if (working) {
            await chatRef.current.resumeStream();
            dbg('resumed', { remoteId });
          }
        } catch (e) {
          dbg('resume error', e);
        }
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [remoteId]);

    return runtime;
  };
}
