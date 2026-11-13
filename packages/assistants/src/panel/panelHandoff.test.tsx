import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { mockApis, renderInTestApp } from '@backstage/frontend-test-utils';
import { assistantsApiRef } from '../api';
import { clientToolsApiRef } from '../clientTools/api';
import { rootRouteRef } from '../routes';
import { AssistantsPanel } from './AssistantsPanel';
import { openPanel } from './panelControl';

// The conversation surface, reduced to the conversation it was given.
jest.mock('../embedded/EmbeddedAssistant', () => ({
  EmbeddedAssistant: (props: { assistantId?: string; threadId?: string }) => (
    <div data-testid="panel-conversation">
      {props.assistantId}|{props.threadId}
    </div>
  ),
}));

/** The page under the panel; "Leave" does what the Assistants page does. */
function Page() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <>
      <span data-testid="path">{pathname}</span>
      <button
        onClick={() => {
          openPanel({ assistantId: 'ops', threadId: 'thread-1' });
          navigate('/catalog/default/component/orders');
        }}
      >
        Leave
      </button>
    </>
  );
}

describe('the Assistants page handing its conversation to the panel', () => {
  beforeEach(() => {
    localStorage.clear();
    // The panel measures its column; jsdom has no layout.
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });

  it('opens the panel on the same conversation on the page it navigates to', async () => {
    const api = {
      getStatus: jest.fn(async () => ({
        assistants: [{ id: 'docs' }, { id: 'ops' }],
        defaultAssistant: 'docs',
        models: [],
      })),
      getThreadsStatus: jest.fn(async () => []),
    };
    renderInTestApp(
      <AssistantsPanel>
        <Page />
      </AssistantsPanel>,
      {
        mountedRoutes: { '/assistants': rootRouteRef },
        initialRouteEntries: ['/assistants'],
        apis: [
          [assistantsApiRef, api],
          [clientToolsApiRef, { tools: [] }],
          mockApis.permission(),
        ] as never,
      },
    );
    await waitFor(() => expect(api.getStatus).toHaveBeenCalled());
    // On the Assistants page the panel stays out of the way.
    expect(screen.queryByTestId('panel-conversation')).toBeNull();

    act(() => {
      fireEvent.click(screen.getByText('Leave'));
    });

    expect(screen.getByTestId('path').textContent).toBe(
      '/catalog/default/component/orders',
    );
    expect((await screen.findByTestId('panel-conversation')).textContent).toBe(
      'ops|thread-1',
    );
    expect(localStorage.getItem('assistants-panel-thread')).toBe('thread-1');
  });
});
