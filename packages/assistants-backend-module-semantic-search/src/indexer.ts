import type { LoggerService } from '@backstage/backend-plugin-api';
import type { IndexableDocument } from '@backstage/plugin-search-common';
import { embed, embedMany, type EmbeddingModel } from 'ai';
import { randomUUID } from 'node:crypto';
import { chunkDocument, embeddingInput, type Chunk } from './chunk';
import { toSourceDocuments } from './documents';
import type { KnowledgeStore } from './store';

const EMBED_BATCH = 96;

export interface IndexRunDeps {
  store: KnowledgeStore;
  embeddingModel: EmbeddingModel;
  /** Every document one Backstage search run indexed. */
  documents: IndexableDocument[];
  logger: LoggerService;
}

/**
 * Copies one finished search run into the knowledge index. Probes the
 * model's dimensions (a model change rebuilds the table), embeds only chunks
 * whose content changed, deletes the chunks of that run's collection that no
 * longer exist, and drops collections no run refreshes any more. A run with
 * no documents changes nothing, as the search engines keep their index when a
 * collator returns nothing.
 */
export async function runIndex({
  store,
  embeddingModel,
  documents: indexed,
  logger,
}: IndexRunDeps): Promise<void> {
  const started = Date.now();
  const { documents, skipped } = toSourceDocuments(indexed);
  if (documents.length === 0) {
    return;
  }

  const probe = await embed({ model: embeddingModel, value: 'dimensions' });
  await store.ensureSchema(probe.embedding.length);

  const collection =
    (await store.collectionOf(documents.map(doc => doc.location))) ??
    randomUUID();
  const chunks = documents.flatMap(chunkDocument);
  const existing = await store.hashes();
  const changed = chunks.filter(chunk => existing.get(chunk.id) !== chunk.hash);

  for (let i = 0; i < changed.length; i += EMBED_BATCH) {
    const batch = changed.slice(i, i + EMBED_BATCH);
    const { embeddings } = await embedMany({
      model: embeddingModel,
      values: batch.map((chunk: Chunk) =>
        embeddingInput(chunk.title, chunk.content),
      ),
      maxParallelCalls: 2,
    });
    await store.upsert(collection, batch, embeddings);
  }

  const deleted = await store.deleteExcept(
    collection,
    chunks.map(chunk => chunk.id),
  );
  const dropped = await store.refreshed(collection);

  logger.info('Knowledge index refreshed', {
    collection,
    sample: documents[0].location,
    documents: documents.length,
    skipped,
    chunks: chunks.length,
    embedded: changed.length,
    deleted,
    dropped,
    durationMs: Date.now() - started,
  });
}
