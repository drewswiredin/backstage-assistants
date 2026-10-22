import { fuseRankings, joinedWords, queryWords, type RankedList } from './rank';

describe('queryWords', () => {
  it('keeps distinct content words and drops stopwords and short words', () => {
    expect(
      queryWords([
        'How do I retry dead-letter messages in Pilon?',
        'retry DLQ',
      ]),
    ).toEqual(['retry', 'dead-letter', 'messages', 'pilon', 'dlq']);
  });

  it('caps the word count', () => {
    expect(
      queryWords(['alpha bravo charlie delta echo foxtrot golf hotel india']),
    ).toHaveLength(8);
  });
});

describe('joinedWords', () => {
  it('joins adjacent words, short ones included, into single terms', () => {
    expect(joinedWords(['tally up', 'roll back now'])).toEqual([
      'tallyup',
      'rollback',
      'backnow',
    ]);
  });

  it('caps the pair count', () => {
    expect(joinedWords(['a b c d e f g h i j k'])).toHaveLength(8);
  });
});

const list = (
  ids: string[],
  weight = 1,
  name: RankedList['name'] = 'keyword',
  type?: string,
): RankedList => ({
  name,
  hits: ids.map(id => ({ id, ...(type ? { type } : {}) })),
  weight,
});

describe('fuseRankings', () => {
  it('ranks ids that several lists agree on above a single list leader', () => {
    expect(
      fuseRankings([
        list(['a', 'b', 'c']),
        list(['c', 'b'], 1, 'rareWord'),
        list(['b'], 1, 'fuzzy'),
      ]).map(hit => hit.id),
    ).toEqual(['b', 'c', 'a']);
  });

  it('lets a one-vote exact match outrank phrasings that share one vote', () => {
    const phrasings = 4;
    expect(
      fuseRankings([
        ...Array.from({ length: phrasings }, () =>
          list(
            ['near1', 'near2', 'near3', 'near4', 'rare'],
            1 / phrasings,
            'semantic',
          ),
        ),
        list(['rare']),
      ])[0].id,
    ).toBe('rare');
  });

  it('records each list rank, the best one across phrasings', () => {
    const [hit] = fuseRankings([
      list(['x', 'a'], 0.5, 'semantic'),
      list(['a'], 0.5, 'semantic'),
      list(['b', 'c', 'a']),
    ]).filter(h => h.id === 'a');
    expect(hit.ranks).toEqual({ semantic: 1, keyword: 3 });
  });

  it('weighs by type, keeping a lower-ranked section above a crowd of low-weight tickets', () => {
    const tickets = Array.from({ length: 20 }, (_, i) => `ticket${i}`);
    const lists = [
      {
        name: 'semantic' as const,
        hits: [
          ...tickets.map(id => ({ id, type: 'jira' })),
          { id: 'runbook', type: 'techdocs' },
        ],
        weight: 1,
      },
    ];
    const weights: Record<string, number> = { jira: 0.5, techdocs: 1.2 };
    const fused = fuseRankings(lists, type => weights[type!] ?? 1);
    expect(fused[0]).toMatchObject({ id: 'runbook', type: 'techdocs' });
  });

  it('leaves out types weighted 0', () => {
    expect(fuseRankings([list(['a'], 1, 'keyword', 'jira')], () => 0)).toEqual(
      [],
    );
  });

  it('returns nothing for empty lists', () => {
    expect(fuseRankings([list([])])).toEqual([]);
  });
});
