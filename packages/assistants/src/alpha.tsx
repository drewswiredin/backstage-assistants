import {
  ApiBlueprint,
  createExtensionInput,
  createFrontendModule,
  createFrontendPlugin,
  discoveryApiRef,
  fetchApiRef,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import { AppRootWrapperBlueprint } from '@backstage/plugin-app-react';
import { RiRobot2Line } from '@remixicon/react';
import { rootRouteRef, threadRouteRef } from './routes';
import { assistantsApiRef, AssistantsClient } from './api';
import { AssistantClientToolBlueprint, clientToolDataRef } from './clientTools';
import { clientToolsApiRef, type ClientToolsApi } from './clientTools/api';
import { renderFormTool } from './clientTools/builtin/renderForm';
import { downloadFileTool } from './clientTools/builtin/downloadFile';
import { readCurrentPageTool } from './clientTools/builtin/readCurrentPage';
import { describePortalTool } from './clientTools/builtin/describePortal';
import { AssistantsPanel } from './panel/AssistantsPanel';

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
 * The client tool registry. Its `tools` input collects every
 * `AssistantClientToolBlueprint` extension in the app: the plugin's own
 * built-ins below and any a host plugin or module contributes. The page and
 * the panel both read it, so a tool is registered once and runs everywhere a
 * conversation does.
 */
const clientToolsApi = ApiBlueprint.makeWithOverrides({
  name: 'client-tools',
  inputs: {
    tools: createExtensionInput([clientToolDataRef]),
  },
  factory(originalFactory, { inputs }) {
    const tools = inputs.tools.map(input => input.get(clientToolDataRef));
    return originalFactory(defineParams =>
      defineParams({
        api: clientToolsApiRef,
        deps: {},
        factory: (): ClientToolsApi => ({ tools }),
      }),
    );
  },
});

/** The Assistants chat page (collapsible sidebar). Mounted at `/assistants`. */
const assistantsPage = PageBlueprint.make({
  params: {
    path: '/assistants',
    routeRef: rootRouteRef,
    loader: () =>
      import('./collapsible/CollapsiblePage').then(m => <m.CollapsiblePage />),
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
 * `read_current_page`: the rendered page as an outline, so the model can see
 * what the user is looking at. An app that does not want pages read turns it
 * off: `client-tool:assistants/read-current-page` with `disabled: true`.
 */
const readCurrentPageClientTool = AssistantClientToolBlueprint.make({
  name: 'read-current-page',
  params: defineParams => defineParams(readCurrentPageTool),
});

/**
 * `describe_portal`: what this Backstage instance offers (plugins, pages,
 * entity tabs, client tools), read from the app tree. An app that does not
 * want it disables `client-tool:assistants/describe-portal`.
 */
const describePortalClientTool = AssistantClientToolBlueprint.make({
  name: 'describe-portal',
  params: defineParams => defineParams(describePortalTool),
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
    clientToolsApi,
    assistantsPage,
    renderFormClientTool,
    downloadFileClientTool,
    readCurrentPageClientTool,
    describePortalClientTool,
  ],
  routes: {
    root: rootRouteRef,
    thread: threadRouteRef,
  },
});

/**
 * The panel: a floating button on every page opens a side panel with one quick
 * conversation, and the page content makes room for it. It wraps the app
 * layout, so it mounts after sign-in and sits beside the page rather than
 * over it. An app root wrapper is the app plugin's own input, so this is a
 * module for the `app` plugin that the host adds to its features:
 *
 * ```ts
 * import assistantsPlugin, { assistantsPanelModule } from '@drewswiredin/backstage-plugin-assistants/alpha';
 * createApp({ features: [assistantsPlugin, assistantsPanelModule] });
 * ```
 *
 * The panel opens the default assistant (designated in the editor) until the
 * user picks another accessible one.
 *
 * @public
 */
export const assistantsPanelModule = createFrontendModule({
  pluginId: 'app',
  extensions: [
    AppRootWrapperBlueprint.make({
      name: 'assistants-panel',
      params: {
        component: ({ children }) => (
          <AssistantsPanel>{children}</AssistantsPanel>
        ),
      },
    }),
  ],
});
