import knexFactory, { type Knex } from 'knex';
import { ThreadService, TURN_STALE_MS } from './threads';

const ALICE = 'user:default/alice';
const BOB = 'user:default/bob';

describe('ThreadService turn state across replicas', () => {
  let db: Knex;
  // Two services on one database stand in for two backend replicas.
  let replicaA: ThreadService;
  let replicaB: ThreadService;
  let threadId: string;

  beforeEach(async () => {
    db = knexFactory({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    replicaA = new ThreadService(db);
    replicaB = new ThreadService(db);
    await replicaA.runMigrations();
    threadId = (await replicaA.createThread(ALICE, 'helper')).id;
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function workingOn(service: ThreadService): Promise<boolean> {
    const rows = await service.listUserThreadStatuses(ALICE);
    return rows.find(r => r.threadId === threadId)!.working;
  }

  it('reports a turn started on one replica as working on another', async () => {
    expect(await workingOn(replicaB)).toBe(false);
    await replicaA.startTurn(threadId);
    expect(await workingOn(replicaB)).toBe(true);
    await replicaA.endTurn(threadId);
    expect(await workingOn(replicaB)).toBe(false);
  });

  it('stops reporting working once the heartbeat goes stale', async () => {
    await replicaA.startTurn(threadId);
    await db('threads')
      .where({ id: threadId })
      .update({
        turn_heartbeat_at: new Date(
          Date.now() - TURN_STALE_MS - 1_000,
        ).toISOString(),
      });
    expect(await workingOn(replicaB)).toBe(false);
    // A heartbeat from the running replica makes it fresh again.
    await replicaA.heartbeatTurn(threadId);
    expect(await workingOn(replicaB)).toBe(true);
  });

  it('carries a cancel from one replica to the heartbeat of the other', async () => {
    await replicaA.startTurn(threadId);
    expect(await replicaA.heartbeatTurn(threadId)).toBe(false);
    expect(await replicaB.requestCancel(ALICE, threadId)).toBe(true);
    expect(await replicaA.heartbeatTurn(threadId)).toBe(true);
    // A new turn starts without the old request.
    await replicaA.endTurn(threadId);
    await replicaA.startTurn(threadId);
    expect(await replicaA.heartbeatTurn(threadId)).toBe(false);
  });

  it('refuses a cancel for another user or for no running turn', async () => {
    expect(await replicaB.requestCancel(ALICE, threadId)).toBe(false);
    await replicaA.startTurn(threadId);
    expect(await replicaB.requestCancel(BOB, threadId)).toBe(false);
    expect(await replicaA.heartbeatTurn(threadId)).toBe(false);
  });

  it('does not revive a finished turn from a late heartbeat', async () => {
    await replicaA.startTurn(threadId);
    await replicaA.endTurn(threadId);
    await replicaA.heartbeatTurn(threadId);
    expect(await workingOn(replicaB)).toBe(false);
  });
});
