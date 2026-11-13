import {
  navigateAndAnnounce,
  navigatingOnTurn,
  navigationAnswered,
  planNavigation,
  type NavigationRequest,
} from './portalNavigation';
import { openPanel, registerPanel } from '../panel/panelControl';

let nextId = 0;
/** A `/chat` body whose last step settled a `portal__navigate` call. */
function chatBody(
  path: string,
  toolCallId = `call-${++nextId}`,
): {
  threadId: string;
  assistantId: string;
  messages: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
} {
  return {
    threadId: 'thread-1',
    assistantId: 'ops',
    messages: [
      { role: 'user', parts: [{ type: 'text', text: 'open orders' }] },
      {
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          {
            type: 'tool-portal__navigate',
            toolCallId,
            state: 'output-available',
            input: { path },
            output: { navigated: true, path },
          },
        ],
      },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

const post = (body: unknown) => ({
  method: 'POST',
  body: JSON.stringify(body),
});

describe('navigatingOnTurn', () => {
  it('navigates once the request carrying the result is accepted, not before', async () => {
    const answered = deferred<Response>();
    const onNavigate = jest.fn();
    const fetch = navigatingOnTurn(() => answered.promise, onNavigate);

    const sent = fetch(
      '/chat',
      post(chatBody('/catalog/default/component/orders')),
    );
    await Promise.resolve();
    expect(onNavigate).not.toHaveBeenCalled();

    answered.resolve(new Response('stream', { status: 200 }));
    await sent;
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith({
      path: '/catalog/default/component/orders',
      threadId: 'thread-1',
      assistantId: 'ops',
    });
  });

  it('navigates at most once per call, and never from an earlier step', async () => {
    const onNavigate = jest.fn();
    const fetch = navigatingOnTurn(
      async () => new Response('', { status: 200 }),
      onNavigate,
    );
    const body = chatBody('/docs', 'call-once');
    await fetch('/chat', post(body));
    await fetch('/chat', post(body));
    expect(onNavigate).toHaveBeenCalledTimes(1);

    // The next turn: the navigation is history behind a new user message.
    const later = chatBody('/docs', 'call-history');
    later.messages.push({
      role: 'user',
      parts: [{ type: 'text', text: 'thanks' }],
    });
    await fetch('/chat', post(later));
    // A later step of the same message settled another tool.
    const stepped = chatBody('/docs', 'call-earlier-step');
    stepped.messages[1].parts.push(
      { type: 'step-start' },
      {
        type: 'tool-read_current_page',
        toolCallId: 'r1',
        state: 'output-available',
        output: {},
      },
    );
    await fetch('/chat', post(stepped));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('stays put when the server refuses the request or the call failed', async () => {
    const onNavigate = jest.fn();
    await navigatingOnTurn(
      async () => new Response('', { status: 403 }),
      onNavigate,
    )('/chat', post(chatBody('/docs')));
    const failed = chatBody('/docs');
    failed.messages[1].parts[1].output = {
      navigated: false,
      error: 'path must stay in this portal',
    };
    await navigatingOnTurn(
      async () => new Response('', { status: 200 }),
      onNavigate,
    )('/chat', post(failed));
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe('navigationAnswered', () => {
  it("navigates for a provider's held call once its answer is accepted", () => {
    const onNavigate = jest.fn();
    const part = {
      type: 'dynamic-tool',
      toolName: 'portal__navigate',
      toolCallId: 'held-1',
    };
    const conversation = { threadId: 'thread-1', assistantId: 'ops' };
    const output = { navigated: true, path: '/create' };
    navigationAnswered(part, output, conversation, onNavigate);
    navigationAnswered(part, output, conversation, onNavigate);
    navigationAnswered(
      { ...part, toolName: 'download_file', toolCallId: 'held-2' },
      output,
      conversation,
      onNavigate,
    );
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith({
      path: '/create',
      threadId: 'thread-1',
      assistantId: 'ops',
    });
  });
});

describe('planNavigation', () => {
  const request: NavigationRequest = {
    path: '/catalog/default/component/orders?tab=api',
    threadId: 'thread-1',
    assistantId: 'ops',
  };
  const threadPath = (id: string) => `/assistants/threads/${id}`;

  it('from the Assistants page, hands the conversation to the panel and moves', () => {
    expect(planNavigation(request, 'page', '/assistants', threadPath)).toEqual({
      to: '/catalog/default/component/orders?tab=api',
      panel: { threadId: 'thread-1', assistantId: 'ops' },
    });
  });

  it('from the panel, only moves the page', () => {
    expect(planNavigation(request, 'panel', '/assistants', threadPath)).toEqual(
      {
        to: '/catalog/default/component/orders?tab=api',
      },
    );
  });

  it('opens a page inside Assistants as the conversation on the full page', () => {
    const into = { ...request, path: '/assistants?assistant=other' };
    expect(planNavigation(into, 'panel', '/assistants', threadPath)).toEqual({
      to: '/assistants/threads/thread-1',
      closePanel: true,
    });
    expect(planNavigation(into, 'page', '/assistants', threadPath)).toEqual({
      to: '/assistants/threads/thread-1',
    });
    // A sibling path is not inside Assistants.
    expect(
      planNavigation(
        { ...request, path: '/assistants-help' },
        'panel',
        '/assistants',
        threadPath,
      ).to,
    ).toBe('/assistants-help');
  });
});

describe('openPanel', () => {
  it('reaches the mounted panel, and says when there is none', () => {
    const open = jest.fn();
    expect(openPanel({ threadId: 't' })).toBe(false);
    const unregister = registerPanel(open);
    expect(openPanel({ threadId: 't', assistantId: 'ops' })).toBe(true);
    expect(open).toHaveBeenCalledWith({ threadId: 't', assistantId: 'ops' });
    unregister();
    expect(openPanel({ threadId: 't' })).toBe(false);
  });
});

describe('navigateAndAnnounce', () => {
  it('fires popstate after the move, so a page that reads its URL on it sees the new one', () => {
    const seen: string[] = [];
    const onPop = () =>
      seen.push(window.location.pathname + window.location.search);
    window.addEventListener('popstate', onPop);
    const navigate = jest.fn((to: string) =>
      window.history.pushState({ idx: 1 }, '', to),
    );
    try {
      navigateAndAnnounce(navigate, '/explorer?item=two');
    } finally {
      window.removeEventListener('popstate', onPop);
    }
    expect(navigate).toHaveBeenCalledWith('/explorer?item=two');
    expect(seen).toEqual(['/explorer?item=two']);
  });
});
