import type {
  AuthService,
  BackstageCredentials,
} from '@backstage/backend-plugin-api';
import type { ActionsRegistryService } from '@backstage/backend-plugin-api/alpha';
import type { CatalogApi } from '@backstage/catalog-client';
import { embedMany, type EmbeddingModel } from 'ai';
import { fuseRankings, joinedWords, queryWords, type RankedList } from './rank';
import type { KnowledgeStore, StoredChunk } from './store';

/** Candidates per retrieval list, before fusion and permission filtering. */
const CANDIDATES = 30;
/** Fused candidates checked for permission; over-fetched so filtering rarely empties the page. */
const FUSED = 40;
const EXCERPT_CHARS = 1500;
/** A word in this many chunks or fewer is rare: strong evidence of what the user means. */
const RARE_MAX_CHUNKS = 3;

export interface SearchKnowledgeDeps {
  actionsRegistry: ActionsRegistryService;
  store: KnowledgeStore;
  catalog: CatalogApi;
  auth: AuthService;
  embeddingModel: EmbeddingModel;
}

/**
 * Registers `search-knowledge`: hybrid retrieval over the knowledge index. Each
 * phrasing is embedded and matched by meaning; the query words are matched
 * exactly (full-text, any word) and, for words absent from the index, by
 * near spelling (trigram). Words found in only a few chunks get a list of
 * their own, so a rare name or acronym buried in a paragraph about something
 * else is not outvoted by sections that are merely near the question.
 *
 * The lists are fused by reciprocal rank with one vote per method: the
 * phrasings share the meaning vote, so extra alternatives broaden recall
 * without drowning out exact matches. Results gated by a catalog entity are
 * filtered to entities the caller can read; the rest are visible to every
 * assistant user, as they are in Backstage search. Repeated text is shown
 * once.
 */
export function registerSearchKnowledgeAction({
  actionsRegistry,
  store,
  catalog,
  auth,
  embeddingModel,
}: SearchKnowledgeDeps): void {
  actionsRegistry.register({
    name: 'search-knowledge',
    title: 'Search Knowledge',
    attributes: { destructive: false, readOnly: true, idempotent: true },
    description: `Search everything the organization's Backstage search indexes (TechDocs, the software catalog, and any other source it collects, such as Confluence or wiki pages) by meaning, not only by exact words. Best for questions in the user's own words: it finds a page even when the question is worded differently from it ("fix errored messages" finds "Retry dead-letter messages") and tolerates misspelled names ("Pilon" finds "Pylon"). It returns the most relevant sections, not every match, and cannot filter by entity kind or source.

How to search the organization's docs and catalog:
1. Start here, with the user's question.
2. If the results don't clearly answer, also run a keyword search: the query tool (catalog and TechDocs at once) when it is available, otherwise search-techdocs and search-catalog. Keyword search finds rare names, acronyms and jargon that ranking by meaning can miss. For a bare name, term or acronym, run both searches from the start.
3. Report something as missing only after both searches come back empty.

Pass the user's question as the "query" parameter. Pass up to three "alternatives": other phrasings, synonyms, or the internal terms the docs might use.

Each result has a title (its heading path), an excerpt, a location, and, for catalog and TechDocs results, the entity ref. A location starting with /docs/ is a TechDocs page: pass it to read-techdocs to read the full page. Any other location is a link to the page or entity; cite it.`,
    schema: {
      input: z =>
        z.object({
          query: z.string().min(1).describe('The question or topic to find'),
          alternatives: z
            .array(z.string())
            .max(3)
            .optional()
            .describe('Other phrasings or terms for the same thing'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(20)
            .optional()
            .default(8)
            .describe('Number of results to return'),
        }),
      output: z =>
        z.object({
          results: z.array(
            z.object({
              title: z.string(),
              location: z.string(),
              entityRef: z.string().optional(),
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

      const phrasings = [input.query, ...(input.alternatives ?? [])];
      const words = queryWords(phrasings);
      const joined = joinedWords(phrasings).filter(w => !words.includes(w));
      const [{ embeddings }, frequencies] = await Promise.all([
        embedMany({ model: embeddingModel, values: phrasings }),
        store.documentFrequencies([...words, ...joined], RARE_MAX_CHUNKS + 1),
      ]);
      const known = [...words, ...joined].filter(
        w => (frequencies.get(w) ?? 0) > 0,
      );
      const rare = known.filter(w => frequencies.get(w)! <= RARE_MAX_CHUNKS);
      const unknown = words.filter(w => frequencies.get(w) === 0);

      const lists: RankedList[] = await Promise.all([
        ...embeddings.map(async embedding => ({
          ids: await store.nearest(embedding, CANDIDATES),
          weight: 1 / embeddings.length,
        })),
        store.keyword(known, CANDIDATES).then(ids => ({ ids, weight: 1 })),
        store.keyword(rare, CANDIDATES).then(ids => ({ ids, weight: 1 })),
        store.fuzzy(unknown, CANDIDATES).then(ids => ({ ids, weight: 1 })),
      ]);

      const ranked = fuseRankings(lists).slice(0, FUSED);
      const byId = new Map(
        (await store.chunks(ranked)).map(chunk => [chunk.id, chunk]),
      );
      const candidates = ranked
        .map(id => byId.get(id))
        .filter((chunk): chunk is StoredChunk => Boolean(chunk));

      const readable = await readableEntityRefs(catalog, auth, credentials, [
        ...new Set(
          candidates.flatMap(chunk =>
            chunk.entityRef ? [chunk.entityRef] : [],
          ),
        ),
      ]);

      const seen = new Set<string>();
      const results = [];
      for (const chunk of candidates) {
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
        results.push({
          title: chunk.title,
          location: chunk.location,
          ...(chunk.entityRef ? { entityRef: chunk.entityRef } : {}),
          excerpt: chunk.content.slice(0, EXCERPT_CHARS),
        });
        if (results.length === input.limit) {
          break;
        }
      }
      return { output: { results } };
    },
  });
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
