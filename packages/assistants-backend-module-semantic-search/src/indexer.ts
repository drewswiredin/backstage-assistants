import type { LoggerService } from '@backstage/backend-plugin-api';
import { embed, embedMany, type EmbeddingModel } from 'ai';
import { chunkDocument, embeddingInput, type Chunk } from './chunk';
import type { CollectedDocuments } from './sources';
import type { KnowledgeStore } from './store';

const EMBED_BATCH = 96;

export interface IndexRunDeps {
  store: KnowledgeStore;
  embeddingModel: EmbeddingModel;
  collect: () => Promise<CollectedDocuments>;
  logger: LoggerService;
}

/**
 * One refresh of the knowledge index. Probes the model's dimensions (a model
 * change rebuilds the table), collects every document, embeds only chunks
 * whose content changed, and deletes chunks that no longer exist. A failed
 * collection throws before anything is deleted.
 */
export async function runIndex({
  store,
  embeddingModel,
  collect,
  logger,
}: IndexRunDeps): Promise<void> {
  const started = Date.now();

  const probe = await embed({ model: embeddingModel, value: 'dimensions' });
  await store.ensureSchema(probe.embedding.length);

  const { documents, failedEntityRefs } = await collect();
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
    await store.upsert(batch, embeddings);
  }

  const deleted = await store.deleteExcept(
    chunks.map(chunk => chunk.id),
    failedEntityRefs,
  );

  logger.info('Knowledge index refreshed', {
    documents: documents.length,
    chunks: chunks.length,
    embedded: changed.length,
    deleted,
    failedEntities: failedEntityRefs.length,
    durationMs: Date.now() - started,
  });
}
