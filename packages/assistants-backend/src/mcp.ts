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

/**
 * A server's full raw tool list, cached. On failure returns the last cached
 * value (or empty) so `/status` never breaks because a server is down.
 */
export async function listServerToolsRaw(
  server: McpServerConfig,
  logger: LoggerService,
): Promise<RawMcpTool[]> {
  const cached = rawCache.get(server.id);
  if (cached && Date.now() - cached.fetchedAt < LIST_TTL_MS) {
    return cached.tools;
  }
  try {
    const client = await connect(server);
    try {
      const { tools } = await client.listTools();
      const raw: RawMcpTool[] = tools.map(t => ({
        name: t.name,
        description: t.description,
      }));
      rawCache.set(server.id, { fetchedAt: Date.now(), tools: raw });
      return raw;
    } finally {
      await client.close();
    }
  } catch (error) {
    logger.warn(
      `MCP server '${server.id}' tool listing failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return cached?.tools ?? [];
  }
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
              return result.structuredContent ?? result.content;
            } catch (error) {
              return {
                error: true,
                message:
                  error instanceof Error ? error.message : String(error),
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
