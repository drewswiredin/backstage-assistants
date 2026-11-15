import knexFactory, { type Knex } from 'knex';
import type { AssistantDefinition } from '@drewswiredin/backstage-plugin-assistants-common';
import { AssistantOrderError, AssistantStore } from './assistants';

function def(title: string): Omit<AssistantDefinition, 'id'> {
  return {
    title,
    prompt: '',
    access: { allowAuthenticated: true, users: [], groups: [] },
    allowedTools: [],
    models: [],
    defaultModel: null,
  };
}

describe('AssistantStore order', () => {
  let db: Knex;
  let store: AssistantStore;

  beforeEach(async () => {
    db = knexFactory({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    store = new AssistantStore(db);
    await store.runMigrations();
    await store.seedOnce();
  });

  afterEach(async () => {
    await db.destroy();
  });

  const titles = (defs: AssistantDefinition[]) => defs.map(d => d.title);

  it('lists new assistants after the existing ones, not by title', async () => {
    await store.create(def('Zed'), 'user:default/a');
    await store.create(def('Alpha'), 'user:default/a');
    expect(titles(await store.listAll())).toEqual([
      'Assistant',
      'Zed',
      'Alpha',
    ]);
    expect(titles(store.list())).toEqual(['Assistant', 'Zed', 'Alpha']);
  });

  it('keeps the order an admin set, with the default first', async () => {
    const zed = await store.create(def('Zed'), 'user:default/a');
    const alpha = await store.create(def('Alpha'), 'user:default/a');
    const seeded = store.getDefaultId()!;
    await store.reorder([alpha.id, zed.id, seeded]);
    expect(titles(await store.listAll())).toEqual([
      'Assistant',
      'Alpha',
      'Zed',
    ]);
    expect(titles(store.list())).toEqual(['Assistant', 'Alpha', 'Zed']);

    await store.setDefault(zed.id, 'user:default/a');
    expect(titles(await store.listAll())).toEqual([
      'Zed',
      'Alpha',
      'Assistant',
    ]);
  });

  it('keeps the order through an edit', async () => {
    const zed = await store.create(def('Zed'), 'user:default/a');
    const alpha = await store.create(def('Alpha'), 'user:default/a');
    await store.reorder([store.getDefaultId()!, alpha.id, zed.id]);
    await store.update(zed.id, { ...zed, title: 'Aardvark' }, 'user:default/a');
    expect(titles(await store.listAll())).toEqual([
      'Assistant',
      'Alpha',
      'Aardvark',
    ]);
  });

  it('refuses an order that misses or repeats an assistant', async () => {
    const zed = await store.create(def('Zed'), 'user:default/a');
    const seeded = store.getDefaultId()!;
    await expect(store.reorder([zed.id])).rejects.toThrow(AssistantOrderError);
    await expect(store.reorder([zed.id, zed.id])).rejects.toThrow(
      AssistantOrderError,
    );
    await expect(store.reorder([zed.id, seeded, 'missing'])).rejects.toThrow(
      AssistantOrderError,
    );
  });
});
