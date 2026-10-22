import { parseEntityRef } from '@backstage/catalog-model';
import type { IndexableDocument } from '@backstage/plugin-search-common';
import { parse } from 'node-html-parser';

/**
 * One searchable unit before chunking: a document from a Backstage search
 * run (a TechDocs section, a catalog entity, a Confluence page, …) as text.
 */
export interface SourceDocument {
  /** Its search result location: a link, and its identity across runs. */
  location: string;
  /**
   * The catalog entity whose read permission gates it. Without one, every
   * assistant user may see it, as everyone may in Backstage search.
   */
  entityRef?: string;
  /** Heading path, e.g. `Pylon › Messaging › Dead-letter handling`. */
  title: string;
  text: string;
  /** The other short fields the collator attached (status, space, updated, …). */
  metadata?: KnowledgeMetadata;
}

export type KnowledgeMetadata = Record<string, string | number | boolean>;

/** Fields every document has, or that the title and text already carry. */
const OWN_FIELDS = new Set([
  'title',
  'text',
  'location',
  'authorization',
  'entityTitle',
  'owner',
  'lifecycle',
]);
/** Fields of an entity-gated document that its entity ref, facts, or location already carry. */
const ENTITY_FIELDS = new Set([
  'kind',
  'namespace',
  'name',
  'type',
  'componentType',
  'path',
]);
const MAX_METADATA_FIELDS = 16;
const MAX_METADATA_CHARS = 200;

export interface MappedDocuments {
  documents: SourceDocument[];
  /** Documents whose `authorization.resourceRef` is not an entity ref, so no permission check applies. */
  skipped: number;
}

/**
 * Maps the documents of one search run. TechDocs sections take their page's
 * title from the page entry in the same run; HTML (MkDocs section text) is
 * flattened; the facts collators attach (entity ref, type, owner, lifecycle)
 * join the text, so a catalog entity with no description is still findable.
 * A document gated by anything other than a catalog entity is skipped: the
 * index can only check entity read permission. Pure; unit-tested.
 */
export function toSourceDocuments(docs: IndexableDocument[]): MappedDocuments {
  const pageTitles = new Map<string, string>();
  for (const doc of docs) {
    if (!doc.location.includes('#') && !pageTitles.has(doc.location)) {
      pageTitles.set(doc.location, htmlToText(doc.title));
    }
  }

  const documents: SourceDocument[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const doc of docs) {
    const resourceRef = doc.authorization?.resourceRef;
    const entityRef = resourceRef ? asEntityRef(resourceRef) : undefined;
    if (resourceRef && !entityRef) {
      skipped++;
      continue;
    }
    if (seen.has(doc.location)) {
      continue;
    }
    const text = [htmlToText(doc.text), facts(doc, entityRef)]
      .filter(Boolean)
      .join('\n');
    if (!text) {
      continue;
    }
    seen.add(doc.location);
    const meta = metadata(doc, entityRef !== undefined);
    documents.push({
      location: doc.location,
      ...(entityRef ? { entityRef } : {}),
      title: headingPath([
        field(doc, 'entityTitle'),
        pageTitles.get(doc.location.split('#')[0]),
        htmlToText(doc.title),
      ]),
      text,
      ...(meta ? { metadata: meta } : {}),
    });
  }
  return { documents, skipped };
}

/** The ref in full form when it names a catalog entity. */
function asEntityRef(ref: string): string | undefined {
  try {
    const { kind, namespace, name } = parseEntityRef(ref);
    return `${kind}:${namespace}/${name}`.toLocaleLowerCase('en-US');
  } catch {
    return undefined;
  }
}

function field(doc: IndexableDocument, key: string): string | undefined {
  const value = (doc as unknown as Record<string, unknown>)[key];
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * The collator's other fields that fit in a result: strings up to 200
 * characters, numbers, booleans, and short string lists joined with commas;
 * at most 16. Long text, nested objects, and fields the title and text
 * already carry are left out.
 */
function metadata(
  doc: IndexableDocument,
  gated: boolean,
): KnowledgeMetadata | undefined {
  const result: KnowledgeMetadata = {};
  let count = 0;
  for (const [key, raw] of Object.entries(doc)) {
    if (
      OWN_FIELDS.has(key) ||
      (gated && ENTITY_FIELDS.has(key)) ||
      count === MAX_METADATA_FIELDS
    ) {
      continue;
    }
    const value =
      Array.isArray(raw) && raw.every(item => typeof item === 'string')
        ? raw.join(', ')
        : raw;
    if (
      (typeof value === 'string' &&
        value.trim() &&
        value.length <= MAX_METADATA_CHARS) ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      result[key] = typeof value === 'string' ? value.trim() : value;
      count++;
    }
  }
  return count > 0 ? result : undefined;
}

function facts(doc: IndexableDocument, entityRef: string | undefined): string {
  const type = field(doc, 'type') ?? field(doc, 'componentType');
  const owner = field(doc, 'owner');
  const lifecycle = field(doc, 'lifecycle');
  return [
    entityRef && (type ? `${entityRef} (${type})` : entityRef),
    owner && `Owner: ${owner}`,
    lifecycle && `Lifecycle: ${lifecycle}`,
  ]
    .filter(Boolean)
    .join(' · ');
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
