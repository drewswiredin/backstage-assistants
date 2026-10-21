import {
  ApiBlueprint,
  createExtensionInput,
  createFrontendPlugin,
  discoveryApiRef,
  fetchApiRef,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import { RiRobot2Line } from '@remixicon/react';
import { rootRouteRef } from './routes';
import { assistantsApiRef, AssistantsClient } from './api';
import { AssistantClientToolBlueprint, clientToolDataRef } from './clientTools';
import { renderFormTool } from './clientTools/builtin/renderForm';
import { downloadFileTool } from './clientTools/builtin/downloadFile';

/** Backend client (`/status`, threads, manage, base url + authed fetch). */
const assistantsApi = ApiBlueprint.make({
  params: defineParams =>
    defineParams({
      api: assistantsApiRef,
      deps: {
        discoveryApi: discoveryApiRef,
        fetchApi: fetchApiRef,
      },
      factory: ({ discoveryApi, fetchApi }) =>
        new AssistantsClient({ discoveryApi, fetchApi }),
    }),
});

/**
 * The Assistants chat page (collapsible sidebar). Mounted at `/assistants`.
 * Its `clientTools` input collects every `AssistantClientToolBlueprint`
 * extension in the app: the plugin's own built-ins below and any a host
 * plugin or module contributes.
 */
const assistantsPage = PageBlueprint.makeWithOverrides({
  inputs: {
    clientTools: createExtensionInput([clientToolDataRef]),
  },
  factory(originalFactory, { inputs }) {
    const clientTools = inputs.clientTools.map(input =>
      input.get(clientToolDataRef),
    );
    return originalFactory({
      path: '/assistants',
      routeRef: rootRouteRef,
      loader: () =>
        import('./collapsible/CollapsiblePage').then(m => (
          <m.CollapsiblePage clientTools={clientTools} />
        )),
    });
  },
});

/** `render_form`: an inline form whose submission is the tool result. */
const renderFormClientTool = AssistantClientToolBlueprint.make({
  name: 'render-form',
  params: defineParams => defineParams(renderFormTool),
});

/** `download_file`: a download chip for a generated text file. */
const downloadFileClientTool = AssistantClientToolBlueprint.make({
  name: 'download-file',
  params: defineParams => defineParams(downloadFileTool),
});

/**
 * The Backstage AI Assistants frontend plugin (new frontend system).
 *
 * @public
 */
export default createFrontendPlugin({
  pluginId: 'assistants',
  title: 'Assistants',
  icon: <RiRobot2Line />,
  extensions: [
    assistantsApi,
    assistantsPage,
    renderFormClientTool,
    downloadFileClientTool,
  ],
  routes: {
    root: rootRouteRef,
  },
});
