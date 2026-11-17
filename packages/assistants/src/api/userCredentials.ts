import {
  atlassianAuthApiRef,
  bitbucketAuthApiRef,
  bitbucketServerAuthApiRef,
  configApiRef,
  discoveryApiRef,
  githubAuthApiRef,
  gitlabAuthApiRef,
  googleAuthApiRef,
  microsoftAuthApiRef,
  oktaAuthApiRef,
  oneloginAuthApiRef,
  openshiftAuthApiRef,
  vmwareCloudAuthApiRef,
  type ApiHolder,
  type ApiRef,
  type OAuthApi,
  type SessionApi,
} from '@backstage/core-plugin-api';
import { scmAuthApiRef } from '@backstage/integration-react';
import {
  USER_CREDENTIALS_HEADER,
  type UserCredentialSpec,
} from '@drewswiredin/backstage-plugin-assistants-common';
import { isOAuthSpec } from './mcpOAuth';

/**
 * The signed-in user's tokens for per-user MCP servers, from Backstage's own
 * auth APIs: SCM auth when the server names a host (it picks the provider
 * from the app's integrations), otherwise the provider's auth API. Tokens are
 * fetched per request (the auth APIs cache and refresh them) and only ever
 * sent in the credentials header. A server that runs its own OAuth has no
 * token here: the backend holds it.
 *
 * A provider can revoke a token before it expires: a GitHub App user token
 * is revoked when the sign-in is refreshed anywhere else, such as another
 * tab loading. The auth APIs refresh only near expiry, so they keep handing
 * out the revoked token. When a server refuses a token,
 * {@link forceUserToken} gets a new one from the sign-in's refresh endpoint,
 * and it stands in for the refused one until the auth APIs move on.
 */

/** Tokens a server refused, each with the token fetched in its place. */
const replaced = new Map<string, string>();

/** The token in use for `token`: itself, or the one that replaced it. */
function current(token: string): string {
  let next = token;
  for (let i = 0; i < 16 && replaced.has(next); i++) {
    next = replaced.get(next)!;
  }
  return next;
}

const AUTH_APIS: Record<string, ApiRef<OAuthApi>> = {
  github: githubAuthApiRef,
  gitlab: gitlabAuthApiRef,
  google: googleAuthApiRef,
  microsoft: microsoftAuthApiRef,
  atlassian: atlassianAuthApiRef,
  okta: oktaAuthApiRef,
  onelogin: oneloginAuthApiRef,
  bitbucket: bitbucketAuthApiRef,
  bitbucketServer: bitbucketServerAuthApiRef,
  openshift: openshiftAuthApiRef,
  vmwareCloud: vmwareCloudAuthApiRef,
};

/**
 * One server's token, or undefined when the user hasn't connected. With
 * `optional` (every turn) a user who isn't signed in to the provider gets no
 * popup; without it (the Connect button) the sign-in popup opens.
 */
export async function getUserToken(
  apis: ApiHolder,
  spec: UserCredentialSpec,
  optional: boolean,
): Promise<string | undefined> {
  if (isOAuthSpec(spec)) return undefined;
  try {
    if (spec.host) {
      const scmAuth = apis.get(scmAuthApiRef);
      if (!scmAuth) return undefined;
      const { token } = await scmAuth.getCredentials({
        url: `https://${spec.host}`,
        ...(spec.scopes
          ? {
              additionalScope: {
                customScopes: { [spec.provider]: spec.scopes },
              },
            }
          : {}),
        optional,
      });
      return token ? current(token) : undefined;
    }
    const ref = AUTH_APIS[spec.provider];
    const auth = ref && apis.get(ref);
    if (!auth) return undefined;
    const token = await auth.getAccessToken(spec.scopes, { optional });
    return token ? current(token) : undefined;
  } catch {
    // A rejected or closed sign-in popup: not connected.
    return undefined;
  }
}

/** Refreshes under way, by provider and scopes: concurrent callers share one. */
const refreshing = new Map<string, Promise<string | undefined>>();

/**
 * A new token for a server that refused the current one, or undefined when
 * the sign-in can't be refreshed. Asks the auth backend's refresh endpoint
 * directly, as Backstage's own session does on a page load, because the
 * auth APIs would return their cached token. The provider revokes the
 * previous token, so this runs only on a refusal.
 */
export async function forceUserToken(
  apis: ApiHolder,
  spec: UserCredentialSpec,
): Promise<string | undefined> {
  if (isOAuthSpec(spec)) return undefined;
  const key = `${spec.provider} ${(spec.scopes ?? []).join(' ')}`;
  let refresh = refreshing.get(key);
  if (!refresh) {
    refresh = refreshUserToken(apis, spec).finally(() =>
      refreshing.delete(key),
    );
    refreshing.set(key, refresh);
  }
  return refresh;
}

async function refreshUserToken(
  apis: ApiHolder,
  spec: UserCredentialSpec,
): Promise<string | undefined> {
  try {
    const discovery = apis.get(discoveryApiRef);
    if (!discovery) return undefined;
    const refused = await getUserToken(apis, spec, true);
    const query = new URLSearchParams({
      ...(spec.scopes?.length ? { scope: spec.scopes.join(' ') } : {}),
      env:
        apis.get(configApiRef)?.getOptionalString('auth.environment') ??
        'development',
    });
    const response = await fetch(
      `${await discovery.getBaseUrl('auth')}/${encodeURIComponent(
        spec.provider,
      )}/refresh?optional&${query}`,
      {
        headers: { 'x-requested-with': 'XMLHttpRequest' },
        credentials: 'include',
      },
    );
    if (!response.ok) return undefined;
    const token = (await response.json())?.providerInfo?.accessToken;
    if (typeof token !== 'string' || !token) return undefined;
    if (refused && refused !== token) replaced.set(refused, token);
    return token;
  } catch {
    return undefined;
  }
}

/**
 * Sign in to a server's provider again, for a sign-in a refresh can't mend:
 * signs out of the provider (the auth APIs open no popup while they hold a
 * session) and opens its sign-in. Undefined when the popup is closed.
 */
export async function reconnectUserToken(
  apis: ApiHolder,
  spec: UserCredentialSpec,
): Promise<string | undefined> {
  if (isOAuthSpec(spec)) return undefined;
  const ref = AUTH_APIS[spec.provider];
  const session = ref && (apis.get(ref) as Partial<SessionApi> | undefined);
  await session?.signOut?.().catch(() => {});
  replaced.clear();
  return getUserToken(apis, spec, false);
}

/** Tokens per server id for the given servers, skipping those not connected. */
export async function getUserTokens(
  apis: ApiHolder,
  specs: ReadonlyArray<UserCredentialSpec>,
  optional = true,
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    specs.map(
      async spec =>
        [spec.server, await getUserToken(apis, spec, optional)] as const,
    ),
  );
  return Object.fromEntries(
    entries.filter((e): e is readonly [string, string] => !!e[1]),
  );
}

/** The credentials header for these tokens; empty when there are none. */
export function credentialsHeader(
  tokens: Record<string, string>,
): Record<string, string> {
  if (Object.keys(tokens).length === 0) return {};
  return { [USER_CREDENTIALS_HEADER]: btoa(JSON.stringify(tokens)) };
}
