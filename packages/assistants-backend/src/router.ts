import express, { type Router } from 'express';
import {
  HttpAuthService,
  LoggerService,
  PermissionsService,
  UserInfoService,
  BackstageUserInfo,
  BackstageCredentials,
} from '@backstage/backend-plugin-api';
import { ActionsService } from '@backstage/backend-plugin-api/alpha';
import { InputError, NotAllowedError, NotFoundError } from '@backstage/errors';
import { randomUUID } from 'crypto';
import {
  streamText,
  generateText,
  convertToModelMessages,
  stepCountIs,
  toUIMessageStream,
  pipeUIMessageStreamToResponse,
  UI_MESSAGE_STREAM_HEADERS,
  type ModelMessage,
  type Tool,
  type UIMessage,
} from 'ai';
import type {
  AssistantDefinition,
  PageContext,
  ReasoningLevel,
  StatusResponse,
} from '@drewswiredin/backstage-plugin-assistants-common';
import {
  assistantUsePermission,
  PLATFORM_INSTRUCTIONS,
  USER_CREDENTIALS_HEADER,
  type ApprovalPreview,
  type ApprovalPreviewRequest,
  type ApprovalPreviewResponse,
  type UserCredentialSpec,
} from '@drewswiredin/backstage-plugin-assistants-common';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import {
  AssistantsConfig,
  effectiveApprovalSet,
  isPolicyAccessible,
  type McpServerConfig,
} from './config';
import { actionsToTools, selectAssistantActions } from './actions';
import {
  capClientToolOutputs,
  readClientToolDeclarations,
  selectClientTools,
} from './clientTools';
import {
  buildMcpTools,
  cachedServerToolsRaw,
  callServerTool,
  mcpToolName,
  splitAllowedTools,
  summarizeMcpTools,
  type UnavailableMcpServer,
} from './mcp';
import type { McpOAuthService } from './mcpOAuth';
import type { ElicitationBroker } from './mcpElicitation';
import { createMcpOAuthRouter } from './mcpOAuthRouter';
import { mcpCallerFor, userCredentialSpec } from './userCredentials';
import {
  argumentRuleViolation,
  auditTarget,
  isNotFoundError,
  previewBaseCalls,
  toolResultText,
} from './toolGuards';
import type { AssistantStore } from './assistants';
import { createOpenApiRouter } from './schema/openapi';
import { createManageRouter } from './manage';
import {
  parseThreadPatch,
  TURN_HEARTBEAT_MS,
  type ThreadService,
} from './threads';
import type { StreamBuffer } from './streamBuffer';
import type { SignalsService } from '@backstage/plugin-signals-node';

/** Signals channel for per-user conversation notifications (working / unread). */
const NOTIFY_CHANNEL = 'assistants:threads';

/**
 * Dependencies for the AI Assistants router. Kept explicit so the router stays
 * easy to unit-test with mocked services.
 */
export interface RouterOptions {
  logger: LoggerService;
  httpAuth: HttpAuthService;
  userInfo: UserInfoService;
  /** Permission service used to authorize the `assistant.use` gate. */
  permissions: PermissionsService;
  /** Actions service used to LIST + INVOKE the assistant's tool allowlist. */
  actions: ActionsService;
  /**
   * Platform/safety config: the model pool + resolver, MCP server connections,
   * runtime limits, and the global approval set. Assistant DEFINITIONS live in
   * {@link assistantStore}; who may manage them is the `assistant.manage`
   * permission, not config.
   */
  assistants: AssistantsConfig;
  /**
   * Server-side store for assistant definitions. The router resolves an
   * assistant per request from its synchronously-read in-memory snapshot
   * (`get`/`list`), exactly where the old config Map was used; the admin
   * `/manage` endpoints mutate it (write-through snapshot rebuild).
   */
  assistantStore: AssistantStore;
  /** Server-side conversation persistence. */
  threadService: ThreadService;
  /** Shared buffer of running turns' streams, for rejoining from any replica. */
  streamBuffer: StreamBuffer;
  /** Real-time push for working / unread indicators (per user). */
  signals: SignalsService;
  /** Backend-held sign-ins for servers that run their own OAuth. */
  oauth?: McpOAuthService;
  /** The app's origin, which the sign-in callback page posts to. */
  appOrigin?: string;
  /** Answers MCP servers' questions (elicitation). */
  elicitations?: ElicitationBroker;
}

/**
 * The per-turn note about the page the user is viewing, appended to the
 * instructions after the assistant prompt. Ephemeral: it describes this
 * turn only and is never persisted with the thread.
 */
export function pageContextInstructions(page: PageContext): string {
  const where = page.title
    ? `"${page.title}" at ${page.path}`
    : `the page at ${page.path}`;
  const entity = page.entityRef
    ? ` The page is the catalog entity ${page.entityRef}.`
    : '';
  return `## The user's page\nThe user is viewing ${where}.${entity} Call \`read_current_page\` to see what the page shows.`;
}

/**
 * The instruction line for a per-user server that offers no tools this turn,
 * so the model explains instead of guessing.
 */
export function unavailableServerInstructions(
  unavailable: UnavailableMcpServer[],
): string | undefined {
  if (unavailable.length === 0) return undefined;
  const lines = unavailable.map(({ server, error }) => {
    const title = server.userCredentials?.title ?? server.id;
    return error
      ? `- ${title} tools (server '${
          server.id
        }') are unavailable this turn: connecting with the user's ${title} sign-in failed (${error.slice(
          0,
          300,
        )}). Tell the user; they may need to reconnect ${title} or lack access.`
      : `- ${title} tools (server '${server.id}') are unavailable because the user hasn't connected ${title}. Ask them to click "Connect ${title}" above the message box.`;
  });
  return `## Unavailable tools\n${lines.join('\n')}`;
}

/** A gated call the user just approved or denied, found in the request's messages. */
export interface ApprovalDecision {
  toolName: string;
  approved: boolean;
  input: unknown;
}

/**
 * The approval answers this request carries: tool calls in the last
 * assistant message the user has answered but that haven't run yet. Each
 * answer is in exactly one request, the one that resumes the turn.
 */
export function approvalDecisions(messages: unknown[]): ApprovalDecision[] {
  const last = [...messages]
    .reverse()
    .find(m => (m as { role?: unknown })?.role === 'assistant') as
    | { parts?: unknown[] }
    | undefined;
  if (!Array.isArray(last?.parts)) return [];
  const decisions: ApprovalDecision[] = [];
  for (const part of last.parts) {
    const p = part as {
      type?: string;
      toolName?: string;
      state?: string;
      input?: unknown;
      approval?: { approved?: boolean };
    };
    if (p?.state !== 'approval-responded' || !p.approval) continue;
    const toolName =
      p.type === 'dynamic-tool' ? p.toolName : p.type?.replace(/^tool-/, '');
    if (!toolName || typeof p.approval.approved !== 'boolean') continue;
    decisions.push({
      toolName,
      approved: p.approval.approved,
      input: p.input,
    });
  }
  return decisions;
}

/** The browser-side approval previews for every MCP server, keyed by namespaced tool. */
function approvalPreviewsFor(
  servers: Map<string, McpServerConfig>,
): Record<string, ApprovalPreview> {
  const previews: Record<string, ApprovalPreview> = {};
  for (const server of servers.values()) {
    for (const [toolName, preview] of Object.entries(
      server.approvalPreview ?? {},
    )) {
      previews[mcpToolName(server.id, toolName)] = {
        type: preview.type,
        fields: preview.fields,
        diff: !!preview.base,
      };
    }
  }
  return previews;
}

/** The `userCredentials` of an assistant summary: its per-user servers' sign-ins. */
function userCredentialsOf(servers: McpServerConfig[]): {
  userCredentials?: UserCredentialSpec[];
} {
  const specs = servers.flatMap(server => {
    const spec = userCredentialSpec(server);
    return spec ? [spec] : [];
  });
  return specs.length > 0 ? { userCredentials: specs } : {};
}

/**
 * Resolves an assistant's accessibility for a resolved
 * {@link @backstage/backend-plugin-api#BackstageUserInfo}. Shared by `/status`
 * (filtering the assistant list) and `/chat` (enforcing per-turn access) so all
 * routes apply identical semantics. Delegates to
 * {@link isPolicyAccessible} (the same ownership-ref check, default-deny):
 *
 * - `allowAuthenticated` grants any signed-in user.
 * - `users` matches the caller's `userEntityRef`.
 * - `groups` matches any of the caller's `ownershipEntityRefs`.
 * - a policy with `allowAuthenticated: false` and empty `users`/`groups` grants
 *   nobody.
 */
function isAssistantAccessible(
  assistant: AssistantDefinition,
  user: BackstageUserInfo,
): boolean {
  return isPolicyAccessible(assistant.access, {
    userEntityRef: user.userEntityRef,
    ownershipEntityRefs: user.ownershipEntityRefs,
  });
}

/**
 * A single message as received on the title route. Accepts both the
 * `content` string shape and the `parts[].text` UI-message shape so the
 * excerpt builder can extract text regardless of how the client serialized it.
 */
interface TitleMessage {
  role?: unknown;
  content?: unknown;
  parts?: Array<{ type?: unknown; text?: unknown }>;
}

/**
 * Extracts a compact, plain-text excerpt from the first few messages of a
 * conversation for use as the title-generation prompt. Handles both the
 * `content` string shape and the `parts[].text` UI-message shape.
 */
function buildTitleExcerpt(messages: TitleMessage[]): string {
  const textOf = (m: TitleMessage): string => {
    if (typeof m.content === 'string') {
      return m.content;
    }
    if (Array.isArray(m.parts)) {
      return m.parts
        .filter(p => p.type === 'text' && typeof p.text === 'string')
        .map(p => p.text as string)
        .join(' ');
    }
    return '';
  };

  return messages
    .slice(0, 4)
    .map(m => {
      const role = typeof m.role === 'string' ? m.role : 'user';
      return `${role}: ${textOf(m).slice(0, 200)}`;
    })
    .join('\n');
}

/** System prompt for auto-titling a conversation's first completed turn. */
const TITLE_SYSTEM_PROMPT =
  'Generate a short conversation title (4-6 words, no quotes, no trailing ' +
  'punctuation) describing what the conversation is about. Reply with ONLY ' +
  'the title, nothing else.';

/**
 * Anthropic tool-args sanitizer.
 *
 * An `assistant` tool-call part can carry its `input` as a JSON **string** (or
 * `undefined`) rather than an object, which the Anthropic provider rejects. We
 * coerce it back to an object before the messages reach the provider.
 *
 * This was originally written as a workaround for `@ai-sdk/anthropic@^3.0.103`,
 * on the assumption an upstream fix would retire it. Re-tested against `ai@7` +
 * `@ai-sdk/anthropic@4`: `convertToModelMessages` is a faithful pass-through —
 * a string `input` stays a string and `undefined` stays `undefined`. It does
 * not normalize, and there is no sign it ever will, so this is a permanent
 * guard rather than a temporary patch.
 *
 * Scope: runs only when the model's provider is configured with
 * `type: anthropic` (see {@link AssistantsConfig.resolveProviderType}) — never
 * keyed on the provider id, which is a free label.
 */
function sanitizeAnthropicToolArgs(messages: ModelMessage[]): ModelMessage[] {
  const coerce = (value: unknown): unknown => {
    if (value && typeof value === 'object') {
      return value;
    }
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return {};
      }
    }
    // undefined/null/other → empty object, the shape the provider expects.
    return {};
  };

  return messages.map(message => {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) {
      return message;
    }
    const content = message.content.map(part =>
      part &&
      typeof part === 'object' &&
      (part as { type?: unknown }).type === 'tool-call'
        ? { ...part, input: coerce((part as { input?: unknown }).input) }
        : part,
    );
    return { ...message, content } as ModelMessage;
  });
}

/**
 * Inline text/code file attachments into text parts for the model.
 *
 * The composer sends text/code files as `file` parts (a base64 data URL) so the
 * chat renders them as a compact chip instead of dumping the contents into the
 * message. Many providers won't read a non-image file part, so here — only for what
 * is sent to the model — each non-image file part is decoded and replaced with a
 * text part wrapping the file contents. Image file parts are left untouched
 * (forwarded to the model as-is; if it can't read images, its provider errors).
 * The persisted UI message keeps the original file
 * part, so the chip survives reloads; this transform is per-turn and model-only.
 */
function inlineTextFileAttachments(messages: unknown[]): unknown[] {
  const decode = (url: string): string | null => {
    const base64 = /^data:[^,]*;base64,(.*)$/s.exec(url);
    if (base64) {
      try {
        return Buffer.from(base64[1], 'base64').toString('utf8');
      } catch {
        return null;
      }
    }
    const plain = /^data:[^,]*,(.*)$/s.exec(url);
    if (plain) {
      try {
        return decodeURIComponent(plain[1]);
      } catch {
        return null;
      }
    }
    return null;
  };

  return messages.map(message => {
    const m = message as {
      role?: unknown;
      parts?: Array<Record<string, unknown>>;
    };
    if (m.role !== 'user' || !Array.isArray(m.parts)) return message;
    let changed = false;
    const parts = m.parts.flatMap(part => {
      const mediaType = part?.mediaType;
      const url = part?.url;
      if (
        part?.type === 'file' &&
        typeof mediaType === 'string' &&
        !mediaType.startsWith('image/') &&
        typeof url === 'string'
      ) {
        const text = decode(url);
        if (text !== null) {
          changed = true;
          const name =
            typeof part.filename === 'string' ? part.filename : 'attachment';
          return [
            {
              type: 'text',
              text: `<attachment name="${name}">\n${text}\n</attachment>`,
            },
          ];
        }
      }
      return [part];
    });
    return changed ? { ...m, parts } : message;
  });
}

/**
 * Builds the Express router for the AI Assistants backend plugin.
 *
 * This mounts `GET /status` and `POST /chat` on the typed OpenAPI router
 * ({@link createOpenApiRouter}, generated from `src/schema/openapi.yaml`), plus
 * plain Express sub-routers for the stream controls (`/chat/resume/:threadId`,
 * `/chat/cancel/:threadId`), the `/threads` conversation store, and the
 * `/manage` admin endpoints. `/chat` resolves the assistant's tool allowlist
 * from the Backstage Actions registry per request; its body is validated
 * against the `ChatRequest` schema by the OpenAPI router, while its RESPONSE
 * is a UI message stream piped via `pipeUIMessageStreamToResponse` and is
 * intentionally NOT response-validated.
 *
 * @public
 */
export async function createRouter(options: RouterOptions): Promise<Router> {
  const {
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
  } = options;

  /**
   * Enforce the `assistant.use` permission for the caller — the plugin-access
   * gate on every user-facing route (`/status`, `/chat`, `/threads`).
   * Throws NotAllowedError (403) when denied. Which assistants the caller then
   * sees is the separate per-assistant {@link isAssistantAccessible} filter.
   */
  async function requireUse(credentials: BackstageCredentials): Promise<void> {
    const [decision] = await permissions.authorize(
      [{ permission: assistantUsePermission }],
      { credentials },
    );
    if (decision.result !== AuthorizeResult.ALLOW) {
      throw new NotAllowedError('You are not permitted to use assistants');
    }
  }

  // Per-thread AbortController for the in-flight turn, so an explicit Stop
  // (POST /chat/cancel/:threadId) can abort the server-side generation. A bare
  // disconnect must NOT abort — that means "navigate away / reload" and the turn
  // keeps running so it can be resumed.
  const turnAborts = new Map<string, AbortController>();

  // Heartbeat timers for the turns this process runs. The heartbeat keeps the
  // thread's `working` flag fresh for every replica and picks up a Stop that
  // another replica received.
  const turnHeartbeats = new Map<string, ReturnType<typeof setInterval>>();

  async function noteStarted(
    userRef: string,
    threadId: string,
    assistantId: string,
  ) {
    await threadService.startTurn(threadId);
    const timer = setInterval(() => {
      threadService
        .heartbeatTurn(threadId)
        .then(cancel => {
          if (cancel) turnAborts.get(threadId)?.abort();
        })
        .catch(error =>
          logger.warn('turn heartbeat failed', {
            threadId,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
    }, TURN_HEARTBEAT_MS);
    timer.unref?.();
    turnHeartbeats.set(threadId, timer);
    void signals
      .publish({
        recipients: { type: 'user', entityRef: userRef },
        channel: NOTIFY_CHANNEL,
        message: { type: 'turn-started', threadId, assistantId },
      })
      .catch(() => {});
  }

  async function noteFinished(
    userRef: string,
    threadId: string,
    assistantId: string,
  ) {
    const timer = turnHeartbeats.get(threadId);
    if (!timer) return; // already finished (Stop runs onAbort, then onFinish)
    clearInterval(timer);
    turnHeartbeats.delete(threadId);
    await threadService.endTurn(threadId).catch(error =>
      logger.error('failed to clear turn state', {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    void signals
      .publish({
        recipients: { type: 'user', entityRef: userRef },
        channel: NOTIFY_CHANNEL,
        message: { type: 'turn-finished', threadId, assistantId },
      })
      .catch(() => {});
  }

  // A thread's metadata changed (e.g. an auto-generated title) without a status
  // change — tells views to refresh the list. Distinct from turn-finished so it
  // doesn't re-toggle read/unread.
  function noteUpdated(userRef: string, threadId: string, assistantId: string) {
    void signals
      .publish({
        recipients: { type: 'user', entityRef: userRef },
        channel: NOTIFY_CHANNEL,
        message: { type: 'updated', threadId, assistantId },
      })
      .catch(() => {});
  }

  // The OpenAPI router's default middleware uses express.json() with no size
  // limit (100kb Express default). Chat conversations with tool results easily
  // exceed that. Override the middleware to use the configurable limit.
  const router = await createOpenApiRouter({
    middleware: [express.json({ limit: assistants.requestBodyLimit })],
  });

  // Approval previews come from config alone, so they are built once.
  const approvalPreviews = approvalPreviewsFor(assistants.mcpServers);

  // Express 4 does not forward rejections from async handlers to the error
  // middleware, so we forward them to `next` explicitly.
  router.get('/status', (req, res, next) => {
    handleStatus(req, res).catch(next);
  });

  router.post('/chat', (req, res, next) => {
    handleChat(req, res).catch(next);
  });

  // Reconnect to an in-flight (or just-finished) /chat stream and replay it.
  // The client (AssistantChatTransport's resumable adapter) calls this on remount
  // when it has a stored stream id, to rejoin a generation it stepped away from.
  // A plain Express sub-router — the typed OpenAPI router only allows spec paths.
  const streamRouter = express.Router();
  streamRouter.get('/chat/resume/:threadId', (req, res, next) => {
    (async () => {
      const credentials = await httpAuth.credentials(req, { allow: ['user'] });
      await requireUse(credentials);
      const user = await userInfo.getUserInfo(credentials);
      const threadId = req.params.threadId;
      // Unknown or foreign thread → nothing to resume.
      if (!(await threadService.getThread(user.userEntityRef, threadId))) {
        res.status(204).end();
        return;
      }
      let closed = false;
      res.on('close', () => {
        closed = true;
      });
      const found = await streamBuffer.follow(threadId, {
        start: () => {
          // Match the UI message stream content type so the client parser
          // accepts it.
          res.status(200);
          for (const [key, value] of Object.entries(
            UI_MESSAGE_STREAM_HEADERS,
          )) {
            res.setHeader(key, String(value));
          }
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.flushHeaders();
        },
        write: data => {
          res.write(data);
        },
        closed: () => closed,
        running: () => threadService.isTurnRunning(threadId),
      });
      // No buffered turn (none ran recently, or it expired) → nothing to resume.
      if (!found) {
        res.status(204).end();
        return;
      }
      res.end();
    })().catch(next);
  });

  // Abort an in-flight turn — the composer Stop button. A bare connection close
  // means "navigate away / reload" (the turn keeps running so it can be resumed),
  // so the client signals an EXPLICIT stop here. Scoped to the caller's own
  // running turn. The request is recorded on the thread, so the replica running
  // the turn stops it on its next heartbeat; when that is this process, it
  // stops now.
  streamRouter.post('/chat/cancel/:threadId', (req, res, next) => {
    (async () => {
      const credentials = await httpAuth.credentials(req, { allow: ['user'] });
      await requireUse(credentials);
      const user = await userInfo.getUserInfo(credentials);
      const threadId = req.params.threadId;
      if (await threadService.requestCancel(user.userEntityRef, threadId)) {
        turnAborts.get(threadId)?.abort();
      }
      res.status(204).end();
    })().catch(next);
  });

  // The current content behind a gated write, for the approval card's diff.
  // The browser names the pending call; the backend runs only the read tool
  // configured for that tool (`approvalPreview.<tool>.base`), as the same
  // user on a per-user server, and only for an assistant the caller may use
  // that allows the tool.
  streamRouter.post('/preview', (req, res, next) => {
    (async () => {
      const credentials = await httpAuth.credentials(req, { allow: ['user'] });
      await requireUse(credentials);
      const user = await userInfo.getUserInfo(credentials);
      const body = (req.body ?? {}) as Partial<ApprovalPreviewRequest>;
      if (
        typeof body.assistantId !== 'string' ||
        typeof body.tool !== 'string' ||
        !body.input ||
        typeof body.input !== 'object'
      ) {
        throw new InputError('assistantId, tool, and input are required');
      }
      const assistant = await assistantStore.getById(body.assistantId);
      if (!assistant || !isAssistantAccessible(assistant, user)) {
        throw new NotFoundError(`Unknown assistantId '${body.assistantId}'`);
      }
      const selection = splitAllowedTools(
        assistant.allowedTools,
        assistants.mcpServers,
      ).mcpSelections.find(sel =>
        sel.tools.some(t => mcpToolName(sel.server.id, t) === body.tool),
      );
      const toolName = selection?.tools.find(
        t => mcpToolName(selection.server.id, t) === body.tool,
      );
      const preview =
        selection && toolName
          ? selection.server.approvalPreview?.[toolName]
          : undefined;
      const calls = preview && previewBaseCalls(preview, body.input);
      if (!selection || !preview?.base || !calls) {
        throw new InputError(`'${body.tool}' has no preview to read`);
      }
      const { server } = selection;
      const caller = mcpCallerFor(
        user.userEntityRef,
        req.headers[USER_CREDENTIALS_HEADER],
        assistants.mcpServers,
        oauth,
      );
      const files = await Promise.all(
        calls.map(
          async ({
            path,
            args,
          }): Promise<ApprovalPreviewResponse['files'][number]> => {
            try {
              const result = await callServerTool(
                server,
                preview.base!.tool,
                args,
                caller,
                logger,
              );
              const text = toolResultText(result.content);
              if (result.isError) {
                const message = text ?? 'the read tool returned an error';
                return isNotFoundError(message)
                  ? { path, exists: false }
                  : { path, exists: true, error: message.slice(0, 500) };
              }
              return text === undefined
                ? { path, exists: true, error: 'The file is not text' }
                : { path, exists: true, content: text };
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              return isNotFoundError(message)
                ? { path, exists: false }
                : { path, exists: true, error: message.slice(0, 500) };
            }
          },
        ),
      );
      const response: ApprovalPreviewResponse = { files };
      res.json(response);
    })().catch(next);
  });

  // A user's answer to an MCP server's question (elicitation), for the call
  // waiting on it on whichever replica runs the turn. Only the user whose
  // turn asked may answer.
  streamRouter.post('/elicitations/:id', (req, res, next) => {
    (async () => {
      const credentials = await httpAuth.credentials(req, { allow: ['user'] });
      await requireUse(credentials);
      if (!elicitations) throw new NotFoundError('No question is open');
      const user = await userInfo.getUserInfo(credentials);
      const { status, errors } = await elicitations.respond(
        req.params.id,
        user.userEntityRef,
        req.body,
      );
      if (status === 204) {
        res.status(204).end();
        return;
      }
      const messages: Record<number, string> = {
        400: errors?.join('; ') ?? 'Invalid answer',
        403: 'This question belongs to another user',
        404: 'No such question',
        410: 'This question was already answered or has expired',
      };
      res.status(status).json({
        error: { name: 'ElicitationError', message: messages[status] },
        ...(errors ? { errors } : {}),
      });
    })().catch(next);
  });

  router.use(streamRouter);

  /**
   * `GET /status` — the single page-load endpoint. Returns the browser-safe
   * {@link StatusResponse}: the assistants the caller may access (id/title/
   * description/models/defaultModel/ui — never the prompt or access policy),
   * the full model pool, and the default model.
   */
  async function handleStatus(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    // Header user token only — rejects service and cookie credentials.
    // Missing/invalid token throws AuthenticationError (401).
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    await requireUse(credentials);
    const user = await userInfo.getUserInfo(credentials);

    // The actions this caller may see (gate 2, coarse). Used to project each
    // assistant's effective tool names = its allowlist ∩ this set, matching
    // what `/chat` would actually offer the model.
    const { actions: available } = await actions.list({ credentials });

    // The accessible definitions for this caller (snapshot read; sync). Each
    // assistant's unified `allowedTools` is split into bare action ids + per-
    // server MCP tool selections so the tool projection below mirrors `/chat`.
    // The default assistant first (it is open to everyone, so always here),
    // the rest in snapshot order.
    const defaultAssistant = assistantStore.getDefaultId();
    const accessible = assistantStore
      .list()
      .filter(assistant => isAssistantAccessible(assistant, user))
      .sort((a, b) => {
        if (a.id === defaultAssistant) return -1;
        if (b.id === defaultAssistant) return 1;
        return 0;
      })
      .map(assistant => ({
        assistant,
        split: splitAllowedTools(assistant.allowedTools, assistants.mcpServers),
      }));

    // MCP tool summaries come from the scheduler-maintained connection pool
    // (maintainMcpConnections, in the plugin) read SYNCHRONOUSLY — so a page load
    // never blocks on a live MCP connection. A server not yet connected (or
    // unreachable) yields an empty list; its tools fill in on the next maintenance
    // cycle. The per-assistant allowlist is applied below via summarizeMcpTools.
    const rawByServer = new Map<
      string,
      ReturnType<typeof cachedServerToolsRaw>
    >();
    for (const { split } of accessible) {
      for (const sel of split.mcpSelections) {
        if (!rawByServer.has(sel.server.id)) {
          rawByServer.set(sel.server.id, cachedServerToolsRaw(sel.server.id));
        }
      }
    }

    // Project each accessible assistant to the browser-safe summary (no prompt,
    // no access) via the store, attaching the resolved tool list = its allowlist
    // ∩ the caller's visible actions (bare) + its allowlisted MCP tools.
    const status: StatusResponse = {
      assistants: accessible.map(({ assistant, split }) => ({
        ...assistantStore.summaryFor(assistant),
        tools: [
          ...selectAssistantActions(available, split.actionIds, logger).map(
            a => ({
              name: a.name,
              description: a.description,
              source: 'backstage',
            }),
          ),
          ...split.mcpSelections.flatMap(sel =>
            summarizeMcpTools(
              sel.server.id,
              rawByServer.get(sel.server.id) ?? [],
              sel.tools,
            ),
          ),
          // Client tools are declared and described in the browser; the
          // backend knows only the allowlisted names.
          ...split.clientToolNames.map(name => ({ name, source: 'client' })),
        ],
        ...userCredentialsOf(split.mcpSelections.map(sel => sel.server)),
      })),
      models: assistants.models,
      defaultModel: assistants.defaultModel,
      requireApproval: [...assistants.requireApproval],
      ...(assistants.approveEachCall.size > 0
        ? { approveEachCall: [...assistants.approveEachCall] }
        : {}),
      ...(Object.keys(approvalPreviews).length > 0 ? { approvalPreviews } : {}),
    };
    if (
      defaultAssistant &&
      accessible.some(a => a.assistant.id === defaultAssistant)
    ) {
      status.defaultAssistant = defaultAssistant;
    }

    res.json(status);
  }

  async function handleChat(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    const requestId = randomUUID();

    // 1. Header user token only — rejects service and cookie credentials.
    //    Missing/invalid token throws AuthenticationError (401).
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    await requireUse(credentials);

    // 2. The request body shape (assistantId/modelId present + non-empty,
    //    messages a non-empty array) is already validated by the OpenAPI router
    //    against `src/schema/openapi.yaml`, so no hand-checks are needed here.
    const {
      assistantId,
      modelId,
      threadId,
      reasoningLevel,
      page,
      elicitation,
    } = req.body as {
      assistantId: string;
      modelId: string;
      threadId?: string;
      reasoningLevel?: ReasoningLevel;
      page?: PageContext;
      elicitation?: boolean;
    };
    let messages = req.body.messages as unknown[];

    // 3. Resolve the assistant from the AUTHORITATIVE DB (not the snapshot) so the
    //    per-turn access decision reflects edits/deletes immediately, even on a
    //    replica that didn't serve the write; unknown → InputError (400).
    const assistant = await assistantStore.getById(assistantId);
    if (!assistant) {
      throw new InputError(`Unknown assistantId '${assistantId}'`);
    }

    // 4. Access check via userInfo + the assistant's policy; denied → 403.
    const user = await userInfo.getUserInfo(credentials);
    if (!isAssistantAccessible(assistant, user)) {
      throw new NotAllowedError(
        `User is not permitted to use assistant '${assistantId}'`,
      );
    }

    // 4a. Thread ownership. Resolved owner-scoped before any side effect (the
    //     abort handle, the in-flight registry, the resumable stream, the
    //     user-turn persist) so a thread the caller doesn't own is a plain 404
    //     with nothing registered against its id.
    if (threadId) {
      const thread = await threadService.getThread(
        user.userEntityRef,
        threadId,
      );
      if (!thread) {
        throw new NotFoundError(`Thread '${threadId}' not found`);
      }
    }

    // 5. Resolve the model; unknown or out-of-allowlist modelId → 400. An empty
    //    allowlist means the full platform pool — defer to the store's derived
    //    effective model list.
    if (!assistantStore.effectiveModels(assistant).includes(modelId)) {
      throw new InputError(
        `Model '${modelId}' is not available for assistant '${assistantId}'`,
      );
    }
    const model = assistants.resolveModel(modelId);

    // 5a. Output ceiling. Only sent when configured — a provider's own default
    //     is right for models it recognises, but it can guess badly (and low)
    //     for an id it doesn't, which truncates or empties the reply.
    const maxOutputTokens = assistants.resolveMaxOutputTokens(modelId);

    // 5b. Reasoning effort for this turn. Unset, or a level this model doesn't
    //     declare, means send nothing and let the provider default stand — a
    //     client whose model just changed under it must not fail the turn.
    const providerOptions = reasoningLevel
      ? assistants.resolveReasoning(modelId, reasoningLevel)
      : undefined;
    if (reasoningLevel && !providerOptions) {
      logger.debug('reasoning level not offered by model; using default', {
        requestId,
        modelId,
        reasoningLevel,
      });
    }

    // 6. Resolve the assistant's tools from its unified `allowedTools`. Split
    //    each entry into bare Backstage action ids and per-server MCP tool
    //    selections (deriving which servers to connect from the namespaced
    //    prefixes; unknown entries are tolerated — see splitAllowedTools).
    const { actionIds, mcpSelections, clientToolNames } = splitAllowedTools(
      assistant.allowedTools,
      assistants.mcpServers,
    );

    // 6a. Backstage actions. The list is scoped to what THIS user may see
    //     (gate 2, coarse); we keep only the actions named in the allowlist
    //     (gate 1; unknown names are logged and skipped — non-fatal) and adapt
    //     them to AI SDK tools whose `execute` invokes with the SAME caller
    //     credentials (runs as the user; fine-grained perms enforced at invoke).
    const { actions: available } = await actions.list({ credentials });
    const selected = selectAssistantActions(available, actionIds, logger);

    // 6b. Tools from the assistant's allowlisted external MCP servers. Shared
    //     servers come from the pooled, scheduler-maintained connections — no
    //     per-turn connect/list, and the connections are NOT closed when the
    //     turn ends; one with no live pooled connection is skipped (its tools
    //     fill in on the next cycle). Per-user servers connect with the token
    //     the browser sent in the credentials header, as this user; without
    //     one they offer no tools and the model is told why (step 9).
    //     Every gated call, and every call an argument rule rejects, is
    //     written to the audit log.
    const caller = mcpCallerFor(
      user.userEntityRef,
      req.headers[USER_CREDENTIALS_HEADER],
      assistants.mcpServers,
      oauth,
    );
    const audit = (
      server: string,
      tool: string,
      decision: string,
      input: unknown,
    ) =>
      logger.info('assistants.tool.audit', {
        user: user.userEntityRef,
        assistantId,
        ...(threadId ? { threadId } : {}),
        server,
        tool,
        decision,
        target: auditTarget(input),
      });
    const { tools: mcpTools, unavailable: unavailableServers } =
      await buildMcpTools(
        mcpSelections,
        logger,
        assistants.toolResultMaxChars,
        {
          caller,
          turn: {
            assistantId,
            ...(threadId ? { threadId } : {}),
            renders: elicitation === true,
          },
          onCall: event => {
            if (
              event.outcome === 'rejected-by-rule' ||
              assistants.requireApproval.has(event.name)
            ) {
              audit(event.server, event.tool, event.outcome, event.input);
            }
          },
        },
      );
    const serverTools: Record<string, Tool> = {
      ...actionsToTools(
        selected,
        actions,
        credentials,
        assistants.toolResultMaxChars,
      ),
      ...mcpTools,
    };

    // 6c. Client tools: declared by the browser on this request (assistant-ui
    //     sends every registered frontend tool's schema as `tools`), filtered
    //     to the built-ins plus this assistant's allowlisted names, and added
    //     WITHOUT `execute` so streamText emits the call and yields to the
    //     browser, which runs the tool with the user's own credentials and
    //     returns the result on the next request. `render_form` and
    //     `download_file` are client tools too.
    const clientTools = selectClientTools({
      declared: readClientToolDeclarations(req.body),
      allowed: clientToolNames,
      reserved: new Set(Object.keys(serverTools)),
      logger,
    });
    const tools = { ...serverTools, ...clientTools.tools };

    // Client tool results arrive inside the conversation rather than through
    // an `execute`, so the one result budget is applied to them here, before
    // the model sees them and before the turn is persisted.
    messages = capClientToolOutputs(
      messages,
      new Set(Object.keys(clientTools.tools)),
      assistants.toolResultMaxChars,
    );

    // 6d. Deterministic approval gate. The approval set is GLOBAL now: the
    //     platform `requireApproval` floor (top-level action ids ∪ per-server
    //     namespaced `<serverId>__<tool>`) intersected with THIS assistant's
    //     `allowedTools`. Every tool in that intersection gets an entry in the
    //     call-level `toolApproval` map passed to `streamText`. The SDK then
    //     emits a tool-approval-request and SKIPS the tool's `execute` until
    //     the user responds (Allow runs it server-side; Deny tells the model it
    //     was declined). This is code-enforced — not a prompt the model can
    //     ignore. Names that don't resolve to a built tool are logged and
    //     skipped.
    //
    //     Client tools are not in the map: the browser gates them before it
    //     runs them (assistant-ui skips a frontend tool's `execute` for a call
    //     that carries a server approval), using the same floor from /status.
    //
    //     The predicate also honours a standing "always allow <tool>" grant: the
    //     surface's "Always allow" button records an approved tool-approval-
    //     response whose `reason` is `always:<tool>`. Once that is in the
    //     conversation, the tool runs without prompting for the rest of the chat —
    //     so a long batch is one click, not one per call. The grant lives in the
    //     model message history (persisted + replayed), so it is deterministic and
    //     survives reloads, and it is per-tool by design (granting one tool never
    //     auto-approves another).
    // The per-turn approval set = global floor ∩ this assistant's allowedTools.
    const approvalSet = effectiveApprovalSet(
      assistant.allowedTools,
      assistants.requireApproval,
    );
    const toolApproval: Record<
      string,
      (
        input: unknown,
        opts: { messages: ReadonlyArray<{ content?: unknown }> },
      ) =>
        | 'user-approval'
        | 'not-applicable'
        | { type: 'denied'; reason: string }
    > = {};
    // The namespaced name's server and tool, and its argument-rule check.
    const selectionByName = new Map<string, [McpServerConfig, string]>();
    for (const { server, tools: names } of mcpSelections) {
      for (const tool of names) {
        selectionByName.set(mcpToolName(server.id, tool), [server, tool]);
      }
    }
    const splitToolName = (name: string): [string, string] => {
      const found = selectionByName.get(name);
      return found ? [found[0].id, found[1]] : ['backstage', name];
    };
    const ruleCheckFor = (name: string) => {
      const found = selectionByName.get(name);
      const rules = found && found[0].argumentRules?.[found[1]];
      return rules
        ? (input: unknown) => argumentRuleViolation(found[1], rules, input)
        : undefined;
    };
    // The user's answers to gated calls arrive on the request that resumes
    // the turn; each is audited once, here.
    for (const decision of approvalDecisions(messages)) {
      if (assistants.requireApproval.has(decision.toolName)) {
        const [server, tool] = splitToolName(decision.toolName);
        audit(
          server,
          tool,
          decision.approved ? 'approved' : 'denied',
          decision.input,
        );
      }
    }
    if (approvalSet.length > 0) {
      const hasStandingGrant = (
        history: ReadonlyArray<{ content?: unknown }>,
        toolName: string,
      ): boolean => {
        const want = `always:${toolName}`;
        for (const m of history) {
          const content = m?.content;
          if (!Array.isArray(content)) continue;
          for (const part of content) {
            if (
              part &&
              typeof part === 'object' &&
              (part as { type?: string }).type === 'tool-approval-response' &&
              (part as { approved?: boolean }).approved === true &&
              (part as { reason?: string }).reason === want
            ) {
              return true;
            }
          }
        }
        return false;
      };
      const gated: string[] = [];
      for (const name of approvalSet) {
        if (name in serverTools) {
          // A function, not a static status: a call that breaks an argument
          // rule is denied with the reason before the user is asked (they
          // never approve a call that would be refused), and the prompt is
          // skipped once a standing grant exists, unless the tool is
          // approved call by call.
          const rule = ruleCheckFor(name);
          const eachCall = assistants.approveEachCall.has(name);
          toolApproval[name] = (input, opts) => {
            const violation = rule?.(input);
            if (violation) {
              const [server, tool] = splitToolName(name);
              audit(server, tool, 'rejected-by-rule', input);
              return { type: 'denied', reason: violation };
            }
            return !eachCall && hasStandingGrant(opts.messages, name)
              ? 'not-applicable'
              : 'user-approval';
          };
          gated.push(name);
        }
      }
      // Client tools are gated in the browser, so they are never "missing".
      const missing = approvalSet.filter(
        n => !gated.includes(n) && !clientToolNames.includes(n),
      );
      if (missing.length > 0) {
        logger.warn(
          `requireApproval lists tool(s) not available to assistant '${
            assistant.id
          }': ${missing.join(', ')}`,
        );
      }
      logger.info(
        `Approval gate active for assistant '${assistant.id}': ${
          gated.join(', ') || '(none)'
        }`,
      );
    }

    // 7. Convert UI messages → model messages. Text/code file attachments (sent
    //    as file parts so the chat shows a chip) are decoded back to inline text
    //    here so every model can read them; image file parts pass through.
    let modelMessages = await convertToModelMessages(
      inlineTextFileAttachments(messages) as Omit<UIMessage, 'id'>[],
    );

    // 8. Anthropic-only tool-args sanitizer (see sanitizeAnthropicToolArgs).
    //    Keyed on the provider's configured TYPE, not its id.
    if (assistants.resolveProviderType(modelId) === 'anthropic') {
      modelMessages = sanitizeAnthropicToolArgs(modelMessages);
    }

    // 9. Stream the turn. Reasoning effort is applied only when this turn asked
    //    for a level the model declares (step 5b); otherwise the provider's own
    //    default stands. The multi-step tool loop is bounded by maxSteps.
    // Abort handle for this turn, registered so the Stop button (via
    // POST /chat/cancel/:threadId) can stop the server-side generation. Cleared
    // on finish / abort / error.
    const turnAbort = new AbortController();
    if (threadId) turnAborts.set(threadId, turnAbort);

    // Per-user servers that offer no tools this turn get one line each, so
    // the model explains (connect, or no access) instead of guessing.
    const unavailableNote = unavailableServerInstructions(unavailableServers);

    const result = streamText({
      model,
      // The page note comes last: it describes this turn only.
      instructions: [
        PLATFORM_INSTRUCTIONS,
        assistant.prompt,
        ...(unavailableNote ? [unavailableNote] : []),
        ...(page ? [pageContextInstructions(page)] : []),
      ].join('\n\n'),
      messages: modelMessages,
      tools,
      ...(Object.keys(toolApproval).length > 0 ? { toolApproval } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(providerOptions ? { providerOptions } : {}),
      stopWhen: stepCountIs(assistants.maxSteps),
      abortSignal: turnAbort.signal,
      onFinish: ({ finishReason, usage, steps }) => {
        if (threadId) turnAborts.delete(threadId);
        // Non-blocking completion log.
        logger.info('chat turn finished', {
          requestId,
          assistantId,
          modelId,
          finishReason,
          steps: steps.length,
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
        });
      },
      onAbort: () => {
        // Explicit Stop: the model has stopped generating. Clear the working
        // indicator and drop the abort handle. The user message stays persisted
        // (turn start); the partial reply is persisted on finish, stamped
        // metadata.canceled (see onFinish below).
        if (threadId) {
          turnAborts.delete(threadId);
          void noteFinished(user.userEntityRef, threadId, assistantId);
        }
        logger.info('chat turn aborted (stop)', {
          requestId,
          assistantId,
          threadId,
        });
      },
      onError: ({ error }) => {
        if (threadId) {
          turnAborts.delete(threadId);
          void noteFinished(user.userEntityRef, threadId, assistantId);
        }
        // A provider rejection carries its body on the AI SDK's APICallError;
        // the message alone ("Provider returned error") says nothing.
        const responseBody = (error as { responseBody?: unknown })
          ?.responseBody;
        logger.error('chat turn errored', {
          requestId,
          assistantId,
          modelId,
          error: error instanceof Error ? error.message : String(error),
          ...(typeof responseBody === 'string'
            ? { responseBody: responseBody.slice(0, 2000) }
            : {}),
        });
      },
    });

    // Persist the user's turn immediately — before streaming — so the
    // conversation is durable the instant it's sent. A client that returns to
    // this thread mid-flight always has the question + prior history to show;
    // onFinish then replaces with the full turn (incl. the assistant reply).
    // Full replace is idempotent, so start + finish compose cleanly.
    if (threadId) {
      await threadService.replaceMessages(
        user.userEntityRef,
        threadId,
        messages as UIMessage[],
        modelId,
      );
    }

    // Buffer the SSE under the THREAD id, so a client returning to this thread
    // can rejoin by an id it already knows (GET /chat/resume/:threadId) — there
    // is no fragile per-turn id to capture. One in-flight stream per thread.
    // Begun before the turn reads as working, so a rejoin never replays the
    // thread's previous turn.
    const streamTurnId = threadId
      ? await streamBuffer.begin(threadId)
      : undefined;
    if (threadId) await noteStarted(user.userEntityRef, threadId, assistantId);

    logger.info('chat turn started', {
      requestId,
      assistantId,
      modelId,
      threadId,
      messageCount: messages.length,
    });

    // 10. Drive the stream to completion server-side even if the client
    //     disconnects, so the turn is always persisted (no data loss on
    //     navigation). The server is the single writer of message rows.
    void result.consumeStream({
      // consumeStream returns a PromiseLike (no .catch); errors surface here.
      // Swallowed on purpose — the turn's own error handling owns the response,
      // this call only drives the stream to completion.
      onError: error =>
        logger.debug('chat stream consume failed', {
          requestId,
          error: String(error),
        }),
    });

    // 11. Pipe the UI message stream to the response. On finish, persist the
    //     completed conversation to the thread (scoped to this user). The
    //     frontend never writes message rows — `originalMessages` +
    //     `generateMessageId` put the SDK in persistence mode.
    // Attach token usage to the assistant message so the composer can show a
    // context-usage gauge. Prefer per-step usage — the LAST `finish-step` wins on
    // merge, and its `inputTokens` is the true context size sent on the final
    // model request (system + tools + full history + tool results), unlike the
    // aggregate `totalUsage` which sums every step. Some providers only report
    // usage at the end, so fall back to `finish.totalUsage` when no step usage
    // was seen. Streams live AND lands in the persisted message (survives reload).
    let sawStepUsage = false;
    void pipeUIMessageStreamToResponse({
      response: res,
      stream: toUIMessageStream({
        stream: result.stream,
        tools,
        originalMessages: messages as UIMessage[],
        generateMessageId: () => `msg-${randomUUID()}`,
        messageMetadata: ({ part }) => {
          if (
            part.type === 'finish-step' &&
            typeof part.usage?.inputTokens === 'number'
          ) {
            sawStepUsage = true;
            return {
              usage: {
                inputTokens: part.usage.inputTokens,
                outputTokens: part.usage.outputTokens,
              },
            };
          }
          if (
            part.type === 'finish' &&
            !sawStepUsage &&
            typeof part.totalUsage?.inputTokens === 'number'
          ) {
            return {
              usage: {
                inputTokens: part.totalUsage.inputTokens,
                outputTokens: part.totalUsage.outputTokens,
              },
            };
          }
          return undefined;
        },
        onFinish: async ({ messages: finalMessages }) => {
          if (!threadId) return;
          // If this turn was aborted via Stop, mark the (partial) assistant reply
          // so ANY client that loads it later shows a "Canceled" indicator instead
          // of an ambiguous half-finished turn. The flag rides in the message's
          // metadata, which round-trips through assistant-ui's history load.
          // Distinct from an error: errors surface via the streamed error part
          // (the client renders them), not a metadata flag — the abort signal is
          // set ONLY when the cancel route fired.
          if (turnAbort.signal.aborted && finalMessages.length > 0) {
            const last = finalMessages[finalMessages.length - 1];
            if (last.role === 'assistant') {
              last.metadata = {
                ...(last.metadata as Record<string, unknown> | undefined),
                canceled: true,
              };
            }
          }
          try {
            const saved = await threadService.replaceMessages(
              user.userEntityRef,
              threadId,
              finalMessages,
              modelId,
            );
            if (!saved) {
              logger.warn(
                'chat turn not persisted: thread not found or not owned',
                {
                  requestId,
                  threadId,
                },
              );
            }
          } catch (error) {
            logger.error('failed to persist chat turn', {
              requestId,
              threadId,
              error: error instanceof Error ? error.message : String(error),
            });
          } finally {
            // Clear "working" the instant the reply is done — titling is background.
            await noteFinished(user.userEntityRef, threadId, assistantId);
          }

          // Auto-title the conversation's first turn OFF the critical path, so the
          // pulse never lingers through title generation. On success emit a
          // lightweight 'updated' signal so views refresh the title (no status change).
          void (async () => {
            try {
              const thread = await threadService.getThread(
                user.userEntityRef,
                threadId,
              );
              if (!thread || thread.title !== 'New Chat') return;
              const titled = await generateText({
                model,
                instructions: TITLE_SYSTEM_PROMPT,
                prompt: buildTitleExcerpt(
                  finalMessages as unknown as TitleMessage[],
                ),
                maxRetries: 1,
              });
              const title = titled.text
                .trim()
                .replace(/["']+/g, '')
                .slice(0, 80);
              if (title) {
                await threadService.updateThread(user.userEntityRef, threadId, {
                  title,
                });
                noteUpdated(user.userEntityRef, threadId, assistantId);
              }
            } catch (titleError) {
              logger.warn('auto-title failed', {
                requestId,
                threadId,
                error:
                  titleError instanceof Error
                    ? titleError.message
                    : String(titleError),
              });
            }
          })();
        },
        // Surface a stream/turn error as a readable error part instead of the SDK's
        // masked default, so a failed turn shows WHY in the chat (the client renders
        // it via MessageError) rather than ending silently. Capped; this is an
        // internal developer tool, so the real reason beats an opaque mask.
        onError: error => {
          const detail = error instanceof Error ? error.message : String(error);
          logger.warn('chat stream error surfaced to client', {
            requestId,
            threadId,
            error: detail,
          });
          return `The assistant couldn't finish this turn: ${detail.slice(
            0,
            300,
          )}`;
        },
        sendReasoning: true,
      }),
      // Buffer a tee'd copy of the SSE in the database so a client returning
      // mid-flight can rejoin via GET /chat/resume/:id on any replica.
      consumeSseStream: ({ stream }) => {
        if (threadId && streamTurnId) {
          streamBuffer.record(threadId, streamTurnId, stream);
        }
      },
      headers: {
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  }

  // ---- Thread persistence routes (server-side conversation storage) --------
  // A plain Express sub-router. These are REST endpoints intentionally OUTSIDE
  // the OpenAPI JSON contract (which covers only /status + /chat); they back
  // assistant-ui's remote thread-list + history adapters. Every route is scoped
  // to the calling user — there is no path to another user's threads or
  // messages. Message rows are written ONLY by /chat (onFinish), never here.
  async function resolveUserRef(req: express.Request): Promise<string> {
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    await requireUse(credentials);
    const user = await userInfo.getUserInfo(credentials);
    return user.userEntityRef;
  }

  // Resolve the caller plus the set of assistant ids they may CURRENTLY access.
  // Thread lists/status are filtered to this set so a conversation for an
  // assistant the user can no longer use (deleted, or access revoked) never
  // surfaces — no orphaned rows, no unread dots for an unavailable assistant.
  async function resolveAccess(
    req: express.Request,
  ): Promise<{ userRef: string; accessibleIds: Set<string> }> {
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    await requireUse(credentials);
    const user = await userInfo.getUserInfo(credentials);
    const accessibleIds = new Set<string>();
    for (const def of assistantStore.list()) {
      if (isAssistantAccessible(def, user)) accessibleIds.add(def.id);
    }
    return { userRef: user.userEntityRef, accessibleIds };
  }

  const threads = express.Router();
  threads.use(express.json({ limit: '1mb' }));

  // List this user's threads — ALL of them by default (one runtime spans every
  // assistant), or one assistant's if `assistantId` is given. Filtered to the
  // assistants the caller can currently access.
  threads.get('/', (req, res, next) => {
    (async () => {
      const { userRef, accessibleIds } = await resolveAccess(req);
      const assistantId = req.query.assistantId;
      const scoped =
        typeof assistantId === 'string' && assistantId
          ? assistantId
          : undefined;
      const all = await threadService.listThreads(userRef, scoped);
      res.json({
        threads: all.filter(t => accessibleIds.has(t.assistantId)),
      });
    })().catch(next);
  });

  // Create a thread (only for an assistant the caller can access).
  threads.post('/', (req, res, next) => {
    (async () => {
      const { userRef, accessibleIds } = await resolveAccess(req);
      const { assistantId, model } = req.body ?? {};
      if (typeof assistantId !== 'string' || !assistantId) {
        throw new InputError('assistantId is required');
      }
      if (!accessibleIds.has(assistantId)) {
        throw new NotAllowedError(
          `You do not have access to assistant '${assistantId}'`,
        );
      }
      const thread = await threadService.createThread(
        userRef,
        assistantId,
        typeof model === 'string' ? model : undefined,
      );
      res.status(201).json(thread);
    })().catch(next);
  });

  // Per-conversation status across ALL of the user's assistants — the single
  // source the client derives every indicator from (conversation dots,
  // assistant rollups, nav). Both `unread` and `working` come from the
  // database, so every replica answers the same.
  // MUST precede `/:id` so 'status' isn't matched as a thread id.
  threads.get('/status', (req, res, next) => {
    (async () => {
      const { userRef, accessibleIds } = await resolveAccess(req);
      const rows = await threadService.listUserThreadStatuses(userRef);
      res.json({
        threads: rows
          .filter(r => accessibleIds.has(r.assistantId))
          .map(r => ({
            threadId: r.threadId,
            assistantId: r.assistantId,
            unread: r.unread,
            working: r.working,
            tokens: r.tokens,
          })),
      });
    })().catch(next);
  });

  // Fetch one thread.
  threads.get('/:id', (req, res, next) => {
    (async () => {
      const userRef = await resolveUserRef(req);
      const thread = await threadService.getThread(userRef, req.params.id);
      if (!thread)
        throw new NotFoundError(`Thread '${req.params.id}' not found`);
      res.json(thread);
    })().catch(next);
  });

  // Rename / set model / set reasoning level / pin / archive.
  threads.patch('/:id', (req, res, next) => {
    (async () => {
      const userRef = await resolveUserRef(req);
      const thread = await threadService.updateThread(
        userRef,
        req.params.id,
        parseThreadPatch(req.body),
      );
      if (!thread)
        throw new NotFoundError(`Thread '${req.params.id}' not found`);
      res.json(thread);
    })().catch(next);
  });

  // Delete a thread and its messages.
  threads.delete('/:id', (req, res, next) => {
    (async () => {
      const userRef = await resolveUserRef(req);
      const deleted = await threadService.deleteThread(userRef, req.params.id);
      if (!deleted)
        throw new NotFoundError(`Thread '${req.params.id}' not found`);
      res.status(204).end();
    })().catch(next);
  });

  // Mark a thread read (clears its unread flag).
  threads.post('/:id/read', (req, res, next) => {
    (async () => {
      const userRef = await resolveUserRef(req);
      const assistantId = await threadService.markRead(userRef, req.params.id);
      if (!assistantId)
        throw new NotFoundError(`Thread '${req.params.id}' not found`);
      // Tell every one of this user's views (chat page + nav icon) it's read, so
      // their derived indicators converge — same channel as working/unread.
      void signals
        .publish({
          recipients: { type: 'user', entityRef: userRef },
          channel: NOTIFY_CHANNEL,
          message: { type: 'read', threadId: req.params.id, assistantId },
        })
        .catch(() => {});
      res.status(204).end();
    })().catch(next);
  });

  // Load a thread's messages (the ThreadHistoryAdapter's only call — load-only).
  threads.get('/:id/messages', (req, res, next) => {
    (async () => {
      const userRef = await resolveUserRef(req);
      const messages = await threadService.getMessages(userRef, req.params.id);
      if (!messages)
        throw new NotFoundError(`Thread '${req.params.id}' not found`);
      res.json({ messages });
    })().catch(next);
  });

  router.use('/threads', threads);

  // Admin management surface — `/manage/assistants` CRUD + `/capabilities`,
  // all gated by the `assistant.manage` permission (403 for non-admins). A plain Express sub-router
  // (out-of-spec, like `/threads`) so the typed OpenAPI router's path
  // allowlist doesn't reject it and the hand-written `/chat` stays untouched.
  // Mutations rebuild the store snapshot write-through (in AssistantStore).
  router.use(
    createManageRouter({
      logger,
      httpAuth,
      userInfo,
      actions,
      assistants,
      assistantStore,
      permissions,
      oauth,
    }),
  );

  // Sign-in to servers that run their own OAuth (see mcpOAuthRouter).
  if (oauth && options.appOrigin) {
    router.use(
      createMcpOAuthRouter({
        oauth,
        httpAuth,
        userInfo,
        permissions,
        appOrigin: options.appOrigin,
      }),
    );
  }

  // Thrown @backstage/errors types reach the root HTTP router's error
  // middleware, which serializes them to { error: { name, message }, request,
  // response }.
  return router;
}
