import type {
  AuthService,
  DiscoveryService,
  LoggerService,
} from '@backstage/backend-plugin-api';
import {
  CATALOG_FILTER_EXISTS,
  type CatalogApi,
} from '@backstage/catalog-client';
import { stringifyEntityRef, type Entity } from '@backstage/catalog-model';
import { Config } from '@backstage/config';
import { parse } from 'node-html-parser';

/**
 * One searchable unit before chunking: a TechDocs section or a catalog entity.
 */
export interface SourceDocument {
  source: 'techdocs' | 'catalog';
  /** Stable identity across runs (TechDocs: page path + anchor; catalog: entity ref). */
  key: string;
  /** The entity whose read permission gates this document. */
  entityRef: string;
  /** TechDocs page path for `read-techdocs` (no fragment), or the entity ref. */
  location: string;
  /** Heading path, e.g. `Messaging standards › Dead-letter handling › Retrying`. */
  title: string;
  text: string;
}

export interface CollectedDocuments {
  documents: SourceDocument[];
  /** Entities whose docs failed to load this run; their indexed chunks are kept. */
  failedEntityRefs: string[];
}

export interface SourceDeps {
  catalog: CatalogApi;
  discovery: DiscoveryService;
  auth: AuthService;
  config: Config;
  logger: LoggerService;
}

/** An entry of MkDocs' `search/search_index.json`. */
export interface MkSearchIndexDoc {
  title: string;
  text: string;
  location: string;
}

const FETCH_CONCURRENCY = 8;
const PAGE_SIZE = 500;

/** Every TechDocs section and every catalog entity, as the plugin's own service identity. */
export async function collectDocuments(
  deps: SourceDeps,
): Promise<CollectedDocuments> {
  const [techdocs, catalog] = await Promise.all([
    collectTechDocs(deps),
    collectCatalog(deps),
  ]);
  return {
    documents: [...techdocs.documents, ...catalog],
    failedEntityRefs: techdocs.failedEntityRefs,
  };
}

async function serviceToken(auth: AuthService, targetPluginId: string) {
  const { token } = await auth.getPluginRequestToken({
    onBehalfOf: await auth.getOwnServiceCredentials(),
    targetPluginId,
  });
  return token;
}

/**
 * Reads each published TechDocs site's MkDocs search index — the same source
 * and URL scheme as Backstage's TechDocs search collator. A site that is not
 * built yet (404) has no documents; any other failure keeps that entity's
 * previously indexed chunks.
 */
async function collectTechDocs({
  catalog,
  discovery,
  auth,
  config,
  logger,
}: SourceDeps): Promise<CollectedDocuments> {
  const legacyCasing =
    config.getOptionalBoolean('techdocs.legacyUseCaseSensitiveTripletPaths') ??
    false;
  const techdocsBaseUrl = await discovery.getBaseUrl('techdocs');

  const entities: Entity[] = [];
  let cursor: string | undefined;
  do {
    const page = await catalog.queryEntities(
      cursor
        ? { cursor, limit: PAGE_SIZE }
        : {
            filter: {
              'metadata.annotations.backstage.io/techdocs-ref':
                CATALOG_FILTER_EXISTS,
            },
            fields: [
              'kind',
              'metadata.namespace',
              'metadata.name',
              'metadata.title',
            ],
            limit: PAGE_SIZE,
          },
      { token: await serviceToken(auth, 'catalog') },
    );
    entities.push(...page.items);
    cursor = page.pageInfo.nextCursor;
  } while (cursor);

  const documents: SourceDocument[] = [];
  const failedEntityRefs: string[] = [];
  await forEachConcurrently(entities, FETCH_CONCURRENCY, async entity => {
    const entityRef = stringifyEntityRef(entity);
    const triplet = {
      namespace: entity.metadata.namespace ?? 'default',
      kind: entity.kind,
      name: entity.metadata.name,
    };
    const path = legacyCasing
      ? triplet
      : {
          namespace: triplet.namespace.toLocaleLowerCase('en-US'),
          kind: triplet.kind.toLocaleLowerCase('en-US'),
          name: triplet.name.toLocaleLowerCase('en-US'),
        };
    const siteRoot = `/docs/${path.namespace}/${path.kind}/${path.name}/`;
    try {
      const response = await fetch(
        `${techdocsBaseUrl}/static${siteRoot}search/search_index.json`,
        {
          headers: {
            Authorization: `Bearer ${await serviceToken(auth, 'techdocs')}`,
          },
        },
      );
      if (response.status === 404) {
        return;
      }
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      const index = (await response.json()) as { docs?: MkSearchIndexDoc[] };
      documents.push(
        ...techDocsDocuments(
          index.docs ?? [],
          entityRef,
          entity.metadata.title ?? entity.metadata.name,
          siteRoot,
        ),
      );
    } catch (error) {
      failedEntityRefs.push(entityRef);
      logger.warn(`Could not read the TechDocs search index for ${entityRef}`, {
        error: String(error),
      });
    }
  });

  return { documents, failedEntityRefs };
}

/**
 * Maps one site's MkDocs search index to documents. Page entries (no `#`)
 * supply the page title for their sections' heading paths; entries without
 * text are skipped.
 */
export function techDocsDocuments(
  docs: MkSearchIndexDoc[],
  entityRef: string,
  siteTitle: string,
  siteRoot: string,
): SourceDocument[] {
  const pageTitles = new Map<string, string>();
  for (const doc of docs) {
    if (!doc.location.includes('#')) {
      pageTitles.set(doc.location, htmlToText(doc.title));
    }
  }

  return docs.flatMap(doc => {
    const text = htmlToText(doc.text);
    if (!text) {
      return [];
    }
    const page = doc.location.split('#')[0];
    return [
      {
        source: 'techdocs' as const,
        key: `${siteRoot}${doc.location}`,
        entityRef,
        location: `${siteRoot}${page}`,
        title: headingPath([
          siteTitle,
          pageTitles.get(page),
          htmlToText(doc.title),
        ]),
        text,
      },
    ];
  });
}

/** Every catalog entity except `Location`, described in a few lines. */
async function collectCatalog({
  catalog,
  auth,
}: SourceDeps): Promise<SourceDocument[]> {
  const documents: SourceDocument[] = [];
  let cursor: string | undefined;
  do {
    const page = await catalog.queryEntities(
      cursor
        ? { cursor, limit: PAGE_SIZE }
        : {
            fields: [
              'kind',
              'metadata.namespace',
              'metadata.name',
              'metadata.title',
              'metadata.description',
              'metadata.tags',
              'spec.type',
              'spec.lifecycle',
              'spec.owner',
              'spec.system',
              'spec.profile.displayName',
            ],
            limit: PAGE_SIZE,
          },
      { token: await serviceToken(auth, 'catalog') },
    );
    for (const entity of page.items) {
      if (entity.kind !== 'Location') {
        documents.push(catalogDocument(entity));
      }
    }
    cursor = page.pageInfo.nextCursor;
  } while (cursor);
  return documents;
}

export function catalogDocument(entity: Entity): SourceDocument {
  const entityRef = stringifyEntityRef(entity);
  const spec = (entity.spec ?? {}) as Record<string, any>;
  const name =
    entity.metadata.title ?? spec.profile?.displayName ?? entity.metadata.name;
  const facts = [
    `${entity.kind}${spec.type ? ` (${spec.type})` : ''}: ${entityRef}`,
    spec.owner && `Owner: ${spec.owner}`,
    spec.system && `System: ${spec.system}`,
    spec.lifecycle && `Lifecycle: ${spec.lifecycle}`,
    entity.metadata.tags?.length && `Tags: ${entity.metadata.tags.join(', ')}`,
  ].filter(Boolean);
  return {
    source: 'catalog',
    key: entityRef,
    entityRef,
    location: entityRef,
    title: name,
    text: [entity.metadata.description, ...facts].filter(Boolean).join('\n'),
  };
}

export function htmlToText(html: string | undefined): string {
  if (!html) {
    return '';
  }
  return parse(html).text.replace(/\s+/g, ' ').trim();
}

function headingPath(parts: Array<string | undefined>): string {
  const path: string[] = [];
  for (const part of parts) {
    if (part && part !== path[path.length - 1]) {
      path.push(part);
    }
  }
  return path.join(' › ');
}

async function forEachConcurrently<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        await fn(items[next++]);
      }
    },
  );
  await Promise.all(workers);
}
