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
  ReasoningLevel,
} from '@drewswiredin/backstage-plugin-assistants-common';
import type { AssistantsApi } from '../api';
import { markTurnEnded } from './interruptedTurns';
import { createAttachmentAdapter } from './attachmentAdapters';
import { createHistoryAdapter } from './threadListAdapter';

/**
 * True when an assistant turn legitimately paused for the user (a `render_form`
 * to fill or a tool approval to answer), so a missing `finishReason` there is a
 * normal hand-off, not a cut-off.
 */
function awaitingHumanInput(message: {
  parts?: ReadonlyArray<{ type?: string; state?: string }>;
}): boolean {
  return (message.parts ?? []).some(
    p =>
      p.state === 'approval-requested' ||
      (typeof p.type === 'string' &&
        p.type.startsWith('tool-') &&
        (p.state === 'input-available' || p.state === 'input-streaming')),
  );
}

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
  /**
   * The reasoning level chosen for the active thread, or undefined when the
   * chosen model has no reasoning control. Also a ref, for the same reason.
   */
  reasoningLevelRef: RefObject<ReasoningLevel | undefined>;
}

/**
 * Wraps the authed fetch to inject the per-turn fields the backend `/chat`
 * expects. `AssistantChatTransport` builds the body (with the thread's `id` and
 * `messages`); we add `assistantId` + `modelId` (+ `reasoningLevel` when the
 * chosen model offers one) and copy `id -> threadId`. `getAssistantId` is read
 * per request so each thread targets its OWN agent (one runtime spans all
 * agents).
 */
function createInjectingFetch(
  baseFetch: typeof fetch,
  baseUrl: string,
  getAssistantId: () => AssistantId,
  modelIdRef: RefObject<ModelId>,
  reasoningLevelRef: RefObject<ReasoningLevel | undefined>,
): typeof fetch {
  return async (input, init) => {
    let nextInit = init;
    if (init && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        body.assistantId = getAssistantId();
        body.modelId = modelIdRef.current;
        // Omitted entirely for a model with no reasoning control, so the
        // provider's own default stands.
        if (reasoningLevelRef.current) {
          body.reasoningLevel = reasoningLevelRef.current;
        }
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
  const { api, baseUrl, getActiveAssistantId, modelIdRef, reasoningLevelRef } =
    options;

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
            reasoningLevelRef,
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
      // Guarantee no turn ever ends silently. The AI SDK reports how the stream
      // ended; we record it by the message's stable id so the surface always
      // shows a reason (see MessageInterrupted), live in this tab. The backend
      // independently stamps the persisted reply for any client after a reload.
      //   - isAbort      → user stopped / aborted        → "Request interrupted"
      //   - isDisconnect → the stream dropped (network)  → "Connection lost"
      //   - isError      → a clean failure; surfaced as the message error part
      //                    (MessageError), with a readable reason from the backend
      //   - clean close, no finishReason, NOT a human-in-the-loop pause → the turn
      //     was cut off (e.g. a provider stream that died server-side and escaped
      //     the SDK error path) → surface it rather than leave a blank ending.
      onFinish: ({ message, isAbort, isDisconnect, isError, finishReason }) => {
        if (!message) return;
        if (isDisconnect) {
          markTurnEnded(message.id, 'disconnected');
        } else if (isAbort) {
          markTurnEnded(message.id, 'interrupted');
        } else if (isError) {
          // Surfaced by the streamed error part (MessageError) — nothing to add.
        } else if (!finishReason && !awaitingHumanInput(message)) {
          markTurnEnded(message.id, 'disconnected');
        }
      },
      // Auto-send the turn back to the server when a client-driven tool step is
      // resolved — so the conversation continues without the user pressing send.
      // Two cases, both scoped to the LATEST step (parts after the final
      // `step-start`) so this fires exactly once: after the server continues, the
      // resolved parts are in a prior step and no longer match (otherwise they'd
      // keep matching → infinite re-send).
      //   1. `render_form` submitted/cancelled (a client-side tool whose result
      //      the form UI supplies via addResult).
      //   2. A DETERMINISTIC approval gate (`needsApproval`) the user answered:
      //      the tool part moves to `approval-responded`, and we must send so the
      //      backend runs the approved tool (or records the denial). addToolApproval
      //      Response only flushes when this predicate is true (see AI SDK chat.ts).
      // We never fire while a part is still `approval-requested` (awaiting the
      // user) or mid-stream, and we require a client-resolved part (form or
      // approval) so a SERVER tool truncated at maxSteps is never auto-resumed
      // (which could run away).
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
        if (latestStepTools.length === 0) return false;
        // Every tool in the step must be client-settled — nothing still streaming,
        // awaiting input, or awaiting the user's approval decision.
        const allSettled = latestStepTools.every(
          p =>
            p.state === 'output-available' ||
            p.state === 'output-error' ||
            p.state === 'approval-responded',
        );
        if (!allSettled) return false;
        const formResolved = latestStepTools.some(
          p =>
            p.type === 'tool-render_form' &&
            (p.state === 'output-available' || p.state === 'output-error'),
        );
        const approvalResolved = latestStepTools.some(
          p => p.state === 'approval-responded',
        );
        return formResolved || approvalResolved;
      },
    });
    // Composer file/image upload. A single, stateless adapter that always attaches
    // and always sends (the provider is the source of truth for what a model can
    // read). Replaces the AI-SDK default wildcard adapter, whose malformed
    // `accept:"*"` broke the file-picker button.
    const attachments = useMemo(() => createAttachmentAdapter(), []);

    // History is passed DIRECTLY here rather than through `RuntimeAdapterProvider`
    // context, and that is load-bearing — see below.
    //
    // `useAISDKRuntime` resolves it as `adapters?.history ?? contextAdapters?.history`.
    // The context branch only works when `@assistant-ui/react` (which provides the
    // context) and `@assistant-ui/react-ai-sdk` (which reads it) resolve to the SAME
    // physical `@assistant-ui/core`. A consumer's dependency tree can nest a second
    // copy under `react-ai-sdk` — same version, but a separate module instance with
    // its own React context — and the lookup silently returns undefined. History
    // then never loads and every existing conversation reopens blank.
    //
    // Passing the adapter directly removes the cross-module context handoff
    // entirely, so duplicate `core` copies can no longer break history.
    //
    // Gating creation on `remoteId` matters too: `useExternalHistory` sets its
    // "already loaded" latch BEFORE checking `remoteId`, so an effect that runs
    // while the id is still unresolved would latch and never load again. Leaving
    // the adapter undefined until the id exists means that effect returns at its
    // first guard, without latching, and loads properly once the id arrives.
    const history = useMemo(
      () => (remoteId ? createHistoryAdapter(api, remoteId) : undefined),
      [remoteId],
    );
    const adapters = useMemo(
      () => (history ? { attachments, history } : { attachments }),
      [attachments, history],
    );
    const runtime = useAISDKRuntime(chat, { adapters });

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
          const rows = await api.getThreadsStatus();
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
