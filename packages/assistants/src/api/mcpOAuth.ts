import {
  MCP_OAUTH_MESSAGE_TYPE,
  type UserCredentialSpec,
} from '@drewswiredin/backstage-plugin-assistants-common';
import type { AssistantsApi } from './AssistantsApi';

/** The `provider` of a server that runs its own OAuth, signed in through the backend. */
export const OAUTH_PROVIDER = 'oauth';

/** True for a server whose tokens the backend holds (its own OAuth). */
export function isOAuthSpec(spec: UserCredentialSpec): boolean {
  return spec.provider === OAUTH_PROVIDER;
}

/** How a popup sign-in ended. */
export interface SignInOutcome {
  /** True when the callback reported success; undefined when the popup closed without word. */
  ok?: boolean;
  error?: string;
}

/**
 * Sign in to a server that runs its own OAuth, in a popup: the backend
 * starts the sign-in and returns the authorization URL, the user signs in
 * there, and the backend's callback page posts the outcome back and closes.
 * Call from a click handler: the popup opens before anything is awaited, so
 * the browser doesn't block it.
 */
export async function signInWithPopup(
  api: AssistantsApi,
  spec: UserCredentialSpec,
): Promise<SignInOutcome> {
  const popup = window.open(
    '',
    `assistants-mcp-oauth-${spec.server}`,
    'width=600,height=720',
  );
  if (!popup) {
    return {
      ok: false,
      error: 'The sign-in window was blocked; allow popups for this site',
    };
  }
  let backendOrigin: string;
  try {
    backendOrigin = new URL(await api.getBaseUrl(), window.location.href)
      .origin;
    popup.location.href = await api.startMcpOAuth(spec.server);
  } catch (error) {
    popup.close();
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return new Promise<SignInOutcome>(resolve => {
    const cleanup: Array<() => void> = [];
    const finish = (outcome: SignInOutcome) => {
      cleanup.forEach(fn => fn());
      resolve(outcome);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        type?: unknown;
        serverId?: unknown;
        ok?: unknown;
        error?: unknown;
      };
      if (
        event.origin !== backendOrigin ||
        data?.type !== MCP_OAUTH_MESSAGE_TYPE ||
        data.serverId !== spec.server
      ) {
        return;
      }
      finish({
        ok: data.ok === true,
        ...(typeof data.error === 'string' ? { error: data.error } : {}),
      });
    };
    window.addEventListener('message', onMessage);
    // Closed without a message: the caller re-checks the status.
    const timer = setInterval(() => {
      if (popup.closed) finish({});
    }, 500);
    cleanup.push(
      () => window.removeEventListener('message', onMessage),
      () => clearInterval(timer),
    );
  });
}
