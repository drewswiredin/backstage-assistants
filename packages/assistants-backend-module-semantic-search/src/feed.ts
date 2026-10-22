import {
  createServiceFactory,
  createServiceRef,
} from '@backstage/backend-plugin-api';
import type {
  DocumentDecoratorFactory,
  IndexableDocument,
} from '@backstage/plugin-search-common';
import { PassThrough, Transform } from 'node:stream';

/** One finished search collator run. */
export interface KnowledgeRun {
  /** The search document type, when it is named in `assistants.semanticSearch.types`. */
  type?: string;
  /** Every document the run indexed; empty for a type that is not copied. */
  documents: IndexableDocument[];
}

/** A run whose pipeline is being assembled, before its type label arrives. */
interface PendingRun {
  type?: string;
  keep: boolean;
}

/**
 * Hands Backstage search's documents to the knowledge index, within one
 * backend. The search module publishes each finished collation; the
 * assistants module listens. Root-scoped, so both plugins share the one
 * instance.
 */
export class KnowledgeFeed {
  #listener?: (run: KnowledgeRun) => void;
  #pending?: PendingRun;

  /** Set when the search module is installed; without it nothing is published. */
  tapped = false;

  get listening(): boolean {
    return this.#listener !== undefined;
  }

  listen(listener: (run: KnowledgeRun) => void): void {
    this.#listener = listener;
  }

  publish(run: KnowledgeRun): void {
    this.#listener?.(run);
  }

  /**
   * Starts a run. Search builds a run's pipeline by calling every decorator
   * factory in one synchronous pass, wildcard factories first, so a typed
   * label created in the same pass belongs to this run. The pending run is
   * forgotten once that pass ends.
   */
  begin(): PendingRun {
    const run: PendingRun = { keep: true };
    this.#pending = run;
    queueMicrotask(() => {
      if (this.#pending === run) {
        this.#pending = undefined;
      }
    });
    return run;
  }

  /** Names the type of the run whose pipeline is being assembled. */
  label(type: string, keep: boolean): void {
    if (this.#pending) {
      this.#pending.type = type;
      this.#pending.keep = keep;
    }
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
 * pass-through and keeps nothing; for a type that is not copied it keeps
 * nothing and publishes the empty run.
 */
export class AssistantsKnowledgeDecorator implements DocumentDecoratorFactory {
  constructor(private readonly feed: KnowledgeFeed) {}

  async getDecorator(): Promise<Transform> {
    if (!this.feed.listening) {
      return new PassThrough({ objectMode: true });
    }
    const feed = this.feed;
    const run = feed.begin();
    const documents: IndexableDocument[] = [];
    return new Transform({
      objectMode: true,
      transform(doc: IndexableDocument, _encoding, done) {
        if (run.keep) {
          documents.push(doc);
        }
        done(null, doc);
      },
      flush(done) {
        feed.publish({
          ...(run.type ? { type: run.type } : {}),
          documents,
        });
        done();
      },
    });
  }
}

/**
 * A pass-through decorator on one configured document type. It adds nothing
 * to the pipeline; creating it tells the feed which type the run being
 * assembled is, since search never tells a decorator its type.
 */
export class KnowledgeTypeLabel implements DocumentDecoratorFactory {
  readonly types: string[];

  constructor(
    private readonly feed: KnowledgeFeed,
    private readonly type: string,
    private readonly enabled: boolean,
  ) {
    this.types = [type];
  }

  async getDecorator(): Promise<Transform> {
    this.feed.label(this.type, this.enabled);
    return new PassThrough({ objectMode: true });
  }
}
