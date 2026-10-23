import type { UserCredentialSpec } from '@drewswiredin/backstage-plugin-assistants-common';
import type { AssistantsApi } from './AssistantsApi';
import { signInWithPopup } from './mcpOAuth';
import { getUserToken } from './userCredentials';

const tracker: UserCredentialSpec = {
  server: 'tracker',
  provider: 'oauth',
  title: 'Tracker',
};
const BACKEND = 'http://localhost:7007';

function setup(start = async () => 'https://auth.example.com/authorize') {
  const popup = { location: { href: '' }, closed: false, close: jest.fn() };
  const open = jest
    .spyOn(window, 'open')
    .mockReturnValue(popup as unknown as Window);
  const api = {
    getBaseUrl: async () => `${BACKEND}/api/assistants`,
    startMcpOAuth: jest.fn(start),
  } as unknown as AssistantsApi;
  return { popup, open, api };
}

const post = (data: unknown, origin = BACKEND) =>
  window.dispatchEvent(new MessageEvent('message', { data, origin }));

afterEach(() => jest.restoreAllMocks());

describe('signInWithPopup', () => {
  it('opens the popup first, sends it to the authorization URL, and resolves on the callback message', async () => {
    const { popup, open, api } = setup();
    const outcome = signInWithPopup(api, tracker);
    expect(open).toHaveBeenCalledTimes(1);
    await new Promise(r => setTimeout(r, 0));
    expect(popup.location.href).toBe('https://auth.example.com/authorize');
    // Ignored: another origin, another server, another message.
    post(
      { type: 'assistants-mcp-oauth', serverId: 'tracker', ok: true },
      'https://evil.example.com',
    );
    post({ type: 'assistants-mcp-oauth', serverId: 'other', ok: true });
    post({ type: 'something-else' });
    post({
      type: 'assistants-mcp-oauth',
      serverId: 'tracker',
      ok: false,
      error: 'declined',
    });
    expect(await outcome).toEqual({ ok: false, error: 'declined' });
  });

  it('closes the popup when the sign-in cannot start', async () => {
    const { popup, api } = setup(async () => {
      throw new Error('Forbidden');
    });
    expect(await signInWithPopup(api, tracker)).toEqual({
      ok: false,
      error: 'Forbidden',
    });
    expect(popup.close).toHaveBeenCalled();
  });

  it('settles with no verdict when the popup is closed', async () => {
    jest.useFakeTimers();
    const { popup, api } = setup();
    const outcome = signInWithPopup(api, tracker);
    await Promise.resolve();
    await Promise.resolve();
    popup.closed = true;
    jest.advanceTimersByTime(600);
    expect(await outcome).toEqual({});
    jest.useRealTimers();
  });

  it('reports a blocked popup', async () => {
    jest.spyOn(window, 'open').mockReturnValue(null);
    expect(await signInWithPopup({} as AssistantsApi, tracker)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/blocked/),
    });
  });
});

describe('getUserToken for a server that runs its own OAuth', () => {
  it('has no browser-side token', async () => {
    const apis = { get: jest.fn() } as never;
    expect(await getUserToken(apis, tracker, false)).toBeUndefined();
  });
});
