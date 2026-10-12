const STOPWORDS = new Set(
  (
    'a about an and are as at be but by can do does for from how i if in is it ' +
    'its me my of on or our should so that the their them then there these ' +
    'this to us was we what when where which who why will with you your'
  ).split(' '),
);

const MAX_WORDS = 8;

/**
 * The distinct content words of the given phrasings: lowercased, at least
 * three characters, stopwords dropped, capped at eight. These drive the
 * keyword and fuzzy lists; the full phrasings drive the vector list.
 */
export function queryWords(phrasings: string[]): string[] {
  const words = new Set<string>();
  for (const phrasing of phrasings) {
    for (const raw of phrasing.toLowerCase().split(/[^\p{L}\p{N}_-]+/u)) {
      const word = raw.replace(/^[-_]+|[-_]+$/g, '');
      if (word.length >= 3 && !STOPWORDS.has(word)) {
        words.add(word);
      }
    }
  }
  return [...words].slice(0, MAX_WORDS);
}

/** A ranked list of chunk ids from one retrieval method, with its fusion weight. */
export interface RankedList {
  ids: string[];
  weight: number;
}

const RRF_K = 60;

/**
 * Reciprocal rank fusion: each list contributes `weight / (60 + rank)` per id.
 * Rewards ids several methods agree on without comparing their raw scores,
 * which live on different scales.
 */
export function fuseRankings(lists: RankedList[]): string[] {
  const scores = new Map<string, number>();
  for (const { ids, weight } of lists) {
    ids.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + weight / (RRF_K + index + 1));
    });
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
