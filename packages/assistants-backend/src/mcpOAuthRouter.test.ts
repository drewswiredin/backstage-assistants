import express from 'express';
import { createHash } from 'crypto';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { AuthenticationError } from '@backstage/errors';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import type { McpOAuthService } from './mcpOAuth';
import { createMcpOAuthRouter } from './mcpOAuthRouter';

const ALICE = 'user:default/alice';
const tracker = { id: 'tracker' };

describe('MCP OAuth routes', () => {
  let http: Server;
  let base: string;
  let signedIn: string | undefined;
  let allowed: boolean;
  const logged: string[] = [];
  const oauth = {
    server: jest.fn((id: string) => (id === 'tracker' ? tracker : undefined)),
    start: jest.fn(async () => 'https://auth.example.com/authorize?state=s'),
    callback: jest.fn(),
    status: jest.fn(async () => ({ tracker: 'connected' })),
    disconnect: jest.fn(async () => {}),
    clientMetadataDocument: jest.fn((id: string) =>
      id === 'tracker' ? { client_id: 'https://x/doc' } : undefined,
    ),
  };

  beforeEach(async () => {
    signedIn = ALICE;
    allowed = true;
    jest.clearAllMocks();
    const app = express();
    // Stands in for Backstage's request log, which reads originalUrl at finish.
    app.use((req, res, next) => {
      res.on('finish', () => logged.push(req.originalUrl));
      next();
    });
    app.use(
      createMcpOAuthRouter({
        oauth: oauth as unknown as McpOAuthService,
        httpAuth: {
          credentials: jest.fn(async () => {
            if (!signedIn) throw new AuthenticationError('Missing credentials');
            return { principal: { userEntityRef: signedIn } };
          }),
        } as any,
        userInfo: {
          getUserInfo: jest.fn(async () => ({ userEntityRef: signedIn })),
        } as any,
        permissions: {
          authorize: jest.fn(async () => [
            { result: allowed ? AuthorizeResult.ALLOW : AuthorizeResult.DENY },
          ]),
        } as any,
        appOrigin: 'http://localhost:3000',
      }),
    );
    app.use(
      (
        err: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        res.status(err.name === 'NotFoundError' ? 404 : 403).json({
          error: { name: err.name },
        });
      },
    );
    http = await new Promise<Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise(resolve => http.close(resolve));
  });

  it('starts a sign-in for the signed-in user', async () => {
    const res = await fetch(`${base}/mcp/tracker/oauth/start`, {
      method: 'POST',
    });
    expect(await res.json()).toEqual({
      authorizationUrl: 'https://auth.example.com/authorize?state=s',
    });
    expect(oauth.start).toHaveBeenCalledWith(tracker, ALICE);
  });

  it('refuses a server that does not sign in with OAuth, and a user without assistant.use', async () => {
    expect(
      (await fetch(`${base}/mcp/github/oauth/start`, { method: 'POST' }))
        .status,
    ).toBe(404);
    allowed = false;
    expect(
      (await fetch(`${base}/mcp/tracker/oauth/start`, { method: 'POST' }))
        .status,
    ).toBe(403);
    expect(oauth.start).not.toHaveBeenCalled();
  });

  it('reports status and disconnects', async () => {
    expect(await (await fetch(`${base}/mcp/oauth/status`)).json()).toEqual({
      servers: { tracker: 'connected' },
    });
    const res = await fetch(`${base}/mcp/tracker/oauth`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(oauth.disconnect).toHaveBeenCalledWith(tracker, ALICE);
  });

  it('serves the client metadata document', async () => {
    const res = await fetch(`${base}/mcp/oauth/client-metadata/tracker`);
    expect(await res.json()).toEqual({ client_id: 'https://x/doc' });
    expect(
      (await fetch(`${base}/mcp/oauth/client-metadata/other`)).status,
    ).toBe(404);
  });

  it("passes the cookie's user to the callback and posts the outcome to the app origin only", async () => {
    oauth.callback.mockResolvedValue({ serverId: 'tracker', ok: true });
    const res = await fetch(
      `${base}/mcp/oauth/callback?code=c&state=s&iss=https%3A%2F%2Fauth`,
    );
    expect(oauth.callback).toHaveBeenCalledWith({
      code: 'c',
      state: 's',
      iss: 'https://auth',
      error: undefined,
      errorDescription: undefined,
      userEntityRef: ALICE,
    });
    const html = await res.text();
    const script = html.match(/<script>(.*)<\/script>/)![1];
    const hash = createHash('sha256').update(script).digest('base64');
    expect(res.headers.get('content-security-policy')).toBe(
      `default-src 'none'; script-src 'sha256-${hash}'`,
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(decodeURIComponent(script)).toContain(
      '{"type":"assistants-mcp-oauth","serverId":"tracker","ok":true}',
    );
    expect(decodeURIComponent(script)).toContain('http://localhost:3000');
    expect(html).toContain('Connected.');
    // No code or state reaches the page or the request log.
    expect(html).not.toContain('state=s');
    expect(logged).toContain('/mcp/oauth/callback');
    expect(logged.join()).not.toContain('code=');
  });

  it('finishes no sign-in for a browser without a Backstage session', async () => {
    signedIn = undefined;
    oauth.callback.mockResolvedValue({
      serverId: 'tracker',
      ok: false,
      error: 'could not be <confirmed>',
    });
    const html = await (
      await fetch(`${base}/mcp/oauth/callback?code=c&state=s`)
    ).text();
    expect(oauth.callback).toHaveBeenCalledWith(
      expect.objectContaining({ userEntityRef: undefined }),
    );
    expect(html).toContain('Sign-in failed: could not be &lt;confirmed&gt;');
  });
});
