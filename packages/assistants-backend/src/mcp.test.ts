import type { McpServerConfig } from './config';
import { splitAllowedTools } from './mcp';

const servers = new Map<string, McpServerConfig>([
  ['github', { id: 'github', transport: 'http', url: 'http://x' }],
]);

describe('splitAllowedTools', () => {
  it('separates action ids, MCP selections, and client tool names', () => {
    const split = splitAllowedTools(
      [
        'search-catalog',
        'github__list_issues',
        'kubernetes__get_workload_status',
        'azure-devops__get_recent_builds',
      ],
      servers,
    );
    expect(split.actionIds).toEqual(['search-catalog']);
    expect(split.mcpSelections).toEqual([
      { server: servers.get('github'), tools: ['list_issues'] },
    ]);
    expect(split.clientToolNames).toEqual([
      'kubernetes__get_workload_status',
      'azure-devops__get_recent_builds',
    ]);
  });

  it('keeps a namespaced entry outside the client-tool shape as an action id', () => {
    const split = splitAllowedTools(['Weird__Name', 'x__'], servers);
    expect(split.actionIds).toEqual(['Weird__Name', 'x__']);
    expect(split.clientToolNames).toEqual([]);
  });
});
