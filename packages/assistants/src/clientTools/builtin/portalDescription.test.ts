import {
  coreExtensionData,
  type AppNode,
  type AppTree,
} from '@backstage/frontend-plugin-api';
import { describePortal } from './portalDescription';

type Data = { routePath?: string; title?: string };

function node(
  id: string,
  pluginId: string,
  data: Data | undefined,
  parent?: AppNode,
  opts: { disabled?: boolean; pluginTitle?: string } = {},
): AppNode {
  const values = new Map<string, unknown>();
  if (data?.routePath !== undefined) {
    values.set(coreExtensionData.routePath.id, data.routePath);
  }
  if (data?.title !== undefined) {
    values.set(coreExtensionData.title.id, data.title);
  }
  return {
    spec: {
      id,
      disabled: opts.disabled ?? false,
      plugin: { pluginId, id: pluginId, title: opts.pluginTitle },
    },
    edges: { attachedTo: parent ? { node: parent, input: 'x' } : undefined },
    instance: data
      ? { getData: (ref: { id: string }) => values.get(ref.id) }
      : undefined,
  } as unknown as AppNode;
}

function tree(nodes: AppNode[]): AppTree {
  return {
    root: nodes[0],
    nodes: new Map(nodes.map(n => [n.spec.id, n])),
    orphans: [],
  } as unknown as AppTree;
}

describe('describePortal', () => {
  const root = node('app/root', 'app', {});
  const routes = node('app/routes', 'app', {}, root);
  const catalog = node(
    'page:catalog',
    'catalog',
    { routePath: '/catalog', title: 'Catalog' },
    routes,
  );
  const entity = node(
    'page:catalog/entity',
    'catalog',
    { routePath: ':namespace/:kind/:name' },
    catalog,
  );
  const overview = node(
    'entity-content:catalog/overview',
    'catalog',
    { routePath: '/', title: 'Overview' },
    entity,
  );
  const k8s = node(
    'entity-content:kubernetes/kubernetes',
    'kubernetes',
    { routePath: 'kubernetes', title: 'Kubernetes' },
    entity,
  );
  const docs = node(
    'page:techdocs',
    'techdocs',
    { routePath: '/docs' },
    routes,
    { pluginTitle: 'TechDocs' },
  );
  const disabled = node(
    'page:hidden',
    'hidden',
    { routePath: '/hidden', title: 'Hidden' },
    routes,
    { disabled: true },
  );
  const notRendered = node('page:ghost', 'ghost', undefined, routes);
  const api = node('api:kubernetes', 'kubernetes', {}, root);

  const result = describePortal(
    tree([
      root,
      routes,
      catalog,
      entity,
      overview,
      k8s,
      docs,
      disabled,
      notRendered,
      api,
    ]),
    { title: 'Acme Portal', clientTools: ['render_form', 'acme__get_status'] },
  );

  it('lists the rendered plugins, skipping the app itself', () => {
    expect(result.plugins).toEqual([
      { id: 'catalog', title: undefined },
      { id: 'kubernetes', title: undefined },
      { id: 'techdocs', title: 'TechDocs' },
    ]);
  });

  it('lists top-level pages with full paths, falling back to the plugin title', () => {
    expect(result.pages).toEqual([
      { title: 'Catalog', path: '/catalog', plugin: 'catalog' },
      { title: 'TechDocs', path: '/docs', plugin: 'techdocs' },
    ]);
  });

  it('lists entity tabs under the entity route, Kubernetes included', () => {
    expect(result.entityTabs).toEqual([
      {
        title: 'Overview',
        path: '/catalog/:namespace/:kind/:name',
        plugin: 'catalog',
      },
      {
        title: 'Kubernetes',
        path: '/catalog/:namespace/:kind/:name/kubernetes',
        plugin: 'kubernetes',
      },
    ]);
  });

  it('carries the app title and the client tools, sorted', () => {
    expect(result.title).toBe('Acme Portal');
    expect(result.clientTools).toEqual(['acme__get_status', 'render_form']);
  });
});
