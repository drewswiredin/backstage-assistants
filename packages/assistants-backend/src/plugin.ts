import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import {
  actionsRegistryServiceRef,
  actionsServiceRef,
} from '@backstage/backend-plugin-api/alpha';
import { signalsServiceRef } from '@backstage/plugin-signals-node';
import { assistantsPermissions } from '@drewswiredin/backstage-plugin-assistants-common';
import { readConfig } from './config';
import { createRouter } from './router';
import { registerCoreActions } from './actions';
import { ThreadService } from './threads';
import { StreamBuffer } from './streamBuffer';
import { AssistantStore } from './assistants';
import {
  maintainMcpConnections,
  maintenanceTimeoutMs,
  closeMcpPool,
  databaseToolCacheStore,
  initMcpToolCache,
  closeUserConnection,
  setElicitationBroker,
} from './mcp';
import { McpOAuthService } from './mcpOAuth';
import { ElicitationBroker } from './mcpElicitation';
import { MCP_OAUTH_PUBLIC_PATHS } from './mcpOAuthRouter';

/**
 * The Backstage AI Assistants backend plugin.
 *
 * Wires the core services it needs (rootConfig, httpRouter, httpAuth,
 * userInfo, logger, auth, discovery), registers the plugin's permissions with
 * the permissions registry, reads and validates the `assistants` config
 * (building the provider registry), registers the built-in core actions when
 * configured, and mounts the router.
 *
 * The routes accept user tokens only via
 * `httpAuth.credentials(req, { allow: ['user'] })`. The one exception, when a
 * server runs its own OAuth, is the sign-in callback (and the client metadata
 * document): they are unauthenticated paths, and the callback checks
 * Backstage's user cookie itself.
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
        permissionsRegistry: coreServices.permissionsRegistry,
        auth: coreServices.auth,
        discovery: coreServices.discovery,
        // Actions registry (REGISTER our core actions) + actions service
        // (LIST + INVOKE the assistant's allowlist per request). Both live in
        // `@backstage/backend-plugin-api/alpha`.
        actionsRegistry: actionsRegistryServiceRef,
        actions: actionsServiceRef,
        signals: signalsServiceRef,
        scheduler: coreServices.scheduler,
        lifecycle: coreServices.lifecycle,
      },
      async init({
        logger,
        config,
        database,
        httpRouter,
        httpAuth,
        userInfo,
        permissions,
        permissionsRegistry,
        auth,
        discovery,
        actionsRegistry,
        actions,
        signals,
        scheduler,
        lifecycle,
      }) {
        // Publish `assistant.use` / `assistant.manage` on the plugin's
        // `.well-known/backstage/permissions/metadata` endpoint so permission
        // UIs (e.g. the RBAC role editor) can discover and grant them.
        permissionsRegistry.addPermissions(assistantsPermissions);

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
        const streamBuffer = new StreamBuffer(db, logger);

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
        const defaultState = await assistantStore.ensureDefault();
        if (defaultState === 'designated') {
          logger.info(
            'default assistant designated: the oldest assistant open to every signed-in user',
          );
        } else if (defaultState === 'none') {
          logger.warn(
            'no default assistant: none is open to every signed-in user; designate one in the editor',
          );
        }

        // Servers that run their own OAuth: the backend keeps each user's
        // tokens (sealed with the configured key) and runs the sign-in.
        const oauth = assistants.mcpOAuthKeys
          ? new McpOAuthService({
              db,
              keys: assistants.mcpOAuthKeys,
              servers: assistants.mcpServers,
              baseUrl: await discovery.getExternalBaseUrl('assistants'),
              logger,
              onDisconnect: closeUserConnection,
            })
          : undefined;
        if (oauth) {
          for (const path of MCP_OAUTH_PUBLIC_PATHS) {
            httpRouter.addAuthPolicy({ path, allow: 'unauthenticated' });
          }
          logger.info(
            `MCP OAuth sign-in redirects to ${oauth.redirectUrl}; register it with each server's authorization server if it needs pre-registration`,
          );
        }

        // Servers may ask the user for input mid-call (elicitation); the
        // broker routes each question to the waiting call and its answer back.
        const elicitations = [...assistants.mcpServers.values()].some(
          server => server.elicitation,
        )
          ? new ElicitationBroker({
              db,
              logger,
              timeoutMs: assistants.elicitationTimeoutMs,
            })
          : undefined;
        setElicitationBroker(elicitations);

        const router = await createRouter({
          logger,
          httpAuth,
          userInfo,
          permissions,
          actions,
          assistants,
          assistantStore,
          threadService,
          streamBuffer,
          signals,
          oauth,
          elicitations,
          appOrigin: new URL(config.getString('app.baseUrl')).origin,
        });

        httpRouter.use(router);

        // Maintain ONE persistent connection per MCP server in the background:
        // connect at boot, then refresh tools + heal dropped connections on a
        // schedule (maintainMcpConnections / mcp.ts). /status reads the cached
        // inventory and /chat reuses these pooled connections — neither ever
        // connects on the request path. Each probe is timeout-bounded so a
        // slow/unreachable server can't stall the cycle; connections close on
        // plugin shutdown.
        if (assistants.mcpServers.size > 0) {
          const mcpServers = [...assistants.mcpServers.values()];
          // Per-user servers have no shared connection; their tools are
          // learned from the first user who connects and kept in the database.
          await initMcpToolCache(
            databaseToolCacheStore(db),
            mcpServers,
            logger,
          );
          for (const server of mcpServers) {
            if (server.userCredentials && server.transport === 'stdio') {
              logger.warn(
                `MCP server '${server.id}' is per-user over stdio: each connected user runs their own process. Prefer an http server that takes the token in a header.`,
              );
            }
          }
          await scheduler.scheduleTask({
            id: 'assistants-mcp-maintain',
            // The connection pool is per-process, so every replica maintains its own.
            scope: 'local',
            frequency: { minutes: 2 },
            initialDelay: { seconds: 0 },
            // Derived from the configured per-server timeouts so raising
            // `connectTimeoutMs` for a slow server isn't undone by the task's
            // own ceiling.
            timeout: { milliseconds: maintenanceTimeoutMs(mcpServers) },
            fn: async () => {
              await maintainMcpConnections(mcpServers, logger);
            },
          });
          lifecycle.addShutdownHook(() => closeMcpPool());
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
