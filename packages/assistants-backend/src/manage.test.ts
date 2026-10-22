import { InputError } from '@backstage/errors';
import { assertDefaultStaysOpen } from './manage';

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
