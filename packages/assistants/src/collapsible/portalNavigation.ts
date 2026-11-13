/**
 * Carries out `portal__navigate` after the server has its result. The tool's
 * `execute` only checks the path; navigating then would unmount the
 * Assistants page before its runtime sends the result, and the turn would
 * stop. So the runtime waits until the request that carries the result is
 * accepted (the server has saved it and records the turn as running), then
 * asks the surface to navigate. The turn goes on server-side; the panel
 * rejoins it by the thread id, as any remount does.
 */
import type { AssistantId } from '@drewswiredin/backstage-plugin-assistants-common';
import { PORTAL_NAVIGATE } from '../clientTools/builtin/portalNavigate';

/** A page to open for a conversation. */
export interface NavigationRequest {
  path: string;
  threadId: string;
  assistantId: AssistantId;
}

/** Calls already carried out in this tab, so history never navigates again. */
const handled = new Set<string>();

interface PartLike {
  type?: string;
  toolName?: string;
  toolCallId?: string;
  state?: string;
  output?: unknown;
}

function navigatedPath(output: unknown): string | undefined {
  const o = output as { navigated?: unknown; path?: unknown } | undefined;
  return o?.navigated === true && typeof o.path === 'string'
    ? o.path
    : undefined;
}

function isNavigateCall(part: PartLike): boolean {
  return (
    part.type === `tool-${PORTAL_NAVIGATE}` ||
    (part.type === 'dynamic-tool' && part.toolName === PORTAL_NAVIGATE)
  );
}

/**
 * The navigation a `/chat` body carries: a `portal__navigate` result in the
 * latest step of its last message, not yet carried out. Earlier steps are
 * history the server has already seen.
 */
export function navigationIn(
  body: Record<string, unknown>,
): { toolCallId: string; path: string } | undefined {
  const messages = body.messages as
    | Array<{ role?: string; parts?: PartLike[] }>
    | undefined;
  const last = messages?.[messages.length - 1];
  if (last?.role !== 'assistant') return undefined;
  const parts = last.parts ?? [];
  const stepStart = parts.reduce(
    (idx, p, i) => (p.type === 'step-start' ? i : idx),
    -1,
  );
  for (const part of parts.slice(stepStart + 1)) {
    const path = navigatedPath(part.output);
    if (
      isNavigateCall(part) &&
      part.state === 'output-available' &&
      part.toolCallId &&
      path &&
      !handled.has(part.toolCallId)
    ) {
      return { toolCallId: part.toolCallId, path };
    }
  }
  return undefined;
}

/**
 * Wraps the turn fetch: once a request carrying a navigation is accepted,
 * `onNavigate` is called with it, at most once per call. Reads the body the
 * runtime sends (with `threadId` and `assistantId` already set).
 */
export function navigatingOnTurn(
  turnFetch: typeof fetch,
  onNavigate: (request: NavigationRequest) => void,
): typeof fetch {
  return async (input, init) => {
    let found: { toolCallId: string; path: string } | undefined;
    let body: Record<string, unknown> = {};
    if (init?.method === 'POST' && typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
        found = navigationIn(body);
      } catch {
        found = undefined;
      }
    }
    const response = await turnFetch(input, init);
    if (
      found &&
      response.ok &&
      typeof body.threadId === 'string' &&
      typeof body.assistantId === 'string' &&
      !handled.has(found.toolCallId)
    ) {
      handled.add(found.toolCallId);
      onNavigate({
        path: found.path,
        threadId: body.threadId,
        assistantId: body.assistantId as AssistantId,
      });
    }
    return response;
  };
}

/**
 * For a provider that runs its own tool loop the result goes to
 * `/held-calls/:id` instead; once that answer is accepted, the same request.
 */
export function navigationAnswered(
  part: PartLike | undefined,
  output: unknown,
  conversation: { threadId?: string; assistantId: AssistantId },
  onNavigate: (request: NavigationRequest) => void,
): void {
  const path = navigatedPath(output);
  if (
    !part ||
    !isNavigateCall(part) ||
    !part.toolCallId ||
    !path ||
    !conversation.threadId ||
    handled.has(part.toolCallId)
  ) {
    return;
  }
  handled.add(part.toolCallId);
  onNavigate({
    path,
    threadId: conversation.threadId,
    assistantId: conversation.assistantId,
  });
}

/** What a surface does for a navigation. */
export interface NavigationPlan {
  /** Where the router goes. */
  to: string;
  /** Hand the conversation to the panel first (from the Assistants page). */
  panel?: { threadId: string; assistantId: AssistantId };
  /** Close the panel and drop its conversation (it moves to the full page). */
  closePanel?: boolean;
}

/**
 * Where each surface sends a navigation. A page inside the Assistants page
 * opens the conversation there instead, since the panel stays out of that
 * page. From the Assistants page, any other page opens with the panel on the
 * same conversation. From the panel, the router just moves; the panel stays.
 */
export function planNavigation(
  request: NavigationRequest,
  surface: 'page' | 'panel',
  assistantsRoot: string | undefined,
  threadPath: ((threadId: string) => string) | undefined,
): NavigationPlan {
  const pathname = request.path.split(/[?#]/)[0];
  const intoAssistants =
    assistantsRoot !== undefined &&
    (pathname === assistantsRoot || pathname.startsWith(`${assistantsRoot}/`));
  if (intoAssistants && threadPath) {
    return {
      to: threadPath(request.threadId),
      ...(surface === 'panel' ? { closePanel: true } : {}),
    };
  }
  if (surface === 'page') {
    return {
      to: request.path,
      panel: { threadId: request.threadId, assistantId: request.assistantId },
    };
  }
  return { to: request.path };
}
