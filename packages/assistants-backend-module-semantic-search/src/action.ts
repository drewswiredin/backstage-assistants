import type {
  AuthService,
  BackstageCredentials,
} from '@backstage/backend-plugin-api';
import type { ActionsRegistryService } from '@backstage/backend-plugin-api/alpha';
import type { CatalogApi } from '@backstage/catalog-client';
import { embedMany, type EmbeddingModel } from 'ai';
import { fuseRankings, queryWords, type RankedList } from './rank';
import type { KnowledgeStore, StoredChunk } from './store';

/** Candidates per retrieval list, before fusion and permission filtering. */
const CANDIDATES = 30;
/** Fused candidates checked for permission; over-fetched so filtering rarely empties the page. */
const FUSED = 40;
const EXCERPT_CHARS = 1500;

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
 * near spelling (trigram). The lists are fused by reciprocal rank, then
 * filtered to entities the caller can read in the catalog.
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
    description: `Search the organization's TechDocs and software catalog by meaning, not only by exact words. Best for questions in the user's own words: it finds a page even when the question is worded differently from it ("fix errored messages" finds "Retry dead-letter messages") and tolerates misspelled names ("Pilon" finds "Pylon"). It returns the most relevant sections, not every match, and cannot filter by entity kind.

Pass the user's question as "query". Pass up to three "alternatives": other phrasings, synonyms, or the internal terms the docs might use.

Each result has a title (its heading path), an excerpt, and a location. For TechDocs results, pass the location to read-techdocs to read the full page. For catalog results, the location is the entity ref.`,
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
              source: z.enum(['techdocs', 'catalog']),
              title: z.string(),
              location: z.string(),
              entityRef: z.string(),
              excerpt: z.string(),
            }),
          ),
        }),
    },
    action: async ({ input, credentials }) => {
      if (!(await store.isReady())) {
        throw new Error(
          'The knowledge index is still being built; use search-techdocs or search-catalog meanwhile.',
        );
      }

      const phrasings = [input.query, ...(input.alternatives ?? [])];
      const words = queryWords(phrasings);
      const [{ embeddings }, unknown] = await Promise.all([
        embedMany({ model: embeddingModel, values: phrasings }),
        store.unknownWords(words),
      ]);

      const lists: RankedList[] = await Promise.all([
        ...embeddings.map(async embedding => ({
          ids: await store.nearest(embedding, CANDIDATES),
          weight: 1,
        })),
        store.keyword(words, CANDIDATES).then(ids => ({ ids, weight: 1 })),
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
        ...new Set(candidates.map(chunk => chunk.entityRef)),
      ]);

      const seen = new Set<string>();
      const results = [];
      for (const chunk of candidates) {
        const key = `${chunk.location}|${chunk.title}`;
        if (!readable.has(chunk.entityRef) || seen.has(key)) {
          continue;
        }
        seen.add(key);
        results.push({
          source: chunk.source,
          title: chunk.title,
          location: chunk.location,
          entityRef: chunk.entityRef,
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
