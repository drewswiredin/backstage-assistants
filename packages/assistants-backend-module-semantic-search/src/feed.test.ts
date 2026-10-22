import type { IndexableDocument } from '@backstage/plugin-search-common';
import { Readable, Writable, type Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  AssistantsKnowledgeDecorator,
  KnowledgeFeed,
  KnowledgeTypeLabel,
  type KnowledgeRun,
} from './feed';

const docs: IndexableDocument[] = [
  { title: 'A', text: 'a', location: '/a' },
  { title: 'B', text: 'b', location: '/b' },
];

function sink(received: IndexableDocument[]) {
  return new Writable({
    objectMode: true,
    write(doc, _encoding, done) {
      received.push(doc);
      done();
    },
  });
}

describe('AssistantsKnowledgeDecorator', () => {
  it('passes documents on unchanged and publishes the run when it finishes', async () => {
    const feed = new KnowledgeFeed();
    const published: KnowledgeRun[] = [];
    feed.listen(run => published.push(run));
    const received: IndexableDocument[] = [];

    await pipeline(
      Readable.from(docs),
      await new AssistantsKnowledgeDecorator(feed).getDecorator(),
      sink(received),
    );

    expect(received).toEqual(docs);
    expect(published).toEqual([{ documents: docs }]);
  });

  it('publishes nothing when the collation fails', async () => {
    const feed = new KnowledgeFeed();
    const published: KnowledgeRun[] = [];
    feed.listen(run => published.push(run));
    async function* failing() {
      yield docs[0];
      throw new Error('source down');
    }

    await expect(
      pipeline(
        Readable.from(failing()),
        await new AssistantsKnowledgeDecorator(feed).getDecorator(),
        sink([]),
      ),
    ).rejects.toThrow('source down');
    expect(published).toEqual([]);
  });

  it('only passes documents through while nothing listens', async () => {
    const received: IndexableDocument[] = [];
    await pipeline(
      Readable.from(docs),
      await new AssistantsKnowledgeDecorator(
        new KnowledgeFeed(),
      ).getDecorator(),
      sink(received),
    );
    expect(received).toEqual(docs);
  });

  /** Assembles a pipeline the way search does: every factory called in one pass, wildcards first. */
  async function collate(
    ...factories: Array<{ getDecorator(): Promise<Transform> }>
  ) {
    const decorators = await Promise.all(
      factories.map(async factory => factory.getDecorator()),
    );
    await pipeline([Readable.from(docs), ...decorators, sink([])]);
  }

  it('publishes the type a label on the same pipeline names', async () => {
    const feed = new KnowledgeFeed();
    const published: KnowledgeRun[] = [];
    feed.listen(run => published.push(run));
    const wildcard = new AssistantsKnowledgeDecorator(feed);

    await collate(wildcard, new KnowledgeTypeLabel(feed, 'confluence', true));
    await collate(wildcard);

    expect(published).toEqual([
      { type: 'confluence', documents: docs },
      { documents: docs },
    ]);
  });

  it('keeps nothing of a type that is not copied', async () => {
    const feed = new KnowledgeFeed();
    const published: KnowledgeRun[] = [];
    feed.listen(run => published.push(run));

    await collate(
      new AssistantsKnowledgeDecorator(feed),
      new KnowledgeTypeLabel(feed, 'jira', false),
    );

    expect(published).toEqual([{ type: 'jira', documents: [] }]);
  });

  it('labels nothing when the label comes after the pipeline is assembled', async () => {
    const feed = new KnowledgeFeed();
    const published: KnowledgeRun[] = [];
    feed.listen(run => published.push(run));
    const decorator = await new AssistantsKnowledgeDecorator(
      feed,
    ).getDecorator();
    await Promise.resolve();
    await new KnowledgeTypeLabel(feed, 'jira', true).getDecorator();

    await pipeline(Readable.from(docs), decorator, sink([]));

    expect(published).toEqual([{ documents: docs }]);
  });
});
