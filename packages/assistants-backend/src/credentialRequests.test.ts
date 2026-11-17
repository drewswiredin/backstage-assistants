import knexFactory from 'knex';
import type { CredentialsRequest } from '@drewswiredin/backstage-plugin-assistants-common';
import { CredentialRequestBroker } from './credentialRequests';
import { ThreadService } from './threads';

const ANA = 'user:default/ana';
const BO = 'user:default/bo';

describe('CredentialRequestBroker', () => {
  const db = knexFactory({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  beforeAll(async () => {
    await new ThreadService(db).runMigrations();
  });
  afterAll(async () => {
    await db.destroy();
  });

  /** A request on `broker`, with what it showed and its eventual token. */
  const ask = (broker: CredentialRequestBroker, signal?: AbortSignal) => {
    const shown: CredentialsRequest[] = [];
    let opened!: (id: string) => void;
    const id = new Promise<string>(resolve => {
      opened = resolve;
    });
    const token = broker.request({
      userEntityRef: ANA,
      serverId: 'github',
      signal,
      show: request => {
        shown.push(request);
        if (request.status === 'open') opened(request.id);
      },
    });
    return { id, token, shown };
  };

  it("hands the browser's token to the waiting call and shows the request settle", async () => {
    const broker = new CredentialRequestBroker({ db, pollMs: 10 });
    const { id, token, shown } = ask(broker);
    expect(await broker.claim(await id, ANA)).toEqual({ status: 204 });
    expect(
      await broker.respond(await id, ANA, server =>
        server === 'github' ? 'ghu_new' : undefined,
      ),
    ).toEqual({ status: 204 });
    expect(await token).toBe('ghu_new');
    expect(shown.map(r => r.status)).toEqual(['open', 'settled']);
  });

  it('reaches the call from another replica without storing a usable token', async () => {
    const holding = new CredentialRequestBroker({ db, pollMs: 10 });
    const other = new CredentialRequestBroker({ db, pollMs: 10 });
    const { id, token } = ask(holding);
    await other.claim(await id, ANA);
    await other.respond(await id, ANA, () => 'ghu_new');
    const stored = (
      await db('credential_requests')
        .where({ id: await id })
        .first()
    ).response as string;
    expect(stored).not.toContain('ghu_new');
    expect(await token).toBe('ghu_new');
    // Settled, the row keeps no token at all.
    expect(
      (
        await db('credential_requests')
          .where({ id: await id })
          .first()
      ).response,
    ).toBe('settled');
  });

  it('lets one tab claim a request', async () => {
    const broker = new CredentialRequestBroker({ db, pollMs: 10 });
    const { id, token } = ask(broker);
    expect(await broker.claim(await id, ANA)).toEqual({ status: 204 });
    expect(await broker.claim(await id, ANA)).toEqual({ status: 410 });
    await broker.respond(await id, ANA, () => undefined);
    expect(await token).toBeUndefined();
  });

  it("refuses another user's answer, an unknown request, and a late answer", async () => {
    const broker = new CredentialRequestBroker({ db, pollMs: 10 });
    const { id, token } = ask(broker);
    expect(await broker.claim(await id, BO)).toEqual({ status: 403 });
    expect(await broker.respond(await id, BO, () => 'x')).toEqual({
      status: 403,
    });
    expect(await broker.respond('nope', ANA, () => 'x')).toEqual({
      status: 404,
    });
    await broker.respond(await id, ANA, () => 'ghu_new');
    await token;
    expect(await broker.respond(await id, ANA, () => 'again')).toEqual({
      status: 410,
    });
    expect(await broker.claim(await id, ANA)).toEqual({ status: 410 });
  });

  it('gives up when the browser does not answer, or the turn stops', async () => {
    const quick = new CredentialRequestBroker({
      db,
      timeoutMs: 30,
      pollMs: 10,
    });
    expect(await ask(quick).token).toBeUndefined();

    const broker = new CredentialRequestBroker({ db, pollMs: 10 });
    const stop = new AbortController();
    const { id, token } = ask(broker, stop.signal);
    await id;
    stop.abort();
    expect(await token).toBeUndefined();
  });
});
