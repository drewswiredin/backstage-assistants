import {
  auth,
  type OAuthAuthorizationServerInformation,
  type OAuthClientInformation,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthTokens,
} from '@ai-sdk/mcp';
import { randomBytes } from 'crypto';
import type { Knex } from 'knex';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { McpOAuthConnection } from '@drewswiredin/backstage-plugin-assistants-common';
import { isOAuthServer, type McpServerConfig } from './config';
import { SecretBox } from './secretBox';

/**
 * Sign-in to MCP servers that run their own OAuth (the MCP authorization
 * spec), held by the backend. The protocol is `@ai-sdk/mcp`'s `auth()`:
 * protected-resource and authorization-server discovery, dynamic client
 * registration, PKCE, the `resource` indicator, the code exchange, and
 * refresh. This service is the `OAuthClientProvider` behind it: where the
 * client, the in-progress sign-in, and each user's tokens are kept (sealed
 * with {@link SecretBox}), and which user a sign-in belongs to.
 *
 * Tokens never leave the backend. A turn asks {@link McpOAuthService.accessToken}
 * for the user's current token, which is refreshed first when it is about to
 * expire, or after the server rejected it; refreshes for one user and server
 * run one at a time, so a rotating refresh token is used once.
 */

/** Refresh a token this close to its expiry, so it outlives the turn's calls. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;
/** How long a started sign-in stays valid. */
const STATE_TTL_MS = 10 * 60 * 1000;
/** Ceiling for the best-effort revocation on disconnect. */
const REVOKE_TIMEOUT_MS = 5_000;

const CLIENT_NAME = 'Backstage AI Assistants';

type FetchFn = typeof fetch;

/** A sign-in in progress, sealed in `mcp_oauth_state`. */
interface Flow {
  codeVerifier?: string;
  client?: OAuthClientInformation;
  authorizationServer?: OAuthAuthorizationServerInformation;
}

interface TokenRow {
  user_ref: string;
  server_id: string;
  tokens_enc: string;
  expires_at: Date | string | null;
}

export interface McpOAuthServiceOptions {
  db: Knex;
  keys: Buffer[];
  servers: Map<string, McpServerConfig>;
  /** The plugin's external base URL, e.g. `https://backstage.example.com/api/assistants`. */
  baseUrl: string;
  logger: LoggerService;
  /** Called after a user disconnects, to close their pooled connection. */
  onDisconnect?: (serverId: string, userEntityRef: string) => Promise<void>;
  fetch?: FetchFn;
}

/** The outcome of a sign-in callback, for the page that tells the app window. */
export interface McpOAuthCallbackResult {
  serverId?: string;
  ok: boolean;
  error?: string;
}

export class McpOAuthService {
  private readonly db: Knex;
  private readonly box: SecretBox;
  private readonly servers: Map<string, McpServerConfig>;
  private readonly baseUrl: string;
  private readonly logger: LoggerService;
  private readonly onDisconnect?: McpOAuthServiceOptions['onDisconnect'];
  private readonly fetchFn?: FetchFn;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(options: McpOAuthServiceOptions) {
    this.db = options.db;
    this.box = new SecretBox(options.keys);
    this.servers = options.servers;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.logger = options.logger;
    this.onDisconnect = options.onDisconnect;
    this.fetchFn = options.fetch;
  }

  /** Where the authorization server sends the user back. */
  get redirectUrl(): string {
    return `${this.baseUrl}/mcp/oauth/callback`;
  }

  /** The client id URL of a server whose client is a metadata document. */
  clientMetadataUrl(serverId: string): string {
    return `${this.baseUrl}/mcp/oauth/client-metadata/${encodeURIComponent(
      serverId,
    )}`;
  }

  /** A configured server that runs its own OAuth, or undefined. */
  server(serverId: string): McpServerConfig | undefined {
    const server = this.servers.get(serverId);
    return server && isOAuthServer(server) ? server : undefined;
  }

  /**
   * The client metadata document for a server with `clientMetadataDocument`:
   * its `client_id` is the URL it is served from.
   */
  clientMetadataDocument(
    serverId: string,
  ): Record<string, unknown> | undefined {
    const server = this.server(serverId);
    if (!server?.userCredentials?.clientMetadataDocument) return undefined;
    return {
      client_id: this.clientMetadataUrl(serverId),
      ...this.clientMetadata(server),
    };
  }

  /**
   * Start a sign-in for `userEntityRef`: discover the server's authorization
   * server, make sure the backend has a client there, and return the
   * authorization URL (PKCE, `state`, `resource`, the configured scopes).
   * The `state` is stored bound to the user and the server for ten minutes.
   */
  async start(server: McpServerConfig, userEntityRef: string): Promise<string> {
    const state = randomBytes(32).toString('base64url');
    const flow: Flow = {};
    let authorizationUrl: URL | undefined;
    const provider: OAuthClientProvider = {
      ...this.baseProvider(server),
      // A new sign-in, whatever is stored: never refresh here.
      tokens: () => undefined,
      saveTokens: () => {},
      clientInformation: async () => {
        flow.client = await this.clientInformation(server);
        return flow.client;
      },
      saveClientInformation: async client => {
        flow.client = client;
        await this.saveRegisteredClient(server.id, client);
      },
      state: () => state,
      saveAuthorizationServerInformation: info => {
        flow.authorizationServer = info;
      },
      saveCodeVerifier: codeVerifier => {
        flow.codeVerifier = codeVerifier;
      },
      codeVerifier: () => flow.codeVerifier ?? '',
      redirectToAuthorization: url => {
        authorizationUrl = url;
      },
    };
    const result = await auth(provider, this.authOptions(server));
    if (result !== 'REDIRECT' || !authorizationUrl) {
      throw new Error(`'${server.id}' did not offer a sign-in`);
    }
    await this.sweepStates();
    await this.db('mcp_oauth_state').insert({
      state,
      user_ref: userEntityRef,
      server_id: server.id,
      flow_enc: this.box.seal(JSON.stringify(flow)),
      expires_at: new Date(Date.now() + STATE_TTL_MS),
    });
    return authorizationUrl.toString();
  }

  /**
   * Finish a sign-in: consume the `state` (once, within ten minutes, only for
   * the user who started it), exchange the code with the PKCE verifier and
   * `resource`, and store the tokens. `userEntityRef` is the user whose
   * browser came back, or undefined when it carried no Backstage sign-in.
   */
  async callback(params: {
    code?: string;
    state?: string;
    iss?: string;
    error?: string;
    errorDescription?: string;
    userEntityRef?: string;
  }): Promise<McpOAuthCallbackResult> {
    const row = params.state
      ? ((await this.db('mcp_oauth_state')
          .where({ state: params.state })
          .first()) as
          | {
              state: string;
              user_ref: string;
              server_id: string;
              flow_enc: string;
              expires_at: Date | string;
            }
          | undefined)
      : undefined;
    if (row) {
      await this.db('mcp_oauth_state').where({ state: row.state }).delete();
    }
    if (!row || new Date(row.expires_at).getTime() < Date.now()) {
      return {
        ok: false,
        error: 'This sign-in expired or was already used. Start it again.',
      };
    }
    const serverId = row.server_id;
    const server = this.server(serverId);
    if (!server) {
      return { serverId, ok: false, error: `Unknown server '${serverId}'` };
    }
    if (params.error) {
      return {
        serverId,
        ok: false,
        error: (params.errorDescription ?? params.error).slice(0, 300),
      };
    }
    if (!params.userEntityRef || params.userEntityRef !== row.user_ref) {
      return {
        serverId,
        ok: false,
        error:
          'This sign-in was started by a different Backstage user, or your Backstage session could not be confirmed.',
      };
    }
    if (!params.code) {
      return { serverId, ok: false, error: 'The sign-in returned no code' };
    }
    const flow = JSON.parse(this.box.open(row.flow_enc)) as Flow;
    const provider: OAuthClientProvider = {
      ...this.baseProvider(server),
      tokens: () => undefined,
      saveTokens: tokens => this.saveTokens(server.id, row.user_ref, tokens),
      clientInformation: () => flow.client,
      authorizationServerInformation: () => flow.authorizationServer,
      storedState: () => row.state,
      saveCodeVerifier: () => {},
      codeVerifier: () => flow.codeVerifier ?? '',
      redirectToAuthorization: () => {},
      invalidateCredentials: async scope => {
        if (scope === 'all' || scope === 'client') {
          await this.forgetRegisteredClient(server);
        }
      },
    };
    try {
      const result = await auth(provider, {
        ...this.authOptions(server),
        authorizationCode: params.code,
        callbackState: params.state,
        ...(params.iss ? { callbackIssuer: params.iss } : {}),
      });
      if (result !== 'AUTHORIZED') {
        return { serverId, ok: false, error: 'The sign-in was not completed' };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `MCP server '${serverId}' sign-in failed for ${row.user_ref}: ${message}`,
      );
      return { serverId, ok: false, error: message.slice(0, 300) };
    }
    this.logger.info(`MCP server '${serverId}' connected`, {
      user: row.user_ref,
    });
    return { serverId, ok: true };
  }

  /**
   * The user's current access token for `server`, or undefined when they
   * aren't connected or the sign-in can't be refreshed. Refreshes first when
   * the token expires within five minutes, or when `rejected` is the stored
   * token (the server just answered 401 to it). A refresh that fails for good
   * deletes the stored sign-in, so the user is asked to connect again.
   */
  async accessToken(
    server: McpServerConfig,
    userEntityRef: string,
    options: { rejected?: string } = {},
  ): Promise<string | undefined> {
    return this.locked(`${server.id}|${userEntityRef}`, async () => {
      const row = await this.tokenRow(server.id, userEntityRef);
      if (!row) return undefined;
      const tokens = this.openTokens(row);
      if (!tokens) return undefined;
      const expiresAt = row.expires_at
        ? new Date(row.expires_at).getTime()
        : undefined;
      const rejected =
        options.rejected !== undefined &&
        options.rejected === tokens.access_token;
      const due =
        rejected ||
        (expiresAt !== undefined && expiresAt - Date.now() < REFRESH_SKEW_MS);
      if (!due) {
        if (this.box.isStale(row.tokens_enc)) {
          await this.saveTokens(server.id, userEntityRef, tokens);
        }
        return tokens.access_token;
      }
      const stillValid =
        !rejected && (expiresAt === undefined || expiresAt > Date.now());
      if (!tokens.refresh_token) {
        return stillValid ? tokens.access_token : undefined;
      }
      return this.refresh(server, userEntityRef, tokens, stillValid);
    });
  }

  /** The user's connection to each server that runs its own OAuth. */
  async status(
    userEntityRef: string,
  ): Promise<Record<string, McpOAuthConnection>> {
    const rows = (await this.db('mcp_oauth_tokens').where({
      user_ref: userEntityRef,
    })) as TokenRow[];
    const byServer = new Map(rows.map(row => [row.server_id, row]));
    const out: Record<string, McpOAuthConnection> = {};
    for (const server of this.servers.values()) {
      if (!isOAuthServer(server)) continue;
      const row = byServer.get(server.id);
      const tokens = row && this.openTokens(row);
      if (!row || !tokens) {
        out[server.id] = 'missing';
        continue;
      }
      const expired =
        row.expires_at !== null &&
        new Date(row.expires_at).getTime() <= Date.now();
      out[server.id] =
        expired && !tokens.refresh_token ? 'expired' : 'connected';
    }
    return out;
  }

  /**
   * Disconnect the user from `server`: revoke the grant at the authorization
   * server when it offers revocation (best effort), delete the stored
   * tokens, and close the user's pooled connection.
   */
  async disconnect(
    server: McpServerConfig,
    userEntityRef: string,
  ): Promise<void> {
    await this.locked(`${server.id}|${userEntityRef}`, async () => {
      const row = await this.tokenRow(server.id, userEntityRef);
      const tokens = row && this.openTokens(row);
      if (tokens) {
        await this.revoke(server, tokens).catch(error =>
          this.logger.warn(
            `MCP server '${server.id}' token revocation failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
      }
      await this.db('mcp_oauth_tokens')
        .where({ user_ref: userEntityRef, server_id: server.id })
        .delete();
    });
    await this.onDisconnect?.(server.id, userEntityRef);
    this.logger.info(`MCP server '${server.id}' disconnected`, {
      user: userEntityRef,
    });
  }

  /** Delete sign-ins that were started and never finished. */
  async sweepStates(): Promise<void> {
    await this.db('mcp_oauth_state')
      .where('expires_at', '<', new Date())
      .delete();
  }

  // --- internals ------------------------------------------------------------

  /** Run `fn` after any earlier call for the same key has settled. */
  private async locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const settled = run.catch(() => {});
    this.locks.set(key, settled);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === settled) this.locks.delete(key);
    }
  }

  private authOptions(server: McpServerConfig) {
    const scopes = server.userCredentials?.scopes;
    return {
      serverUrl: server.url as string,
      // Without an explicit scope the library asks for every scope the
      // server advertises.
      ...(scopes ? { scope: scopes.join(' ') } : {}),
      ...(this.fetchFn ? { fetchFn: this.fetchFn } : {}),
    };
  }

  private clientMetadata(server: McpServerConfig): OAuthClientMetadata {
    const uc = server.userCredentials;
    return {
      client_name: CLIENT_NAME,
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: uc?.clientSecret
        ? 'client_secret_post'
        : 'none',
      ...(uc?.scopes ? { scope: uc.scopes.join(' ') } : {}),
    };
  }

  /** The provider members every mode shares. */
  private baseProvider(server: McpServerConfig) {
    const clientMetadata = this.clientMetadata(server);
    return {
      redirectUrl: this.redirectUrl,
      clientMetadata,
    };
  }

  /**
   * The backend's client at the server's authorization server, in order: the
   * configured `clientId`, the client metadata document, or the client the
   * backend registered (undefined until it has, so the library registers).
   */
  private async clientInformation(
    server: McpServerConfig,
  ): Promise<OAuthClientInformation | undefined> {
    const uc = server.userCredentials!;
    if (uc.clientId) {
      return {
        client_id: uc.clientId,
        ...(uc.clientSecret ? { client_secret: uc.clientSecret } : {}),
      };
    }
    if (uc.clientMetadataDocument) {
      return { client_id: this.clientMetadataUrl(server.id) };
    }
    const row = (await this.db('mcp_oauth_clients')
      .where({ server_id: server.id })
      .first()) as { client_enc: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(this.box.open(row.client_enc));
    } catch {
      return undefined;
    }
  }

  private async saveRegisteredClient(
    serverId: string,
    client: OAuthClientInformation,
  ): Promise<void> {
    await this.db('mcp_oauth_clients')
      .insert({
        server_id: serverId,
        client_enc: this.box.seal(JSON.stringify(client)),
        registered_at: new Date(),
      })
      .onConflict('server_id')
      .merge();
  }

  /** Drop a registered client the authorization server no longer accepts. */
  private async forgetRegisteredClient(server: McpServerConfig): Promise<void> {
    const uc = server.userCredentials!;
    if (uc.clientId || uc.clientMetadataDocument) return;
    await this.db('mcp_oauth_clients').where({ server_id: server.id }).delete();
  }

  private async tokenRow(
    serverId: string,
    userEntityRef: string,
  ): Promise<TokenRow | undefined> {
    return (await this.db('mcp_oauth_tokens')
      .where({ user_ref: userEntityRef, server_id: serverId })
      .first()) as TokenRow | undefined;
  }

  private openTokens(row: TokenRow): OAuthTokens | undefined {
    try {
      return JSON.parse(this.box.open(row.tokens_enc));
    } catch (error) {
      this.logger.warn(
        `MCP server '${row.server_id}' stored sign-in could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  private async saveTokens(
    serverId: string,
    userEntityRef: string,
    tokens: OAuthTokens,
  ): Promise<void> {
    await this.db('mcp_oauth_tokens')
      .insert({
        user_ref: userEntityRef,
        server_id: serverId,
        tokens_enc: this.box.seal(JSON.stringify(tokens)),
        expires_at:
          typeof tokens.expires_in === 'number'
            ? new Date(Date.now() + tokens.expires_in * 1000)
            : null,
        updated_at: new Date(),
      })
      .onConflict(['user_ref', 'server_id'])
      .merge();
  }

  /**
   * Refresh through the library, which discovers the authorization server and
   * sends the refresh grant with `resource`. A rotated refresh token is stored;
   * a server that returns none keeps the current one. On a refused grant the
   * stored sign-in is deleted; on any other failure it is kept, and the
   * current token is used while it is still valid.
   */
  private async refresh(
    server: McpServerConfig,
    userEntityRef: string,
    tokens: OAuthTokens,
    stillValid: boolean,
  ): Promise<string | undefined> {
    let saved: OAuthTokens | undefined;
    let refused = false;
    const provider: OAuthClientProvider = {
      ...this.baseProvider(server),
      tokens: () => (refused ? undefined : tokens),
      saveTokens: async next => {
        saved = {
          ...next,
          refresh_token: next.refresh_token ?? tokens.refresh_token,
        };
        await this.saveTokens(server.id, userEntityRef, saved);
      },
      clientInformation: () => this.clientInformation(server),
      invalidateCredentials: async scope => {
        if (scope === 'all' || scope === 'tokens') refused = true;
        if (scope === 'all' || scope === 'client') {
          await this.forgetRegisteredClient(server);
        }
      },
      // Reached only when the refresh didn't work: the user has to sign in
      // again, from the browser.
      saveAuthorizationServerInformation: () => {},
      saveCodeVerifier: () => {},
      codeVerifier: () => '',
      redirectToAuthorization: () => {},
    };
    try {
      const result = await auth(provider, this.authOptions(server));
      if (result === 'AUTHORIZED' && saved) return saved.access_token;
    } catch (error) {
      this.logger.warn(
        `MCP server '${server.id}' token refresh failed for ${userEntityRef}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      if (!refused) return stillValid ? tokens.access_token : undefined;
    }
    if (!refused) return stillValid ? tokens.access_token : undefined;
    this.logger.info(
      `MCP server '${server.id}' sign-in expired; the user must connect again`,
      { user: userEntityRef },
    );
    await this.db('mcp_oauth_tokens')
      .where({ user_ref: userEntityRef, server_id: server.id })
      .delete();
    return undefined;
  }

  /** RFC 7009 revocation of the grant, when the authorization server offers it. */
  private async revoke(
    server: McpServerConfig,
    tokens: OAuthTokens,
  ): Promise<void> {
    const issuer = tokens.authorization_server;
    if (!issuer) return;
    const endpoint = await this.revocationEndpoint(issuer);
    if (!endpoint) return;
    const client = await this.clientInformation(server);
    const body = new URLSearchParams({
      token: tokens.refresh_token ?? tokens.access_token,
      token_type_hint: tokens.refresh_token ? 'refresh_token' : 'access_token',
    });
    if (client?.client_id) body.set('client_id', client.client_id);
    if (client?.client_secret) body.set('client_secret', client.client_secret);
    const res = await (this.fetchFn ?? fetch)(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`revocation answered HTTP ${res.status}`);
  }

  /** The authorization server's `revocation_endpoint` (RFC 8414 metadata). */
  private async revocationEndpoint(
    issuer: string,
  ): Promise<string | undefined> {
    const url = new URL(issuer);
    const path = url.pathname.replace(/\/$/, '');
    const candidates = [
      `${url.origin}/.well-known/oauth-authorization-server${path}`,
      `${url.origin}${path}/.well-known/oauth-authorization-server`,
      `${url.origin}${path}/.well-known/openid-configuration`,
    ];
    for (const candidate of new Set(candidates)) {
      const res = await (this.fetchFn ?? fetch)(candidate, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
      }).catch(() => undefined);
      if (!res?.ok) continue;
      const metadata = (await res.json().catch(() => ({}))) as {
        revocation_endpoint?: unknown;
      };
      return typeof metadata.revocation_endpoint === 'string'
        ? metadata.revocation_endpoint
        : undefined;
    }
    return undefined;
  }
}
