import { act, renderHook, waitFor } from '@testing-library/react';
import type { AssistantsApi, ConversationStatusRow } from '../api';
import { refreshThreadStatus, useThreadStatus } from './useThreadStatus';

// Signals is installed; a test fires `signal()` to deliver a message, and
// otherwise it never delivers, as for a browser connected to a replica other
// than the one that publishes.
const signalHandlers = new Set<() => void>();
const mockSignalApi = {
  subscribe: (_channel: string, onMessage: () => void) => {
    signalHandlers.add(onMessage);
    return { unsubscribe: () => signalHandlers.delete(onMessage) };
  },
};
jest.mock('@backstage/core-plugin-api', () => ({
  ...jest.requireActual('@backstage/core-plugin-api'),
  useApiHolder: () => ({ get: () => mockSignalApi }),
}));

const rows = (unread: boolean): ConversationStatusRow[] => [
  { threadId: 't1', assistantId: 'a1', unread, working: false },
];

const api = (unread: boolean) =>
  ({
    getThreadsStatus: jest.fn().mockResolvedValue(rows(unread)),
    markThreadRead: jest.fn().mockResolvedValue(undefined),
  } as unknown as AssistantsApi);

/**
 * An API whose status responses the test answers, newest request first: the
 * order in which an older response lands last and can undo a newer read.
 */
function heldApi() {
  const pending: Array<(value: ConversationStatusRow[]) => void> = [];
  const assistants = {
    getThreadsStatus: jest.fn(
      () =>
        new Promise<ConversationStatusRow[]>(resolve => pending.push(resolve)),
    ),
    markThreadRead: jest.fn().mockResolvedValue(undefined),
  } as unknown as AssistantsApi;
  const answerAll = async (unread: boolean) => {
    await act(async () => {
      for (const resolve of pending.splice(0).reverse()) {
        resolve(rows(unread));
        await Promise.resolve();
      }
    });
  };
  return { assistants, pending, answerAll };
}

async function signal() {
  await act(async () => {
    signalHandlers.forEach(onMessage => onMessage());
    jest.advanceTimersByTime(200);
  });
}

describe('useThreadStatus', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('clears the nav rollup in this tab when the page focuses the conversation, without a signal', async () => {
    const assistants = api(true);
    const nav = renderHook(() => useThreadStatus(assistants, undefined));
    await waitFor(() =>
      expect(nav.result.current.overallStatus).toBe('unread'),
    );

    const page = renderHook(
      ({ focused }) => useThreadStatus(assistants, focused),
      { initialProps: { focused: undefined as string | undefined } },
    );
    await waitFor(() =>
      expect(page.result.current.statusOf('t1')).toBe('unread'),
    );

    act(() => page.rerender({ focused: 't1' }));
    expect(page.result.current.statusOf('t1')).toBe('read');
    expect(nav.result.current.overallStatus).toBe('read');
    expect(assistants.markThreadRead).toHaveBeenCalledWith('t1');
  });

  it('keeps a reply read in the open panel read on the button when the turn finishes', async () => {
    jest.useFakeTimers();
    const { assistants, answerAll } = heldApi();
    const button = renderHook(() => useThreadStatus(assistants, undefined));
    const panel = renderHook(() => useThreadStatus(assistants, 't1'));
    await answerAll(false);

    // The turn finishes: every response from here on reports it unread, and
    // the open panel marks it read on seeing that.
    await signal();
    await answerAll(true);

    expect(panel.result.current.statusOf('t1')).toBe('read');
    expect(button.result.current.statusOf('t1')).toBe('read');
    expect(assistants.markThreadRead).toHaveBeenCalledWith('t1');
  });

  it('ignores unread in a response requested before the conversation was read', async () => {
    jest.useFakeTimers();
    const { assistants, answerAll } = heldApi();
    const nav = renderHook(() => useThreadStatus(assistants, undefined));
    const page = renderHook(
      ({ focused }) => useThreadStatus(assistants, focused),
      { initialProps: { focused: undefined as string | undefined } },
    );
    await answerAll(true);
    expect(nav.result.current.overallStatus).toBe('unread');

    await signal();
    act(() => page.rerender({ focused: 't1' }));
    await answerAll(true);

    expect(nav.result.current.overallStatus).toBe('read');

    // Once the read is confirmed, a later reply shows as unread again.
    act(() => page.rerender({ focused: undefined }));
    await signal();
    await answerAll(true);
    expect(nav.result.current.overallStatus).toBe('unread');
  });

  it('shares one request between every view in the tab', async () => {
    jest.useFakeTimers();
    const { assistants, answerAll } = heldApi();
    renderHook(() => useThreadStatus(assistants, undefined));
    renderHook(() => useThreadStatus(assistants, 't1'));
    renderHook(() => useThreadStatus(assistants, undefined));
    await answerAll(false);
    await signal();
    await answerAll(false);
    expect(assistants.getThreadsStatus).toHaveBeenCalledTimes(2);
  });

  it('shows a turn this tab started as working, then unread, when its replica never signals', async () => {
    jest.useFakeTimers();
    let server = { working: false, unread: false };
    const assistants = {
      getThreadsStatus: jest.fn(async () => [
        { threadId: 't1', assistantId: 'a1', ...server },
      ]),
      markThreadRead: jest.fn().mockResolvedValue(undefined),
    } as unknown as AssistantsApi;
    const button = renderHook(() => useThreadStatus(assistants, undefined));
    await act(async () => {});
    expect(button.result.current.statusOf('t1')).toBe('read');

    // The turn starts on another replica: no signal reaches this tab.
    server = { working: true, unread: false };
    await act(async () => refreshThreadStatus(assistants));
    expect(button.result.current.statusOf('t1')).toBe('working');

    // It finishes, also unsignalled: the working poll catches it.
    server = { working: false, unread: true };
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(button.result.current.statusOf('t1')).toBe('unread');
  });
});
