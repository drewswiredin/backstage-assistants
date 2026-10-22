import type {
  AuthService,
  BackstageCredentials,
} from '@backstage/backend-plugin-api';
import type { ActionsRegistryService } from '@backstage/backend-plugin-api/alpha';
import type { CatalogApi } from '@backstage/catalog-client';
import { embedMany, type EmbeddingModel } from 'ai';
import type { KnowledgeTypeSettings } from './config';
import { fuseRankings, joinedWords, queryWords, type RankedList } from './rank';
import {
  selectTypes,
  typeSettingsOf,
  type KnowledgeCandidate,
  type KnowledgeRanker,
} from './ranking';
import type { KnowledgeStore } from './store';

/** Candidates per type in each retrieval list, before fusion and permission filtering. */
const CANDIDATES = 30;
/** Fused candidates checked for permission and ranked; over-fetched so filtering and type caps rarely empty the page. */
const FUSED = 60;
/** The most results a caller may ask for, unless `maxResults` is configured higher. */
const MAX_LIMIT = 20;
const EXCERPT_CHARS = 1500;
/** A word in this many chunks or fewer is rare: strong evidence of what the user means. */
const RARE_MAX_CHUNKS = 3;

export interface SearchKnowledgeDeps {
  actionsRegistry: ActionsRegistryService;
  store: KnowledgeStore;
  catalog: CatalogApi;
  auth: AuthService;
  embeddingModel: EmbeddingModel;
  types: Map<string, KnowledgeTypeSettings>;
  maxResults: number;
  /** The ranker in effect: the default, or one a module set. */
  ranker: () => KnowledgeRanker;
}

/**
 * Registers `search-knowledge`: hybrid retrieval over the knowledge index. Each
 * phrasing is embedded and matched by meaning; the query words are matched
 * exactly (full-text, any word) and, for words absent from the index, by
 * near spelling (trigram). Words found in only a few chunks get a list of
 * their own, so a rare name or acronym buried in a paragraph about something
 * else is not outvoted by sections that are merely near the question.
 *
 * Each list keeps its best chunks of every document type, so a large source
 * cannot fill a list on its own. The lists are fused by reciprocal rank with
 * one vote per method, each chunk's score multiplied by its type's weight:
 * the phrasings share the meaning vote, so extra alternatives broaden recall
 * without drowning out exact matches. Results gated by a catalog entity are
 * filtered to entities the caller can read; the rest are visible to every
 * assistant user, as they are in Backstage search. Repeated text is shown
 * once, and the ranker picks the results from what remains.
 */
export function registerSearchKnowledgeAction({
  actionsRegistry,
  store,
  catalog,
  auth,
  embeddingModel,
  types,
  maxResults,
  ranker,
}: SearchKnowledgeDeps): void {
  actionsRegistry.register({
    name: 'search-knowledge',
    title: 'Search Knowledge',
    attributes: { destructive: false, readOnly: true, idempotent: true },
    description: `Search everything the organization's Backstage search indexes (TechDocs, the software catalog, and any other source it collects, such as Confluence or wiki pages) by meaning, not only by exact words. Best for questions in the user's own words: it finds a page even when the question is worded differently from it ("fix errored messages" finds "Retry dead-letter messages") and tolerates misspelled names ("Pilon" finds "Pylon"). It returns the most relevant sections, not every match, and cannot filter by entity kind.
${sourcesDescription(types)}

How to search the organization's docs and catalog:
1. Start here, with the user's question.
2. If the results don't clearly answer, also run a keyword search: the query tool (catalog and TechDocs at once) when it is available, otherwise search-techdocs and search-catalog. Keyword search finds rare names, acronyms and jargon that ranking by meaning can miss. For a bare name, term or acronym, run both searches from the start.
3. Report something as missing only after both searches come back empty.

Pass the user's question as the "query" parameter. Pass up to three "alternatives": other phrasings, synonyms, or the internal terms the docs might use.

Each result has a title (its heading path), an excerpt, a location, its source type, the fields the source attached (such as status, space, or last update: use them to judge how current it is), and, for catalog and TechDocs results, the entity ref. A location starting with /docs/ is a TechDocs page: pass it to read-techdocs to read the full page. Any other location is a link to the page or entity; cite it.`,
    schema: {
      input: z =>
        z.object({
          query: z.string().min(1).describe('The question or topic to find'),
          alternatives: z
            .array(z.string())
            .max(3)
            .optional()
            .describe('Other phrasings or terms for the same thing'),
          types: z
            .array(z.string())
            .optional()
            .describe(
              'Search only these sources (search document types); omit to search the default ones',
            ),
          limit: z
            .number()
            .int()
            .min(1)
            .max(Math.max(MAX_LIMIT, maxResults))
            .optional()
            .default(maxResults)
            .describe('Number of results to return'),
        }),
      output: z =>
        z.object({
          results: z.array(
            z.object({
              title: z.string(),
              location: z.string(),
              type: z.string().optional(),
              entityRef: z.string().optional(),
              metadata: z
                .record(
                  z.string(),
                  z.union([z.string(), z.number(), z.boolean()]),
                )
                .optional(),
              excerpt: z.string(),
            }),
          ),
        }),
    },
    action: async ({ input, credentials }) => {
      if (!(await store.isReady())) {
        throw new Error(
          'The knowledge index is still being built; meanwhile use keyword search: the query tool when it is available, otherwise search-techdocs and search-catalog.',
        );
      }

      const filter = selectTypes(types, await store.types(), input.types);
      const phrasings = [input.query, ...(input.alternatives ?? [])];
      const words = queryWords(phrasings);
      const joined = joinedWords(phrasings).filter(w => !words.includes(w));
      const [{ embeddings }, frequencies] = await Promise.all([
        embedMany({ model: embeddingModel, values: phrasings }),
        store.documentFrequencies(
          [...words, ...joined],
          RARE_MAX_CHUNKS + 1,
          filter,
        ),
      ]);
      const known = [...words, ...joined].filter(
        w => (frequencies.get(w) ?? 0) > 0,
      );
      const rare = known.filter(w => frequencies.get(w)! <= RARE_MAX_CHUNKS);
      const unknown = words.filter(w => frequencies.get(w) === 0);

      const lists: RankedList[] = await Promise.all([
        ...embeddings.map(async embedding => ({
          name: 'semantic' as const,
          hits: await store.nearest(embedding, CANDIDATES, filter),
          weight: 1 / embeddings.length,
        })),
        store
          .keyword(known, CANDIDATES, filter)
          .then(hits => ({ name: 'keyword' as const, hits, weight: 1 })),
        store
          .keyword(rare, CANDIDATES, filter)
          .then(hits => ({ name: 'rareWord' as const, hits, weight: 1 })),
        store
          .fuzzy(unknown, CANDIDATES, filter)
          .then(hits => ({ name: 'fuzzy' as const, hits, weight: 1 })),
      ]);

      const settingsOf = typeSettingsOf(types);
      const fused = fuseRankings(lists, type => settingsOf(type).weight).slice(
        0,
        FUSED,
      );
      const byId = new Map(
        (await store.chunks(fused.map(hit => hit.id))).map(chunk => [
          chunk.id,
          chunk,
        ]),
      );
      const found = fused.flatMap(hit => {
        const chunk = byId.get(hit.id);
        return chunk ? [{ hit, chunk }] : [];
      });

      const readable = await readableEntityRefs(catalog, auth, credentials, [
        ...new Set(
          found.flatMap(({ chunk }) =>
            chunk.entityRef ? [chunk.entityRef] : [],
          ),
        ),
      ]);

      const seen = new Set<string>();
      const candidates: KnowledgeCandidate[] = [];
      for (const { hit, chunk } of found) {
        const key = `${chunk.location}|${chunk.title}`;
        if (
          (chunk.entityRef && !readable.has(chunk.entityRef)) ||
          seen.has(key) ||
          seen.has(chunk.content)
        ) {
          continue;
        }
        seen.add(key);
        seen.add(chunk.content);
        candidates.push({ ...chunk, score: hit.score, ranks: hit.ranks });
      }

      const ids = new Set(candidates.map(candidate => candidate.id));
      const ranked = await ranker()({
        query: input.query,
        phrasings,
        types: filter.types,
        candidates,
        maxResults: input.limit,
      });
      const results = ranked
        .filter(candidate => ids.delete(candidate.id))
        .slice(0, input.limit)
        .map(candidate => ({
          title: candidate.title,
          location: candidate.location,
          ...(candidate.type ? { type: candidate.type } : {}),
          ...(candidate.entityRef ? { entityRef: candidate.entityRef } : {}),
          ...(candidate.metadata ? { metadata: candidate.metadata } : {}),
          excerpt: candidate.content.slice(0, EXCERPT_CHARS),
        }));
      return { output: { results } };
    },
  });
}

/**
 * The tool description's paragraph on sources: the configured types, which
 * ones are searched only when named, and what each holds.
 */
export function sourcesDescription(
  types: Map<string, KnowledgeTypeSettings>,
): string {
  const listed = [...types].filter(
    ([, settings]) => settings.enabled && settings.weight > 0,
  );
  const lines = listed.map(
    ([type, settings]) =>
      `- ${type}${settings.default ? '' : ' (only when named in "types")'}${
        settings.description ? `: ${settings.description}` : ''
      }`,
  );
  return [
    '',
    `Sources: pass "types" to search only the named search document types; without it the search covers every source except those marked as searched only when named. An unknown name returns the list of types.`,
    ...lines,
  ].join('\n');
}

/**
 * The subset of entity refs the caller can read, asked of the catalog as the
 * caller — so the catalog's own permission policy decides, and a deleted
 * entity's leftover chunks never surface.
 */
async function readableEntityRefs(
  catalog: CatalogApi,
  auth: AuthService,
  credentials: BackstageCredentials,
  entityRefs: string[],
): Promise<Set<string>> {
  if (entityRefs.length === 0) {
    return new Set();
  }
  const { token } = await auth.getPluginRequestToken({
    onBehalfOf: credentials,
    targetPluginId: 'catalog',
  });
  const { items } = await catalog.getEntitiesByRefs(
    { entityRefs, fields: ['kind', 'metadata.namespace', 'metadata.name'] },
    { token },
  );
  return new Set(entityRefs.filter((_, i) => items[i]));
}
