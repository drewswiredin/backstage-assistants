import type { McpServerConfig } from './config';
import { readUserCredentials, userCredentialSpec } from './userCredentials';

const github: McpServerConfig = {
  id: 'github',
  transport: 'http',
  url: 'https://mcp.example.com/',
  userCredentials: {
    provider: 'github',
    host: 'github.com',
    title: 'GitHub',
    header: 'Authorization',
    scheme: 'Bearer',
  },
};
const servers = new Map<string, McpServerConfig>([
  ['github', github],
  ['docs', { id: 'docs', transport: 'http', url: 'http://docs' }],
]);
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64');

describe('readUserCredentials', () => {
  it("keeps per-user servers' tokens only", () => {
    expect(
      readUserCredentials(
        encode({ github: 'ghu_one', docs: 'x', unknown: 'y' }),
        servers,
      ),
    ).toEqual({ github: 'ghu_one' });
  });

  it('yields nothing for a missing or malformed header', () => {
    expect(readUserCredentials(undefined, servers)).toEqual({});
    expect(readUserCredentials('not base64 json', servers)).toEqual({});
    expect(readUserCredentials(encode(['ghu_one']), servers)).toEqual({});
    expect(readUserCredentials(encode({ github: 42 }), servers)).toEqual({});
  });
});

describe('userCredentialSpec', () => {
  it('carries the sign-in and nothing about the header', () => {
    expect(userCredentialSpec(github)).toEqual({
      server: 'github',
      provider: 'github',
      host: 'github.com',
      title: 'GitHub',
    });
    expect(userCredentialSpec(servers.get('docs')!)).toBeUndefined();
  });
});
