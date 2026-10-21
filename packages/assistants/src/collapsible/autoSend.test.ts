import { shouldSendAutomatically } from './autoSend';

const isClientTool = (name: string) =>
  ['render_form', 'download_file', 'demo__read'].includes(name);

const assistant = (parts: Array<Record<string, unknown>>) => [
  { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
  { role: 'assistant', parts },
];

describe('shouldSendAutomatically', () => {
  it('sends once a client tool in the latest step has its output', () => {
    expect(
      shouldSendAutomatically(
        assistant([
          { type: 'step-start' },
          { type: 'tool-demo__read', state: 'output-available', output: {} },
        ]),
        isClientTool,
      ),
    ).toBe(true);
  });

  it('waits while any tool in the step is unsettled', () => {
    expect(
      shouldSendAutomatically(
        assistant([
          { type: 'tool-demo__read', state: 'output-available', output: {} },
          { type: 'tool-render_form', state: 'input-available' },
        ]),
        isClientTool,
      ),
    ).toBe(false);
    expect(
      shouldSendAutomatically(
        assistant([
          { type: 'tool-search-catalog', state: 'approval-requested' },
        ]),
        isClientTool,
      ),
    ).toBe(false);
  });

  it('never resumes a server tool settled on its own, so maxSteps holds', () => {
    expect(
      shouldSendAutomatically(
        assistant([
          {
            type: 'tool-search-catalog',
            state: 'output-available',
            output: {},
          },
        ]),
        isClientTool,
      ),
    ).toBe(false);
  });

  it('sends after an answered approval', () => {
    expect(
      shouldSendAutomatically(
        assistant([
          { type: 'tool-search-catalog', state: 'approval-responded' },
        ]),
        isClientTool,
      ),
    ).toBe(true);
  });

  it('does not resume a turn the user stopped mid-tool', () => {
    expect(
      shouldSendAutomatically(
        assistant([
          {
            type: 'tool-demo__read',
            state: 'output-available',
            output: { _error: true, code: 'aborted', message: 'stopped' },
          },
        ]),
        isClientTool,
      ),
    ).toBe(false);
  });

  it('looks only at the latest step', () => {
    expect(
      shouldSendAutomatically(
        assistant([
          { type: 'step-start' },
          { type: 'tool-demo__read', state: 'output-available', output: {} },
          { type: 'step-start' },
          { type: 'text', text: 'done' },
        ]),
        isClientTool,
      ),
    ).toBe(false);
  });

  it('ignores non-assistant last messages', () => {
    expect(
      shouldSendAutomatically(
        [{ role: 'user', parts: [{ type: 'text' }] }],
        isClientTool,
      ),
    ).toBe(false);
  });
});
