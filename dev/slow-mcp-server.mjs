#!/usr/bin/env node
/*
 * Fake MCP stdio server for LOCAL TESTING of resumable streaming + notifications.
 *
 * Exposes several "search" tools that each sleep FAKE_MCP_DELAY_MS before
 * returning, so a single "search every tool you have for X" prompt produces a
 * long, multi-tool-call turn — a wide window to navigate away mid-stream, switch
 * tabs, or hard-refresh and watch the stream resume.
 *
 * Pure Node, zero dependencies (so `node slow-mcp-server.mjs` works regardless of
 * the yarn linker). Protocol: JSON-RPC 2.0 over newline-delimited stdio, the MCP
 * stdio transport the backend's StdioClientTransport speaks. stdout is reserved
 * for protocol frames; all logging goes to stderr.
 *
 * Env knobs:
 *   FAKE_MCP_DELAY_MS  per tool-call delay in ms (default 6000)
 *   FAKE_MCP_ROWS      fake result rows per call (default 5)
 *   FAKE_MCP_RESULT_KB pad each result to ~N KB (default 0 = off; use to also
 *                      exercise tool-result truncation / toolResultMaxChars)
 */
import { createInterface } from 'node:readline';

const DELAY_MS = Number(process.env.FAKE_MCP_DELAY_MS ?? 6000);
const ROWS = Number(process.env.FAKE_MCP_ROWS ?? 5);
const RESULT_KB = Number(process.env.FAKE_MCP_RESULT_KB ?? 0);
// Max tool calls running at once. Default 1 (serial): a model that fires all its
// tool calls in ONE parallel step still yields a long, staggered turn
// (N tools x delay) — ideal for watching resumable streaming. Set >1 for partial
// parallelism, or 0 for unlimited (realistic full parallel).
const CONCURRENCY = Number(process.env.FAKE_MCP_CONCURRENCY ?? 1);

const log = (...a) => process.stderr.write(`[slow-mcp] ${a.join(' ')}\n`);
const send = msg => process.stdout.write(`${JSON.stringify(msg)}\n`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Tiny concurrency limiter so tool calls run serially (or up to CONCURRENCY).
let active = 0;
const queue = [];
function pump() {
  while ((CONCURRENCY <= 0 || active < CONCURRENCY) && queue.length) {
    const job = queue.shift();
    active++;
    job().finally(() => {
      active--;
      pump();
    });
  }
}
const schedule = job =>
  new Promise((resolve, reject) => {
    queue.push(() => job().then(resolve, reject));
    pump();
  });

const TOOLS = [
  [
    'search_jira_issues',
    'Search Jira for issues, epics and stories matching a query.',
  ],
  [
    'search_confluence_docs',
    'Search Confluence spaces and pages for documentation.',
  ],
  ['search_github_code', 'Search code across GitHub repositories.'],
  ['search_slack_messages', 'Search Slack channels and threads for messages.'],
  ['query_datadog_metrics', 'Query Datadog metrics, monitors and dashboards.'],
  ['search_pagerduty_incidents', 'Search PagerDuty for incidents and alerts.'],
  [
    'search_snowflake_tables',
    'Search Snowflake databases for tables and columns.',
  ],
  [
    'lookup_servicenow_tickets',
    'Look up ServiceNow change and incident tickets.',
  ],
].map(([name, description]) => ({
  name,
  description,
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'The search query.' } },
    required: ['query'],
  },
}));

function fakeResult(name, query) {
  const prefix = name
    .replace(/[^a-z]/gi, '')
    .slice(0, 3)
    .toUpperCase();
  const rows = [];
  for (let i = 1; i <= ROWS; i++) {
    rows.push(
      `${i}. [${name}] hit for "${query}" — id=${prefix}-${1000 + i}, ` +
        `status=${['open', 'in-progress', 'resolved'][i % 3]}, owner=team-${
          (i % 4) + 1
        }`,
    );
  }
  let text = `${name} returned ${ROWS} result(s) for "${query}" after ${DELAY_MS}ms:\n${rows.join(
    '\n',
  )}`;
  if (RESULT_KB > 0) {
    text += `\n\n--- padding (${RESULT_KB}KB) ---\n${'x'.repeat(
      RESULT_KB * 1024,
    )}`;
  }
  return text;
}

async function handle(msg) {
  const { id, method, params } = msg;
  // Notifications (no id, e.g. notifications/initialized) need no response.
  if (id === undefined || id === null) return;

  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'slow-tools', version: '1.0.0' },
        },
      });
      return;
    case 'ping':
      send({ jsonrpc: '2.0', id, result: {} });
      return;
    case 'tools/list':
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      return;
    case 'tools/call': {
      const name = params?.name;
      const query = params?.arguments?.query ?? '';
      if (!TOOLS.some(t => t.name === name)) {
        send({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: `Unknown tool: ${name}` },
        });
        return;
      }
      log(`tools/call ${name} q="${query}" — queued`);
      await schedule(async () => {
        log(
          `tools/call ${name} — running (active=${active}/${
            CONCURRENCY || '∞'
          }), sleeping ${DELAY_MS}ms`,
        );
        await sleep(DELAY_MS);
      });
      log(`tools/call ${name} — responding`);
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: fakeResult(name, query) }],
          isError: false,
        },
      });
      return;
    }
    default:
      send({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', line => {
  const t = line.trim();
  if (!t) return;
  let msg;
  try {
    msg = JSON.parse(t);
  } catch {
    log(`bad json: ${t.slice(0, 120)}`);
    return;
  }
  // Don't await — handle concurrently so parallel tool calls overlap.
  Promise.resolve(handle(msg)).catch(e =>
    log(`handler error: ${e?.message ?? String(e)}`),
  );
});
rl.on('close', () => process.exit(0));
log(
  `ready — ${TOOLS.length} tools, delay ${DELAY_MS}ms, concurrency ${
    CONCURRENCY || '∞'
  }, rows ${ROWS}, pad ${RESULT_KB}KB`,
);
