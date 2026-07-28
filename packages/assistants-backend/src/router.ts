import express, { type Router } from 'express';
import {
  HttpAuthService,
  LoggerService,
  PermissionsService,
  RootConfigService,
  UserInfoService,
  BackstageUserInfo,
  BackstageCredentials,
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
  tool,
  jsonSchema,
  UI_MESSAGE_STREAM_HEADERS,
  type ModelMessage,
  type UIMessage,
} from 'ai';
import type {
  AssistantDefinition,
  StatusResponse,
} from '@drewswiredin/backstage-plugin-assistants-common';
import { assistantUsePermission } from '@drewswiredin/backstage-plugin-assistants-common';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { AssistantsConfig, isPolicyAccessible } from './config';
import { actionsToTools, selectAssistantActions } from './actions';
import {
  buildMcpTools,
  cachedServerToolsRaw,
  splitAllowedTools,
  summarizeMcpTools,
} from './mcp';
import type { AssistantStore } from './assistants';
import { createOpenApiRouter } from './schema/openapi';
import { createManageRouter } from './manage';
import type { ThreadService } from './threads';
import { ResumableStreamRegistry } from './resumableStreams';
import type { SignalsService } from '@backstage/plugin-signals-node';

/** Signals channel for per-user conversation notifications (working / unread). */
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
  /** Permission service used to authorize the `assistant.use` gate. */
  permissions: PermissionsService;
  /** Actions service used to LIST + INVOKE the assistant's tool allowlist. */
  actions: ActionsService;
  /**
   * Platform/safety config: the model pool + resolver, MCP server connections,
   * runtime limits, the management allowlist, and the global approval set.
   * Assistant DEFINITIONS no longer live here — they come from {@link assistantStore}.
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
  /** Real-time push for working / unread indicators (per user). */
  signals: SignalsService;
}

/**
 * Resolves an assistant's accessibility for a resolved
 * {@link @backstage/backend-plugin-api#BackstageUserInfo}. Shared by `/status`
 * (filtering the assistant list) and `/chat` + `/title` (enforcing per-turn
 * access) so all routes apply identical semantics. Delegates to
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
 * release that fixes the Anthropic tool-call args round-trip upstream.
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
    permissions,
    actions,
    assistants,
    assistantStore,
    threadService,
    signals,
  } = options;

  /**
   * Enforce the `assistant.use` permission for the caller — the plugin-access
   * gate on every user-facing route (`/status`, `/chat`, `/title`, `/threads`).
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

  // Live, per-user set of in-flight generations: userRef -> (threadId -> assistantId).
  // Ephemeral (single backend replica); surfaced to the client via GET /threads/status.
  const inFlight = new Map<string, Map<string, string>>();

  // In-memory buffers of in-flight /chat SSE streams, for mid-flight resume.
  const resumables = new ResumableStreamRegistry();

  // Per-thread AbortController for the in-flight turn, so an explicit Stop
  // (POST /chat/cancel/:threadId) can abort the server-side generation. A bare
  // disconnect must NOT abort — that means "navigate away / reload" and the turn
  // keeps running so it can be resumed.
  const turnAborts = new Map<string, AbortController>();

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
  streamRouter.get('/chat/resume/:threadId', (req, res, next) => {
    (async () => {
      const credentials = await httpAuth.credentials(req, { allow: ['user'] });
      await requireUse(credentials);
      const user = await userInfo.getUserInfo(credentials);
      const sub = resumables.subscribe(
        req.params.threadId,
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

  // Abort an in-flight turn — the composer Stop button. A bare connection close
  // means "navigate away / reload" (the turn keeps running so it can be resumed),
  // so the client signals an EXPLICIT stop here. Scoped to the caller's own
  // in-flight turn (checked against the per-user in-flight set).
  streamRouter.post('/chat/cancel/:threadId', (req, res, next) => {
    (async () => {
      const credentials = await httpAuth.credentials(req, { allow: ['user'] });
      await requireUse(credentials);
      const user = await userInfo.getUserInfo(credentials);
      const threadId = req.params.threadId;
      if (inFlight.get(user.userEntityRef)?.has(threadId)) {
        turnAborts.get(threadId)?.abort();
      }
      res.status(204).end();
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
    // assistant's effective tool names = its allowlist ∩ this set (wildcard
    // resolved), matching what `/chat` would actually offer the model.
    const { actions: available } = await actions.list({ credentials });

    // The accessible definitions for this caller (snapshot read; sync). Each
    // assistant's unified `allowedTools` is split into bare action ids + per-
    // server MCP tool selections so the tool projection below mirrors `/chat`.
    const accessible = assistantStore
      .list()
      .filter(assistant => isAssistantAccessible(assistant, user))
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
        ],
      })),
      models: assistants.models,
      defaultModel: assistants.defaultModel,
    };

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
    const { assistantId, modelId, threadId, messages } = req.body as {
      assistantId: string;
      modelId: string;
      threadId?: string;
      messages: unknown[];
    };

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

    // 5. Resolve the model; unknown or out-of-allowlist modelId → 400. An empty
    //    allowlist means the full platform pool — defer to the store's derived
    //    effective model list.
    if (!assistantStore.effectiveModels(assistant).includes(modelId)) {
      throw new InputError(
        `Model '${modelId}' is not available for assistant '${assistantId}'`,
      );
    }
    const model = assistants.resolveModel(modelId);

    // 6. Resolve the assistant's tools from its unified `allowedTools`. Split
    //    each entry into bare Backstage action ids and per-server MCP tool
    //    selections (deriving which servers to connect from the namespaced
    //    prefixes; unknown entries are tolerated — see splitAllowedTools).
    const { actionIds, mcpSelections } = splitAllowedTools(
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

    // 6b. Tools from the assistant's allowlisted external MCP servers
    //     (static/shared credential — not run-as-user). Built from the pooled,
    //     scheduler-maintained connections — no per-turn connect/list, and the
    //     connections are NOT closed when the turn ends. A server with no live
    //     pooled connection is skipped (its tools fill in on the next cycle).
    const mcpTools = buildMcpTools(
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
      ...mcpTools,
      // Interactive form tool — a CLIENT-side tool (no `execute`): the model
      // calls it with an RJSF form spec, streamText emits the call and yields,
      // the frontend renders the form, and the user's submitted values come back
      // as the tool result (human-in-the-loop) so the turn continues. Generic:
      // use any time structured / multi-field / multiple-choice input is needed.
      render_form: tool({
        description:
          'Render an interactive form for the user to fill, instead of asking ' +
          'multiple questions in chat. Provide `jsonSchema` (a standard JSON ' +
          'Schema describing the fields — use enums for dropdowns, `required`, ' +
          'types, etc.) and optionally `uiSchema` (RJSF widgets/ordering), ' +
          '`title`, and `submitLabel`. The form is shown in the chat; the user ' +
          'fills and submits it and you receive their values as the tool result. ' +
          'Use whenever you need structured, multi-field, multiple-choice, or ' +
          'complex input. ' +
          'The form renders Backstage scaffolder field extensions: set a ' +
          "property's `uiSchema` `ui:field` to a picker to get a real Backstage " +
          'widget instead of a plain input. Built-in pickers: `OwnerPicker` and ' +
          '`OwnedEntityPicker` (catalog owner/entity), `EntityPicker` and ' +
          '`MultiEntityPicker` (catalog entities; filter via `ui:options.catalogFilter`), ' +
          '`EntityNamePicker`, `EntityTagsPicker`, `MyGroupsPicker`, ' +
          '`RepoUrlPicker` / `RepoBranchPicker` / `RepoOwnerPicker` (SCM repo ' +
          'location). Any custom field the app has registered works the same way ' +
          'by its name. When reusing a scaffolder template, you can pass that ' +
          "template's parameter block as `jsonSchema` as-is — `ui:field` / " +
          '`ui:options` embedded inside the schema properties (the template ' +
          'convention) are handled automatically; you do not need to split them ' +
          'into `uiSchema` yourself. ' +
          'The result is `{ submitted: true, values: {...} }` when ' +
          'the user submits, or `{ submitted: false, cancelled: true }` if they ' +
          'dismiss it — in which case do not assume any values; ask again or ' +
          'proceed without them.',
        inputSchema: jsonSchema<{
          jsonSchema: Record<string, unknown>;
          uiSchema?: Record<string, unknown>;
          title?: string;
          submitLabel?: string;
        }>({
          type: 'object',
          properties: {
            jsonSchema: {
              type: 'object',
              description:
                'A JSON Schema (RJSF) describing the form fields to collect.',
            },
            uiSchema: {
              type: 'object',
              description:
                'Optional RJSF uiSchema (widgets, ordering, ui:field, etc.).',
            },
            title: { type: 'string', description: 'Optional form heading.' },
            submitLabel: {
              type: 'string',
              description: 'Optional submit button label (default "Submit").',
            },
          },
          required: ['jsonSchema'],
          additionalProperties: false,
        }),
        // No `execute`: resolved on the client via the form's submit (addResult).
      }),
      // Generative download tool — a CLIENT-side tool (no `execute`): the model
      // calls it with file content, the frontend (DownloadFileTool) renders a
      // download chip and acknowledges it. Lets the assistant hand back a generated
      // artifact (CSV/JSON/code/etc.) as a saveable file instead of inline text.
      download_file: tool({
        description:
          'Deliver a downloadable file to the user. Use when the user asks for a ' +
          'file, export, or download, or when a downloadable artifact is more ' +
          'useful than inline text (e.g. a CSV, JSON, Markdown, code, or config ' +
          'file you generated). Provide `filename` (with extension), `content` ' +
          '(the COMPLETE file text), and optionally `mimeType`. The file appears ' +
          'in the chat as a download chip the user can save or copy — put the full ' +
          'content in `content`, do not also paste it into your message.',
        inputSchema: jsonSchema<{
          filename: string;
          content: string;
          mimeType?: string;
        }>({
          type: 'object',
          properties: {
            filename: {
              type: 'string',
              description: 'File name including extension, e.g. "report.csv".',
            },
            content: {
              type: 'string',
              description: 'The complete file contents, as text.',
            },
            mimeType: {
              type: 'string',
              description:
                'Optional MIME type, e.g. "text/csv". Inferred from the ' +
                'filename extension when omitted.',
            },
          },
          required: ['filename', 'content'],
          additionalProperties: false,
        }),
        // No `execute`: rendered + acknowledged on the client (DownloadFileTool).
      }),
    };

    // 6c. Deterministic approval gate. The approval set is GLOBAL now: the
    //     platform `requireApproval` floor (top-level action ids ∪ per-server
    //     namespaced `<serverId>__<tool>`) intersected with THIS assistant's
    //     `allowedTools`. For every tool in that intersection, set the AI SDK's
    //     `needsApproval` predicate. The SDK then emits a tool-approval-request
    //     and SKIPS the tool's `execute` until the user responds (Allow runs it
    //     server-side; Deny tells the model it was declined). This is
    //     code-enforced — not a prompt the model can ignore. Names that don't
    //     resolve to a built tool are logged and skipped.
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
    const approvalSet = assistant.allowedTools.filter(t =>
      assistants.requireApproval.has(t),
    );
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
        const t = (tools as Record<string, unknown>)[name];
        if (t && typeof t === 'object') {
          // A function, not `true`: skip the prompt once a standing grant exists.
          (t as { needsApproval?: unknown }).needsApproval = (
            _input: unknown,
            opts: { messages: ReadonlyArray<{ content?: unknown }> },
          ): boolean => !hasStandingGrant(opts.messages, name);
          gated.push(name);
        }
      }
      const missing = approvalSet.filter(n => !gated.includes(n));
      if (missing.length > 0) {
        logger.warn(
          `requireApproval lists tool(s) not available to assistant '${assistant.id}': ${missing.join(', ')}`,
        );
      }
      logger.info(
        `Approval gate active for assistant '${assistant.id}': ${gated.join(', ') || '(none)'}`,
      );
    }

    // 7. Convert UI messages → model messages. Text/code file attachments (sent
    //    as file parts so the chat shows a chip) are decoded back to inline text
    //    here so every model can read them; image file parts pass through.
    let modelMessages = await convertToModelMessages(
      inlineTextFileAttachments(messages) as Omit<UIMessage, 'id'>[],
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
    // Abort handle for this turn, registered so the Stop button (via
    // POST /chat/cancel/:threadId) can stop the server-side generation. Cleared
    // on finish / abort / error.
    const turnAbort = new AbortController();
    if (threadId) turnAborts.set(threadId, turnAbort);

    const result = streamText({
      model,
      system: assistant.prompt,
      messages: modelMessages,
      tools,
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
          noteFinished(user.userEntityRef, threadId, assistantId);
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
          noteFinished(user.userEntityRef, threadId, assistantId);
        }
        logger.error('chat turn errored', {
          requestId,
          assistantId,
          modelId,
          error: error instanceof Error ? error.message : String(error),
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

    // Buffer the SSE under the THREAD id, so a client returning to this thread
    // can rejoin by an id it already knows (GET /chat/resume/:threadId) — there
    // is no fragile per-turn id to capture. One in-flight stream per thread.
    const resumableId = threadId ?? randomUUID();

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
    result.pipeUIMessageStreamToResponse(res, {
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
        return `The assistant couldn't finish this turn: ${detail.slice(0, 300)}`;
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
    await requireUse(credentials);

    // 2. The request body shape is validated by the OpenAPI router (see
    //    `handleChat`); only the business checks below remain.
    const { assistantId, modelId, messages } = req.body as {
      assistantId: string;
      modelId: string;
      messages: unknown[];
    };

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

    // 5. Resolve the model; unknown or out-of-allowlist modelId → 400. An empty
    //    allowlist means the full platform pool — defer to the store's derived
    //    effective model list.
    if (!assistantStore.effectiveModels(assistant).includes(modelId)) {
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
    await requireUse(credentials);
    const user = await userInfo.getUserInfo(credentials);
    return user.userEntityRef;
  }

  // Resolve the caller plus the set of assistant ids they may CURRENTLY access.
  // Thread lists/status are filtered to this set so a conversation for an agent
  // the user can no longer use (removed from config, or access revoked) never
  // surfaces — no orphaned rows, no unread dots for an unavailable agent.
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

  // List this user's threads — ALL of them by default (single multi-agent
  // runtime), or one assistant's if `assistantId` is given. Filtered to agents
  // the caller can currently access.
  threads.get('/', (req, res, next) => {
    (async () => {
      const { userRef, accessibleIds } = await resolveAccess(req);
      const assistantId = req.query.assistantId;
      const scoped =
        typeof assistantId === 'string' && assistantId ? assistantId : undefined;
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
  // source the client derives every indicator from (conversation dots, agent
  // rollups, nav). `unread` is durable (DB); `working` is the live in-flight set.
  // MUST precede `/:id` so 'status' isn't matched as a thread id.
  threads.get('/status', (req, res, next) => {
    (async () => {
      const { userRef, accessibleIds } = await resolveAccess(req);
      const rows = await threadService.listUserThreadStatuses(userRef);
      const working = inFlight.get(userRef);
      res.json({
        threads: rows
          .filter(r => accessibleIds.has(r.assistantId))
          .map(r => ({
            threadId: r.threadId,
            assistantId: r.assistantId,
            unread: r.unread,
            working: working?.has(r.threadId) ?? false,
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
    }),
  );

  // Standard Backstage error envelope. Mounted LAST so thrown @backstage/errors
  // types are serialized to { error: { name, message }, request, response }.
  const middleware = MiddlewareFactory.create({ logger, config });
  router.use(middleware.error());

  return router;
}
