import {
  configApiRef,
  discoveryApiRef,
  githubAuthApiRef,
  type ApiRef,
} from '@backstage/core-plugin-api';
import { scmAuthApiRef } from '@backstage/integration-react';
import type { UserCredentialSpec } from '@drewswiredin/backstage-plugin-assistants-common';
import {
  credentialsHeader,
  forceUserToken,
  getUserToken,
  reconnectUserToken,
  getUserTokens,
} from './userCredentials';

const github: UserCredentialSpec = {
  server: 'github',
  provider: 'github',
  host: 'github.com',
  title: 'GitHub',
};

function holder(apis: Array<[ApiRef<unknown>, unknown]>) {
  const byId = new Map(apis.map(([ref, impl]) => [ref.id, impl]));
  return { get: (ref: ApiRef<unknown>) => byId.get(ref.id) } as never;
}

describe('getUserToken', () => {
  it("asks SCM auth for the host's token, silently on a turn", async () => {
    const getCredentials = jest.fn(async () => ({
      token: 'ghu_ana',
      headers: {},
    }));
    const apis = holder([[scmAuthApiRef, { getCredentials }]]);
    expect(await getUserToken(apis, github, true)).toBe('ghu_ana');
    expect(getCredentials).toHaveBeenCalledWith({
      url: 'https://github.com',
      optional: true,
    });
  });

  it("uses the provider's auth API when no host is set", async () => {
    const getAccessToken = jest.fn(async () => 'gho_ana');
    const apis = holder([[githubAuthApiRef, { getAccessToken }]]);
    expect(
      await getUserToken(
        apis,
        { ...github, host: undefined, scopes: ['repo'] },
        false,
      ),
    ).toBe('gho_ana');
    expect(getAccessToken).toHaveBeenCalledWith(['repo'], { optional: false });
  });

  it('is undefined when not signed in, the popup is closed, or the provider is unknown', async () => {
    expect(
      await getUserToken(
        holder([
          [scmAuthApiRef, { getCredentials: async () => ({ token: '' }) }],
        ]),
        github,
        true,
      ),
    ).toBeUndefined();
    expect(
      await getUserToken(
        holder([
          [
            scmAuthApiRef,
            { getCredentials: async () => Promise.reject(new Error('closed')) },
          ],
        ]),
        github,
        false,
      ),
    ).toBeUndefined();
    expect(
      await getUserToken(
        holder([]),
        { ...github, host: undefined, provider: 'acme' },
        true,
      ),
    ).toBeUndefined();
  });
});

describe('credentialsHeader', () => {
  it('encodes the connected servers only', async () => {
    const apis = holder([
      [scmAuthApiRef, { getCredentials: async () => ({ token: 'ghu_ana' }) }],
    ]);
    const tokens = await getUserTokens(apis, [
      github,
      { server: 'jira', provider: 'atlassian', title: 'Atlassian' },
    ]);
    expect(tokens).toEqual({ github: 'ghu_ana' });
    const header = credentialsHeader(tokens);
    expect(JSON.parse(atob(header['x-assistants-credentials']))).toEqual({
      github: 'ghu_ana',
    });
    expect(credentialsHeader({})).toEqual({});
  });
});

describe('forceUserToken', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  const discovery = { getBaseUrl: async () => 'https://portal/api/auth' };
  const config = (environment?: string) => ({
    getOptionalString: (key: string) =>
      key === 'auth.environment' ? environment : undefined,
  });
  const refreshAnswers = (body: unknown, ok = true) => {
    const fetchMock = jest.fn(async () => ({ ok, json: async () => body }));
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  };

  it("asks the sign-in's refresh endpoint, past the cached session", async () => {
    const getAccessToken = jest.fn(async () => 'ghu_revoked');
    const fetchMock = refreshAnswers({
      providerInfo: { accessToken: 'ghu_new' },
    });
    const apis = holder([
      [githubAuthApiRef, { getAccessToken }],
      [discoveryApiRef, discovery],
      [configApiRef, config('production')],
    ]);
    const spec = { ...github, host: undefined, scopes: ['repo', 'read:org'] };

    expect(await forceUserToken(apis, spec)).toBe('ghu_new');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://portal/api/auth/github/refresh?optional&scope=repo+read%3Aorg&env=production',
      {
        headers: { 'x-requested-with': 'XMLHttpRequest' },
        credentials: 'include',
      },
    );
  });

  it('sends the new token on later turns while the session still holds the refused one', async () => {
    let session = 'ghu_stale';
    const getCredentials = jest.fn(async () => ({ token: session }));
    refreshAnswers({ providerInfo: { accessToken: 'ghu_fresh' } });
    const apis = holder([
      [scmAuthApiRef, { getCredentials }],
      [discoveryApiRef, discovery],
    ]);

    await forceUserToken(apis, github);
    expect(await getUserToken(apis, github, true)).toBe('ghu_fresh');
    // Refused again later: the next one replaces it in turn.
    refreshAnswers({ providerInfo: { accessToken: 'ghu_fresher' } });
    await forceUserToken(apis, github);
    expect(await getUserToken(apis, github, true)).toBe('ghu_fresher');
    // The session refreshed itself: its token is the current one.
    session = 'ghu_session';
    expect(await getUserToken(apis, github, true)).toBe('ghu_session');
  });

  it('defaults the auth environment, and shares one refresh between callers', async () => {
    const fetchMock = refreshAnswers({
      providerInfo: { accessToken: 'ghu_one' },
    });
    const apis = holder([
      [scmAuthApiRef, { getCredentials: async () => ({ token: 'ghu_old' }) }],
      [discoveryApiRef, discovery],
    ]);
    expect(
      await Promise.all([
        forceUserToken(apis, github),
        forceUserToken(apis, github),
      ]),
    ).toEqual(['ghu_one', 'ghu_one']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe(
      'https://portal/api/auth/github/refresh?optional&env=development',
    );
  });

  it('is undefined when the refresh fails, returns no token, or the server runs its own OAuth', async () => {
    const apis = holder([
      [scmAuthApiRef, { getCredentials: async () => ({ token: 'ghu_old' }) }],
      [discoveryApiRef, discovery],
    ]);
    refreshAnswers({}, false);
    expect(await forceUserToken(apis, github)).toBeUndefined();
    refreshAnswers({ providerInfo: {} });
    expect(await forceUserToken(apis, github)).toBeUndefined();
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await forceUserToken(apis, github)).toBeUndefined();
    expect(
      await forceUserToken(apis, { ...github, provider: 'oauth' }),
    ).toBeUndefined();
    expect(await forceUserToken(holder([]), github)).toBeUndefined();
  });
});

describe('reconnectUserToken', () => {
  it('signs out of the provider, then opens its sign-in', async () => {
    const order: string[] = [];
    const signOut = jest.fn(async () => {
      order.push('signOut');
    });
    const getAccessToken = jest.fn(async () => {
      order.push('signIn');
      return 'ghu_again';
    });
    const apis = holder([[githubAuthApiRef, { signOut, getAccessToken }]]);
    expect(await reconnectUserToken(apis, { ...github, host: undefined })).toBe(
      'ghu_again',
    );
    expect(order).toEqual(['signOut', 'signIn']);
    expect(getAccessToken).toHaveBeenCalledWith(undefined, { optional: false });
  });
});
