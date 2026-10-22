import {
  createServiceFactory,
  createServiceRef,
} from '@backstage/backend-plugin-api';
import type {
  DocumentDecoratorFactory,
  IndexableDocument,
} from '@backstage/plugin-search-common';
import { PassThrough, Transform } from 'node:stream';

/**
 * Hands Backstage search's documents to the knowledge index, within one
 * backend. The search module publishes each finished collation; the
 * assistants module listens. Root-scoped, so both plugins share the one
 * instance.
 */
export class KnowledgeFeed {
  #listener?: (documents: IndexableDocument[]) => void;

  /** Set when the search module is installed; without it nothing is published. */
  tapped = false;

  get listening(): boolean {
    return this.#listener !== undefined;
  }

  listen(listener: (documents: IndexableDocument[]) => void): void {
    this.#listener = listener;
  }

  publish(documents: IndexableDocument[]): void {
    this.#listener?.(documents);
  }
}

export const knowledgeFeedServiceRef = createServiceRef<KnowledgeFeed>({
  id: 'drewswiredin.assistants.knowledge-feed',
  scope: 'root',
  defaultFactory: async service =>
    createServiceFactory({
      service,
      deps: {},
      factory: () => new KnowledgeFeed(),
    }),
});

/**
 * A search decorator on every document type: passes each document on to the
 * search engine unchanged and, when the collation finishes, publishes the
 * run's documents to the feed. A failed collation never reaches `flush`, so
 * it publishes nothing. While the knowledge index is off it is a plain
 * pass-through and keeps nothing.
 */
export class AssistantsKnowledgeDecorator implements DocumentDecoratorFactory {
  constructor(private readonly feed: KnowledgeFeed) {}

  async getDecorator(): Promise<Transform> {
    if (!this.feed.listening) {
      return new PassThrough({ objectMode: true });
    }
    const feed = this.feed;
    const documents: IndexableDocument[] = [];
    return new Transform({
      objectMode: true,
      transform(doc: IndexableDocument, _encoding, done) {
        documents.push(doc);
        done(null, doc);
      },
      flush(done) {
        feed.publish(documents);
        done();
      },
    });
  }
}
