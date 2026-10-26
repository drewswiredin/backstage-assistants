import { renderHook, waitFor } from '@testing-library/react';
import {
  useHeldClientTools,
  withHeldCalls,
  type HeldChatHelpers,
} from './heldCalls';

function chatWith(parts: object[], status = 'streaming') {
  return {
    status,
    messages: [{ role: 'assistant', parts }],
    addToolApprovalResponse: jest.fn(),
    addToolOutput: jest.fn(),
  } as HeldChatHelpers & {
    status: string;
    addToolApprovalResponse: jest.Mock;
    addToolOutput: jest.Mock;
  };
}

describe('withHeldCalls', () => {
  it('posts a held approval and still updates the message', () => {
    const answer = jest.fn(async () => {});
    const chat = chatWith([]);
    withHeldCalls(chat, answer).addToolApprovalResponse({
      id: 'held-1',
      approved: true,
      reason: 'always:register-entity',
    });
    expect(answer).toHaveBeenCalledWith('held-1', {
      approved: true,
      reason: 'always:register-entity',
    });
    expect(chat.addToolApprovalResponse).toHaveBeenCalled();
  });

  it('leaves an ordinary approval to the turn', () => {
    const answer = jest.fn(async () => {});
    const chat = chatWith([]);
    withHeldCalls(chat, answer).addToolApprovalResponse({
      id: 'aitxt-1',
      approved: false,
    });
    expect(answer).not.toHaveBeenCalled();
    expect(chat.addToolApprovalResponse).toHaveBeenCalled();
  });

  it('posts the output of a provider-executed call, and an error as an error', () => {
    const answer = jest.fn(async () => {});
    const chat = chatWith([
      { type: 'dynamic-tool', toolCallId: 'toolu_1', providerExecuted: true },
      { type: 'tool-render_form', toolCallId: 'call-2' },
    ]);
    const held = withHeldCalls(chat, answer);
    held.addToolOutput({
      tool: 'render_form',
      toolCallId: 'toolu_1',
      output: { submitted: true },
    });
    held.addToolOutput({
      tool: 'render_form',
      toolCallId: 'toolu_1',
      state: 'output-error',
      errorText: 'Dismissed',
    });
    held.addToolOutput({
      tool: 'render_form',
      toolCallId: 'call-2',
      output: 1,
    });
    expect(answer.mock.calls).toEqual([
      ['tool-toolu_1', { output: { submitted: true } }],
      ['tool-toolu_1', { error: 'Dismissed' }],
    ]);
    expect(chat.addToolOutput).toHaveBeenCalledTimes(3);
  });
});

describe('useHeldClientTools', () => {
  const held = {
    type: 'dynamic-tool',
    toolCallId: 'toolu_7',
    toolName: 'read_current_page',
    state: 'input-available',
    input: { find: 'error' },
    providerExecuted: true,
  };

  it('runs a held call once while the turn is live and answers it', async () => {
    const run = jest.fn(async (_input: unknown, _signal: AbortSignal) => ({
      outline: '# Page',
    }));
    const chat = chatWith([held]);
    const { rerender } = renderHook(() =>
      useHeldClientTools(chat, name =>
        name === 'read_current_page' ? run : undefined,
      ),
    );
    rerender();
    await waitFor(() => expect(chat.addToolOutput).toHaveBeenCalled());
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toEqual({ find: 'error' });
    expect(chat.addToolOutput).toHaveBeenCalledWith({
      tool: 'read_current_page',
      toolCallId: 'toolu_7',
      output: { outline: '# Page' },
    });
  });

  it('runs nothing once the turn is over, or for a tool with no runner', () => {
    const run = jest.fn(async () => ({}));
    renderHook(() => useHeldClientTools(chatWith([held], 'ready'), () => run));
    renderHook(() => useHeldClientTools(chatWith([held]), () => undefined));
    renderHook(() =>
      useHeldClientTools(
        chatWith([{ ...held, providerExecuted: false }]),
        () => run,
      ),
    );
    expect(run).not.toHaveBeenCalled();
  });
});
