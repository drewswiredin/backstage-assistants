import type { AuthService, LoggerService } from '@backstage/backend-plugin-api';
import type { CatalogService } from '@backstage/plugin-catalog-node';
import { GroupAncestry } from './groupAncestry';
import { isPolicyAccessible } from './config';

/** A catalog of groups, each with its `childOf` parents. */
function catalogOf(tree: Record<string, string[]>) {
  const getEntitiesByRefs = jest.fn(
    async ({ entityRefs }: { entityRefs: string[] }) => ({
      items: entityRefs.map(ref =>
        tree[ref]
          ? {
              relations: tree[ref].map(targetRef => ({
                type: 'childOf',
                targetRef,
              })),
            }
          : undefined,
      ),
    }),
  );
  return { getEntitiesByRefs } as unknown as CatalogService & {
    getEntitiesByRefs: typeof getEntitiesByRefs;
  };
}

const auth = {
  getOwnServiceCredentials: jest.fn(async () => ({ principal: {} })),
} as unknown as AuthService;
const logger = { warn: jest.fn() } as unknown as LoggerService;

describe('GroupAncestry', () => {
  it('adds every ancestor group, through cycles, one catalog call per level', async () => {
    const catalog = catalogOf({
      'group:default/payments': ['group:default/Engineering'],
      'group:default/engineering': [
        'group:default/org',
        'group:default/payments',
      ],
      'group:default/org': [],
    });
    const ancestry = new GroupAncestry({ catalog, auth, logger });
    expect(
      (
        await ancestry.expand(['user:default/ana', 'group:default/Payments'])
      ).sort(),
    ).toEqual([
      'group:default/engineering',
      'group:default/org',
      'group:default/payments',
      'user:default/ana',
    ]);
    expect(catalog.getEntitiesByRefs).toHaveBeenCalledTimes(3);
    expect(catalog.getEntitiesByRefs.mock.calls[0][0]).toEqual({
      entityRefs: ['group:default/payments'],
      fields: ['relations'],
    });
  });

  it('reuses parents until they expire', async () => {
    const catalog = catalogOf({ 'group:default/a': ['group:default/b'] });
    const ancestry = new GroupAncestry({ catalog, auth, logger, ttlMs: 0 });
    const cached = new GroupAncestry({ catalog, auth, logger });
    await cached.expand(['group:default/a']);
    await cached.expand(['group:default/a']);
    expect(catalog.getEntitiesByRefs).toHaveBeenCalledTimes(2);
    await ancestry.expand(['group:default/a']);
    await ancestry.expand(['group:default/a']);
    expect(catalog.getEntitiesByRefs).toHaveBeenCalledTimes(6);
  });

  it('falls back to the direct groups when the catalog fails', async () => {
    const catalog = {
      getEntitiesByRefs: jest.fn(async () => {
        throw new Error('catalog down');
      }),
    } as unknown as CatalogService;
    const ancestry = new GroupAncestry({ catalog, auth, logger });
    expect(await ancestry.expand(['group:default/A'])).toEqual([
      'group:default/a',
    ]);
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('isPolicyAccessible', () => {
  it('compares entity refs case-insensitively', () => {
    const policy = {
      allowAuthenticated: false,
      users: ['user:default/Ana'],
      groups: ['group:default/Engineering'],
    };
    expect(
      isPolicyAccessible(policy, {
        userEntityRef: 'user:default/ana',
        ownershipEntityRefs: [],
      }),
    ).toBe(true);
    expect(
      isPolicyAccessible(policy, {
        userEntityRef: 'user:default/bo',
        ownershipEntityRefs: ['group:default/engineering'],
      }),
    ).toBe(true);
    expect(
      isPolicyAccessible(policy, {
        userEntityRef: 'user:default/bo',
        ownershipEntityRefs: ['group:default/payments'],
      }),
    ).toBe(false);
  });
});
