import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import {
  actionsRegistryServiceRef,
  actionsServiceRef,
} from '@backstage/backend-plugin-api/alpha';
import { signalsServiceRef } from '@backstage/plugin-signals-node';
import { readConfig } from './config';
import { createRouter } from './router';
import { registerCoreActions } from './actions';
import { ThreadService } from './threads';

/**
 * The Backstage AI Assistants backend plugin.
 *
 * Wires the core services it needs (rootConfig, httpRouter, httpAuth,
 * userInfo, logger, auth, discovery), reads and validates the `assistants`
 * config (building the provider registry), registers the built-in core actions
 * when configured, and mounts the router.
 *
 * No `addAuthPolicy` is applied — the routes accept user header tokens only via
 * `httpAuth.credentials(req, { allow: ['user'] })`.
 *
 * @public
 */
export const assistantsPlugin = createBackendPlugin({
  pluginId: 'assistants',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        config: coreServices.rootConfig,
        database: coreServices.database,
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        userInfo: coreServices.userInfo,
        auth: coreServices.auth,
        discovery: coreServices.discovery,
        // Actions registry (REGISTER our core actions) + actions service
        // (LIST + INVOKE the assistant's allowlist per request). Both live in
        // `@backstage/backend-plugin-api/alpha`.
        actionsRegistry: actionsRegistryServiceRef,
        actions: actionsServiceRef,
        signals: signalsServiceRef,
      },
      async init({
        logger,
        config,
        database,
        httpRouter,
        httpAuth,
        userInfo,
        auth,
        discovery,
        actionsRegistry,
        actions,
        signals,
      }) {
        const assistants = readConfig(config);

        // Register the built-in catalog/search/TechDocs actions only when the
        // operator opts in. They surface via `actions.list` only if `assistants`
        // is listed in core `backend.actions.pluginSources`.
        if (assistants.registerCoreActions) {
          registerCoreActions({ actionsRegistry, discovery, auth });
        }

        // Conversation persistence: the plugin owns its own tables in Backstage's
        // standard `backend.database` (SQLite dev / Postgres prod). Migrations are
        // idempotent and run on every boot.
        const threadService = new ThreadService(await database.getClient());
        await threadService.runMigrations();

        const router = await createRouter({
          logger,
          config,
          httpAuth,
          userInfo,
          actions,
          assistants,
          threadService,
          signals,
        });

        httpRouter.use(router);

        logger.info('AI Assistants backend plugin initialized', {
          assistants: assistants.assistants.size,
          models: assistants.models.length,
          defaultModel: assistants.defaultModel,
          registerCoreActions: assistants.registerCoreActions,
        });
      },
    });
  },
});
