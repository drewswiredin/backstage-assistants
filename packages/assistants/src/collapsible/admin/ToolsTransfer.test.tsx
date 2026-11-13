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

describe('ToolsTransfer browser tools', () => {
  const noServers = {
    actions: [],
    models: [],
    requireApproval: [],
    mcpServers: [],
  } as unknown as CapabilitiesResponse;
  const tool = (name: string) => ({
    name,
    description: `${name} does a thing`,
    inputSchema: { type: 'object' as const, properties: {} },
    attributes: { readOnly: true },
  });

  it('groups browser tools by namespace and names the plugin that contributed them', () => {
    render(
      <ToolsTransfer
        capabilities={noServers}
        clientTools={[
          tool('kube-admin__scale'),
          tool('mongo__find'),
          tool('read_current_page'),
          tool('portal__navigate'),
        ]}
        pluginOf={name =>
          name.startsWith('mongo') ? 'mongodb-studio' : undefined
        }
        allowedTools={['kube-admin__scale', 'mongo__find']}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByText('kube-admin')).toBeTruthy();
    expect(screen.getByText('mongo')).toBeTruthy();
    expect(screen.getByText('scale')).toBeTruthy();
    expect(screen.getByText('find')).toBeTruthy();
    expect(screen.getByText(/from the mongodb-studio plugin/)).toBeTruthy();
    // One group per namespace, each labelled as browser tools.
    expect(screen.getAllByText(/Browser tools/)).toHaveLength(2);
  });

  it('flags a built-in saved in allowedTools, and a browser tool nothing registers', () => {
    render(
      <ToolsTransfer
        capabilities={noServers}
        clientTools={[tool('portal__navigate')]}
        allowedTools={['portal__navigate', 'mongo__find']}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByText('Built-in tools')).toBeTruthy();
    expect(
      screen.getByText('built in — every assistant already has it'),
    ).toBeTruthy();
    expect(screen.getByText('mongo')).toBeTruthy();
    expect(screen.getByText('browser tool — no longer available')).toBeTruthy();
  });

  it('keeps built-ins out of the picker', () => {
    render(
      <ToolsTransfer
        capabilities={noServers}
        clientTools={[tool('portal__navigate'), tool('mongo__find')]}
        allowedTools={[]}
        onChange={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Add tool'));
    expect(screen.getByText('find')).toBeTruthy();
    expect(screen.queryByText('navigate')).toBeNull();
    expect(screen.queryByText('portal__navigate')).toBeNull();
  });
});
