import { fireEvent, render, screen } from '@testing-library/react';
import type { CapabilitiesResponse } from '@drewswiredin/backstage-plugin-assistants-common';
import { ToolsTransfer } from './ToolsTransfer';

const tracker = {
  provider: 'oauth',
  title: 'Tracker',
  header: 'Authorization',
  scheme: 'Bearer',
  server: 'tracker',
};

const capabilities = {
  actions: [],
  models: [],
  requireApproval: [],
  mcpServers: [
    {
      id: 'tracker',
      reachable: false,
      error: 'Connect Tracker to list its tools',
      userCredentials: tracker,
      tools: [],
    },
  ],
} as unknown as CapabilitiesResponse;

describe('ToolsTransfer', () => {
  it('keeps a per-user server with no tools listed in the picker, with its Connect', () => {
    const onConnect = jest.fn();
    const onChange = jest.fn();
    render(
      <ToolsTransfer
        capabilities={capabilities}
        allowedTools={[]}
        onChange={onChange}
        onConnect={onConnect}
      />,
    );
    fireEvent.click(screen.getByText('Add tool'));
    const note = screen.getByText('Connect Tracker to list its tools');
    expect(note.closest('[aria-disabled="true"]')).toBeTruthy();
    fireEvent.click(note);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Connect Tracker' }));
    expect(onConnect).toHaveBeenCalledWith(tracker);
  });
});
