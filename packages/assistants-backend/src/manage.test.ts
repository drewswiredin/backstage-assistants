import { InputError } from '@backstage/errors';
import type { CapabilitiesResponse } from '@drewswiredin/backstage-plugin-assistants-common';
import { assertDefaultStaysOpen, validateDelta } from './manage';

const open = { allowAuthenticated: true, users: [], groups: [] };
const closed = {
  allowAuthenticated: false,
  users: ['user:default/a'],
  groups: [],
};

describe('assertDefaultStaysOpen', () => {
  it('refuses to close the default assistant', () => {
    expect(() =>
      assertDefaultStaysOpen({ isDefault: true }, { access: closed }),
    ).toThrow(InputError);
  });

  it('lets the default assistant stay open, with extra principals', () => {
    expect(() =>
      assertDefaultStaysOpen(
        { isDefault: true },
        { access: { ...open, users: ['user:default/a'] } },
      ),
    ).not.toThrow();
  });

  it('lets any other assistant be closed, including a new one', () => {
    expect(() =>
      assertDefaultStaysOpen({ isDefault: false }, { access: closed }),
    ).not.toThrow();
    expect(() =>
      assertDefaultStaysOpen(undefined, { access: closed }),
    ).not.toThrow();
  });
});

describe('validateDelta', () => {
  const capabilities = {
    actions: [{ id: 'search-catalog' }],
    models: [],
    mcpServers: [],
    requireApproval: [],
  } as unknown as CapabilitiesResponse;
  const def = (allowedTools: string[]) => ({
    allowedTools,
    models: [],
    defaultModel: null,
  });

  it('refuses a newly added built-in tool, naming it', () => {
    for (const name of ['read_current_page', 'portal__navigate']) {
      expect(() =>
        validateDelta(def([name]), undefined, capabilities, new Map()),
      ).toThrow(`Tool '${name}' is built in`);
    }
  });

  it('keeps a built-in that was saved before, so existing assistants still save', () => {
    const previous = {
      ...def(['portal__navigate']),
      id: 'a',
      title: 'A',
      prompt: '',
      access: { allowAuthenticated: true, users: [], groups: [] },
    };
    expect(() =>
      validateDelta(
        def(['portal__navigate', 'search-catalog']),
        previous,
        capabilities,
        new Map(),
      ),
    ).not.toThrow();
  });
});
