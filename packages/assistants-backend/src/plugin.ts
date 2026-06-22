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
import { AssistantStore } from './assistants';
import { warmServerToolsCache } from './mcp';

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
        permissions: coreServices.permissions,
        auth: coreServices.auth,
        discovery: coreServices.discovery,
        // Actions registry (REGISTER our core actions) + actions service
        // (LIST + INVOKE the assistant's allowlist per request). Both live in
        // `@backstage/backend-plugin-api/alpha`.
        actionsRegistry: actionsRegistryServiceRef,
        actions: actionsServiceRef,
        signals: signalsServiceRef,
        scheduler: coreServices.scheduler,
      },
      async init({
        logger,
        config,
        database,
        httpRouter,
        httpAuth,
        userInfo,
        permissions,
        auth,
        discovery,
        actionsRegistry,
        actions,
        signals,
        scheduler,
      }) {
        const assistants = readConfig(config);

        // Register the built-in catalog/search/TechDocs actions only when the
        // operator opts in (config `assistants.builtinActions`). They surface
        // via `actions.list` only if `assistants` is listed in core
        // `backend.actions.pluginSources`.
        if (assistants.builtinActions) {
          registerCoreActions({ actionsRegistry, discovery, auth });
        }

        // Conversation persistence: the plugin owns its own tables in Backstage's
        // standard `backend.database` (SQLite dev / Postgres prod). Migrations are
        // idempotent and run on every boot.
        const db = (await database.getClient()) as any;
        const threadService = new ThreadService(db);
        await threadService.runMigrations();

        // Assistant DEFINITIONS persistence: same DB, managed at runtime via the
        // admin `/manage` API. The store holds a synchronously-read snapshot the
        // router resolves per request; it's seeded with one default on first init
        // (never resurrected once an operator deletes/edits it). The platform
        // model pool + default feed its derived-at-read model/default helpers.
        const assistantStore = new AssistantStore(db, {
          pool: assistants.models,
          defaultModel: assistants.defaultModel,
        });
        await assistantStore.runMigrations();
        await assistantStore.seedOnce();

        const router = await createRouter({
          logger,
          config,
          httpAuth,
          userInfo,
          permissions,
          actions,
          assistants,
          assistantStore,
          threadService,
          signals,
        });

        httpRouter.use(router);

        // Keep each MCP server's tool inventory warm in the background so GET
        // /status never blocks on a live MCP connection (warmServerToolsCache /
        // mcp.ts). Runs at boot (initialDelay 0) and every few minutes; each
        // probe is timeout-bounded so one slow/unreachable server can't stall it.
        if (assistants.mcpServers.size > 0) {
          await scheduler.scheduleTask({
            id: 'assistants-mcp-warm',
            frequency: { minutes: 3 },
            initialDelay: { seconds: 0 },
            timeout: { minutes: 1 },
            fn: async () => {
              await warmServerToolsCache(
                [...assistants.mcpServers.values()],
                logger,
              );
            },
          });
        }

        logger.info('AI Assistants backend plugin initialized', {
          models: assistants.models.length,
          defaultModel: assistants.defaultModel,
          builtinActions: assistants.builtinActions,
          assistants: assistantStore.list().length,
        });
      },
    });
  },
});
