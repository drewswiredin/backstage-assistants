import express from 'express';
import { createHash, randomBytes } from 'crypto';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import knexFactory, { type Knex } from 'knex';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { McpServerConfig } from './config';
import { McpOAuthService } from './mcpOAuth';
import { ThreadService } from './threads';

const ALICE = 'user:default/alice';
const BOB = 'user:default/bob';

/**
 * A loopback MCP authorization server: protected-resource metadata on the
 * MCP origin, RFC 8414 metadata, dynamic registration, authorization codes
 * with PKCE, rotating refresh tokens, and revocation. It records what the
 * client sent so the tests can check PKCE and `resource`.
 */
function fakeAuthorizationServer() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  const as = {
    base: '',
    registrations: [] as Array<Record<string, unknown>>,
    codes: new Map<
      string,
      { clientId: string; challenge: string; redirectUri: string }
    >(),
    refreshTokens: new Set<string>(),
    tokenRequests: [] as Array<Record<string, string>>,
    revoked: [] as string[],
    expiresIn: 3600,
    refreshDelayMs: 0,
    refreshDown: false,
    /** Act as the user approving the sign-in: returns the code for this authorize URL. */
    approve(authorizationUrl: string): string {
      const url = new URL(authorizationUrl);
      const code = randomBytes(8).toString('hex');
      as.codes.set(code, {
        clientId: url.searchParams.get('client_id')!,
        challenge: url.searchParams.get('code_challenge')!,
        redirectUri: url.searchParams.get('redirect_uri')!,
      });
      return code;
    },
  };
  const issue = () => {
    const refresh = `rt-${randomBytes(6).toString('hex')}`;
    as.refreshTokens.add(refresh);
    return {
      access_token: `at-${randomBytes(6).toString('hex')}`,
      token_type: 'Bearer',
      expires_in: as.expiresIn,
      refresh_token: refresh,
    };
  };
  app.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => {
    res.json({
      resource: `${as.base}/mcp`,
      authorization_servers: [`${as.base}/as`],
      scopes_supported: ['read', 'write', 'admin'],
    });
  });
  const metadata = (_req: express.Request, res: express.Response) => {
    res.json({
      issuer: `${as.base}/as`,
      authorization_endpoint: `${as.base}/as/authorize`,
      token_endpoint: `${as.base}/as/token`,
      registration_endpoint: `${as.base}/as/register`,
      revocation_endpoint: `${as.base}/as/revoke`,
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  };
  app.get('/.well-known/oauth-authorization-server/as', metadata);
  app.get('/as/.well-known/oauth-authorization-server', metadata);
  app.post('/as/register', (req, res) => {
    as.registrations.push(req.body);
    res.status(201).json({
      ...req.body,
      client_id: `client-${as.registrations.length}`,
    });
  });
  app.post('/as/token', async (req, res) => {
    const body = req.body as Record<string, string>;
    as.tokenRequests.push(body);
    if (body.grant_type === 'authorization_code') {
      const code = as.codes.get(body.code);
      as.codes.delete(body.code);
      const challenge = createHash('sha256')
        .update(body.code_verifier ?? '')
        .digest('base64url');
      if (
        !code ||
        code.challenge !== challenge ||
        code.clientId !== body.client_id ||
        code.redirectUri !== body.redirect_uri
      ) {
        res.status(400).json({ error: 'invalid_grant' });
        return;
      }
      res.json(issue());
      return;
    }
    if (body.grant_type === 'refresh_token') {
      await new Promise(r => setTimeout(r, as.refreshDelayMs));
      if (as.refreshDown) {
        res.status(503).send('unavailable');
        return;
      }
      if (!as.refreshTokens.delete(body.refresh_token)) {
        res.status(400).json({ error: 'invalid_grant' });
        return;
      }
      res.json(issue());
      return;
    }
    res.status(400).json({ error: 'unsupported_grant_type' });
  });
  app.post('/as/revoke', (req, res) => {
    as.revoked.push((req.body as Record<string, string>).token);
    as.refreshTokens.delete((req.body as Record<string, string>).token);
    res.status(200).end();
  });
  return { app, as };
}

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn(),
} as unknown as LoggerService;

const KEY = randomBytes(32);

describe('McpOAuthService', () => {
  let db: Knex;
  let http: Server;
  let as: ReturnType<typeof fakeAuthorizationServer>['as'];
  let server: McpServerConfig;
  let onDisconnect: jest.Mock;

  function service(
    overrides: Partial<McpServerConfig['userCredentials']> = {},
    keys: Buffer[] = [KEY],
  ): McpOAuthService {
    server = {
      ...server,
      userCredentials: { ...server.userCredentials!, ...overrides },
    };
    return new McpOAuthService({
      db,
      keys,
      servers: new Map([[server.id, server]]),
      baseUrl: 'http://localhost:7007/api/assistants',
      logger,
      onDisconnect,
    });
  }

  /** Start, approve, and finish a sign-in for `user`. */
  async function connect(oauth: McpOAuthService, user = ALICE) {
    const url = await oauth.start(server, user);
    const state = new URL(url).searchParams.get('state')!;
    const result = await oauth.callback({
      code: as.approve(url),
      state,
      userEntityRef: user,
    });
    return { url, state, result };
  }

  async function storedRow(user = ALICE) {
    return db('mcp_oauth_tokens')
      .where({ user_ref: user, server_id: 'tracker' })
      .first();
  }

  beforeEach(async () => {
    const fake = fakeAuthorizationServer();
    as = fake.as;
    http = await new Promise<Server>(resolve => {
      const s = fake.app.listen(0, '127.0.0.1', () => resolve(s));
    });
    as.base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    db = knexFactory({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await new ThreadService(db).runMigrations();
    server = {
      id: 'tracker',
      transport: 'http',
      url: `${as.base}/mcp`,
      userCredentials: {
        provider: 'oauth',
        title: 'Tracker',
        header: 'Authorization',
        scheme: 'Bearer',
        scopes: ['read', 'write'],
      },
    };
    onDisconnect = jest.fn(async () => {});
  });

  afterEach(async () => {
    await db.destroy();
    await new Promise(resolve => http.close(resolve));
  });

  it('builds the authorization URL with PKCE, state, resource, and the configured scopes', async () => {
    const oauth = service();
    const url = new URL(await oauth.start(server, ALICE));
    expect(url.origin + url.pathname).toBe(`${as.base}/as/authorize`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:7007/api/assistants/mcp/oauth/callback',
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toMatch(/^[\w-]{43}$/);
    expect(url.searchParams.get('resource')).toBe(`${as.base}/mcp`);
    // Not every scope the server advertises: only the configured ones.
    expect(url.searchParams.get('scope')).toBe('read write');
  });

  it('registers once per server and reuses the client', async () => {
    const oauth = service();
    await oauth.start(server, ALICE);
    await oauth.start(server, BOB);
    expect(as.registrations).toHaveLength(1);
    expect(as.registrations[0]).toMatchObject({
      client_name: 'Backstage AI Assistants',
      redirect_uris: [
        'http://localhost:7007/api/assistants/mcp/oauth/callback',
      ],
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'none',
    });
  });

  it('uses a configured client id instead of registering', async () => {
    const oauth = service({ clientId: 'admin-issued' });
    const url = new URL(await oauth.start(server, ALICE));
    expect(url.searchParams.get('client_id')).toBe('admin-issued');
    expect(as.registrations).toHaveLength(0);
  });

  it('uses its client metadata document as the client id', async () => {
    const oauth = service({ clientMetadataDocument: true });
    const url = new URL(await oauth.start(server, ALICE));
    const clientId =
      'http://localhost:7007/api/assistants/mcp/oauth/client-metadata/tracker';
    expect(url.searchParams.get('client_id')).toBe(clientId);
    expect(as.registrations).toHaveLength(0);
    expect(oauth.clientMetadataDocument('tracker')).toMatchObject({
      client_id: clientId,
      redirect_uris: [
        'http://localhost:7007/api/assistants/mcp/oauth/callback',
      ],
      token_endpoint_auth_method: 'none',
    });
    expect(
      service({ clientMetadataDocument: false }).clientMetadataDocument(
        'tracker',
      ),
    ).toBeUndefined();
  });

  it('exchanges the code with the PKCE verifier and resource, and stores the tokens sealed', async () => {
    const oauth = service();
    const { result } = await connect(oauth);
    expect(result).toEqual({ serverId: 'tracker', ok: true });
    const exchange = as.tokenRequests.find(
      r => r.grant_type === 'authorization_code',
    )!;
    expect(exchange.resource).toBe(`${as.base}/mcp`);
    expect(exchange.code_verifier).toBeTruthy();

    const token = await oauth.accessToken(server, ALICE);
    expect(token).toMatch(/^at-/);
    const row = await storedRow();
    expect(row.tokens_enc).not.toContain(token);
    expect(row.tokens_enc).not.toContain('rt-');
    expect(await oauth.status(ALICE)).toEqual({ tracker: 'connected' });
    expect(await oauth.status(BOB)).toEqual({ tracker: 'missing' });
    // Nothing secret reaches the log.
    expect(JSON.stringify((logger.info as jest.Mock).mock.calls)).not.toContain(
      token,
    );
  });

  it('accepts a state once, within its lifetime, and only for the user who started it', async () => {
    const oauth = service();
    const { url, state } = await connect(oauth);
    // Replayed.
    expect(
      await oauth.callback({
        code: as.approve(url),
        state,
        userEntityRef: ALICE,
      }),
    ).toMatchObject({ ok: false });

    // Finished by another Backstage user: refused, and the state is spent.
    const started = await oauth.start(server, ALICE);
    const aliceState = new URL(started).searchParams.get('state')!;
    expect(
      await oauth.callback({
        code: as.approve(started),
        state: aliceState,
        userEntityRef: BOB,
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/different/) });
    expect(await oauth.status(BOB)).toEqual({ tracker: 'missing' });
    expect(
      await oauth.callback({
        code: as.approve(started),
        state: aliceState,
        userEntityRef: ALICE,
      }),
    ).toMatchObject({ ok: false });

    // Expired.
    const late = await oauth.start(server, ALICE);
    const lateState = new URL(late).searchParams.get('state')!;
    await db('mcp_oauth_state')
      .where({ state: lateState })
      .update({ expires_at: new Date(Date.now() - 1000) });
    expect(
      await oauth.callback({
        code: as.approve(late),
        state: lateState,
        userEntityRef: ALICE,
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
  });

  it('reports a sign-in the user declined', async () => {
    const oauth = service();
    const url = await oauth.start(server, ALICE);
    expect(
      await oauth.callback({
        state: new URL(url).searchParams.get('state')!,
        error: 'access_denied',
        errorDescription: 'The user declined',
        userEntityRef: ALICE,
      }),
    ).toEqual({ serverId: 'tracker', ok: false, error: 'The user declined' });
  });

  it('refreshes a token about to expire, stores the rotated refresh token, and refreshes once for concurrent turns', async () => {
    as.expiresIn = 60; // inside the refresh window
    const oauth = service();
    await connect(oauth);
    const before = await storedRow();
    as.expiresIn = 3600;
    as.refreshDelayMs = 50;
    const tokens = await Promise.all([
      oauth.accessToken(server, ALICE),
      oauth.accessToken(server, ALICE),
    ]);
    const refreshes = as.tokenRequests.filter(
      r => r.grant_type === 'refresh_token',
    );
    // The second call waited for the first and found a fresh token.
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0].resource).toBe(`${as.base}/mcp`);
    expect(tokens[0]).toBe(tokens[1]);
    expect((await storedRow()).tokens_enc).not.toBe(before.tokens_enc);
    // The rotated refresh token is the one stored: the next refresh works.
    const next = await oauth.accessToken(server, ALICE, {
      rejected: tokens[0],
    });
    expect(next).toMatch(/^at-/);
    expect(next).not.toBe(tokens[0]);
  });

  it('refreshes a token the server refused, once, even when several calls report it', async () => {
    const oauth = service();
    await connect(oauth);
    const first = (await oauth.accessToken(server, ALICE))!;
    const [a, b] = await Promise.all([
      oauth.accessToken(server, ALICE, { rejected: first }),
      oauth.accessToken(server, ALICE, { rejected: first }),
    ]);
    expect(a).toBe(b);
    expect(a).not.toBe(first);
    expect(
      as.tokenRequests.filter(r => r.grant_type === 'refresh_token'),
    ).toHaveLength(1);
  });

  it('forgets a sign-in whose refresh the server refuses', async () => {
    const oauth = service();
    await connect(oauth);
    const first = (await oauth.accessToken(server, ALICE))!;
    as.refreshTokens.clear(); // revoked at the server
    expect(
      await oauth.accessToken(server, ALICE, { rejected: first }),
    ).toBeUndefined();
    expect(await storedRow()).toBeUndefined();
    expect(await oauth.status(ALICE)).toEqual({ tracker: 'missing' });
  });

  it('keeps a valid token when the authorization server is unreachable', async () => {
    as.expiresIn = 120; // due for refresh but not expired
    const oauth = service();
    await connect(oauth);
    as.refreshDown = true;
    const token = await oauth.accessToken(server, ALICE);
    expect(token).toMatch(/^at-/);
    expect(await storedRow()).toBeDefined();
    // Refused by the server, the same token is not offered again.
    expect(
      await oauth.accessToken(server, ALICE, { rejected: token }),
    ).toBeUndefined();
    expect(await storedRow()).toBeDefined();
  });

  it('disconnect revokes the grant, deletes the tokens, and closes the connection', async () => {
    const oauth = service();
    await connect(oauth);
    await oauth.disconnect(server, ALICE);
    expect(as.revoked).toHaveLength(1);
    expect(as.revoked[0]).toMatch(/^rt-/);
    expect(await storedRow()).toBeUndefined();
    expect(onDisconnect).toHaveBeenCalledWith('tracker', ALICE);
  });

  it('reads tokens sealed under a previous key and reseals them under the current one', async () => {
    await connect(service());
    const oldSealed = (await storedRow()).tokens_enc;
    const rotated = service({}, [randomBytes(32), KEY]);
    expect(await rotated.accessToken(server, ALICE)).toMatch(/^at-/);
    expect((await storedRow()).tokens_enc).not.toBe(oldSealed);
    // Without the old key the stored sign-in can't be read: not connected.
    expect(
      await service({}, [randomBytes(32)]).accessToken(server, BOB),
    ).toBeUndefined();
  });
});
