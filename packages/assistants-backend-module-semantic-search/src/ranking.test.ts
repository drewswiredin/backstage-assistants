import { sourcesDescription } from './action';
import type { KnowledgeTypeSettings } from './config';
import {
  defaultRanker,
  selectTypes,
  typeSettingsOf,
  type KnowledgeCandidate,
} from './ranking';

const types = new Map<string, KnowledgeTypeSettings>([
  ['software-catalog', { weight: 1.5, default: true, enabled: true }],
  ['techdocs', { weight: 1.2, default: true, enabled: true }],
  [
    'jira',
    {
      weight: 0.5,
      default: false,
      maxResults: 2,
      enabled: true,
      description: 'ticket history, decisions and status',
    },
  ],
  ['wiki', { weight: 1, default: true, enabled: false }],
  ['drafts', { weight: 0, default: true, enabled: true }],
]);

const stored = {
  types: ['jira', 'software-catalog', 'techdocs', 'wiki'],
  untyped: true,
};

describe('selectTypes', () => {
  it('searches the default types and unnamed sources when the caller names none', () => {
    expect(selectTypes(types, stored, undefined)).toEqual({
      types: ['software-catalog', 'techdocs'],
      untyped: true,
    });
  });

  it('searches only the named types', () => {
    expect(selectTypes(types, stored, ['jira'])).toEqual({
      types: ['jira'],
      untyped: false,
    });
  });

  it('never searches a type weighted 0, even when named', () => {
    expect(selectTypes(types, stored, ['drafts', 'techdocs'])).toEqual({
      types: ['techdocs'],
      untyped: false,
    });
  });

  it('rejects an unknown or uncopied type and lists the known ones', () => {
    expect(() => selectTypes(types, stored, ['confluence'])).toThrow(
      "Unknown knowledge type 'confluence'; the types are drafts, jira, software-catalog, techdocs",
    );
    expect(() => selectTypes(types, stored, ['wiki'])).toThrow(/'wiki'/);
  });

  it('knows types the index holds that config no longer names', () => {
    expect(
      selectTypes(new Map(), { types: ['confluence'], untyped: false }, [
        'confluence',
      ]),
    ).toEqual({ types: ['confluence'], untyped: false });
  });
});

const candidate = (id: string, type?: string): KnowledgeCandidate => ({
  id,
  ...(type ? { type } : {}),
  location: `/${id}`,
  title: id,
  content: id,
  ranks: {},
  score: 1,
});

describe('defaultRanker', () => {
  const rank = defaultRanker(typeSettingsOf(types));
  const input = (candidates: KnowledgeCandidate[], maxResults = 5) => ({
    query: 'q',
    phrasings: ['q'],
    types: [],
    candidates,
    maxResults,
  });

  it('caps a type and gives its slots to the next best of other types', async () => {
    const results = await rank(
      input([
        candidate('j1', 'jira'),
        candidate('j2', 'jira'),
        candidate('j3', 'jira'),
        candidate('j4', 'jira'),
        candidate('t1', 'techdocs'),
        candidate('u1'),
        candidate('u2'),
      ]),
    );
    expect(results.map(r => r.id)).toEqual(['j1', 'j2', 't1', 'u1', 'u2']);
  });

  it('gives slots no other type can fill back to the capped type', async () => {
    const results = await rank(
      input(
        ['j1', 'j2', 'j3', 'j4', 'j5'].map(id => candidate(id, 'jira')),
        4,
      ),
    );
    expect(results.map(r => r.id)).toEqual(['j1', 'j2', 'j3', 'j4']);
  });

  it('stops at maxResults', async () => {
    const results = await rank(
      input(
        ['a', 'b', 'c'].map(id => candidate(id, 'techdocs')),
        2,
      ),
    );
    expect(results.map(r => r.id)).toEqual(['a', 'b']);
  });
});

describe('sourcesDescription', () => {
  it('lists the copied types, marking the opt-in ones', () => {
    expect(sourcesDescription(types)).toBe(
      [
        '',
        'Sources: pass "types" to search only the named search document types; without it the search covers every source except those marked as searched only when named. An unknown name returns the list of types.',
        '- software-catalog',
        '- techdocs',
        '- jira (only when named in "types"): ticket history, decisions and status',
      ].join('\n'),
    );
  });
});
