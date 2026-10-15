import { fuseRankings, joinedWords, queryWords } from './rank';

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

  it('lets a one-vote exact match outrank phrasings that share one vote', () => {
    const phrasings = 4;
    expect(
      fuseRankings([
        ...Array.from({ length: phrasings }, () => ({
          ids: ['near1', 'near2', 'near3', 'near4', 'rare'],
          weight: 1 / phrasings,
        })),
        { ids: ['rare'], weight: 1 },
      ])[0],
    ).toBe('rare');
  });

  it('returns nothing for empty lists', () => {
    expect(fuseRankings([{ ids: [], weight: 1 }])).toEqual([]);
  });
});
