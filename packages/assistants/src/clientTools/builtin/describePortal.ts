/**
 * `describe_portal`: the built-in client tool the model calls to learn what
 * this Backstage instance offers: its plugins, its pages and their paths, the
 * tabs on a catalog entity's page, and the tools the assistant can run here.
 * Read from the app tree every new-frontend-system app builds, so it needs
 * no per-plugin code and works with or without the visualizer plugin.
 * Read-only, so it never asks for approval unless the app lists it in the
 * approval floor.
 */
import type { JsonObject } from '@backstage/types';
import { configApiRef } from '@backstage/core-plugin-api';
import { appTreeApiRef } from '@backstage/frontend-plugin-api';
import type { AssistantClientTool } from '../types';
import { clientToolsApiRef } from '../api';
import { describePortal, type PortalDescription } from './portalDescription';

export const describePortalTool: AssistantClientTool<
  JsonObject,
  PortalDescription
> = {
  name: 'describe_portal',
  title: 'Describe this portal',
  description:
    'What this Backstage instance offers: its installed plugins, its pages with their paths (catalog, docs, templates, and any other feature in the sidebar), the tabs on a catalog entity page (such as Kubernetes, CI, or API definitions), and the tools you can run in the browser here. Call it when the user asks what is in Backstage, what they can do here, where to find something, or which page to open; link to pages by their path.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  attributes: { readOnly: true, idempotent: true },
  isAvailable: ({ apis }) => apis.get(appTreeApiRef) !== undefined,
  execute: async (_input, { apis }) => {
    const appTree = apis.get(appTreeApiRef);
    if (!appTree) throw new Error('This app does not expose its app tree.');
    return describePortal(appTree.getTree().tree, {
      title: apis.get(configApiRef)?.getOptionalString('app.title'),
      clientTools: apis.get(clientToolsApiRef)?.tools.map(t => t.name),
    });
  },
};
