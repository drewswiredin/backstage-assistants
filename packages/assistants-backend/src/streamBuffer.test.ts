import knexFactory, { type Knex } from 'knex';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { StreamBuffer, type StreamFollower } from './streamBuffer';
import { ThreadService } from './threads';

/** A stream whose chunks the test pushes, and closes, by hand. */
function controlledStream() {
  let controller!: ReadableStreamDefaultController<string>;
  const stream = new ReadableStream<string>({
    start: c => {
      controller = c;
    },
  });
  return {
    stream,
    push: (chunk: string) => controller.enqueue(chunk),
    close: () => controller.close(),
  };
}

function collector(running = true) {
  const out = { started: false, data: '' };
  const follower: StreamFollower = {
    start: () => {
      out.started = true;
    },
    write: d => {
      out.data += d;
    },
    closed: () => false,
    running: async () => running,
  };
  return { out, follower };
}

const logger = { warn: jest.fn() } as unknown as LoggerService;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('StreamBuffer across replicas', () => {
  let db: Knex;
  // Two buffers on one database stand in for two backend replicas.
  let writer: StreamBuffer;
  let reader: StreamBuffer;
  let threadId: string;

  beforeEach(async () => {
    db = knexFactory({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    const threads = new ThreadService(db);
    await threads.runMigrations();
    threadId = (await threads.createThread('user:default/alice', 'helper')).id;
    writer = new StreamBuffer(db, logger);
    reader = new StreamBuffer(db, logger);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('finds nothing for a thread with no buffered turn', async () => {
    const { out, follower } = collector();
    expect(await reader.follow(threadId, follower)).toBe(false);
    expect(out.started).toBe(false);
  });

  it('replays the buffered stream and follows the live tail to the end', async () => {
    const turnId = await writer.begin(threadId);
    const s = controlledStream();
    writer.record(threadId, turnId, s.stream);
    s.push('data: one\n\n');
    await sleep(400);

    const { out, follower } = collector();
    const following = reader.follow(threadId, follower);
    await sleep(400);
    expect(out.data).toBe('data: one\n\n');

    s.push('data: two\n\n');
    s.close();
    expect(await following).toBe(true);
    expect(out).toEqual({ started: true, data: 'data: one\n\ndata: two\n\n' });
  });

  it('starts at once, before the first batch is written', async () => {
    await writer.begin(threadId);
    const { out, follower } = collector(false);
    // Nothing recorded and the turn is not running: starts, then ends idle.
    expect(await reader.follow(threadId, follower)).toBe(true);
    expect(out).toEqual({ started: true, data: '' });
  }, 10_000);

  it('ends a follower when the next turn replaces the buffer', async () => {
    const first = await writer.begin(threadId);
    const s1 = controlledStream();
    writer.record(threadId, first, s1.stream);
    s1.push('data: old\n\n');
    await sleep(400);

    const { out, follower } = collector();
    const following = reader.follow(threadId, follower);
    await sleep(100);
    const second = await writer.begin(threadId);
    const s2 = controlledStream();
    writer.record(threadId, second, s2.stream);
    s2.push('data: new\n\n');
    s2.close();
    expect(await following).toBe(true);
    expect(out.data).toBe('data: old\n\n');
    s1.close();
    await sleep(100);
  });
});
