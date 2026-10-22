/**
 * Describes this Backstage instance from its app tree: the installed plugins,
 * the pages with their paths, and the tabs on catalog entity pages. Every app
 * on the new frontend system builds this tree to render itself (the
 * visualizer plugin is one reader of it), so the description needs no
 * per-plugin code and no plugin of its own. Pure over the tree; unit-tested.
 */
import {
  coreExtensionData,
  type AppNode,
  type AppTree,
} from '@backstage/frontend-plugin-api';

export interface PortalPlugin {
  id: string;
  title?: string;
}

export interface PortalPage {
  title: string;
  /** The app path; `:param` segments stand for values such as an entity name. */
  path: string;
  plugin: string;
}

export interface PortalDescription {
  /** The app's title, from `app.title`. */
  title?: string;
  plugins: PortalPlugin[];
  /** Top-level pages, the places the sidebar links to. */
  pages: PortalPage[];
  /** Tabs on a catalog entity's page (Overview, TechDocs, Kubernetes, …). */
  entityTabs: PortalPage[];
  /** Tools the assistant can run in this browser (contributed client tools). */
  clientTools: string[];
}

/** Plugins that are the app's own scaffolding, not features a user visits. */
const INTERNAL_PLUGINS = new Set(['app', 'root']);

function joinPath(parent: string, child: string): string {
  if (!child || child === '/') return parent || '/';
  const left = parent.replace(/\/+$/, '');
  const right = child.replace(/^\/+/, '');
  return `${left}/${right}`;
}

/** The node's full path: its route path joined under every routed ancestor. */
function fullPath(node: AppNode): string | undefined {
  const own = node.instance?.getData(coreExtensionData.routePath);
  if (own === undefined) return undefined;
  let path = own;
  let parent = node.edges.attachedTo?.node;
  while (parent) {
    const parentPath = parent.instance?.getData(coreExtensionData.routePath);
    if (parentPath !== undefined) path = joinPath(parentPath, path);
    parent = parent.edges.attachedTo?.node;
  }
  return path.startsWith('/') ? path : `/${path}`;
}

/** Whether any ancestor has its own route (so the node is a sub-page). */
function hasRoutedAncestor(node: AppNode): boolean {
  let parent = node.edges.attachedTo?.node;
  while (parent) {
    if (parent.instance?.getData(coreExtensionData.routePath) !== undefined) {
      return true;
    }
    parent = parent.edges.attachedTo?.node;
  }
  return false;
}

/** Whether a node sits under a catalog entity page (an entity tab). */
function underEntityPage(node: AppNode): boolean {
  let parent = node.edges.attachedTo?.node;
  while (parent) {
    if (parent.spec.id === 'page:catalog/entity') return true;
    parent = parent.edges.attachedTo?.node;
  }
  return false;
}

export function describePortal(
  tree: AppTree,
  options: { title?: string; clientTools?: string[] } = {},
): PortalDescription {
  const plugins = new Map<string, PortalPlugin>();
  const pages: PortalPage[] = [];
  const entityTabs: PortalPage[] = [];

  for (const node of tree.nodes.values()) {
    // Only what the app actually rendered: no disabled or orphaned nodes.
    if (!node.instance || node.spec.disabled) continue;
    const plugin = node.spec.plugin;
    const pluginId = plugin?.pluginId ?? plugin?.id;
    if (!pluginId || INTERNAL_PLUGINS.has(pluginId)) continue;
    if (!plugins.has(pluginId)) {
      plugins.set(pluginId, { id: pluginId, title: plugin.title });
    }

    const path = fullPath(node);
    if (path === undefined) continue;
    const title =
      node.instance.getData(coreExtensionData.title) ??
      plugin.title ??
      node.spec.id;
    const entry = { title, path, plugin: pluginId };
    if (underEntityPage(node)) entityTabs.push(entry);
    else if (node.spec.id.startsWith('page:') && !hasRoutedAncestor(node)) {
      pages.push(entry);
    }
  }

  const byPath = (a: PortalPage, b: PortalPage) => a.path.localeCompare(b.path);
  const description: PortalDescription = {
    plugins: [...plugins.values()].sort((a, b) => a.id.localeCompare(b.id)),
    pages: pages.sort(byPath),
    entityTabs: entityTabs.sort(byPath),
    clientTools: [...(options.clientTools ?? [])].sort(),
  };
  if (options.title) description.title = options.title;
  return description;
}
