import {
  ApiBlueprint,
  createFrontendPlugin,
  discoveryApiRef,
  fetchApiRef,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import { rootRouteRef } from './routes';
import { assistantsApiRef, AssistantsClient } from './api';

/** Backend client (`/status`, `/title`, base url + authed fetch). */
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

/** The Assistants chat page (collapsible sidebar). Mounted at `/assistants`. */
const assistantsPage = PageBlueprint.make({
  params: {
    path: '/assistants',
    routeRef: rootRouteRef,
    loader: () =>
      import('./collapsible/CollapsiblePage').then(m => <m.CollapsiblePage />),
  },
});

/**
 * The Backstage AI Assistants frontend plugin (new frontend system).
 *
 * @public
 */
export default createFrontendPlugin({
  pluginId: 'assistants',
  extensions: [assistantsApi, assistantsPage],
  routes: {
    root: rootRouteRef,
  },
});
