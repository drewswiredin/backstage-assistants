import {
  initialPageAssistant,
  loadPageAssistant,
  savePageAssistant,
} from './pageAssistant';

describe('initialPageAssistant', () => {
  const assistants = [{ id: 'default' }, { id: 'ops' }, { id: 'docs' }];

  it('prefers the assistant the URL names', () => {
    expect(initialPageAssistant(assistants, 'docs', 'ops')).toBe('docs');
  });

  it('returns to the assistant last open here', () => {
    expect(initialPageAssistant(assistants, null, 'ops')).toBe('ops');
  });

  it('falls back to the first listed when neither is usable', () => {
    expect(initialPageAssistant(assistants, 'gone', 'revoked')).toBe('default');
    expect(initialPageAssistant(assistants, null, undefined)).toBe('default');
  });

  it('remembers across loads', () => {
    savePageAssistant('ops');
    expect(loadPageAssistant()).toBe('ops');
  });
});
