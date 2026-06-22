import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { jsonSchema, tool, type Tool } from 'ai';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { ToolSummary } from '@drewswiredin/backstage-plugin-assistants-common';
import type { McpServerConfig } from './config';
import { truncateToolResult } from './truncateToolResult';

/**
 * MCP (Model Context Protocol) integration. External MCP servers' tools are
 * adapted into AI SDK tools so assistants can call them — the same wrapping we
 * do for Backstage actions in {@link actionsToTools}.
 *
 * Auth is a single static credential per server (the configured headers / stdio
 * env) — one shared identity for all users, NOT run-as-user. Access is gated by
 * the assistant's `access` policy, its per-profile `mcpServers` allowlist, and an
 * optional per-server tool allowlist.
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

/** A resolved server connection + this assistant's optional per-tool allowlist. */
export interface ResolvedMcpSelection {
  server: McpServerConfig;
  /** undefined or `['*']` = all tools; `[]` = none; else exactly these. */
  tools?: string[];
}

/**
 * Namespace a server's tool name so tools from different servers (and Backstage
 * actions) never collide, and so `/status` listing and `/chat` execution agree
 * on the name the model sees.
 */
export function mcpToolName(serverId: string, toolName: string): string {
  return `${serverId.replace(/[^a-zA-Z0-9_-]/g, '_')}${NAME_SEPARATOR}${toolName}`;
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
 * Splits an assistant's unified `allowedTools` into bare Backstage action ids
 * and per-server MCP tool selections.
 *
 * An entry is treated as an MCP tool when it is `<serverId>__<tool>` and
 * `<serverId>` (in its {@link mcpToolName}-sanitized form) matches a configured
 * server in `servers`; the remainder is the bare tool name. Everything else —
 * including a namespaced entry whose server prefix is unknown — is returned as a
 * bare action id, so unknown entries are tolerated downstream (an unknown action
 * id is logged + skipped by {@link selectAssistantActions}; an unknown MCP tool
 * name is simply not connected).
 *
 * Returns the bare action-id list plus one {@link ResolvedMcpSelection} per
 * referenced server with its per-server tool allowlist assembled from the
 * matching entries (so only the named tools on each server are exposed).
 */
export function splitAllowedTools(
  allowedTools: string[],
  servers: Map<string, McpServerConfig>,
): { actionIds: string[]; mcpSelections: ResolvedMcpSelection[] } {
  // Map a sanitized server id back to its config + raw id, for prefix matching.
  const bySanitized = new Map<string, McpServerConfig>();
  for (const server of servers.values()) {
    bySanitized.set(sanitizeServerId(server.id), server);
  }

  const actionIds: string[] = [];
  // Preserve first-seen server order; collect each server's allowlisted tools.
  const selByServerId = new Map<string, { server: McpServerConfig; tools: string[] }>();

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
  };
}

/**
 * Per-tool allowlist semantics: `undefined` or `['*']` allow everything; `[]`
 * allows nothing; otherwise only the named (un-namespaced) tools.
 */
function isToolAllowed(allowlist: string[] | undefined, name: string): boolean {
  if (allowlist === undefined) return true;
  if (allowlist.includes('*')) return true;
  return allowlist.includes(name);
}

function createTransport(server: McpServerConfig) {
  // Local process transport.
  if (server.transport === 'stdio') {
    return new StdioClientTransport({
      command: server.command as string,
      args: server.args,
      // Merge configured env over the SDK's safe default env (PATH, etc.).
      env: server.env
        ? { ...getDefaultEnvironment(), ...server.env }
        : undefined,
      cwd: server.cwd,
    });
  }

  // Remote transports.
  const url = new URL(server.url as string);
  if (server.transport === 'websocket') {
    return new WebSocketClientTransport(url);
  }
  const requestInit =
    server.headers && Object.keys(server.headers).length > 0
      ? { headers: server.headers }
      : undefined;
  return server.transport === 'sse'
    ? new SSEClientTransport(url, { requestInit })
    : new StreamableHTTPClientTransport(url, { requestInit });
}

// --- MCP connection pool ----------------------------------------------------
// One PERSISTENT client per configured server, established and refreshed by the
// scheduler (maintainMcpConnections, wired in the plugin) — NOT per request.
// /status reads the cached tool inventory synchronously; /chat reuses the pooled
// clients for tool execution; /capabilities reads (and can force-refresh) the
// same pool. Connections are closed only on plugin shutdown (closeMcpPool).

/** A pooled server: its persistent client (when connected), last-known tool
 *  inventory (with input schemas, for /chat tool definitions), and reachability. */
interface PooledServer {
  client?: Client;
  tools: RawMcpTool[];
  reachable: boolean;
  error?: string;
  fetchedAt: number;
}
const pool = new Map<string, PooledServer>();

/** Per-connect/list ceiling so one slow/black-holed server can't stall a
 *  maintenance cycle near the MCP SDK's ~60s default request timeout. */
const PROBE_TIMEOUT_MS = 8_000;
/** Freshness window for an on-demand /capabilities read before it re-lists. */
const LIST_TTL_MS = 5 * 60 * 1000;
/** Max servers refreshed concurrently per maintenance cycle. */
const MAINTAIN_CONCURRENCY = 5;

/**
 * Reject after `ms` if `p` hasn't settled, so a probe can bound `connect` /
 * `listTools` (which otherwise inherit the SDK's ~60s default).
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
 * tools for drift tolerance. Bounded by PROBE_TIMEOUT_MS so a bad server can't
 * stall the maintenance cycle.
 */
async function refreshServer(
  server: McpServerConfig,
  logger: LoggerService,
): Promise<PooledServer> {
  const entry = poolEntry(server.id);
  // Declared outside the try so the catch can close a client whose connect timed
  // out (and never reached `entry.client`) — otherwise its transport / spawned
  // child process leaks on every cycle.
  let client = entry.client;
  try {
    if (!client) {
      client = new Client({
        name: 'backstage-plugin-assistants',
        version: '0.1.0',
      });
      await withTimeout(
        client.connect(createTransport(server)),
        PROBE_TIMEOUT_MS,
        `MCP '${server.id}' connect`,
      );
      entry.client = client;
    }
    const { tools } = await withTimeout(
      client.listTools(),
      PROBE_TIMEOUT_MS,
      `MCP '${server.id}' listTools`,
    );
    entry.tools = tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    entry.reachable = true;
    entry.error = undefined;
    entry.fetchedAt = Date.now();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`MCP server '${server.id}' tool listing failed: ${message}`);
    entry.reachable = false;
    entry.error = message;
    // Close the (possibly half-connected) client to release its connection /
    // child process, and drop it so the next cycle reconnects fresh. Keep the
    // last-known tools so /status + /chat tolerate a transient blip.
    if (client) {
      await client.close().catch(() => {});
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
  force = false,
): Promise<ServerToolProbe> {
  const cached = pool.get(server.id);
  if (
    !force &&
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

/**
 * Scheduler-driven maintenance: ensure every configured server has a live
 * connection and a fresh tool inventory, keeping the connections OPEN for reuse
 * by `/chat`. Bounded concurrency avoids a connection burst; each refresh is
 * timeout-bounded and a failure leaves the last-known tools intact. Runs off the
 * request path — never blocks a user.
 */
export async function maintainMcpConnections(
  servers: McpServerConfig[],
  logger: LoggerService,
): Promise<void> {
  const queue = [...servers];
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      await refreshServer(next, logger);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(MAINTAIN_CONCURRENCY, servers.length) },
      worker,
    ),
  );
}

/**
 * Close every pooled connection — registered as a plugin shutdown hook. For
 * stdio servers this also terminates the spawned child process.
 */
export async function closeMcpPool(): Promise<void> {
  await Promise.all(
    [...pool.values()].map(e => e.client?.close().catch(() => {})),
  );
  pool.clear();
}

/**
 * Browser-safe tool summaries (namespaced name + description + source) for a
 * server's raw tools, filtered by the assistant's per-tool allowlist.
 */
export function summarizeMcpTools(
  serverId: string,
  raw: RawMcpTool[],
  allowlist: string[] | undefined,
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

/**
 * Build the AI-SDK tool set for a turn from the POOLED connections — no per-turn
 * connect or listTools. Tool definitions come from the maintained cache (incl.
 * input schemas); each tool's `execute` calls through the persistent pooled
 * client, re-read at call time so a reconnect by the scheduler is picked up. A
 * server with no live connection yields a graceful "not connected" tool error
 * and is healed by the next maintenance cycle. Connections are NEVER opened or
 * closed here.
 */
export function buildMcpTools(
  selections: ResolvedMcpSelection[],
  logger: LoggerService,
  toolResultMaxChars: number,
): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  for (const { server, tools: allowlist } of selections) {
    const entry = pool.get(server.id);
    if (!entry) {
      // Not connected yet — its tools fill in on the next maintenance cycle.
      continue;
    }
    for (const t of entry.tools) {
      if (!isToolAllowed(allowlist, t.name)) {
        continue;
      }
      tools[mcpToolName(server.id, t.name)] = tool({
        description: t.description,
        inputSchema: jsonSchema(
          (t.inputSchema ?? {}) as Parameters<typeof jsonSchema>[0],
        ),
        execute: async input => {
          // Re-read the pooled client at call time so a scheduler reconnect is
          // picked up. No per-chat connect — a down server fails gracefully and
          // is healed by the next maintenance cycle.
          const client = pool.get(server.id)?.client;
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
          try {
            const result = await client.callTool({
              name: t.name,
              arguments: (input ?? {}) as Record<string, unknown>,
            });
            if (result.isError) {
              const detail =
                typeof result.content === 'string'
                  ? result.content
                  : JSON.stringify(result.content);
              logger.warn(
                `MCP tool '${server.id}/${t.name}' returned error: ${detail}`,
              );
              return {
                _error: true,
                message: truncateToolResult(detail, toolResultMaxChars),
              };
            }
            return truncateToolResult(
              result.structuredContent ?? result.content,
              toolResultMaxChars,
            );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            logger.error(`MCP tool '${server.id}/${t.name}' threw: ${message}`);
            // Cap the message too — a tool error can embed an upstream body
            // large enough to overflow the context window.
            return {
              _error: true,
              message: truncateToolResult(message, toolResultMaxChars),
            };
          }
        },
      });
    }
  }
  return tools;
}
