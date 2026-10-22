import type { IndexableDocument } from '@backstage/plugin-search-common';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AssistantsKnowledgeDecorator, KnowledgeFeed } from './feed';

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
    const published: IndexableDocument[][] = [];
    feed.listen(run => published.push(run));
    const received: IndexableDocument[] = [];

    await pipeline(
      Readable.from(docs),
      await new AssistantsKnowledgeDecorator(feed).getDecorator(),
      sink(received),
    );

    expect(received).toEqual(docs);
    expect(published).toEqual([docs]);
  });

  it('publishes nothing when the collation fails', async () => {
    const feed = new KnowledgeFeed();
    const published: IndexableDocument[][] = [];
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
});
