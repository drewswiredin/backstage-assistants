import {
  USER_CREDENTIALS_HEADER,
  type UserCredentialSpec,
} from '@drewswiredin/backstage-plugin-assistants-common';
import { isOAuthServer, type McpServerConfig } from './config';
import type { McpCaller } from './mcp';
import type { McpOAuthService } from './mcpOAuth';

/**
 * The tokens the browser sent for per-user MCP servers, from the
 * {@link USER_CREDENTIALS_HEADER} (base64 JSON keyed by server id). Only
 * configured per-user servers' entries are kept, and none for a server that
 * runs its own OAuth (the backend holds those tokens); a malformed header
 * yields none. The header is never logged or stored.
 */
export function readUserCredentials(
  header: string | string[] | undefined,
  servers: Map<string, McpServerConfig>,
): Record<string, string> {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const credentials: Record<string, string> = {};
  for (const [serverId, token] of Object.entries(parsed)) {
    const server = servers.get(serverId);
    if (
      server?.userCredentials &&
      !isOAuthServer(server) &&
      typeof token === 'string' &&
      token.length > 0 &&
      token.length <= 8192
    ) {
      credentials[serverId] = token;
    }
  }
  return credentials;
}

/** The browser-safe sign-in spec of a per-user server. */
export function userCredentialSpec(
  server: McpServerConfig,
): UserCredentialSpec | undefined {
  const uc = server.userCredentials;
  if (!uc) return undefined;
  return {
    server: server.id,
    provider: uc.provider,
    ...(uc.host ? { host: uc.host } : {}),
    ...(uc.scopes ? { scopes: uc.scopes } : {}),
    title: uc.title,
  };
}

/**
 * The MCP caller for a request: the user, the tokens their browser sent, and
 * their backend-held tokens for servers that run their own OAuth.
 */
export function mcpCallerFor(
  userEntityRef: string,
  header: string | string[] | undefined,
  servers: Map<string, McpServerConfig>,
  oauth: McpOAuthService | undefined,
): McpCaller {
  return {
    userEntityRef,
    credentials: readUserCredentials(header, servers),
    ...(oauth
      ? {
          oauthToken: (server, options) =>
            oauth.accessToken(server, userEntityRef, options),
        }
      : {}),
  };
}
