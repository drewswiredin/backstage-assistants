const STOPWORDS = new Set(
  (
    'a about an and are as at be but by can do does for from how i if in is it ' +
    'its me my of on or our should so that the their them then there these ' +
    'this to us was we what when where which who why will with you your'
  ).split(' '),
);

const MAX_WORDS = 8;

function tokens(phrasing: string): string[] {
  return phrasing
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map(raw => raw.replace(/^[-_]+|[-_]+$/g, ''))
    .filter(Boolean);
}

/** Alternatives embedded per search; extra ones are ignored, not an error. */
export const MAX_ALTERNATIVES = 3;

/**
 * The query and its first three distinct alternatives, trimmed: blanks and
 * repeats of the query or of each other (ignoring case) are dropped, so no
 * phrasing is embedded twice.
 */
export function phrasingsOf(
  query: string,
  alternatives: string[] = [],
): string[] {
  const seen = new Set([query.trim().toLowerCase()]);
  const phrasings = [query];
  for (const alternative of alternatives) {
    const trimmed = alternative.trim();
    const key = trimmed.toLowerCase();
    if (phrasings.length > MAX_ALTERNATIVES || !trimmed || seen.has(key)) {
      continue;
    }
    seen.add(key);
    phrasings.push(trimmed);
  }
  return phrasings;
}

/**
 * The distinct content words of the given phrasings: lowercased, at least
 * three characters, stopwords dropped, capped at eight. These drive the
 * keyword and fuzzy lists; the full phrasings drive the vector lists.
 */
export function queryWords(phrasings: string[]): string[] {
  const words = new Set<string>();
  for (const phrasing of phrasings) {
    for (const word of tokens(phrasing)) {
      if (word.length >= 3 && !STOPWORDS.has(word)) {
        words.add(word);
      }
    }
  }
  return [...words].slice(0, MAX_WORDS);
}

/**
 * Adjacent word pairs written as one word ("tally up" → "tallyup"), capped at
 * eight, for terms the user split in two. Only pairs the index contains are
 * searched, so the nonsense pairs cost nothing.
 */
export function joinedWords(phrasings: string[]): string[] {
  const words = new Set<string>();
  for (const phrasing of phrasings) {
    const parts = tokens(phrasing);
    for (let i = 1; i < parts.length; i++) {
      words.add(parts[i - 1] + parts[i]);
    }
  }
  return [...words].slice(0, MAX_WORDS);
}

/** The retrieval methods whose lists are fused. */
export type ListName = 'semantic' | 'keyword' | 'rareWord' | 'fuzzy';

/** A ranked list of chunks from one retrieval method, with its fusion weight. */
export interface RankedList {
  name: ListName;
  hits: Array<{ id: string; type?: string }>;
  weight: number;
}

/** A chunk after fusion. */
export interface FusedHit {
  id: string;
  type?: string;
  /** Fused score, after the type's weight. */
  score: number;
  /** The chunk's 1-based rank in each list it appears in; the best one for the semantic lists. */
  ranks: Partial<Record<ListName, number>>;
}

const RRF_K = 60;

/**
 * Reciprocal rank fusion: each list contributes `weight / (60 + rank)` per
 * chunk, and the sum is multiplied by the chunk's type weight. Rewards chunks
 * several methods agree on without comparing their raw scores, which live on
 * different scales. Chunks whose type weighs 0 are left out.
 */
export function fuseRankings(
  lists: RankedList[],
  typeWeight: (type: string | undefined) => number = () => 1,
): FusedHit[] {
  const fused = new Map<string, FusedHit>();
  for (const { name, hits, weight } of lists) {
    hits.forEach(({ id, type }, index) => {
      const hit = fused.get(id) ?? {
        id,
        ...(type ? { type } : {}),
        score: 0,
        ranks: {},
      };
      hit.score += weight / (RRF_K + index + 1);
      hit.ranks[name] = Math.min(hit.ranks[name] ?? Infinity, index + 1);
      fused.set(id, hit);
    });
  }
  return [...fused.values()]
    .map(hit => ({ ...hit, score: hit.score * typeWeight(hit.type) }))
    .filter(hit => hit.score > 0)
    .sort((a, b) => b.score - a.score);
}
