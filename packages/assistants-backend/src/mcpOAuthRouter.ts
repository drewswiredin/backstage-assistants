import express from 'express';
import { createHash } from 'crypto';
import type {
  HttpAuthService,
  PermissionsService,
  UserInfoService,
} from '@backstage/backend-plugin-api';
import { NotAllowedError, NotFoundError } from '@backstage/errors';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import {
  assistantUsePermission,
  MCP_OAUTH_MESSAGE_TYPE,
  type McpOAuthStartResponse,
  type McpOAuthStatusResponse,
} from '@drewswiredin/backstage-plugin-assistants-common';
import type { McpOAuthCallbackResult, McpOAuthService } from './mcpOAuth';

/** Paths that take no Backstage token (registered as unauthenticated in the plugin). */
export const MCP_OAUTH_PUBLIC_PATHS = [
  '/mcp/oauth/callback',
  '/mcp/oauth/client-metadata',
];

export interface McpOAuthRouterOptions {
  oauth: McpOAuthService;
  httpAuth: HttpAuthService;
  userInfo: UserInfoService;
  permissions: PermissionsService;
  /** The app's origin, the only window the callback page posts to. */
  appOrigin: string;
}

/**
 * Routes for servers that run their own OAuth:
 *
 * - `POST /mcp/:serverId/oauth/start` returns the authorization URL for the
 *   signed-in user; the browser opens it in a popup.
 * - `GET /mcp/oauth/callback` is where the authorization server sends the
 *   user back. It takes no Backstage token; the `state` names the sign-in,
 *   and Backstage's user cookie (issued to the browser before the popup
 *   opens) must belong to the user who started it. It answers with a page
 *   that posts the outcome to the app window and closes.
 * - `GET /mcp/oauth/status` is the user's connection to each such server.
 * - `DELETE /mcp/:serverId/oauth` disconnects the user.
 * - `GET /mcp/oauth/client-metadata/:serverId` serves the client metadata
 *   document of a server configured with `clientMetadataDocument`.
 */
export function createMcpOAuthRouter(
  options: McpOAuthRouterOptions,
): express.Router {
  const { oauth, httpAuth, userInfo, permissions, appOrigin } = options;
  const router = express.Router();

  async function requireUser(req: express.Request): Promise<string> {
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    const [decision] = await permissions.authorize(
      [{ permission: assistantUsePermission }],
      { credentials },
    );
    if (decision.result !== AuthorizeResult.ALLOW) {
      throw new NotAllowedError('You are not permitted to use assistants');
    }
    return (await userInfo.getUserInfo(credentials)).userEntityRef;
  }

  function oauthServer(serverId: string) {
    const server = oauth.server(serverId);
    if (!server) {
      throw new NotFoundError(
        `No MCP server '${serverId}' signs in with OAuth`,
      );
    }
    return server;
  }

  router.post('/mcp/:serverId/oauth/start', (req, res, next) => {
    (async () => {
      const userEntityRef = await requireUser(req);
      const server = oauthServer(req.params.serverId);
      const response: McpOAuthStartResponse = {
        authorizationUrl: await oauth.start(server, userEntityRef),
      };
      res.json(response);
    })().catch(next);
  });

  router.get('/mcp/oauth/status', (req, res, next) => {
    (async () => {
      const userEntityRef = await requireUser(req);
      const response: McpOAuthStatusResponse = {
        servers: await oauth.status(userEntityRef),
      };
      res.json(response);
    })().catch(next);
  });

  router.delete('/mcp/:serverId/oauth', (req, res, next) => {
    (async () => {
      const userEntityRef = await requireUser(req);
      await oauth.disconnect(oauthServer(req.params.serverId), userEntityRef);
      res.status(204).end();
    })().catch(next);
  });

  router.get('/mcp/oauth/client-metadata/:serverId', (req, res) => {
    const document = oauth.clientMetadataDocument(req.params.serverId);
    if (!document) {
      res.status(404).json({ error: { name: 'NotFoundError' } });
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(document);
  });

  router.get('/mcp/oauth/callback', (req, res, next) => {
    (async () => {
      const query = (name: string) =>
        typeof req.query[name] === 'string'
          ? (req.query[name] as string)
          : undefined;
      // Backstage's request log records `originalUrl` when the response
      // finishes: keep the code and state out of it.
      req.originalUrl = req.originalUrl.split('?')[0];
      // The browser's Backstage sign-in, from the user cookie; none when it
      // carried no cookie.
      const credentials = await httpAuth
        .credentials(req, { allow: ['user'], allowLimitedAccess: true })
        .catch(() => undefined);
      const userEntityRef = credentials?.principal.userEntityRef;
      const result = await oauth.callback({
        code: query('code'),
        state: query('state'),
        iss: query('iss'),
        error: query('error'),
        errorDescription: query('error_description'),
        userEntityRef,
      });
      sendCallbackPage(res, appOrigin, result);
    })().catch(next);
  });

  return router;
}

/**
 * The page the popup lands on: posts `{ type, serverId, ok, error }` to the
 * app window that opened it, then closes. A hash-pinned CSP allows only this
 * script. With no opener (the page opened on its own) it shows the outcome.
 */
function sendCallbackPage(
  res: express.Response,
  appOrigin: string,
  result: McpOAuthCallbackResult,
): void {
  const message = JSON.stringify({ type: MCP_OAUTH_MESSAGE_TYPE, ...result });
  const script = `(function(){var m=JSON.parse(decodeURIComponent('${encodeURIComponent(
    message,
  ).replace(/'/g, '%27')}'));var o=decodeURIComponent('${encodeURIComponent(
    appOrigin,
  ).replace(
    /'/g,
    '%27',
  )}');if(window.opener){window.opener.postMessage(m,o);setTimeout(function(){window.close();},100);}})();`;
  const hash = createHash('sha256').update(script).digest('base64');
  const text = result.ok
    ? 'Connected. You can close this window.'
    : `Sign-in failed: ${result.error ?? 'unknown error'}`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Options', 'deny');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; script-src 'sha256-${hash}'`,
  );
  res.end(
    `<!doctype html><html><head><meta charset="utf-8"><title>Sign-in</title></head><body><p>${escapeHtml(
      text,
    )}</p><script>${script}</script></body></html>`,
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
