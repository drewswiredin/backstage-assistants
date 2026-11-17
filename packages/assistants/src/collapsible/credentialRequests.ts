import { useEffect } from 'react';
import type { CredentialsRequest } from '@drewswiredin/backstage-plugin-assistants-common';

/**
 * Credential requests: a per-user MCP server refused the token sent with the
 * turn, so the backend asks for a new one on the tool call that hit it, as
 * a preliminary output `{ _credentialsRequest }`. The browser answers while
 * the turn is live; the call then runs again with the new token.
 */

interface PartLike {
  type?: string;
  output?: unknown;
}

interface MessageLike {
  role?: string;
  parts?: ReadonlyArray<PartLike>;
}

/** The request for a new token in a tool output, when it is one. */
export function credentialsRequestOf(
  output: unknown,
): CredentialsRequest | undefined {
  const request = (
    output as { _credentialsRequest?: CredentialsRequest } | null | undefined
  )?._credentialsRequest;
  return request && typeof request.id === 'string' ? request : undefined;
}

/** Requests this tab has answered or is answering, across every thread. */
const seen = new Set<string>();

/** The open requests in the last assistant message not yet handled here. */
export function openCredentialsRequests(
  messages: ReadonlyArray<MessageLike>,
): CredentialsRequest[] {
  const last = messages[messages.length - 1];
  if (last?.role !== 'assistant') return [];
  return (last.parts ?? [])
    .map(part => credentialsRequestOf(part.output))
    .filter(
      (request): request is CredentialsRequest =>
        request?.status === 'open' && !seen.has(request.id),
    );
}

/** Answers each request for a new token while the turn is live. */
export function useCredentialsRequests(
  chat: { messages: ReadonlyArray<MessageLike>; status?: string },
  answer: ((request: CredentialsRequest) => Promise<void>) | undefined,
): void {
  const live = chat.status === 'streaming' || chat.status === 'submitted';
  const last = chat.messages[chat.messages.length - 1];
  useEffect(() => {
    if (!live || !answer) return;
    for (const request of openCredentialsRequests(chat.messages)) {
      seen.add(request.id);
      // Unanswered, the call reports the sign-in expired.
      void answer(request).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, last, answer]);
}
