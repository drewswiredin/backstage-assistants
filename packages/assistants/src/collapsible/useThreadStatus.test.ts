import { act, renderHook, waitFor } from '@testing-library/react';
import type { AssistantsApi } from '../api';
import { useThreadStatus } from './useThreadStatus';

// Signals is installed but never delivers, as for a browser connected to a
// replica other than the one that publishes.
jest.mock('@backstage/core-plugin-api', () => ({
  ...jest.requireActual('@backstage/core-plugin-api'),
  useApiHolder: () => ({
    get: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
  }),
}));

const api = (unread: boolean) =>
  ({
    getThreadsStatus: jest
      .fn()
      .mockResolvedValue([
        { threadId: 't1', assistantId: 'a1', unread, working: false },
      ]),
    markThreadRead: jest.fn().mockResolvedValue(undefined),
  } as unknown as AssistantsApi);

describe('useThreadStatus', () => {
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
});
