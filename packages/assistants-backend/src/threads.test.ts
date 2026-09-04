import { InputError } from '@backstage/errors';
import { parseThreadPatch } from './threads';

describe('parseThreadPatch', () => {
  it('accepts every metadata field with the right type', () => {
    expect(
      parseThreadPatch({
        title: 'Deploy checklist',
        model: 'openai:gpt-4o',
        reasoningLevel: 'high',
        pinned: true,
        archived: false,
      }),
    ).toEqual({
      title: 'Deploy checklist',
      model: 'openai:gpt-4o',
      reasoningLevel: 'high',
      pinned: true,
      archived: false,
    });
  });

  it('accepts a partial body and null to clear model / reasoningLevel', () => {
    expect(parseThreadPatch({ pinned: true })).toEqual({ pinned: true });
    expect(parseThreadPatch({ model: null, reasoningLevel: null })).toEqual({
      model: null,
      reasoningLevel: null,
    });
    expect(parseThreadPatch({})).toEqual({});
  });

  it('rejects a non-object body', () => {
    expect(() => parseThreadPatch(undefined)).toThrow(InputError);
    expect(() => parseThreadPatch('title')).toThrow(InputError);
    expect(() => parseThreadPatch([])).toThrow(InputError);
  });

  it('rejects unknown keys', () => {
    expect(() =>
      parseThreadPatch({ title: 'x', userRef: 'user:default/eve' }),
    ).toThrow(/Unknown field\(s\): userRef/);
  });

  it('rejects an empty, non-string, or over-long title', () => {
    expect(() => parseThreadPatch({ title: '' })).toThrow(InputError);
    expect(() => parseThreadPatch({ title: '   ' })).toThrow(InputError);
    expect(() => parseThreadPatch({ title: 42 })).toThrow(InputError);
    expect(() => parseThreadPatch({ title: 'x'.repeat(513) })).toThrow(
      /at most 512/,
    );
    expect(parseThreadPatch({ title: 'x'.repeat(512) }).title).toHaveLength(
      512,
    );
  });

  it('rejects a reasoningLevel outside the enum', () => {
    expect(() => parseThreadPatch({ reasoningLevel: 'ultra' })).toThrow(
      /reasoningLevel must be one of low, medium, high, max/,
    );
    expect(() => parseThreadPatch({ reasoningLevel: 1 })).toThrow(InputError);
  });

  it('rejects non-boolean pinned / archived and a non-string model', () => {
    expect(() => parseThreadPatch({ pinned: 'yes' })).toThrow(InputError);
    expect(() => parseThreadPatch({ archived: 1 })).toThrow(InputError);
    expect(() => parseThreadPatch({ model: '' })).toThrow(InputError);
    expect(() => parseThreadPatch({ model: {} })).toThrow(InputError);
  });
});
