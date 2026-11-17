import {
  credentialsRequestOf,
  openCredentialsRequests,
} from './credentialRequests';

const request = (id: string, status: 'open' | 'settled' = 'open') => ({
  type: 'dynamic-tool',
  output: { _credentialsRequest: { id, server: 'github', status } },
});

describe('credentialsRequestOf', () => {
  it('reads a request from a tool output, and nothing from a result', () => {
    expect(credentialsRequestOf(request('r1').output)).toEqual({
      id: 'r1',
      server: 'github',
      status: 'open',
    });
    expect(
      credentialsRequestOf([{ type: 'text', text: 'ok' }]),
    ).toBeUndefined();
    expect(credentialsRequestOf(undefined)).toBeUndefined();
  });
});

describe('openCredentialsRequests', () => {
  it('finds the open requests of the last assistant message', () => {
    const messages = [
      { role: 'assistant', parts: [request('old')] },
      { role: 'user', parts: [] },
      {
        role: 'assistant',
        parts: [
          { type: 'text' },
          request('a'),
          request('b', 'settled'),
          { type: 'dynamic-tool', output: [{ type: 'text', text: 'ok' }] },
        ],
      },
    ];
    expect(openCredentialsRequests(messages).map(r => r.id)).toEqual(['a']);
    expect(openCredentialsRequests(messages.slice(0, 2))).toEqual([]);
  });
});
