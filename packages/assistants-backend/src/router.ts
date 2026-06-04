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
import { InputError, NotAllowedError } from '@backstage/errors';
import { randomUUID } from 'crypto';
import {
  streamText,
  generateText,
  convertToModelMessages,
  stepCountIs,
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
import { createOpenApiRouter } from './schema/openapi';

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
 * `src/schema/openapi.yaml`) per ADR 0002. `/chat` is a hand-written streaming
 * route whose body is validated against the same `ChatRequest` schema by the
 * router; its RESPONSE is a UI message stream piped via
 * `pipeUIMessageStreamToResponse` and is intentionally NOT response-validated.
 *
 * @public
 */
export async function createRouter(options: RouterOptions): Promise<Router> {
  const { logger, config, httpAuth, userInfo, actions, assistants } = options;

  // The OpenAPI router validates every incoming request body/params against the
  // spec and parses JSON itself (no separate `express.json()` needed).
  const router = await createOpenApiRouter();

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

    // Filter assistants by the caller's access policy, then project to the
    // browser-safe summary shape. Prompt and access never leave the backend.
    const status: StatusResponse = buildStatus(
      assistants,
      assistant => isAssistantAccessible(assistant, user),
      assistant =>
        selectAssistantActions(available, assistant.actions, logger).map(
          a => a.name,
        ),
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

    // 6. Resolve the assistant's tools from the Backstage Actions registry. The
    //    list is scoped to what THIS user may see (gate 2, coarse); we then
    //    keep only the actions named in the assistant's allowlist (gate 1;
    //    unknown names are logged and skipped — non-fatal) and adapt them to AI
    //    SDK tools whose `execute` invokes with the SAME caller credentials
    //    (runs as the user; fine-grained perms enforced at invoke — ADR 0003).
    const { actions: available } = await actions.list({ credentials });
    const selected = selectAssistantActions(available, assistant.actions, logger);
    const tools = actionsToTools(selected, actions, credentials);

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
    });

    logger.info('chat turn started', {
      requestId,
      assistantId,
      modelId,
      messageCount: messages.length,
    });

    // 10. Pipe the UI message stream to the Express response.
    result.pipeUIMessageStreamToResponse(res, {
      sendReasoning: true,
      headers: { 'Cache-Control': 'no-cache, no-transform' },
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
        system:
          'Generate a short conversation title (4-6 words, no quotes, no ' +
          'trailing punctuation) describing what the conversation is about. ' +
          'Reply with ONLY the title, nothing else.',
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

  // Standard Backstage error envelope. Mounted LAST so thrown @backstage/errors
  // types are serialized to { error: { name, message }, request, response }.
  const middleware = MiddlewareFactory.create({ logger, config });
  router.use(middleware.error());

  return router;
}
