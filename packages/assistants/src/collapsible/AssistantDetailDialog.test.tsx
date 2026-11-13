import { render, screen } from '@testing-library/react';
import type { AssistantSummary } from '@drewswiredin/backstage-plugin-assistants-common';
import { ClientToolsProvider } from '../clientTools/ClientToolsProvider';
import { AssistantDetailDialog } from './AssistantDetailDialog';

const assistant = {
  id: 'ops',
  title: 'Ops',
  tools: [
    { name: 'search-catalog', description: 'Search the catalog' },
    { name: 'register-entity', description: 'Register an entity' },
    { name: 'kube-admin__scale', source: 'client' },
    { name: 'kube-admin__list', source: 'client' },
  ],
} as unknown as AssistantSummary;

const tool = (name: string, readOnly: boolean) => ({
  name,
  description: `${name} does a thing`,
  inputSchema: { type: 'object' as const, properties: {} },
  attributes: { readOnly },
});

describe('AssistantDetailDialog', () => {
  it('marks the tools that ask for approval with a gavel', () => {
    render(
      <ClientToolsProvider
        tools={[
          tool('kube-admin__scale', false),
          tool('kube-admin__list', true),
        ]}
        requireApproval={['register-entity']}
      >
        <AssistantDetailDialog assistant={assistant} open onClose={jest.fn()} />
      </ClientToolsProvider>,
    );
    const gavels = screen.getAllByLabelText(
      'Asks for your approval before it runs',
    );
    const gated = gavels.map(g => g.closest('li')?.textContent);
    expect(gated).toEqual(['register-entity', 'scale']);
  });
});
