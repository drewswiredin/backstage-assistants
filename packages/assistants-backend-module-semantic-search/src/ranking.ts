import { createExtensionPoint } from '@backstage/backend-plugin-api';
import { InputError } from '@backstage/errors';
import { DEFAULT_TYPE_SETTINGS, type KnowledgeTypeSettings } from './config';
import type { StoredTypes, TypeFilter } from './store';

/**
 * One `search-knowledge` result candidate, after fusion and the permission
 * check.
 *
 * @alpha
 */
export interface KnowledgeCandidate {
  /** The chunk's stable id. */
  id: string;
  /** The Backstage search document type; absent for types not named in `assistants.semanticSearch.types`. */
  type?: string;
  /** The catalog entity gating it, for catalog and TechDocs results. */
  entityRef?: string;
  /** The search result location: a TechDocs path or a link. */
  location: string;
  /** Heading path, e.g. `Pylon › Messaging › Dead-letter handling`. */
  title: string;
  /** The chunk's text, up to ~1600 characters. */
  content: string;
  /** The chunk's 1-based rank in each retrieval list it appears in. */
  ranks: {
    semantic?: number;
    keyword?: number;
    rareWord?: number;
    fuzzy?: number;
  };
  /** Reciprocal rank fusion score, after the type's configured weight. */
  score: number;
  /** The short fields the collator attached (status, space, updated, …). */
  metadata?: Record<string, string | number | boolean>;
}

/**
 * What a {@link KnowledgeRanker} picks from.
 *
 * @alpha
 */
export interface KnowledgeRankerInput {
  /** The caller's question. */
  query: string;
  /** The query and the caller's alternatives. */
  phrasings: string[];
  /** The types searched: those the caller named, or the default ones. */
  types: string[];
  /** Candidates the caller may read, best fused score first, with repeated text removed. */
  candidates: KnowledgeCandidate[];
  /** How many results the caller gets. */
  maxResults: number;
}

/**
 * Picks and orders the results from the candidates. Results it returns that
 * are not among the candidates are dropped, and the list is cut to
 * `maxResults`.
 *
 * @alpha
 */
export type KnowledgeRanker = (
  input: KnowledgeRankerInput,
) => Promise<KnowledgeCandidate[]> | KnowledgeCandidate[];

/**
 * Replaces how `search-knowledge` picks its results.
 *
 * @alpha
 */
export interface KnowledgeRankingExtensionPoint {
  /** Replaces the default ranker (type caps, then `maxResults`). */
  setRanker(ranker: KnowledgeRanker): void;
}

/**
 * Lets a backend module replace how `search-knowledge` picks its results,
 * for example to favour recent tickets or the caller's team. The ranker sees
 * only candidates the caller may read.
 *
 * @alpha
 */
export const knowledgeRankingExtensionPoint =
  createExtensionPoint<KnowledgeRankingExtensionPoint>({
    id: 'assistants.knowledge.ranking',
  });

export type TypeSettingsOf = (
  type: string | undefined,
) => KnowledgeTypeSettings;

export function typeSettingsOf(
  types: Map<string, KnowledgeTypeSettings>,
): TypeSettingsOf {
  return type => (type && types.get(type)) || DEFAULT_TYPE_SETTINGS;
}

/**
 * The default ranker: best score first, at most `maxResults` of a type that
 * sets it, the rest of the slots going to the next best of other types. A
 * cap spreads results across sources rather than excluding one: slots no
 * other type can fill go back to the capped types, best first.
 */
export function defaultRanker(settingsOf: TypeSettingsOf): KnowledgeRanker {
  return ({ candidates, maxResults }) => {
    const counts = new Map<string | undefined, number>();
    const picked = new Set<KnowledgeCandidate>();
    for (const candidate of candidates) {
      const count = counts.get(candidate.type) ?? 0;
      const cap = settingsOf(candidate.type).maxResults;
      if (picked.size === maxResults || (cap !== undefined && count >= cap)) {
        continue;
      }
      counts.set(candidate.type, count + 1);
      picked.add(candidate);
    }
    for (const candidate of candidates) {
      if (picked.size === maxResults) {
        break;
      }
      picked.add(candidate);
    }
    return candidates.filter(candidate => picked.has(candidate));
  };
}

/**
 * The chunks one search covers. Named types are searched as asked, untyped
 * chunks only when the caller names none; with no names, the types that are
 * on by default. Types weighted 0 or not copied are never searched. A name
 * the index does not know is an error that lists the known ones, so the
 * model can correct itself.
 */
export function selectTypes(
  configured: Map<string, KnowledgeTypeSettings>,
  stored: StoredTypes,
  requested: string[] | undefined,
): TypeFilter {
  const settingsOf = typeSettingsOf(configured);
  const known = [...new Set([...stored.types, ...configured.keys()])]
    .filter(type => settingsOf(type).enabled)
    .sort();
  const searchable = (type: string) => settingsOf(type).weight > 0;

  if (requested && requested.length > 0) {
    const unknown = requested.filter(type => !known.includes(type));
    if (unknown.length > 0) {
      throw new InputError(
        `Unknown knowledge type ${unknown
          .map(type => `'${type}'`)
          .join(', ')}; the types are ${known.join(', ') || 'none yet'}`,
      );
    }
    return {
      types: [...new Set(requested)].filter(searchable),
      untyped: false,
    };
  }
  return {
    types: known.filter(type => searchable(type) && settingsOf(type).default),
    untyped: stored.untyped,
  };
}
