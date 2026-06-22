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

/** A server's raw (un-namespaced) tool, as returned by the MCP server. */
interface RawMcpTool {
  name: string;
  description?: string;
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

async function connect(server: McpServerConfig): Promise<Client> {
  const client = new Client({
    name: 'backstage-plugin-assistants',
    version: '0.1.0',
  });
  await client.connect(createTransport(server));
  return client;
}

// --- /status: cached RAW tool listings -------------------------------------
// Connecting to every MCP server on every /status call would be slow, so each
// server's full (unfiltered) tool list is cached briefly; the per-assistant
// allowlist is applied on top via summarizeMcpTools (allowlist-independent cache).
interface RawCacheEntry {
  fetchedAt: number;
  tools: RawMcpTool[];
}
const rawCache = new Map<string, RawCacheEntry>();
const LIST_TTL_MS = 5 * 60 * 1000;
/** Per-probe ceiling so one slow/black-holed server can't stall a probe (or a
 *  background warm cycle) near the MCP SDK's ~60s default request timeout. */
const PROBE_TIMEOUT_MS = 8_000;
/** Max concurrent server probes in a background warm cycle. */
const WARM_CONCURRENCY = 5;

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

/**
 * A server's reachability + tool inventory.
 *
 * Unlike {@link listServerToolsRaw}, a failure is REPORTED (`reachable: false`
 * with `error`) rather than swallowed — so the editor's `/capabilities` picker
 * can show why a server is unavailable instead of an indistinguishable empty
 * list. On a cache hit the server is reported reachable with the cached tools.
 */
export interface ServerToolProbe {
  reachable: boolean;
  error?: string;
  tools: RawMcpTool[];
}

/**
 * Connect to a server and list its tools, populating the shared TTL cache.
 * Captures the failure instead of swallowing it. A cache hit short-circuits and
 * is reported reachable.
 */
export async function probeServerTools(
  server: McpServerConfig,
  logger: LoggerService,
  force = false,
): Promise<ServerToolProbe> {
  const cached = rawCache.get(server.id);
  if (!force && cached && Date.now() - cached.fetchedAt < LIST_TTL_MS) {
    return { reachable: true, tools: cached.tools };
  }
  // Own the client so we can always close it — even when connect/list times out.
  const client = new Client({
    name: 'backstage-plugin-assistants',
    version: '0.1.0',
  });
  try {
    await withTimeout(
      client.connect(createTransport(server)),
      PROBE_TIMEOUT_MS,
      `MCP '${server.id}' connect`,
    );
    const { tools } = await withTimeout(
      client.listTools(),
      PROBE_TIMEOUT_MS,
      `MCP '${server.id}' listTools`,
    );
    const raw: RawMcpTool[] = tools.map(t => ({
      name: t.name,
      description: t.description,
    }));
    rawCache.set(server.id, { fetchedAt: Date.now(), tools: raw });
    return { reachable: true, tools: raw };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`MCP server '${server.id}' tool listing failed: ${message}`);
    // Report the failure (capabilities); still expose any stale tools we have.
    return { reachable: false, error: message, tools: cached?.tools ?? [] };
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * A server's full raw tool list, cached. On failure returns the last cached
 * value (or empty) so `/status` never breaks because a server is down. Thin
 * wrapper over {@link probeServerTools} that drops the reachability signal.
 */
export async function listServerToolsRaw(
  server: McpServerConfig,
  logger: LoggerService,
): Promise<RawMcpTool[]> {
  return (await probeServerTools(server, logger)).tools;
}

/**
 * Synchronous read of the warm cache: a server's cached tools, or `[]` if it
 * hasn't been warmed yet. NEVER connects — this is what `/status` uses so a
 * page load never blocks on a live MCP connection. The cache is kept fresh by
 * {@link warmServerToolsCache} (scheduled in the plugin); an unwarmed/unreachable
 * server simply yields `[]` until the next warm cycle fills it in.
 */
export function cachedServerToolsRaw(serverId: string): RawMcpTool[] {
  return rawCache.get(serverId)?.tools ?? [];
}

/**
 * Background warmer: force-refresh the tool cache for every given server so the
 * synchronous `/status` read ({@link cachedServerToolsRaw}) is always populated.
 * Bounded concurrency avoids a connection burst with many servers; each probe is
 * timeout-bounded, and a failure leaves the prior cached value intact (see
 * {@link probeServerTools}). Off the request path — never blocks a user.
 */
export async function warmServerToolsCache(
  servers: McpServerConfig[],
  logger: LoggerService,
): Promise<void> {
  const queue = [...servers];
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      await probeServerTools(next, logger, true);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(WARM_CONCURRENCY, servers.length) }, worker),
  );
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

// --- /chat: live tools ------------------------------------------------------

/**
 * Live MCP tools for a turn plus a `close()` to release the clients once the
 * stream (and its tool calls) finish.
 *
 * @public
 */
export interface LiveMcpTools {
  tools: Record<string, Tool>;
  close: () => Promise<void>;
}

/**
 * Connect to the given server selections and adapt their (allowlisted) tools to
 * AI SDK tools. A server that fails to connect/list is logged and skipped so one
 * bad server can't break the turn.
 */
export async function buildMcpTools(
  selections: ResolvedMcpSelection[],
  logger: LoggerService,
  toolResultMaxChars: number,
): Promise<LiveMcpTools> {
  const clients: Client[] = [];
  const tools: Record<string, Tool> = {};

  for (const { server, tools: allowlist } of selections) {
    try {
      const client = await connect(server);
      clients.push(client);
      const { tools: mcpTools } = await client.listTools();
      for (const t of mcpTools) {
        if (!isToolAllowed(allowlist, t.name)) {
          continue;
        }
        tools[mcpToolName(server.id, t.name)] = tool({
          description: t.description,
          inputSchema: jsonSchema(
            (t.inputSchema ?? {}) as Parameters<typeof jsonSchema>[0],
          ),
          execute: async input => {
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
              logger.error(
                `MCP tool '${server.id}/${t.name}' threw: ${message}`,
              );
              // Cap the message too — a tool error can embed an upstream body
              // large enough to overflow the context window (see Issue #2).
              return {
                _error: true,
                message: truncateToolResult(message, toolResultMaxChars),
              };
            }
          },
        });
      }
    } catch (error) {
      logger.warn(
        `MCP server '${server.id}' connect/list failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return {
    tools,
    close: async () => {
      await Promise.all(clients.map(c => c.close().catch(() => {})));
    },
  };
}
