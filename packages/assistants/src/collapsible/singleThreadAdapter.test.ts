import type { AssistantsApi } from '../api';
import { createSingleThreadAdapter } from './threadListAdapter';

const serverThread = {
  id: 't-1',
  assistantId: 'platform',
  title: 'Pods',
  archived: false,
  pinned: false,
  model: null,
  reasoningLevel: null,
  updatedAt: '2026-10-21T00:00:00Z',
  lastReadAt: null,
  unread: false,
};

function fakeApi(impl: (path: string, init?: RequestInit) => unknown) {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const api = {
    requestJson: jest.fn(async (path: string, init?: RequestInit) => {
      calls.push([path, init]);
      return impl(path, init);
    }),
  } as unknown as AssistantsApi;
  return { api, calls };
}

describe('createSingleThreadAdapter', () => {
  it('lists nothing without a remembered thread', async () => {
    const { api, calls } = fakeApi(() => serverThread);
    const adapter = createSingleThreadAdapter(
      api,
      () => 'platform',
      () => undefined,
    );
    await expect(adapter.list()).resolves.toEqual({ threads: [] });
    expect(calls).toEqual([]);
  });

  it('lists the one remembered thread, fetched by id', async () => {
    const { api, calls } = fakeApi(() => serverThread);
    const adapter = createSingleThreadAdapter(
      api,
      () => 'platform',
      () => 't-1',
    );
    const { threads } = await adapter.list();
    expect(calls.map(c => c[0])).toEqual(['/threads/t-1']);
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      remoteId: 't-1',
      title: 'Pods',
      status: 'regular',
      custom: { assistantId: 'platform' },
    });
  });

  it('lists nothing when the remembered thread is gone (404)', async () => {
    const { api } = fakeApi(() => {
      throw Object.assign(new Error('not found'), {
        response: { status: 404 },
      });
    });
    const adapter = createSingleThreadAdapter(
      api,
      () => 'platform',
      () => 't-gone',
    );
    await expect(adapter.list()).resolves.toEqual({ threads: [] });
  });

  it('surfaces any other failure', async () => {
    const { api } = fakeApi(() => {
      throw Object.assign(new Error('down'), { response: { status: 503 } });
    });
    const adapter = createSingleThreadAdapter(
      api,
      () => 'platform',
      () => 't-1',
    );
    await expect(adapter.list()).rejects.toThrow('down');
  });

  it('creates a new thread under the surface assistant', async () => {
    const { api, calls } = fakeApi(() => ({ ...serverThread, id: 't-new' }));
    const adapter = createSingleThreadAdapter(
      api,
      () => 'docs',
      () => undefined,
    );
    await expect(adapter.initialize('local')).resolves.toEqual({
      remoteId: 't-new',
      externalId: undefined,
    });
    expect(calls[0][0]).toBe('/threads');
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({
      assistantId: 'docs',
    });
  });
});
