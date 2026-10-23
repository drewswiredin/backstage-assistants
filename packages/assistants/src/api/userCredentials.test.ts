import { githubAuthApiRef, type ApiRef } from '@backstage/core-plugin-api';
import { scmAuthApiRef } from '@backstage/integration-react';
import type { UserCredentialSpec } from '@drewswiredin/backstage-plugin-assistants-common';
import {
  credentialsHeader,
  getUserToken,
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
