import express, { type Router } from 'express';
import {
  HttpAuthService,
  LoggerService,
  RootConfigService,
  UserInfoService,
  BackstageUserInfo,
} from '@backstage/backend-plugin-api';
import { ActionsService } from '@backstage/backend-plugin-api/alpha';
import { MiddlewareFactory } from '@backstage/backend-defaults/rootHttpRouter';
import { InputError, NotAllowedError, NotFoundError } from '@backstage/errors';
import { randomUUID } from 'crypto';
import {
  streamText,
  generateText,
  convertToModelMessages,
  stepCountIs,
  UI_MESSAGE_STREAM_HEADERS,
  type ModelMessage,
  type UIMessage,
} from 'ai';
import type { StatusResponse } from '@drewswiredin/backstage-plugin-assistants-common';
import {
  AssistantAccessPolicy,
  AssistantDefinition,
  AssistantsConfig,
  buildStatus,
} from './config';
import { actionsToTools, selectAssistantActions } from './actions';
import {
  buildMcpTools,
  listServerToolsRaw,
  summarizeMcpTools,
  type ResolvedMcpSelection,
} from './mcp';
import { createOpenApiRouter } from './schema/openapi';
import type { ThreadService } from './threads';
import { ResumableStreamRegistry } from './resumableStreams';
import type { SignalsService } from '@backstage/plugin-signals-node';

/** Signals channel for per-user conversation notifications (generating / unread). */
const NOTIFY_CHANNEL = 'assistants:threads';

/**
 * Dependencies for the AI Assistants router. Kept explicit so the router stays
 * easy to unit-test with mocked services.
 */
export interface RouterOptions {
  logger: LoggerService;
  config: RootConfigService;
  httpAuth: HttpAuthService;
  userInfo: UserInfoService;
  /** Actions service used to LIST + INVOKE the assistant's tool allowlist. */
  actions: ActionsService;
  assistants: AssistantsConfig;
  /** Server-side conversation persistence. */
  threadService: ThreadService;
  /** Real-time push for generating / unread indicators (per user). */
  signals: SignalsService;
}

/**
 * Evaluates an assistant's access policy against the caller's identity. Shared
 * by `/status` (filtering the assistant list) and `/chat` + `/title` (enforcing
 * per-turn access) so all routes apply identical semantics.
 *
 * - no policy (none of the three set) → closed; only the explicit grants below
 *   open it. A policy with `allowAuthenticated: false` and empty `users`/`groups`
 *   grants nobody.
 * - `allowAuthenticated` grants any signed-in user.
 * - `users` matches the caller's `userEntityRef`.
 * - `groups` matches any of the caller's `ownershipEntityRefs`.
 */
function checkAccess(
  policy: AssistantAccessPolicy,
  userRef: string,
  ownershipRefs: string[],
): boolean {
  if (policy.allowAuthenticated) {
    return true;
  }
  if (policy.users.includes(userRef)) {
    return true;
  }
  if (policy.groups.some(group => ownershipRefs.includes(group))) {
    return true;
  }
  return false;
}

/**
 * Convenience wrapper resolving an assistant's accessibility from a resolved
 * {@link @backstage/backend-plugin-api#BackstageUserInfo}.
 */
function isAssistantAccessible(
  assistant: AssistantDefinition,
  user: BackstageUserInfo,
): boolean {
  return checkAccess(
    assistant.access,
    user.userEntityRef,
    user.ownershipEntityRefs,
  );
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

/** System prompt for conversation title generation (shared by `/title` and auto-titling). */
const TITLE_SYSTEM_PROMPT =
  'Generate a short conversation title (4-6 words, no quotes, no trailing ' +
  'punctuation) describing what the conversation is about. Reply with ONLY ' +
  'the title, nothing else.';

/**
 * Anthropic tool-args sanitizer.
 *
 * Workaround for a quirk in the affected `@ai-sdk/anthropic` range (pinned in
 * this package's `package.json` at `^3.0.81`) where tool-call args round-trip
 * incorrectly through `convertToModelMessages`: an `assistant` tool-call part
 * can surface with its `input` serialized as a JSON **string** (or `undefined`)
 * instead of an object, which the Anthropic provider then rejects. We coerce
 * any such tool-call `input` back to an object before the messages reach the
 * provider.
 *
 * Scope: gated to the `anthropic` provider only — it must not run for other
 * providers. Remove this once the backend is bumped past an `@ai-sdk/anthropic`
 * release that fixes the round-trip. See the upstream tracking issue:
 *   https://github.com/vercel/ai/issues/  (tool-call args round-trip; Anthropic)
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
 * Builds the Express router for the AI Assistants backend plugin.
 *
 * This mounts `GET /status`, `POST /chat`, and `POST /title`. `/chat` resolves
 * the assistant's tool allowlist from the Backstage Actions registry per
 * request.
 *
 * Request validation for `/status` and `/title` is delegated to the typed
 * OpenAPI router ({@link createOpenApiRouter}, generated from
 * `src/schema/openapi.yaml`). `/chat` is a hand-written streaming
 * route whose body is validated against the same `ChatRequest` schema by the
 * router; its RESPONSE is a UI message stream piped via
 * `pipeUIMessageStreamToResponse` and is intentionally NOT response-validated.
 *
 * @public
 */
export async function createRouter(options: RouterOptions): Promise<Router> {
  const {
    logger,
    config,
    httpAuth,
    userInfo,
    actions,
    assistants,
    threadService,
    signals,
  } = options;

  // Live, per-user set of in-flight generations: userRef -> (threadId -> assistantId).
  // Ephemeral (single backend replica); surfaced to the client via GET /threads/status.
  const inFlight = new Map<string, Map<string, string>>();

  // In-memory buffers of in-flight /chat SSE streams, for mid-flight resume.
  const resumables = new ResumableStreamRegistry();

  function noteStarted(userRef: string, threadId: string, assistantId: string) {
    let m = inFlight.get(userRef);
    if (!m) {
      m = new Map();
      inFlight.set(userRef, m);
    }
    m.set(threadId, assistantId);
    void signals
      .publish({
        recipients: { type: 'user', entityRef: userRef },
        channel: NOTIFY_CHANNEL,
        message: { type: 'turn-started', threadId, assistantId },
      })
      .catch(() => {});
  }

  function noteFinished(userRef: string, threadId: string, assistantId: string) {
    const m = inFlight.get(userRef);
    if (m) {
      m.delete(threadId);
      if (m.size === 0) inFlight.delete(userRef);
    }
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

  // Express 4 does not forward rejections from async handlers to the error
  // middleware, so we forward them to `next` explicitly.
  router.get('/status', (req, res, next) => {
    handleStatus(req, res).catch(next);
  });

  router.post('/chat', (req, res, next) => {
    handleChat(req, res).catch(next);
  });

  router.post('/title', (req, res, next) => {
    handleTitle(req, res).catch(next);
  });

  // Reconnect to an in-flight (or just-finished) /chat stream and replay it.
  // The client (AssistantChatTransport's resumable adapter) calls this on remount
  // when it has a stored stream id, to rejoin a generation it stepped away from.
  // A plain Express sub-router — the typed OpenAPI router only allows spec paths.
  const streamRouter = express.Router();
  streamRouter.get('/chat/resume/:streamId', (req, res, next) => {
    (async () => {
      const credentials = await httpAuth.credentials(req, { allow: ['user'] });
      const user = await userInfo.getUserInfo(credentials);
      const sub = resumables.subscribe(
        req.params.streamId,
        user.userEntityRef,
        chunk => (chunk === null ? res.end() : res.write(chunk)),
      );
      // Unknown / expired / not owned → nothing to resume.
      if (!sub) {
        res.status(204).end();
        return;
      }
      // Match the UI message stream content type so the client parser accepts it.
      res.status(200);
      for (const [key, value] of Object.entries(UI_MESSAGE_STREAM_HEADERS)) {
        res.setHeader(key, String(value));
      }
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.flushHeaders();
      // Replay everything buffered so far; the live tail arrives via the listener.
      for (const chunk of sub.buffered) res.write(chunk);
      if (sub.done) {
        res.end();
        return;
      }
      req.on('close', () => sub.unsubscribe());
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
    const user = await userInfo.getUserInfo(credentials);

    // The actions this caller may see (gate 2, coarse). Used to project each
    // assistant's effective tool names = its allowlist ∩ this set (wildcard
    // resolved), matching what `/chat` would actually offer the model.
    const { actions: available } = await actions.list({ credentials });

    // Pre-fetch (cached) MCP tool summaries for every server referenced by an
    // assistant this caller can access, so the synchronous tool projection below
    // can include them. A server that's down yields an empty list, not an error.
    const neededServers = new Set<string>();
    for (const assistant of assistants.assistants.values()) {
      if (isAssistantAccessible(assistant, user)) {
        assistant.mcpServers.forEach(sel => neededServers.add(sel.server));
      }
    }
    // Full (unfiltered) raw tool list per server, cached; the per-assistant
    // tool allowlist is applied below via summarizeMcpTools.
    const rawByServer = new Map<string, Awaited<
      ReturnType<typeof listServerToolsRaw>
    >>();
    await Promise.all(
      [...neededServers].map(async id => {
        const server = assistants.mcpServers.get(id);
        if (server) {
          rawByServer.set(id, await listServerToolsRaw(server, logger));
        }
      }),
    );

    // Filter assistants by the caller's access policy, then project to the
    // browser-safe summary shape. Prompt and access never leave the backend.
    const status: StatusResponse = buildStatus(
      assistants,
      assistant => isAssistantAccessible(assistant, user),
      assistant => [
        ...selectAssistantActions(available, assistant.actions, logger).map(
          a => ({
            name: a.name,
            description: a.description,
            source: 'backstage',
          }),
        ),
        ...assistant.mcpServers.flatMap(sel =>
          summarizeMcpTools(sel.server, rawByServer.get(sel.server) ?? [], sel.tools),
        ),
      ],
    );

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

    // 2. The request body shape (assistantId/modelId present + non-empty,
    //    messages a non-empty array) is already validated by the OpenAPI router
    //    against `src/schema/openapi.yaml`, so no hand-checks are needed here.
    const { assistantId, modelId, threadId, messages } = req.body as {
      assistantId: string;
      modelId: string;
      threadId?: string;
      messages: unknown[];
    };

    // 3. Resolve assistant config; unknown assistantId → InputError (400).
    const assistant = assistants.assistants.get(assistantId);
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

    // 5. Resolve the model; unknown or out-of-allowlist modelId → 400.
    if (!assistant.models.includes(modelId)) {
      throw new InputError(
        `Model '${modelId}' is not available for assistant '${assistantId}'`,
      );
    }
    const model = assistants.resolveModel(modelId);

    // 6. Resolve the assistant's tools from the Backstage Actions registry. The
    //    list is scoped to what THIS user may see (gate 2, coarse); we then
    //    keep only the actions named in the assistant's allowlist (gate 1;
    //    unknown names are logged and skipped — non-fatal) and adapt them to AI
    //    SDK tools whose `execute` invokes with the SAME caller credentials
    //    (runs as the user; fine-grained perms enforced at invoke).
    const { actions: available } = await actions.list({ credentials });
    const selected = selectAssistantActions(available, assistant.actions, logger);

    // 6b. Add tools from the assistant's allowlisted external MCP servers
    //     (static/shared credential — not run-as-user). Connections are held for
    //     the turn and closed when the stream finishes/errors. A server that's
    //     down is skipped, not fatal.
    const mcpSelections = assistant.mcpServers
      .map((sel): ResolvedMcpSelection | undefined => {
        const server = assistants.mcpServers.get(sel.server);
        return server ? { server, tools: sel.tools } : undefined;
      })
      .filter((s): s is ResolvedMcpSelection => Boolean(s));
    const mcp = await buildMcpTools(
      mcpSelections,
      logger,
      assistants.toolResultMaxChars,
    );
    const tools = {
      ...actionsToTools(
        selected,
        actions,
        credentials,
        assistants.toolResultMaxChars,
      ),
      ...mcp.tools,
    };

    // 7. Convert UI messages → model messages.
    let modelMessages = await convertToModelMessages(
      messages as Omit<UIMessage, 'id'>[],
    );

    // 8. Anthropic-only tool-args sanitizer (see sanitizeAnthropicToolArgs).
    //    Gated to the `anthropic` provider; must not run for other providers.
    const provider = modelId.split(':')[0];
    if (provider === 'anthropic') {
      modelMessages = sanitizeAnthropicToolArgs(modelMessages);
    }

    // 9. Stream the turn. Provider defaults are used (no explicit
    //    thinking/reasoning tuning). The multi-step tool loop is bounded by
    //    maxSteps.
    const result = streamText({
      model,
      system: assistant.prompt,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(assistants.maxSteps),
      onFinish: ({ finishReason, usage, steps }) => {
        // Release MCP connections now the turn (incl. tool calls) is done.
        void mcp.close();
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
      onError: ({ error }) => {
        void mcp.close();
        if (threadId) noteFinished(user.userEntityRef, threadId, assistantId);
        logger.error('chat turn errored', {
          requestId,
          assistantId,
          modelId,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });

    if (threadId) noteStarted(user.userEntityRef, threadId, assistantId);

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
    void result.consumeStream();

    // Id under which a copy of this SSE stream is buffered for mid-flight resume.
    const resumableId = randomUUID();

    // 11. Pipe the UI message stream to the response. On finish, persist the
    //     completed conversation to the thread (scoped to this user). The
    //     frontend never writes message rows — `originalMessages` +
    //     `generateMessageId` put the SDK in persistence mode.
    result.pipeUIMessageStreamToResponse(res, {
      originalMessages: messages as UIMessage[],
      generateMessageId: () => `msg-${randomUUID()}`,
      onFinish: async ({ messages: finalMessages }) => {
        if (!threadId) return;
        try {
          const saved = await threadService.replaceMessages(
            user.userEntityRef,
            threadId,
            finalMessages,
            modelId,
          );
          if (!saved) {
            logger.warn('chat turn not persisted: thread not found or not owned', {
              requestId,
              threadId,
            });
          }
        } catch (error) {
          logger.error('failed to persist chat turn', {
            requestId,
            threadId,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          // Clear "working" the instant the reply is done — titling is background.
          noteFinished(user.userEntityRef, threadId, assistantId);
        }

        // Auto-title the conversation's first turn OFF the critical path, so the
        // pulse never lingers through title generation. On success emit a
        // lightweight 'updated' signal so views refresh the title (no status change).
        void (async () => {
          try {
            const thread = await threadService.getThread(user.userEntityRef, threadId);
            if (!thread || thread.title !== 'New Chat') return;
            const titled = await generateText({
              model,
              system: TITLE_SYSTEM_PROMPT,
              prompt: buildTitleExcerpt(finalMessages as unknown as TitleMessage[]),
              maxRetries: 1,
            });
            const title = titled.text.trim().replace(/["']+/g, '').slice(0, 80);
            if (title) {
              await threadService.updateThread(user.userEntityRef, threadId, { title });
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
      // Buffer a tee'd copy of the SSE so a client returning mid-flight can
      // rejoin via GET /chat/resume/:id (in-memory; single replica).
      consumeSseStream: ({ stream }) => {
        resumables.start(resumableId, user.userEntityRef, stream);
      },
      sendReasoning: true,
      headers: {
        'Cache-Control': 'no-cache, no-transform',
        // AssistantChatTransport reads this to learn the resume id to store.
        'x-resumable-stream-id': resumableId,
      },
    });
  }

  /**
   * `POST /title` — generate a short conversation title from the opening
   * messages. Auth, assistant resolution, and access enforcement mirror `/chat`
   * exactly. Title generation itself is best-effort: any generation error is
   * logged and a `{ title: 'New Chat' }` fallback is returned with a 200 so
   * titling can never break the chat UX.
   */
  async function handleTitle(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    // 1. Header user token only — rejects service and cookie credentials.
    //    Missing/invalid token throws AuthenticationError (401).
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });

    // 2. The request body shape is validated by the OpenAPI router (see
    //    `handleChat`); only the business checks below remain.
    const { assistantId, modelId, messages } = req.body as {
      assistantId: string;
      modelId: string;
      messages: unknown[];
    };

    // 3. Resolve assistant config; unknown assistantId → InputError (400).
    const assistant = assistants.assistants.get(assistantId);
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

    // 5. Resolve the model; unknown or out-of-allowlist modelId → 400.
    if (!assistant.models.includes(modelId)) {
      throw new InputError(
        `Model '${modelId}' is not available for assistant '${assistantId}'`,
      );
    }
    const model = assistants.resolveModel(modelId);

    // 6. Build a compact excerpt from the opening messages.
    const excerpt = buildTitleExcerpt(messages as TitleMessage[]);

    // 7. Generate the title. Best-effort: on any error, log and fall back to
    //    'New Chat' (200) so titling never breaks the UX.
    try {
      const result = await generateText({
        model,
        system: TITLE_SYSTEM_PROMPT,
        prompt: excerpt,
        maxRetries: 1,
      });

      const title = result.text.trim().replace(/["']+/g, '').slice(0, 80);
      res.json({ title: title || 'New Chat' });
    } catch (error) {
      logger.warn('title generation failed', {
        assistantId,
        modelId,
        error: String(error),
      });
      res.json({ title: 'New Chat' });
    }
  }

  // ---- Thread persistence routes (server-side conversation storage) --------
  // A plain Express sub-router. These are REST endpoints intentionally OUTSIDE
  // the OpenAPI JSON contract (which covers only /status + /title); they back
  // assistant-ui's remote thread-list + history adapters. Every route is scoped
  // to the calling user — there is no path to another user's threads or
  // messages. Message rows are written ONLY by /chat (onFinish), never here.
  async function resolveUserRef(req: express.Request): Promise<string> {
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    const user = await userInfo.getUserInfo(credentials);
    return user.userEntityRef;
  }

  const threads = express.Router();
  threads.use(express.json({ limit: '1mb' }));

  // List this user's threads for an assistant (with server-computed unread).
  threads.get('/', (req, res, next) => {
    (async () => {
      const userRef = await resolveUserRef(req);
      const assistantId = req.query.assistantId;
      if (typeof assistantId !== 'string' || !assistantId) {
        throw new InputError('assistantId query parameter is required');
      }
      res.json({ threads: await threadService.listThreads(userRef, assistantId) });
    })().catch(next);
  });

  // Create a thread.
  threads.post('/', (req, res, next) => {
    (async () => {
      const userRef = await resolveUserRef(req);
      const { assistantId, model } = req.body ?? {};
      if (typeof assistantId !== 'string' || !assistantId) {
        throw new InputError('assistantId is required');
      }
      const thread = await threadService.createThread(
        userRef,
        assistantId,
        typeof model === 'string' ? model : undefined,
      );
      res.status(201).json(thread);
    })().catch(next);
  });

  // Cross-assistant unread: which assistants have any unread thread for this
  // user. Drives the rail's per-assistant unread dots. MUST be registered before
  // `/:id` so 'unread' isn't matched as a thread id.
  // Per-conversation status across ALL of the user's assistants — the single
  // source the client derives every indicator from (conversation dots, agent
  // rollups, nav). `unread` is durable (DB); `working` is the live in-flight set.
  // MUST precede `/:id` so 'status' isn't matched as a thread id.
  threads.get('/status', (req, res, next) => {
    (async () => {
      const userRef = await resolveUserRef(req);
      const rows = await threadService.listUserThreadStatuses(userRef);
      const working = inFlight.get(userRef);
      res.json({
        threads: rows.map(r => ({
          threadId: r.threadId,
          assistantId: r.assistantId,
          unread: r.unread,
          working: working?.has(r.threadId) ?? false,
        })),
      });
    })().catch(next);
  });

  // Fetch one thread.
  threads.get('/:id', (req, res, next) => {
    (async () => {
      const userRef = await resolveUserRef(req);
      const thread = await threadService.getThread(userRef, req.params.id);
      if (!thread) throw new NotFoundError(`Thread '${req.params.id}' not found`);
      res.json(thread);
    })().catch(next);
  });

  // Rename / set model / pin / archive.
  threads.patch('/:id', (req, res, next) => {
    (async () => {
      const userRef = await resolveUserRef(req);
      const { title, model, pinned, archived } = req.body ?? {};
      const thread = await threadService.updateThread(userRef, req.params.id, {
        title,
        model,
        pinned,
        archived,
      });
      if (!thread) throw new NotFoundError(`Thread '${req.params.id}' not found`);
      res.json(thread);
    })().catch(next);
  });

  // Delete a thread and its messages.
  threads.delete('/:id', (req, res, next) => {
    (async () => {
      const userRef = await resolveUserRef(req);
      const deleted = await threadService.deleteThread(userRef, req.params.id);
      if (!deleted) throw new NotFoundError(`Thread '${req.params.id}' not found`);
      res.status(204).end();
    })().catch(next);
  });

  // Mark a thread read (clears its unread flag).
  threads.post('/:id/read', (req, res, next) => {
    (async () => {
      const userRef = await resolveUserRef(req);
      const assistantId = await threadService.markRead(userRef, req.params.id);
      if (!assistantId) throw new NotFoundError(`Thread '${req.params.id}' not found`);
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
      if (!messages) throw new NotFoundError(`Thread '${req.params.id}' not found`);
      res.json({ messages });
    })().catch(next);
  });

  router.use('/threads', threads);

  // Standard Backstage error envelope. Mounted LAST so thrown @backstage/errors
  // types are serialized to { error: { name, message }, request, response }.
  const middleware = MiddlewareFactory.create({ logger, config });
  router.use(middleware.error());

  return router;
}
