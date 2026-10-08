import { act, render, screen } from '@testing-library/react';
import { RenderFormTool } from './RenderFormTool';

// Each mount of the scaffolder Form records the uiSchema it was handed: pickers
// read `ui:options` once, on mount, so the first mount's spec is the one that sticks.
const mounts: unknown[] = [];

jest.mock('@backstage/core-plugin-api', () => ({
  useApiHolder: () => ({
    get: () => ({ loadFormFields: async () => [] }),
  }),
}));

jest.mock('@backstage/plugin-scaffolder-react/alpha', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    formFieldsApiRef: {},
    extractSchemaFromStep: (schema: any) => ({ schema, uiSchema: {} }),
    Form: ({ uiSchema }: { uiSchema: unknown }) => {
      useEffect(() => {
        mounts.push(uiSchema);
      }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return <div data-testid="form" />;
    },
  };
});

jest.mock('@backstage/plugin-scaffolder-react', () => ({
  SecretsContextProvider: ({ children }: { children: unknown }) => children,
}));

const Render = RenderFormTool.unstable_tool.render as any;

const jsonSchema = {
  type: 'object',
  properties: { system: { type: 'string' } },
};
const filtered = {
  system: {
    'ui:field': 'EntityPicker',
    'ui:options': { catalogFilter: { kind: 'System' } },
  },
};
// Mid-stream: the picker's field has arrived, its ui:options have not.
const partial = {
  jsonSchema,
  uiSchema: { system: { 'ui:field': 'EntityPicker' } },
};
const complete = { jsonSchema, uiSchema: filtered };

const props = (args: unknown, status: { type: string; reason?: string }) => ({
  args,
  status,
  result: undefined,
  addResult: jest.fn(),
  toolName: 'render_form',
  toolCallId: 'call-1',
});

describe('RenderFormTool', () => {
  beforeEach(() => {
    mounts.length = 0;
  });

  it('mounts the form only once the streamed args are complete', async () => {
    const { rerender } = render(
      <Render {...props(partial, { type: 'running' })} />,
    );
    // Let the field registry resolve and flush; a mid-stream form must still not mount.
    await act(() => new Promise(r => setTimeout(r, 0)));
    expect(screen.queryByTestId('form')).toBeNull();
    expect(screen.getByText('Preparing form…')).toBeTruthy();

    rerender(
      <Render
        {...props(complete, { type: 'requires-action', reason: 'tool-calls' })}
      />,
    );
    await screen.findByTestId('form');
    expect(mounts).toEqual([filtered]);
  });

  it('mounts straight away for a stored call reloaded from history', async () => {
    render(
      <Render
        {...props(complete, { type: 'requires-action', reason: 'tool-calls' })}
      />,
    );
    await screen.findByTestId('form');
    expect(mounts).toEqual([filtered]);
  });
});
