import { render, screen } from '@testing-library/react';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import { ToolFallback } from './parts';

/** The message parts the approval card reads from the assistant-ui store. */
let parts: unknown[] = [];
jest.mock('@assistant-ui/react', () => ({
  useAuiState: (select: (s: unknown) => unknown) =>
    select({ message: { parts }, threadListItem: { custom: {} } }),
}));
jest.mock('../toolGuards', () => ({
  useToolGuards: () => ({
    approveEachCall: new Set(['github__create_or_update_file']),
    approvalPreviews: {},
    assistantForTool: () => undefined,
  }),
}));

const TOOL = 'github__create_or_update_file';
const call = (id: string, approval: Record<string, unknown>) => ({
  type: 'tool-call',
  toolName: TOOL,
  toolCallId: id,
  args: { branch: id },
  approval,
});

const props = (overrides: Record<string, unknown>) =>
  ({
    toolCallId: 'c2',
    toolName: TOOL,
    args: { branch: 'b' },
    status: { type: 'requires-action' },
    respondToApproval: jest.fn(),
    ...overrides,
  } as unknown as ToolCallMessagePartProps);

describe('ToolFallback approvals', () => {
  it('asks for a new call even when an earlier call of the tool was denied', () => {
    parts = [
      call('c1', { id: 'a1', approved: false, reason: 'rule' }),
      call('c2', { id: 'a2' }),
    ];
    const respondToApproval = jest.fn();
    render(
      <ToolFallback
        {...props({ approval: { id: 'a2' }, respondToApproval })}
      />,
    );
    expect(screen.getByText(/Approval required to run/)).toBeTruthy();
    expect(respondToApproval).not.toHaveBeenCalled();
    // Approved call by call: no standing grant offered.
    expect(screen.queryByText('Always allow')).toBeNull();
  });

  it("follows the batch leader's decision for calls waiting with it", () => {
    parts = [call('c1', { id: 'a1' }), call('c2', { id: 'a2' })];
    const respondToApproval = jest.fn();
    const { rerender } = render(
      <ToolFallback
        {...props({ approval: { id: 'a2' }, respondToApproval })}
      />,
    );
    parts = [
      call('c1', { id: 'a1', approved: true }),
      call('c2', { id: 'a2' }),
    ];
    rerender(
      <ToolFallback
        {...props({ approval: { id: 'a2' }, respondToApproval })}
      />,
    );
    expect(respondToApproval).toHaveBeenCalledWith({ approved: true });
  });

  it('shows a denied call as one row with the reason and no success mark', () => {
    parts = [];
    const { container } = render(
      <ToolFallback
        {...props({
          approval: {
            id: 'a1',
            approved: false,
            reason: "'branch' must match x",
          },
          status: { type: 'complete' },
          result: { type: 'execution-denied' },
        })}
      />,
    );
    const row = screen.getByRole('button');
    expect(row.textContent).toContain(
      `${TOOL}— Denied, not run: 'branch' must match x`,
    );
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });
});
