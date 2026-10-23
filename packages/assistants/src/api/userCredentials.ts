import {
  atlassianAuthApiRef,
  bitbucketAuthApiRef,
  bitbucketServerAuthApiRef,
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
} from '@backstage/core-plugin-api';
import { scmAuthApiRef } from '@backstage/integration-react';
import {
  USER_CREDENTIALS_HEADER,
  type UserCredentialSpec,
} from '@drewswiredin/backstage-plugin-assistants-common';

/**
 * The signed-in user's tokens for per-user MCP servers, from Backstage's own
 * auth APIs: SCM auth when the server names a host (it picks the provider
 * from the app's integrations), otherwise the provider's auth API. Tokens are
 * fetched per request (the auth APIs cache and refresh them) and only ever
 * sent in the credentials header.
 */

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
      return token || undefined;
    }
    const ref = AUTH_APIS[spec.provider];
    const auth = ref && apis.get(ref);
    if (!auth) return undefined;
    return (await auth.getAccessToken(spec.scopes, { optional })) || undefined;
  } catch {
    // A rejected or closed sign-in popup: not connected.
    return undefined;
  }
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
