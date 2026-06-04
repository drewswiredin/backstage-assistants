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
 * Auth is a single static credential per server (the configured `headers`) —
 * one shared identity for all users, NOT run-as-user. Access is gated by the
 * assistant's `access` policy and per-profile `mcpServers` allowlist.
 */

const NAME_SEPARATOR = '__';

/**
 * Namespace a server's tool name so tools from different servers (and Backstage
 * actions) never collide, and so `/status` listing and `/chat` execution agree
 * on the name the model sees.
 */
export function mcpToolName(serverId: string, toolName: string): string {
  return `${serverId.replace(/[^a-zA-Z0-9_-]/g, '_')}${NAME_SEPARATOR}${toolName}`;
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

// --- /status: cached tool listings -----------------------------------------
// Connecting to every MCP server on every /status call would be slow, so the
// browser-safe tool listing is cached per server with a short TTL.
interface CacheEntry {
  fetchedAt: number;
  tools: ToolSummary[];
}
const listCache = new Map<string, CacheEntry>();
const LIST_TTL_MS = 5 * 60 * 1000;

/**
 * Browser-safe tool summaries (namespaced name + description) for one MCP
 * server, cached. On failure, returns the last cached value (or empty) so
 * `/status` never breaks because a server is down.
 */
export async function listMcpTools(
  server: McpServerConfig,
  logger: LoggerService,
): Promise<ToolSummary[]> {
  const cached = listCache.get(server.id);
  if (cached && Date.now() - cached.fetchedAt < LIST_TTL_MS) {
    return cached.tools;
  }
  try {
    const client = await connect(server);
    try {
      const { tools } = await client.listTools();
      const summaries: ToolSummary[] = tools.map(t => ({
        name: mcpToolName(server.id, t.name),
        description: t.description,
      }));
      listCache.set(server.id, { fetchedAt: Date.now(), tools: summaries });
      return summaries;
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
 * Connect to the given MCP servers and adapt their tools to AI SDK tools. A
 * server that fails to connect/list is logged and skipped (its tools are simply
 * absent) so one bad server can't break the turn.
 */
export async function buildMcpTools(
  servers: McpServerConfig[],
  logger: LoggerService,
): Promise<LiveMcpTools> {
  const clients: Client[] = [];
  const tools: Record<string, Tool> = {};

  for (const server of servers) {
    try {
      const client = await connect(server);
      clients.push(client);
      const { tools: mcpTools } = await client.listTools();
      for (const t of mcpTools) {
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
              // Prefer structured output; fall back to the content blocks.
              return result.structuredContent ?? result.content;
            } catch (error) {
              // Structured error, not a throw — the model can react and the
              // multi-step loop continues (matches actionsToTools).
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
