import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  McpOAuthConnection,
  StatusResponse,
} from '@drewswiredin/backstage-plugin-assistants-common';
import type { AssistantsApi } from '../../api/AssistantsApi';
import { ToolGuardsProvider } from '../toolGuards';
import { ConnectChips } from './ConnectChips';

jest.mock('@backstage/core-plugin-api', () => ({
  ...jest.requireActual('@backstage/core-plugin-api'),
  useApiHolder: () => ({ get: () => ({ post: jest.fn() }) }),
}));

const status = {
  assistants: [
    {
      id: 'ops',
      title: 'Ops',
      userCredentials: [
        { server: 'tracker', provider: 'oauth', title: 'Tracker' },
      ],
    },
  ],
} as unknown as StatusResponse;

function renderChips(connections: McpOAuthConnection[]) {
  const getMcpOAuthStatus = jest.fn(async () => ({
    tracker: connections.shift() ?? 'missing',
  }));
  const disconnectMcpOAuth = jest.fn(async () => {});
  const api = {
    getMcpOAuthStatus,
    disconnectMcpOAuth,
  } as unknown as AssistantsApi;
  render(
    <ToolGuardsProvider status={status} api={api}>
      <ConnectChips assistantId="ops" />
    </ToolGuardsProvider>,
  );
  return { getMcpOAuthStatus, disconnectMcpOAuth };
}

describe('ConnectChips for a server that runs its own OAuth', () => {
  it('offers Connect until the backend reports a sign-in', async () => {
    renderChips(['missing']);
    expect(await screen.findByText('Connect Tracker')).toBeTruthy();
  });

  it('offers Reconnect for an expired sign-in', async () => {
    renderChips(['expired']);
    expect(await screen.findByText('Reconnect Tracker')).toBeTruthy();
  });

  it('shows a connected server, and disconnects it', async () => {
    const { disconnectMcpOAuth, getMcpOAuthStatus } = renderChips([
      'connected',
      'missing',
    ]);
    const chip = await screen.findByText('Tracker');
    expect(screen.queryByText('Connect Tracker')).toBeNull();
    fireEvent.click(chip.parentElement!.querySelector('.MuiChip-deleteIcon')!);
    await waitFor(() =>
      expect(disconnectMcpOAuth).toHaveBeenCalledWith('tracker'),
    );
    expect(await screen.findByText('Connect Tracker')).toBeTruthy();
    expect(getMcpOAuthStatus).toHaveBeenCalledTimes(2);
  });
});
