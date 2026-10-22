import { resolveRequestedThread } from './resolveRequestedThread';

const item = (remoteId: string, assistantId: string) => ({
  remoteId,
  custom: { assistantId },
});

const threadList = {
  threadIds: ['local-1', 'local-2'],
  archivedThreadIds: ['local-3'],
  threadItems: {
    'local-1': item('t-1', 'platform'),
    'local-2': item('t-2', 'docs'),
    'local-3': item('t-3', 'platform'),
    'local-new': { remoteId: undefined, custom: undefined },
  },
} as any;

describe('resolveRequestedThread', () => {
  it('maps a server thread id to its local id and assistant', () => {
    expect(resolveRequestedThread(threadList, 't-2')).toEqual({
      threadId: 'local-2',
      assistantId: 'docs',
    });
  });

  it('finds an archived thread too', () => {
    expect(resolveRequestedThread(threadList, 't-3')).toEqual({
      threadId: 'local-3',
      assistantId: 'platform',
    });
  });

  it('is undefined for an unknown thread, or none requested', () => {
    expect(resolveRequestedThread(threadList, 'nope')).toBeUndefined();
    expect(resolveRequestedThread(threadList, undefined)).toBeUndefined();
  });
});
