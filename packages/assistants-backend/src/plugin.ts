import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { createRouter } from './router';

/**
 * The Backstage AI Assistants backend plugin. Placeholder skeleton.
 *
 * @public
 */
export const assistantsPlugin = createBackendPlugin({
  pluginId: 'assistants',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        httpRouter: coreServices.httpRouter,
      },
      async init({ logger, httpRouter }) {
        httpRouter.use(await createRouter({ logger }));
      },
    });
  },
});
