import type { AuthService, LoggerService } from '@backstage/backend-plugin-api';
import type { CatalogService } from '@backstage/plugin-catalog-node';

/** How long a group's parents are reused before the catalog is asked again. */
const PARENTS_TTL_MS = 60_000;

/**
 * Resolves the groups a user belongs to through the catalog's group
 * hierarchy: a member of `group:default/payments`, which is `childOf`
 * `group:default/engineering`, belongs to both. `ownershipEntityRefs` holds
 * only the user and their direct groups, so an assistant granted to a parent
 * group would otherwise miss every member of its child groups. The same
 * resolution the RBAC plugin applies to its group roles.
 *
 * Parents are cached per group for a minute; a catalog failure falls back to
 * the direct refs (never to more access) and is not cached.
 */
export class GroupAncestry {
  private readonly parents = new Map<
    string,
    { refs: string[]; expires: number }
  >();

  constructor(
    private readonly options: {
      catalog: CatalogService;
      auth: AuthService;
      logger: LoggerService;
      ttlMs?: number;
    },
  ) {}

  /** `refs` with every ancestor group of their groups added, lowercased. */
  async expand(refs: string[]): Promise<string[]> {
    const all = new Set(refs.map(r => r.toLocaleLowerCase('en-US')));
    let frontier = [...all].filter(r => r.startsWith('group:'));
    try {
      while (frontier.length > 0) {
        const next: string[] = [];
        for (const parent of (await this.parentsOf(frontier)).flat()) {
          if (!all.has(parent)) {
            all.add(parent);
            next.push(parent);
          }
        }
        frontier = next;
      }
    } catch (error) {
      this.options.logger.warn(
        `could not resolve parent groups from the catalog; using direct groups only: ${error}`,
      );
      return refs.map(r => r.toLocaleLowerCase('en-US'));
    }
    return [...all];
  }

  /** Each group's `childOf` targets, from the cache or one catalog call. */
  private async parentsOf(groups: string[]): Promise<string[][]> {
    const now = Date.now();
    const missing = groups.filter(g => {
      const hit = this.parents.get(g);
      return !hit || hit.expires <= now;
    });
    if (missing.length > 0) {
      const { catalog, auth } = this.options;
      const { items } = await catalog.getEntitiesByRefs(
        { entityRefs: missing, fields: ['relations'] },
        { credentials: await auth.getOwnServiceCredentials() },
      );
      const expires = now + (this.options.ttlMs ?? PARENTS_TTL_MS);
      missing.forEach((group, i) => {
        const refs = (items[i]?.relations ?? [])
          .filter(r => r.type === 'childOf')
          .map(r => r.targetRef.toLocaleLowerCase('en-US'));
        this.parents.set(group, { refs, expires });
      });
    }
    return groups.map(g => this.parents.get(g)?.refs ?? []);
  }
}
