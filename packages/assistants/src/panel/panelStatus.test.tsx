import { act, waitFor } from '@testing-library/react';
import { mockApis, renderInTestApp } from '@backstage/frontend-test-utils';
import { assistantsApiRef } from '../api';
import { clientToolsApiRef } from '../clientTools/api';
import { rootRouteRef } from '../routes';
import { AssistantsPanel } from './AssistantsPanel';
import { savePanelAssistant } from './panelStorage';
import { notifyAssistantsChanged } from '../collapsible/admin/assistantsChanged';
import { resolveAssistantColor } from '../collapsible/surface/AssistantAvatar';

const shown = (color: string) => resolveAssistantColor(color, 'light');

jest.mock('../embedded/EmbeddedAssistant', () => ({
  EmbeddedAssistant: () => null,
}));

/** The strip's edge colour, as the panel sets it. */
function stripColor(container: HTMLElement) {
  return (
    container.querySelector('aside') as HTMLElement
  ).style.getPropertyValue('--assistants-strip-glow');
}

describe('the panel strip colour', () => {
  beforeEach(() => {
    localStorage.clear();
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });

  function render(statuses: object[]) {
    const getStatus = jest.fn(async () => statuses.shift() ?? statuses[0]);
    const api = { getStatus, getThreadsStatus: jest.fn(async () => []) };
    return {
      getStatus,
      ...renderInTestApp(
        <AssistantsPanel>
          <span />
        </AssistantsPanel>,
        {
          mountedRoutes: { '/assistants': rootRouteRef },
          initialRouteEntries: ['/catalog'],
          apis: [
            [assistantsApiRef, api],
            [clientToolsApiRef, { tools: [] }],
            mockApis.permission(),
          ] as never,
        },
      ),
    };
  }

  const before = {
    assistants: [{ id: 'docs', color: '#00ff00' }],
    defaultAssistant: 'docs',
    models: [],
  };
  const after = {
    assistants: [
      { id: 'docs', color: '#00ff00' },
      { id: 'super', color: '#ff0000' },
    ],
    defaultAssistant: 'docs',
    models: [],
  };

  it('follows an assistant created after the app loaded', async () => {
    const { container, getStatus } = render([before, after, after]);
    await waitFor(() => expect(stripColor(container)).toBe(shown('#00ff00')));
    act(() => savePanelAssistant('super'));
    await waitFor(() => expect(stripColor(container)).toBe(shown('#ff0000')));
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it('follows the editor recolouring the picked assistant', async () => {
    const recoloured = {
      ...before,
      assistants: [{ id: 'docs', color: '#0000ff' }],
    };
    const { container } = render([before, recoloured, recoloured]);
    await waitFor(() => expect(stripColor(container)).toBe(shown('#00ff00')));
    act(() => notifyAssistantsChanged());
    await waitFor(() => expect(stripColor(container)).toBe(shown('#0000ff')));
  });
});
