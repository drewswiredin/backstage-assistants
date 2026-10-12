import { fuseRankings, queryWords } from './rank';

describe('queryWords', () => {
  it('keeps distinct content words and drops stopwords and short words', () => {
    expect(
      queryWords([
        'How do I retry dead-letter messages in Nexis?',
        'retry DLQ',
      ]),
    ).toEqual(['retry', 'dead-letter', 'messages', 'nexis', 'dlq']);
  });

  it('caps the word count', () => {
    expect(
      queryWords(['alpha bravo charlie delta echo foxtrot golf hotel india']),
    ).toHaveLength(8);
  });
});

describe('fuseRankings', () => {
  it('ranks ids that several lists agree on above a single list leader', () => {
    expect(
      fuseRankings([
        { ids: ['a', 'b', 'c'], weight: 1 },
        { ids: ['c', 'b'], weight: 1 },
        { ids: ['b'], weight: 1 },
      ]),
    ).toEqual(['b', 'c', 'a']);
  });

  it('returns nothing for empty lists', () => {
    expect(fuseRankings([{ ids: [], weight: 1 }])).toEqual([]);
  });
});
