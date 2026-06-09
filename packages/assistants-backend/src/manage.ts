import express from 'express';
import {
  HttpAuthService,
  LoggerService,
  UserInfoService,
  BackstageUserInfo,
  BackstageCredentials,
} from '@backstage/backend-plugin-api';
import { ActionsService } from '@backstage/backend-plugin-api/alpha';
import { InputError, NotAllowedError, NotFoundError } from '@backstage/errors';
import type {
  AssistantDefinition,
  CapabilitiesResponse,
} from '@drewswiredin/backstage-plugin-assistants-common';
import type { AssistantsConfig } from './config';
import type { AssistantStore } from './assistants';
import { mcpToolName, probeServerTools } from './mcp';

/**
 * The admin management surface for assistant DEFINITIONS — the `/manage/*` CRUD
 * endpoints and `/capabilities`, all gated by `canManage` (the
 * `assistants.admins` ownership-ref check; 403 otherwise). Kept out of the
 * hand-written `/chat` router so the streaming path stays self-contained.
 *
 * Mounted as a plain Express sub-router via `router.use(...)`, mirroring the
 * existing `/threads` sub-router — the typed OpenAPI router only permits paths
 * declared in the spec, so out-of-spec admin routes live here.
 */

/** Dependencies for the management sub-router. */
export interface ManageRouterOptions {
  logger: LoggerService;
  httpAuth: HttpAuthService;
  userInfo: UserInfoService;
  actions: ActionsService;
  assistants: AssistantsConfig;
  assistantStore: AssistantStore;
  /** The `assistants.admins` ownership-ref check for the caller. */
  canManage: (user: BackstageUserInfo) => boolean;
}

/**
 * Builds the live capability inventory: assignable Backstage actions (scoped to
 * the admin's visibility), the global model pool, and each MCP server's
 * reachability + tool inventory (failures reported, not swallowed). Used to
 * feed the editor's pickers and to delta-validate write requests.
 */
async function buildCapabilities(
  options: ManageRouterOptions,
  credentials: BackstageCredentials,
): Promise<CapabilitiesResponse> {
  const { actions, assistants, logger } = options;

  // Actions the admin may see (gate 2, coarse), listed with their own
  // credentials so the editor offers exactly what they can grant.
  const { actions: available } = await actions.list({ credentials });

  // Each MCP server's reachability + tools. A failure is captured (reachable:
  // false + error), not swallowed, so the editor can show why it's unavailable.
  const mcpServers = await Promise.all(
    [...assistants.mcpServers.values()].map(async server => {
      const probe = await probeServerTools(server, logger);
      return {
        id: server.id,
        reachable: probe.reachable,
        ...(probe.error ? { error: probe.error } : {}),
        tools: probe.tools.map(t => ({
          name: t.name,
          description: t.description,
        })),
      };
    }),
  );

  return {
    actions: available.map(a => ({ id: a.name, description: a.description })),
    models: assistants.models,
    mcpServers,
  };
}

/**
 * The set of tool ids that are LIVE/assignable right now, derived from
 * capabilities: every Backstage action id plus every reachable MCP server's
 * namespaced `<serverId>__<tool>`. New tool additions are validated against this
 * set; pre-existing assignments are grandfathered (not re-checked).
 */
function liveToolIds(capabilities: CapabilitiesResponse): Set<string> {
  const ids = new Set<string>();
  for (const a of capabilities.actions) {
    ids.add(a.id);
  }
  for (const server of capabilities.mcpServers) {
    for (const tool of server.tools) {
      ids.add(mcpToolName(server.id, tool.name));
    }
  }
  return ids;
}

/** The set of live `provider:model` ids from capabilities. */
function liveModelIds(capabilities: CapabilitiesResponse): Set<string> {
  return new Set(capabilities.models.map(m => m.id));
}

/**
 * A non-empty string, or throw {@link InputError} naming the field.
 */
function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new InputError(`'${field}' must be a non-empty string`);
  }
  return value;
}

/** An array of strings, or throw naming the field. */
function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) {
    throw new InputError(`'${field}' must be an array of strings`);
  }
  return value as string[];
}

/**
 * Structural validation of a write body into a normalized definition (sans id +
 * audit columns). Strict on shape; lenient on the membership of `access.users`
 * / `access.groups` (dangling refs simply grant nobody, validated at read).
 */
function parseDefinitionBody(
  body: unknown,
): Omit<AssistantDefinition, 'id' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at'> {
  if (!body || typeof body !== 'object') {
    throw new InputError('request body must be an assistant definition object');
  }
  const b = body as Record<string, unknown>;

  const title = requireString(b.title, 'title');
  const prompt = requireString(b.prompt, 'prompt');

  // Access defaults to deny (allowAuthenticated false, no users/groups) when
  // absent; create overrides to the deny default regardless (see the create
  // route). When present it is structurally validated.
  let access: AssistantDefinition['access'] = {
    allowAuthenticated: false,
    users: [],
    groups: [],
  };
  if (b.access !== undefined) {
    if (!b.access || typeof b.access !== 'object') {
      throw new InputError("'access' must be an object");
    }
    const a = b.access as Record<string, unknown>;
    if (typeof a.allowAuthenticated !== 'boolean') {
      throw new InputError("'access.allowAuthenticated' must be a boolean");
    }
    access = {
      allowAuthenticated: a.allowAuthenticated,
      users: requireStringArray(a.users, 'access.users'),
      groups: requireStringArray(a.groups, 'access.groups'),
    };
  }

  const allowedTools = requireStringArray(b.allowedTools, 'allowedTools');
  const models = requireStringArray(b.models, 'models');

  if (b.defaultModel !== null && typeof b.defaultModel !== 'string') {
    throw new InputError("'defaultModel' must be a string or null");
  }
  const defaultModel = (b.defaultModel as string | null) ?? null;

  const def: Omit<
    AssistantDefinition,
    'id' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at'
  > = {
    title,
    prompt,
    access,
    allowedTools,
    models,
    defaultModel,
  };

  if (b.description !== undefined) {
    def.description = requireString(b.description, 'description');
  }
  if (b.color !== undefined) {
    def.color = requireString(b.color, 'color');
  }
  if (b.ui !== undefined) {
    if (typeof b.ui !== 'object' || b.ui === null) {
      throw new InputError("'ui' must be an object");
    }
    // The UI block is browser-cosmetic; pass it through structurally (the
    // shared UiOptions shape is enforced by the editor, lenient here).
    def.ui = b.ui as AssistantDefinition['ui'];
  }

  return def;
}

/**
 * Delta liveness validation: every tool/model that is NEWLY added relative to
 * `previous` must be live in `capabilities`. Pre-existing assignments are
 * grandfathered (never re-checked) and removals are always free. On create,
 * `previous` is undefined so every entry is an addition and must be live.
 * Throws {@link InputError} on the first dead addition. Users/groups are not
 * liveness-checked (lenient by design).
 */
function validateDelta(
  next: Pick<AssistantDefinition, 'allowedTools' | 'models' | 'defaultModel'>,
  previous: AssistantDefinition | undefined,
  capabilities: CapabilitiesResponse,
): void {
  const tools = liveToolIds(capabilities);
  const modelIds = liveModelIds(capabilities);

  const prevTools = new Set(previous?.allowedTools ?? []);
  for (const t of next.allowedTools) {
    if (!prevTools.has(t) && !tools.has(t)) {
      throw new InputError(
        `Tool '${t}' is not currently available and cannot be added`,
      );
    }
  }

  const prevModels = new Set(previous?.models ?? []);
  for (const m of next.models) {
    if (!prevModels.has(m) && !modelIds.has(m)) {
      throw new InputError(
        `Model '${m}' is not in the current pool and cannot be added`,
      );
    }
  }

  // A newly-set defaultModel must be live unless it was already the default.
  if (
    next.defaultModel !== null &&
    next.defaultModel !== (previous?.defaultModel ?? null) &&
    !modelIds.has(next.defaultModel)
  ) {
    throw new InputError(
      `defaultModel '${next.defaultModel}' is not in the current pool`,
    );
  }
}

/**
 * Build the admin management Express sub-router. Every route resolves the caller
 * and enforces `canManage` (403 otherwise) before doing any work.
 */
export function createManageRouter(options: ManageRouterOptions): express.Router {
  const { httpAuth, userInfo, assistantStore, logger } = options;

  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  // Resolve the caller and enforce the admin gate. Returns the credentials +
  // user for the handler; throws NotAllowedError (403) for non-admins.
  async function requireAdmin(
    req: express.Request,
  ): Promise<{ credentials: BackstageCredentials; user: BackstageUserInfo }> {
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    const user = await userInfo.getUserInfo(credentials);
    if (!options.canManage(user)) {
      throw new NotAllowedError('You are not permitted to manage assistants');
    }
    return { credentials, user };
  }

  // GET /capabilities — the live, assignable inventory for the editor pickers.
  router.get('/capabilities', (req, res, next) => {
    (async () => {
      const { credentials } = await requireAdmin(req);
      const capabilities = await buildCapabilities(options, credentials);
      res.json(capabilities);
    })().catch(next);
  });

  // GET /manage/assistants — full definitions (incl. prompt + access + audit)
  // for the editor.
  router.get('/manage/assistants', (req, res, next) => {
    (async () => {
      await requireAdmin(req);
      const assistants = await assistantStore.listAll();
      res.json({ assistants });
    })().catch(next);
  });

  // POST /manage/assistants — create. Server-generated uuid; NEW assistants
  // default to access-deny (allowAuthenticated false, no users/groups) unless
  // the body says otherwise. Create => every tool/model must be live.
  router.post('/manage/assistants', (req, res, next) => {
    (async () => {
      const { credentials, user } = await requireAdmin(req);
      const parsed = parseDefinitionBody(req.body);
      // NEW assistants are access-deny by default — never accidentally open. An
      // admin opens access in a subsequent edit.
      const def = {
        ...parsed,
        access: { allowAuthenticated: false, users: [], groups: [] },
      };
      const capabilities = await buildCapabilities(options, credentials);
      validateDelta(def, undefined, capabilities);
      const created = await assistantStore.create(def, user.userEntityRef);
      logger.info('assistant created', {
        id: created.id,
        by: user.userEntityRef,
      });
      res.status(201).json(created);
    })().catch(next);
  });

  // PUT /manage/assistants/:id — update. Delta-validated against the existing
  // row: new tool/model additions must be live; pre-existing grandfathered.
  router.put('/manage/assistants/:id', (req, res, next) => {
    (async () => {
      const { credentials, user } = await requireAdmin(req);
      const id = req.params.id;
      const previous = await assistantStore.getById(id);
      if (!previous) {
        throw new NotFoundError(`Assistant '${id}' not found`);
      }
      const def = parseDefinitionBody(req.body);
      const capabilities = await buildCapabilities(options, credentials);
      validateDelta(def, previous, capabilities);
      // Carry the immutable id; the store preserves creation audit + stamps the
      // editor/timestamp.
      const updated = await assistantStore.update(
        id,
        { ...def, id },
        user.userEntityRef,
      );
      if (!updated) {
        throw new NotFoundError(`Assistant '${id}' not found`);
      }
      logger.info('assistant updated', { id, by: user.userEntityRef });
      res.json(updated);
    })().catch(next);
  });

  // DELETE /manage/assistants/:id — hard delete. The seed marker is NOT cleared
  // (the default is never resurrected).
  router.delete('/manage/assistants/:id', (req, res, next) => {
    (async () => {
      const { user } = await requireAdmin(req);
      const id = req.params.id;
      const deleted = await assistantStore.delete(id);
      if (!deleted) {
        throw new NotFoundError(`Assistant '${id}' not found`);
      }
      logger.info('assistant deleted', { id, by: user.userEntityRef });
      res.status(204).end();
    })().catch(next);
  });

  return router;
}
