import type { PageContext } from '@drewswiredin/backstage-plugin-assistants-common';

/**
 * The catalog entity route, `/catalog/:namespace/:kind/:name`, wherever the
 * catalog is mounted. Core Backstage, not a plugin's own route.
 */
const ENTITY_ROUTE = /\/catalog\/([^/]+)\/([^/]+)\/([^/?#]+)/;

/**
 * What a surface beside the page tells the backend about the page the user is
 * on: the pathname, the document title, and the catalog entity ref when the
 * path is an entity page. Pure; unit-tested.
 */
export function derivePageContext(
  pathname: string,
  title: string | undefined,
): PageContext {
  const context: PageContext = { path: pathname };
  const trimmed = title?.trim();
  if (trimmed) context.title = trimmed.slice(0, 300);
  const match = ENTITY_ROUTE.exec(pathname);
  if (match) {
    const [, namespace, kind, name] = match.map(decodeURIComponent);
    context.entityRef = `${kind.toLowerCase()}:${namespace.toLowerCase()}/${name}`;
  }
  return context;
}
