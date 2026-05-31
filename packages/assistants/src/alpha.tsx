import {
  createFrontendPlugin,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import { rootRouteRef } from './routes';

const assistantsPage = PageBlueprint.make({
  params: {
    path: '/assistants',
    routeRef: rootRouteRef,
    loader: () =>
      import('./components/AssistantsPage').then(m => <m.AssistantsPage />),
  },
});

/**
 * The Backstage AI Assistants frontend plugin (new frontend system).
 *
 * @public
 */
export default createFrontendPlugin({
  pluginId: 'assistants',
  extensions: [assistantsPage],
  routes: {
    root: rootRouteRef,
  },
});
