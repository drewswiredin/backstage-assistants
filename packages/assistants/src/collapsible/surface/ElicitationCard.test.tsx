import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ElicitationPrompt } from '@drewswiredin/backstage-plugin-assistants-common';
import { ElicitationCard } from './ElicitationCard';

const respondElicitation = jest.fn();
jest.mock('../toolGuards', () => ({
  useToolGuards: () => ({ respondElicitation }),
}));

const prompt = (
  overrides: Partial<ElicitationPrompt> = {},
): ElicitationPrompt => ({
  id: 'q1',
  server: 'ado',
  serverTitle: 'Azure DevOps',
  tool: 'wit_my_work_items',
  message: 'Select the project.',
  requestedSchema: {
    type: 'object',
    required: ['project'],
    properties: {
      project: {
        type: 'string',
        title: 'Project',
        oneOf: [
          { const: 'pylon', title: 'Pylon' },
          { const: 'tally', title: 'Tally' },
        ],
      },
      count: { type: 'integer', title: 'Count' },
    },
  },
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  status: 'open',
  ...overrides,
});

beforeEach(() => respondElicitation.mockReset().mockResolvedValue(undefined));

describe('ElicitationCard', () => {
  it('shows who asks, enables Submit once the answer fits, and sends it only on Submit', async () => {
    render(<ElicitationCard prompt={prompt()} />);
    expect(screen.getByText(/Azure DevOps needs input for/)).toBeTruthy();
    expect(screen.getByText('Select the project.')).toBeTruthy();

    const submit = () =>
      screen.getByText('Submit').closest('button') as HTMLButtonElement;
    expect(submit().disabled).toBe(true);
    fireEvent.click(submit());
    expect(respondElicitation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Pylon'));
    expect(submit().disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('Count'), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByText('Submit'));
    await waitFor(() =>
      expect(respondElicitation).toHaveBeenCalledWith('q1', {
        action: 'accept',
        content: { project: 'pylon', count: 4 },
      }),
    );
    expect(
      await screen.findByText('Answered — Project: Pylon · Count: 4'),
    ).toBeTruthy();
  });

  it('declines without content, and offers no Cancel', async () => {
    render(<ElicitationCard prompt={prompt()} />);
    expect(screen.queryByText('Cancel')).toBeNull();
    fireEvent.click(screen.getByText('Decline'));
    await waitFor(() =>
      expect(respondElicitation).toHaveBeenCalledWith('q1', {
        action: 'decline',
      }),
    );
    expect(await screen.findByText('Declined')).toBeTruthy();
  });

  it("doesn't name a tool when the server didn't say which call asked", () => {
    render(<ElicitationCard prompt={prompt({ tool: undefined })} />);
    expect(
      screen.getByText(/Azure DevOps needs input/).textContent?.trim(),
    ).toBe('Azure DevOps needs input');
  });

  it('warns about a field that looks like a secret', () => {
    render(
      <ElicitationCard
        prompt={prompt({
          requestedSchema: {
            type: 'object',
            properties: {
              pat: { type: 'string', title: 'Personal access token' },
            },
          },
        })}
      />,
    );
    expect(screen.getByText(/looks like a secret/)).toBeTruthy();
  });

  it('shows how a question ended, and treats an expired one as closed', () => {
    const { unmount } = render(
      <ElicitationCard
        prompt={prompt({ status: 'accepted', answered: ['project'] })}
      />,
    );
    expect(screen.getByText('Answered — project')).toBeTruthy();
    unmount();
    render(
      <ElicitationCard
        prompt={prompt({
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        })}
      />,
    );
    expect(screen.getByText('Expired')).toBeTruthy();
    expect(screen.queryByText('Submit')).toBeNull();
  });

  it('closes an open question once the turn has stopped', () => {
    render(<ElicitationCard prompt={prompt()} closed />);
    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(screen.queryByText('Submit')).toBeNull();
  });

  it("shows the server's objection and keeps the form", async () => {
    respondElicitation.mockRejectedValue(new Error('Count must be at least 1'));
    render(<ElicitationCard prompt={prompt()} />);
    fireEvent.click(screen.getByLabelText('Tally'));
    fireEvent.click(screen.getByText('Submit'));
    expect(await screen.findByText('Count must be at least 1')).toBeTruthy();
    expect(screen.getByText('Submit')).toBeTruthy();
  });
});
