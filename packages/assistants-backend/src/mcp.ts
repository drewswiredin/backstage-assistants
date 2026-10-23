import {
  createMCPClient,
  ElicitationRequestSchema,
  type MCPClient,
  type MCPClientConfig,
} from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import { createHash } from 'crypto';
import type { Knex } from 'knex';
import { jsonSchema, tool, type Tool } from 'ai';
import type { LoggerService } from '@backstage/backend-plugin-api';
import {
  CLIENT_TOOL_NAME_PATTERN,
  type ElicitationPrompt,
  type ElicitationStatus,
  type ToolSummary,
} from '@drewswiredin/backstage-plugin-assistants-common';
import { isOAuthServer, type McpServerConfig } from './config';
import { truncateToolResult } from './truncateToolResult';
import type { ElicitationBroker, ElicitationCall } from './mcpElicitation';
import { argumentRuleViolation } from './toolGuards';

/**
 * MCP (Model Context Protocol) integration, on `@ai-sdk/mcp` (the AI SDK's own
 * MCP client). External MCP servers' tools are adapted into AI SDK tools so
 * assistants can call them — the same wrapping we do for Backstage actions in
 * {@link actionsToTools}. The pooling, warm tool cache, and timeout bounds
 * around the client are ours; the protocol client and transports are the
 * library's.
 *
 * Auth is either a single static credential per server (the configured headers
 * / stdio env: one shared identity for all users), or, for a server with
 * `userCredentials`, the signed-in user's own token, held only in that user's
 * pooled connection: sent by the browser with each turn, or, for a server
 * that runs its own OAuth, kept by the backend ({@link McpOAuthService}). Access is gated by
 * the assistant's `access` policy and its explicit per-tool `allowedTools`
 * entries (`<serverId>__<tool>`; no wildcard); a per-user server additionally
 * caps every call at what the user's own token may do.
 */

const NAME_SEPARATOR = '__';

/** A server's raw (un-namespaced) tool, as returned by the MCP server. The
 *  `inputSchema` is captured so `/chat` can build tool definitions from the pool
 *  cache without a live `listTools`. */
interface RawMcpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** A resolved server connection + this assistant's per-tool allowlist. */
export interface ResolvedMcpSelection {
  server: McpServerConfig;
  /** Exactly these (un-namespaced) tool names — explicit only, no wildcard. */
  tools: string[];
}

/**
 * Namespace a server's tool name so tools from different servers (and Backstage
 * actions) never collide, and so `/status` listing and `/chat` execution agree
 * on the name the model sees.
 */
export function mcpToolName(serverId: string, toolName: string): string {
  return `${serverId.replace(
    /[^a-zA-Z0-9_-]/g,
    '_',
  )}${NAME_SEPARATOR}${toolName}`;
}

/**
 * The sanitized form of a server id as it appears in a namespaced tool name
 * (the same transform {@link mcpToolName} applies to the prefix). An assistant's
 * `allowedTools` carry the namespaced name, so resolution matches on this form.
 */
function sanitizeServerId(serverId: string): string {
  return serverId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Splits an assistant's unified `allowedTools` into bare Backstage action ids,
 * per-server MCP tool selections, and client tool names.
 *
 * An entry is treated as an MCP tool when it is `<serverId>__<tool>` and
 * `<serverId>` (in its {@link mcpToolName}-sanitized form) matches a configured
 * server in `servers`; the remainder is the bare tool name. A namespaced entry
 * whose prefix is not a configured server and whose shape is
 * `<namespace>__<tool>` is a client tool, offered when the browser declares
 * it. Everything else is returned as a bare action id, so unknown entries are
 * tolerated downstream (an unknown action id is logged + skipped by
 * {@link selectAssistantActions}; an unknown MCP tool name is simply not
 * connected; an undeclared client tool is simply not offered).
 *
 * Returns the bare action-id list, one {@link ResolvedMcpSelection} per
 * referenced server with its per-server tool allowlist assembled from the
 * matching entries (so only the named tools on each server are exposed), and
 * the client tool names.
 */
export function splitAllowedTools(
  allowedTools: string[],
  servers: Map<string, McpServerConfig>,
): {
  actionIds: string[];
  mcpSelections: ResolvedMcpSelection[];
  clientToolNames: string[];
} {
  // Map a sanitized server id back to its config + raw id, for prefix matching.
  const bySanitized = new Map<string, McpServerConfig>();
  for (const server of servers.values()) {
    bySanitized.set(sanitizeServerId(server.id), server);
  }

  const actionIds: string[] = [];
  const clientToolNames: string[] = [];
  // Preserve first-seen server order; collect each server's allowlisted tools.
  const selByServerId = new Map<
    string,
    { server: McpServerConfig; tools: string[] }
  >();

  for (const entry of allowedTools) {
    const sep = entry.indexOf(NAME_SEPARATOR);
    if (sep > 0) {
      const prefix = entry.slice(0, sep);
      const toolName = entry.slice(sep + NAME_SEPARATOR.length);
      const server = bySanitized.get(prefix);
      if (server && toolName) {
        let sel = selByServerId.get(server.id);
        if (!sel) {
          sel = { server, tools: [] };
          selByServerId.set(server.id, sel);
        }
        sel.tools.push(toolName);
        continue;
      }
      if (CLIENT_TOOL_NAME_PATTERN.test(entry)) {
        clientToolNames.push(entry);
        continue;
      }
    }
    // Not a known-server namespaced tool → a bare action id (tolerated).
    actionIds.push(entry);
  }

  return {
    actionIds,
    mcpSelections: [...selByServerId.values()].map(({ server, tools }) => ({
      server,
      tools,
    })),
    clientToolNames,
  };
}

/**
 * Per-tool allowlist semantics: explicit names only — `[]` allows nothing,
 * there is no wildcard, and a tool added to a server later is never
 * auto-granted (the trust model in docs/architecture.md, Authorization).
 */
function isToolAllowed(allowlist: string[], name: string): boolean {
  return allowlist.includes(name);
}

/**
 * The transport for a server; for a per-user server, carrying the user's
 * `token` in the configured header (http/sse) or environment variable (stdio).
 */
function transportFor(
  server: McpServerConfig,
  token?: string,
): MCPClientConfig['transport'] {
  const uc = token ? server.userCredentials : undefined;
  // Local process transport. The library merges the configured env over its
  // safe inherited defaults (PATH etc.).
  if (server.transport === 'stdio') {
    const env = uc?.env ? { ...server.env, [uc.env]: token! } : server.env;
    return new Experimental_StdioMCPTransport({
      command: server.command as string,
      args: server.args,
      env,
      cwd: server.cwd,
    });
  }

  // Remote transports (Streamable HTTP / legacy SSE) are plain config.
  const headers = uc
    ? {
        ...server.headers,
        [uc.header]: uc.scheme ? `${uc.scheme} ${token}` : token!,
      }
    : server.headers;
  return {
    type: server.transport === 'sse' ? 'sse' : 'http',
    url: server.url as string,
    headers: headers && Object.keys(headers).length > 0 ? headers : undefined,
  };
}

// --- Elicitation -----------------------------------------------------------
// A server with `elicitation` may ask the user for input mid-call. Its
// clients declare the capability and hand each request to the broker, which
// the plugin installs at startup; without one nothing is declared, and such
// a server's request fails as it did before.

let elicitationBroker: ElicitationBroker | undefined;

/** Install (or remove) the broker that answers servers' questions. */
export function setElicitationBroker(broker: ElicitationBroker | undefined) {
  elicitationBroker = broker;
}

function elicitationCapability(
  server: McpServerConfig,
): Pick<MCPClientConfig, 'capabilities'> {
  return server.elicitation && elicitationBroker
    ? { capabilities: { elicitation: {} } }
    : {};
}

function answerElicitations(client: MCPClient, server: McpServerConfig) {
  const broker = elicitationBroker;
  if (!server.elicitation || !broker) return;
  client.onElicitationRequest(ElicitationRequestSchema, request =>
    broker.handle(client, server, request),
  );
}

// --- MCP connection pool ----------------------------------------------------
// One PERSISTENT client per configured server, established and refreshed by the
// scheduler (maintainMcpConnections, wired in the plugin) — NOT per request.
// /status reads the cached tool inventory synchronously; /chat reuses the pooled
// clients for tool execution; /capabilities reads the same pool. Connections are
// closed only on plugin shutdown (closeMcpPool).

/** A pooled server: its persistent client (when connected), last-known tool
 *  inventory (with input schemas, for /chat tool definitions), and reachability. */
interface PooledServer {
  client?: MCPClient;
  tools: RawMcpTool[];
  reachable: boolean;
  error?: string;
  fetchedAt: number;
}
const pool = new Map<string, PooledServer>();

/** Default per-connect/list ceiling so one slow/black-holed server can't stall
 *  a maintenance cycle near the MCP SDK's ~60s default request timeout.
 *  Overridable per server via `connectTimeoutMs` (resolved in config.ts) —
 *  e.g. Python stdio servers can take ~10s just to start. */
const DEFAULT_PROBE_TIMEOUT_MS = 8_000;

/** The connect/list ceiling for a server: its configured `connectTimeoutMs`
 *  (per-server → global, resolved at config read) or the built-in default. */
function probeTimeoutMs(server: McpServerConfig): number {
  return server.connectTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
}

/** Floor for the maintenance task's own timeout, so a small fleet of fast
 *  servers keeps the historical 1-minute budget. */
const MIN_MAINTENANCE_TIMEOUT_MS = 60_000;

/** Freshness window for an on-demand /capabilities read before it re-lists. */
const LIST_TTL_MS = 5 * 60 * 1000;
/** Ceiling for one tool call — matches the MCP SDK's historical per-request
 *  default, so a hung server can't hold a turn open indefinitely. */
const TOOL_CALL_TIMEOUT_MS = 60_000;
/** Max servers refreshed concurrently per maintenance cycle. */
const MAINTAIN_CONCURRENCY = 5;

/**
 * Reject after `ms` if `p` hasn't settled. Only needed for the connect step —
 * `createMCPClient` offers no timeout of its own. (Per-request bounds on
 * `listTools`/`callTool` ride an `AbortSignal` instead: the library types a
 * `timeout` option but only honours `signal`.)
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      v => {
        clearTimeout(timer);
        resolve(v);
      },
      e => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Get or create the pool entry for a server. */
function poolEntry(serverId: string): PooledServer {
  let entry = pool.get(serverId);
  if (!entry) {
    entry = { tools: [], reachable: false, fetchedAt: 0 };
    pool.set(serverId, entry);
  }
  return entry;
}

/**
 * Ensure a live connection to `server` and refresh its tool inventory into the
 * pool, KEEPING the connection open for reuse. Creates the persistent client on
 * first use and re-lists on an existing one; on failure, drops the (possibly
 * dead) client so the next cycle reconnects, while preserving the last-known
 * tools for drift tolerance. Bounded by the server's connect timeout so a bad
 * server can't stall the maintenance cycle.
 */
async function refreshServer(
  server: McpServerConfig,
  logger: LoggerService,
): Promise<PooledServer> {
  const entry = poolEntry(server.id);
  const timeoutMs = probeTimeoutMs(server);
  // Held outside the try so the catch can close a client that connected but
  // failed to list — otherwise its transport / spawned child process leaks on
  // every cycle. A client that resolves AFTER the connect timeout is closed by
  // the late `.then` below.
  let client = entry.client;
  let connectPromise: Promise<MCPClient> | undefined;
  try {
    if (!client) {
      connectPromise = createMCPClient({
        transport: transportFor(server),
        clientName: 'backstage-plugin-assistants',
        ...elicitationCapability(server),
        onUncaughtError: e =>
          logger.warn(
            `MCP server '${server.id}' transport error: ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
      });
      client = await withTimeout(
        connectPromise,
        timeoutMs,
        `MCP '${server.id}' connect`,
      );
      answerElicitations(client, server);
      entry.client = client;
    }
    const { tools } = await client.listTools({
      options: { signal: AbortSignal.timeout(timeoutMs) },
    });
    entry.tools = tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    entry.reachable = true;
    entry.error = undefined;
    entry.fetchedAt = Date.now();
    warnUnknownToolNames(server, entry.tools, logger);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`MCP server '${server.id}' tool listing failed: ${message}`);
    entry.reachable = false;
    entry.error = message;
    // Close the (possibly half-connected) client to release its connection /
    // child process, and drop it so the next cycle reconnects fresh. Keep the
    // last-known tools so /status + /chat tolerate a transient blip. A connect
    // that resolves after its timeout is closed on arrival.
    if (client) {
      await client.close().catch(() => {});
    } else if (connectPromise) {
      void connectPromise.then(c => c.close().catch(() => {})).catch(() => {});
    }
    entry.client = undefined;
  }
  return entry;
}

/**
 * A server's reachability + tool inventory, for the `/capabilities` editor. On a
 * fresh pool entry (within LIST_TTL_MS, not forced) the maintained value is
 * returned without re-listing; otherwise the pool is refreshed (reusing the
 * persistent client). A failure is REPORTED (`reachable: false` + `error`) so the
 * picker can show why a server is unavailable rather than an empty list.
 */
export interface ServerToolProbe {
  reachable: boolean;
  error?: string;
  tools: RawMcpTool[];
}

export async function probeServerTools(
  server: McpServerConfig,
  logger: LoggerService,
  caller?: McpCaller,
): Promise<ServerToolProbe> {
  // A per-user server is listed as the caller when they are connected, and
  // otherwise from its shared inventory: the last listing any user got.
  if (server.userCredentials) {
    const token = caller && (await callerToken(server, caller));
    if (caller && token) {
      try {
        const { conn } = await connectAs(server, caller, token, logger);
        return { reachable: true, tools: conn.tools };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          reachable: false,
          error: message,
          tools: cachedServerToolsRaw(server.id),
        };
      }
    }
    const tools = cachedServerToolsRaw(server.id);
    return tools.length > 0
      ? { reachable: true, tools }
      : {
          reachable: false,
          error: `Connect ${server.userCredentials.title} to discover this server's tools`,
          tools,
        };
  }
  const cached = pool.get(server.id);
  if (
    cached &&
    cached.fetchedAt > 0 &&
    Date.now() - cached.fetchedAt < LIST_TTL_MS
  ) {
    return {
      reachable: cached.reachable,
      error: cached.error,
      tools: cached.tools,
    };
  }
  const entry = await refreshServer(server, logger);
  return { reachable: entry.reachable, error: entry.error, tools: entry.tools };
}

/**
 * Synchronous read of the pooled tool inventory: a server's cached tools, or `[]`
 * if it isn't connected yet. NEVER connects — this is what `/status` uses so a
 * page load never blocks on a live MCP connection. The pool is kept fresh by
 * {@link maintainMcpConnections} (scheduled in the plugin).
 */
export function cachedServerToolsRaw(serverId: string): RawMcpTool[] {
  return pool.get(serverId)?.tools ?? [];
}

// --- Per-user connections ----------------------------------------------------
// A server with `userCredentials` has no shared connection. Each user gets a
// client of their own, opened on their first turn with their token and reused
// while the token stays the same; a refreshed token reconnects. Connections
// idle for 10 minutes are closed, and at most 200 are kept (least recently
// used closed first). Tokens are never stored: only their hash, to tell a
// refreshed token from the one the connection was opened with.
//
// The tool schemas are the same for every user, so the first listing is also
// kept as the server's shared inventory (in the pool entry, and through the
// tool cache store, in the database) for `/status` and the editor.

/** A user's connection to a per-user server, with the tools it lists for them. */
interface UserConnection {
  client: MCPClient;
  tokenHash: string;
  tools: RawMcpTool[];
  lastUsed: number;
}
const userPool = new Map<string, UserConnection>();
const userConnecting = new Map<string, Promise<UserConnection>>();

const USER_IDLE_MS = 10 * 60 * 1000;
const USER_POOL_MAX = 200;

function userKey(serverId: string, userEntityRef: string): string {
  return `${serverId}|${userEntityRef}`;
}

function tokenHashOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Persists the shared tool inventory of per-user servers across restarts. */
export interface McpToolCacheStore {
  load(): Promise<Map<string, RawMcpTool[]>>;
  save(serverId: string, tools: RawMcpTool[]): Promise<void>;
}
let toolCacheStore: McpToolCacheStore | undefined;

/** {@link McpToolCacheStore} on the plugin database's `mcp_tool_cache` table. */
export function databaseToolCacheStore(db: Knex): McpToolCacheStore {
  return {
    async load() {
      const rows = (await db('mcp_tool_cache').select(
        'server_id',
        'tools_json',
      )) as Array<{ server_id: string; tools_json: string }>;
      return new Map(
        rows.map(row => [row.server_id, JSON.parse(row.tools_json)]),
      );
    },
    async save(serverId, tools) {
      await db('mcp_tool_cache')
        .insert({
          server_id: serverId,
          tools_json: JSON.stringify(tools),
          updated_at: new Date(),
        })
        .onConflict('server_id')
        .merge();
    },
  };
}

/**
 * Seed the per-user servers' tool inventories from `store` and keep saving
 * new listings to it. Called once at startup.
 */
export async function initMcpToolCache(
  store: McpToolCacheStore,
  servers: McpServerConfig[],
  logger: LoggerService,
): Promise<void> {
  toolCacheStore = store;
  try {
    const cached = await store.load();
    for (const server of servers) {
      const tools = server.userCredentials && cached.get(server.id);
      if (tools) {
        const entry = poolEntry(server.id);
        entry.tools = tools;
        entry.reachable = true;
        entry.fetchedAt = Date.now();
      }
    }
  } catch (error) {
    logger.warn(
      `MCP tool cache could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** Keep a per-user server's latest listing as its shared inventory. */
function recordSharedTools(
  server: McpServerConfig,
  tools: RawMcpTool[],
  logger: LoggerService,
): void {
  const entry = poolEntry(server.id);
  const changed = JSON.stringify(entry.tools) !== JSON.stringify(tools);
  entry.tools = tools;
  entry.reachable = true;
  entry.error = undefined;
  entry.fetchedAt = Date.now();
  warnUnknownToolNames(server, tools, logger);
  if (changed && toolCacheStore) {
    toolCacheStore
      .save(server.id, tools)
      .catch(error =>
        logger.warn(
          `MCP tool cache for '${server.id}' could not be saved: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
  }
}

const warnedServers = new Set<string>();

/**
 * Warn once per server about guard config naming tools the server doesn't
 * list: a typo there would silently leave a write unguarded.
 */
function warnUnknownToolNames(
  server: McpServerConfig,
  tools: RawMcpTool[],
  logger: LoggerService,
): void {
  if (warnedServers.has(server.id) || tools.length === 0) return;
  warnedServers.add(server.id);
  const listed = new Set(tools.map(t => t.name));
  const named = new Set([
    ...(server.requireApproval ?? []),
    ...Object.keys(server.argumentRules ?? {}),
    ...Object.entries(server.approvalPreview ?? {}).flatMap(([name, p]) =>
      p.base ? [name, p.base.tool] : [name],
    ),
  ]);
  const unknown = [...named].filter(name => !listed.has(name));
  if (unknown.length > 0) {
    logger.warn(
      `MCP server '${
        server.id
      }' does not list tool(s) named in its config: ${unknown.join(', ')}`,
    );
  }
}

/** Close idle per-user connections and the least recently used beyond the cap. */
function sweepUserPool(now = Date.now()): void {
  for (const [key, conn] of userPool) {
    if (now - conn.lastUsed > USER_IDLE_MS || userPool.size > USER_POOL_MAX) {
      userPool.delete(key);
      void conn.client.close().catch(() => {});
    }
  }
}

/**
 * The user's connection to a per-user server, opened with `token` when there
 * is none or the token changed. Concurrent calls for the same user and token
 * share one connect. Throws when the server can't be reached or rejects the
 * token, with the server's message.
 */
async function userConnection(
  server: McpServerConfig,
  userEntityRef: string,
  token: string,
  logger: LoggerService,
): Promise<UserConnection> {
  const key = userKey(server.id, userEntityRef);
  const tokenHash = tokenHashOf(token);
  const existing = userPool.get(key);
  if (existing && existing.tokenHash === tokenHash) {
    // Re-insert so Map order stays least recently used first.
    userPool.delete(key);
    existing.lastUsed = Date.now();
    userPool.set(key, existing);
    return existing;
  }
  const pendingKey = `${key}|${tokenHash}`;
  const pending = userConnecting.get(pendingKey);
  if (pending) return pending;

  const connect = (async () => {
    if (existing) {
      userPool.delete(key);
      await existing.client.close().catch(() => {});
    }
    const timeoutMs = probeTimeoutMs(server);
    const connectPromise = createMCPClient({
      transport: transportFor(server, token),
      clientName: 'backstage-plugin-assistants',
      ...elicitationCapability(server),
      onUncaughtError: e =>
        logger.warn(
          `MCP server '${server.id}' transport error: ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
    });
    let client: MCPClient | undefined;
    try {
      client = await withTimeout(
        connectPromise,
        timeoutMs,
        `MCP '${server.id}' connect`,
      );
      answerElicitations(client, server);
      const { tools } = await client.listTools({
        options: { signal: AbortSignal.timeout(timeoutMs) },
      });
      const raw = tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      const conn: UserConnection = {
        client,
        tokenHash,
        tools: raw,
        lastUsed: Date.now(),
      };
      userPool.set(key, conn);
      sweepUserPool();
      recordSharedTools(server, raw, logger);
      return conn;
    } catch (error) {
      if (client) {
        await client.close().catch(() => {});
      } else {
        void connectPromise
          .then(c => c.close().catch(() => {}))
          .catch(() => {});
      }
      throw error;
    }
  })();
  userConnecting.set(pendingKey, connect);
  try {
    return await connect;
  } finally {
    userConnecting.delete(pendingKey);
  }
}

/** How many per-user connections are open. */
export function userConnectionCount(): number {
  return userPool.size;
}

/** Close a user's connection to a server, e.g. after they disconnect. */
export async function closeUserConnection(
  serverId: string,
  userEntityRef: string,
): Promise<void> {
  const key = userKey(serverId, userEntityRef);
  const conn = userPool.get(key);
  userPool.delete(key);
  await conn?.client.close().catch(() => {});
}

/** True for an error that says the server answered 401 to the token. */
function isUnauthorized(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b401\b/.test(message);
}

/**
 * The caller's token for a per-user server: the one their browser sent, or,
 * for a server that runs its own OAuth, the backend-held one (refreshed when
 * due, or when `rejected` is the token the server just refused).
 */
export async function callerToken(
  server: McpServerConfig,
  caller: McpCaller,
  rejected?: string,
): Promise<string | undefined> {
  if (isOAuthServer(server)) {
    return caller.oauthToken?.(server, rejected ? { rejected } : {});
  }
  return rejected ? undefined : caller.credentials[server.id];
}

/**
 * The caller's connection to a per-user server, opened with `token`. When the
 * server refuses a backend-held OAuth token, it is refreshed once and the
 * connect retried.
 */
async function connectAs(
  server: McpServerConfig,
  caller: McpCaller,
  token: string,
  logger: LoggerService,
): Promise<{ conn: UserConnection; token: string }> {
  try {
    const conn = await userConnection(
      server,
      caller.userEntityRef,
      token,
      logger,
    );
    return { conn, token };
  } catch (error) {
    if (!isOAuthServer(server) || !isUnauthorized(error)) throw error;
    const fresh = await callerToken(server, caller, token);
    if (!fresh) throw signInExpired(server);
    const conn = await userConnection(
      server,
      caller.userEntityRef,
      fresh,
      logger,
    );
    return { conn, token: fresh };
  }
}

function signInExpired(server: McpServerConfig): Error {
  const title = server.userCredentials?.title ?? server.id;
  return new Error(`The ${title} sign-in expired; reconnect ${title}`);
}

/**
 * Scheduler-driven maintenance: ensure every configured server has a live
 * connection and a fresh tool inventory, keeping the connections OPEN for reuse
 * by `/chat`. Bounded concurrency avoids a connection burst; each refresh is
 * timeout-bounded and a failure leaves the last-known tools intact. Runs off the
 * request path — never blocks a user.
 */
/**
 * The worst-case duration of one {@link maintainMcpConnections} cycle, used as
 * the scheduled task's own timeout. Without this a server configured with a
 * generous `connectTimeoutMs` would still be cut short by a fixed task timeout —
 * the outer bound has to follow the inner one. Worst case per server is a
 * connect plus a listTools at its ceiling, and each worker drains
 * `ceil(servers / MAINTAIN_CONCURRENCY)` servers in series.
 */
export function maintenanceTimeoutMs(servers: McpServerConfig[]): number {
  if (servers.length === 0) {
    return MIN_MAINTENANCE_TIMEOUT_MS;
  }
  const slowest = Math.max(...servers.map(probeTimeoutMs));
  const perWorker = Math.ceil(
    servers.length / Math.min(MAINTAIN_CONCURRENCY, servers.length),
  );
  return Math.max(MIN_MAINTENANCE_TIMEOUT_MS, perWorker * 2 * slowest);
}

export async function maintainMcpConnections(
  servers: McpServerConfig[],
  logger: LoggerService,
): Promise<void> {
  // Per-user servers have no shared connection to keep: there is no token to
  // probe them with. Their idle user connections are closed instead.
  sweepUserPool();
  const queue = servers.filter(server => !server.userCredentials);
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      await refreshServer(next, logger);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(MAINTAIN_CONCURRENCY, queue.length) },
      worker,
    ),
  );
}

/**
 * Close every pooled connection — registered as a plugin shutdown hook. For
 * stdio servers this also terminates the spawned child process.
 */
export async function closeMcpPool(): Promise<void> {
  await Promise.all([
    ...[...pool.values()].map(e => e.client?.close().catch(() => {})),
    ...[...userPool.values()].map(c => c.client.close().catch(() => {})),
  ]);
  pool.clear();
  userPool.clear();
  warnedServers.clear();
}

/**
 * Browser-safe tool summaries (namespaced name + description + source) for a
 * server's raw tools, filtered by the assistant's per-tool allowlist.
 */
export function summarizeMcpTools(
  serverId: string,
  raw: RawMcpTool[],
  allowlist: string[],
): ToolSummary[] {
  return raw
    .filter(t => isToolAllowed(allowlist, t.name))
    .map(t => ({
      name: mcpToolName(serverId, t.name),
      description: t.description,
      source: serverId,
    }));
}

// --- /chat: tools from the pooled connections -------------------------------

/** What happened to a guarded MCP tool call, for the audit record. */
export interface McpToolCallEvent {
  server: string;
  /** The un-namespaced tool name. */
  tool: string;
  /** The namespaced name the model sees. */
  name: string;
  outcome: 'executed' | 'failed' | 'rejected-by-rule';
  input: unknown;
}

/** The signed-in user and their tokens for per-user servers. */
export interface McpCaller {
  userEntityRef: string;
  /** Token per per-user server id, as the browser sent them. */
  credentials: Record<string, string>;
  /**
   * The user's backend-held token for a server that runs its own OAuth;
   * refreshed when due, or when `rejected` is the token the server refused.
   */
  oauthToken?: (
    server: McpServerConfig,
    options?: { rejected?: string },
  ) => Promise<string | undefined>;
}

/** The turn a tool call belongs to, for a server's questions (elicitation). */
export interface McpTurn {
  assistantId: string;
  threadId?: string;
  /** The browser renders question forms (it said so on the request). */
  renders: boolean;
  /**
   * Filled in as questions settle: the last question's status per tool call
   * id, which the router stamps on the persisted reply so the call's row
   * shows a declined, cancelled, or expired question after a reload.
   */
  elicitations?: Record<string, ElicitationStatus>;
}

/**
 * Run a call whose server may ask the user for input. The call is an async
 * generator: each question (and its outcome) is yielded as a preliminary
 * tool output `{ _elicitation }`, which streams to the browser but never to
 * the model; the call's result is yielded last, as the final output.
 */
async function* runAskingUser(
  server: McpServerConfig,
  toolName: string,
  caller: McpCaller,
  turn: McpTurn | undefined,
  executeOptions:
    | { abortSignal?: AbortSignal; toolCallId?: string }
    | undefined,
  run: (call: ElicitationCall) => Promise<unknown>,
): AsyncGenerator<unknown> {
  const shown: ElicitationPrompt[] = [];
  // Settled by the call; `wake` resumes the loop below.
  const state: {
    wake?: () => void;
    done: boolean;
    result?: unknown;
    failure?: unknown;
  } = { done: false };
  const call: ElicitationCall = {
    userEntityRef: caller.userEntityRef,
    assistantId: turn?.assistantId ?? '',
    ...(turn?.threadId ? { threadId: turn.threadId } : {}),
    server,
    tool: toolName,
    renders: turn?.renders ?? false,
    ...(executeOptions?.abortSignal
      ? { signal: executeOptions.abortSignal }
      : {}),
    show: prompt => {
      if (prompt.status !== 'open' && executeOptions?.toolCallId) {
        if (turn?.elicitations) {
          turn.elicitations[executeOptions.toolCallId] = prompt.status;
        }
      }
      shown.push(prompt);
      state.wake?.();
    },
    asked: 0,
  };
  run(call).then(
    value => {
      state.result = value;
      state.done = true;
      state.wake?.();
    },
    error => {
      state.failure = error;
      state.done = true;
      state.wake?.();
    },
  );
  for (;;) {
    while (shown.length > 0) yield { _elicitation: shown.shift() };
    if (state.done) break;
    await new Promise<void>(resolve => {
      state.wake = resolve;
    });
    state.wake = undefined;
  }
  if (state.failure) throw state.failure;
  yield state.result;
}

/** A selected per-user server that offers no tools this turn, and why. */
export interface UnavailableMcpServer {
  server: McpServerConfig;
  /** Set when connecting failed; absent when the user sent no token. */
  error?: string;
}

/**
 * A client for a server: the pooled shared client, or the caller's own
 * connection for a per-user server (reconnecting if it was closed meanwhile).
 */
async function clientFor(
  server: McpServerConfig,
  caller: McpCaller | undefined,
  logger: LoggerService,
): Promise<{ client?: MCPClient; token?: string }> {
  if (!server.userCredentials) return { client: pool.get(server.id)?.client };
  const token = caller && (await callerToken(server, caller));
  if (!caller || !token) return {};
  const connected = await connectAs(server, caller, token, logger);
  return { client: connected.conn.client, token: connected.token };
}

/** A timeout whose clock stops between `pause()` and `resume()`. */
export function pausableTimeout(ms: number) {
  const controller = new AbortController();
  let remaining = ms;
  let started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const start = () => {
    started = Date.now();
    timer = setTimeout(
      () =>
        controller.abort(
          new DOMException(`Tool call timed out after ${ms}ms`, 'TimeoutError'),
        ),
      Math.max(0, remaining),
    );
  };
  start();
  return {
    signal: controller.signal,
    pause() {
      if (!timer) return;
      clearTimeout(timer);
      timer = undefined;
      remaining -= Date.now() - started;
    },
    resume() {
      if (timer || controller.signal.aborted) return;
      start();
    },
    clear() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

/**
 * Run one MCP tool call, bounded by the turn's abort and the call ceiling.
 * Returns the result's content, or `{ _error, message }` for an error result
 * or a throw, with the server's message so the model can explain it (a 401 or
 * 403 from a per-user server says the user lacks access).
 */
async function callMcpTool(
  client: MCPClient,
  server: McpServerConfig,
  name: string,
  input: unknown,
  logger: LoggerService,
  toolResultMaxChars: number,
  abortSignal?: AbortSignal,
  ceiling: AbortSignal = AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS),
): Promise<{ ok: boolean; value: unknown }> {
  try {
    // Bounded: the turn's abort (Stop) cancels an in-flight call, and a hung
    // server can't hold the turn past the call ceiling.
    const signal = abortSignal
      ? AbortSignal.any([abortSignal, ceiling])
      : ceiling;
    const result = await client.callTool({
      name,
      arguments: (input ?? {}) as Record<string, unknown>,
      options: { signal },
    });
    if (result.isError) {
      const detail =
        typeof result.content === 'string'
          ? result.content
          : JSON.stringify(result.content);
      logger.warn(`MCP tool '${server.id}/${name}' returned error: ${detail}`);
      return {
        ok: false,
        value: {
          _error: true,
          message: truncateToolResult(detail, toolResultMaxChars),
        },
      };
    }
    return {
      ok: true,
      value: truncateToolResult(
        result.structuredContent ?? result.content,
        toolResultMaxChars,
      ),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`MCP tool '${server.id}/${name}' threw: ${message}`);
    // Cap the message too — a tool error can embed an upstream body large
    // enough to overflow the context window.
    return {
      ok: false,
      value: {
        _error: true,
        message: truncateToolResult(message, toolResultMaxChars),
      },
    };
  }
}

/**
 * Build the AI-SDK tool set for a turn. Shared servers' tools come from the
 * pooled, scheduler-maintained connections — no per-turn connect or
 * listTools; each `execute` re-reads the pooled client at call time so a
 * scheduler reconnect is picked up, and a server with no live connection
 * yields a graceful "not connected" error until the next maintenance cycle.
 *
 * A per-user server's tools come from the caller's own connection, opened
 * with the token their browser sent (reused while the token is unchanged).
 * Without a token, or when connecting fails, the server offers no tools and
 * is returned in `unavailable`, so the turn can tell the model why.
 *
 * Every call is checked against the server's argument rules before it runs;
 * a broken rule returns the reason to the model instead of calling the tool.
 * `onCall` hears each executed, failed, or rule-rejected call.
 */
export async function buildMcpTools(
  selections: ResolvedMcpSelection[],
  logger: LoggerService,
  toolResultMaxChars: number,
  options: {
    caller?: McpCaller;
    onCall?: (event: McpToolCallEvent) => void;
    /** The turn, for questions a server asks mid-call (elicitation). */
    turn?: McpTurn;
  } = {},
): Promise<{
  tools: Record<string, Tool>;
  unavailable: UnavailableMcpServer[];
}> {
  const { caller, onCall, turn } = options;
  const broker = elicitationBroker;
  const tools: Record<string, Tool> = {};
  const unavailable: UnavailableMcpServer[] = [];

  for (const { server, tools: allowlist } of selections) {
    let listed: RawMcpTool[];
    if (server.userCredentials) {
      const token = caller && (await callerToken(server, caller));
      if (!caller || !token) {
        unavailable.push({ server });
        continue;
      }
      try {
        listed = (await connectAs(server, caller, token, logger)).conn.tools;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
          `MCP server '${server.id}' connect failed for ${caller.userEntityRef}: ${message}`,
        );
        unavailable.push({ server, error: message });
        continue;
      }
    } else {
      const entry = pool.get(server.id);
      if (!entry) {
        // Not connected yet — its tools fill in on the next maintenance cycle.
        continue;
      }
      listed = entry.tools;
    }

    for (const t of listed) {
      if (!isToolAllowed(allowlist, t.name)) {
        continue;
      }
      const name = mcpToolName(server.id, t.name);
      const rules = server.argumentRules?.[t.name];
      // One call: rule check, client, the call (tracked on its client while
      // it runs, so a question the server asks finds it), and the OAuth retry.
      const run = async (
        input: unknown,
        executeOptions:
          | { abortSignal?: AbortSignal; toolCallId?: string }
          | undefined,
        call?: ElicitationCall,
      ): Promise<unknown> => {
        const callOn = (c: MCPClient) => {
          // The ceiling stops counting while the user answers a question;
          // the question has its own timeout.
          const ceiling = pausableTimeout(TOOL_CALL_TIMEOUT_MS);
          if (call) {
            call.onWait = waiting =>
              waiting ? ceiling.pause() : ceiling.resume();
          }
          const release = call && broker?.track(c, call);
          return callMcpTool(
            c,
            server,
            t.name,
            input,
            logger,
            toolResultMaxChars,
            executeOptions?.abortSignal,
            ceiling.signal,
          ).finally(() => {
            ceiling.clear();
            release?.();
          });
        };
        const violation = argumentRuleViolation(t.name, rules, input);
        if (violation) {
          onCall?.({
            server: server.id,
            tool: t.name,
            name,
            outcome: 'rejected-by-rule',
            input,
          });
          return { _error: true, message: violation };
        }
        let client: MCPClient | undefined;
        let token: string | undefined;
        try {
          ({ client, token } = await clientFor(server, caller, logger));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          onCall?.({
            server: server.id,
            tool: t.name,
            name,
            outcome: 'failed',
            input,
          });
          return {
            _error: true,
            message: truncateToolResult(
              `MCP server '${server.id}' could not be reached: ${message}`,
              toolResultMaxChars,
            ),
          };
        }
        if (!client) {
          logger.warn(
            `MCP server '${server.id}' not connected; '${t.name}' skipped this turn`,
          );
          return {
            _error: true,
            message: truncateToolResult(
              `MCP server '${server.id}' is not currently connected — try again shortly.`,
              toolResultMaxChars,
            ),
          };
        }
        let { ok, value } = await callOn(client);
        // A backend-held OAuth token the server refused mid-turn: refresh
        // it once and retry the call on a connection with the new token.
        // A 401 comes before the server acts, so the retry can't repeat it.
        if (
          !ok &&
          caller &&
          token &&
          isOAuthServer(server) &&
          isUnauthorized((value as { message?: unknown })?.message)
        ) {
          const fresh = await callerToken(server, caller, token);
          if (!fresh) {
            value = { _error: true, message: signInExpired(server).message };
          } else {
            try {
              const retry = await userConnection(
                server,
                caller.userEntityRef,
                fresh,
                logger,
              );
              ({ ok, value } = await callOn(retry.client));
            } catch (error) {
              value = {
                _error: true,
                message: truncateToolResult(
                  `MCP server '${server.id}' could not be reached: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                  toolResultMaxChars,
                ),
              };
            }
          }
        }
        onCall?.({
          server: server.id,
          tool: t.name,
          name,
          outcome: ok ? 'executed' : 'failed',
          input,
        });
        return value;
      };
      tools[name] = tool({
        description: t.description,
        inputSchema: jsonSchema(
          (t.inputSchema ?? {}) as Parameters<typeof jsonSchema>[0],
        ),
        execute:
          server.elicitation && broker && caller
            ? (input, executeOptions) =>
                runAskingUser(
                  server,
                  t.name,
                  caller,
                  turn,
                  executeOptions,
                  call => run(input, executeOptions, call),
                )
            : (input, executeOptions) => run(input, executeOptions),
      });
    }
  }
  return { tools, unavailable };
}

/**
 * Call one of a server's tools outside a turn, as `caller` for a per-user
 * server: the approval preview's read of the current content. Returns the
 * raw MCP result, or throws when there is no client.
 */
export async function callServerTool(
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
  caller: McpCaller | undefined,
  logger: LoggerService,
): Promise<{ isError: boolean; content: unknown }> {
  const { client } = await clientFor(server, caller, logger);
  if (!client) {
    throw new Error(
      server.userCredentials
        ? `Connect ${server.userCredentials.title} to read from '${server.id}'`
        : `MCP server '${server.id}' is not currently connected`,
    );
  }
  const result = await client.callTool({
    name: toolName,
    arguments: args,
    options: { signal: AbortSignal.timeout(probeTimeoutMs(server)) },
  });
  return { isError: !!result.isError, content: result.content };
}
