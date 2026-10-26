import { useEffect, useRef } from 'react';
import {
  HELD_APPROVAL_PREFIX,
  heldToolCallId,
  type HeldCallAnswer,
} from '@drewswiredin/backstage-plugin-assistants-common';

/**
 * Held calls: with a provider that runs its own tool loop, a call that needs
 * the user can't end the turn, so the backend holds it open and the browser
 * answers through `POST /held-calls/:id`. An approval it asks for carries an
 * id starting `held-`; a client tool's call is provider-executed. Both are
 * answered here, and the local message still updates as usual, so the card
 * shows the decision or the result at once.
 */

/** The slice of a UI message part these helpers read. */
interface PartLike {
  type?: string;
  toolCallId?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  providerExecuted?: boolean;
}

interface MessageLike {
  role?: string;
  parts?: ReadonlyArray<PartLike>;
}

/** The two `useChat` helpers a held call's answer goes through. */
export interface HeldChatHelpers {
  messages: ReadonlyArray<MessageLike>;
  addToolApprovalResponse: (args: {
    id: string;
    approved: boolean;
    reason?: string;
  }) => unknown;
  addToolOutput: (args: {
    tool: string;
    toolCallId: string;
    state?: 'output-error';
    output?: unknown;
    errorText?: string;
  }) => unknown;
}

function findPart(
  messages: ReadonlyArray<MessageLike>,
  toolCallId: string,
): PartLike | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const part = messages[i].parts?.find(p => p.toolCallId === toolCallId);
    if (part) return part;
  }
  return undefined;
}

/**
 * `chat` with its approval and tool-output helpers also answering held
 * calls. Other answers pass through untouched.
 */
export function withHeldCalls<T extends HeldChatHelpers>(
  chat: T,
  answer: (id: string, body: HeldCallAnswer) => Promise<void>,
  onError: (error: unknown) => void = () => {},
): T {
  return {
    ...chat,
    addToolApprovalResponse: args => {
      if (args.id.startsWith(HELD_APPROVAL_PREFIX)) {
        void answer(args.id, {
          approved: args.approved,
          ...(args.reason !== undefined ? { reason: args.reason } : {}),
        }).catch(onError);
      }
      return chat.addToolApprovalResponse(args);
    },
    addToolOutput: args => {
      if (findPart(chat.messages, args.toolCallId)?.providerExecuted) {
        void answer(
          heldToolCallId(args.toolCallId),
          args.state === 'output-error'
            ? { error: args.errorText ?? 'The tool failed.' }
            : { output: args.output },
        ).catch(onError);
      }
      return chat.addToolOutput(args);
    },
  };
}

/** Runs a held client tool's call in this browser; undefined if not runnable. */
export type HeldClientToolRunner = (
  toolName: string,
) => ((input: unknown, signal: AbortSignal) => Promise<unknown>) | undefined;

/**
 * Runs each provider-executed call of a client tool that the browser can run
 * by itself while the turn is live, and answers it with the result. A tool
 * answered by its card (`render_form`) has no runner; the card's result goes
 * through {@link withHeldCalls}.
 */
export function useHeldClientTools(
  chat: HeldChatHelpers & { status?: string },
  runnerFor: HeldClientToolRunner | undefined,
): void {
  const started = useRef(new Set<string>());
  const live = chat.status === 'streaming' || chat.status === 'submitted';
  const last = chat.messages[chat.messages.length - 1];
  useEffect(() => {
    if (!live || !runnerFor || last?.role !== 'assistant') return;
    for (const part of last.parts ?? []) {
      if (
        part.type !== 'dynamic-tool' ||
        !part.providerExecuted ||
        part.state !== 'input-available' ||
        !part.toolCallId ||
        !part.toolName ||
        started.current.has(part.toolCallId)
      ) {
        continue;
      }
      const run = runnerFor(part.toolName);
      if (!run) continue;
      const toolCallId = part.toolCallId;
      const tool = part.toolName;
      started.current.add(toolCallId);
      const controller = new AbortController();
      void run(part.input, controller.signal).then(
        output => chat.addToolOutput({ tool, toolCallId, output }),
        error =>
          chat.addToolOutput({
            tool,
            toolCallId,
            state: 'output-error',
            errorText: error instanceof Error ? error.message : String(error),
          }),
      );
    }
  }, [live, last, runnerFor, chat]);
}
