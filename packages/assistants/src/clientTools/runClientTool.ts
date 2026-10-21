import type { ApiHolder } from '@backstage/core-plugin-api';
import type {
  ClientToolError,
  ClientToolErrorCode,
} from '@drewswiredin/backstage-plugin-assistants-common';
import type {
  AssistantClientTool,
  ClientToolAuthRequirement,
  ClientToolInterrupt,
} from './types';

/**
 * The browser side of a client tool call: approval, credential, `execute`,
 * and result shaping. assistant-ui calls this as the registered tool's
 * `execute`; the user prompts go through its `human` interrupt, which the
 * tool's card renders and answers with `resume`.
 *
 * Every failure returns a {@link ClientToolError} rather than throwing, so
 * the model can explain it and the turn continues. A credential never
 * appears in a result: `execute` is the only code that sees it.
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

export interface RunClientToolDeps {
  apis: ApiHolder;
  /** Asks the user; resolves with the card's `resume` payload. */
  human(payload: ClientToolInterrupt): Promise<unknown>;
  /** Aborted when the user stops the turn. */
  signal: AbortSignal;
  /** The global approval floor from `/status`. */
  requireApproval: ReadonlySet<string>;
}

/**
 * Whether a call must be approved before it runs: every tool that is not
 * read-only or is destructive, plus any tool named in the config floor. There
 * is no standing "always allow" for client tools; each call asks.
 */
export function clientToolNeedsApproval(
  tool: Pick<AssistantClientTool, 'name' | 'attributes'>,
  requireApproval: ReadonlySet<string>,
): boolean {
  return (
    !tool.attributes.readOnly ||
    tool.attributes.destructive === true ||
    requireApproval.has(tool.name)
  );
}

function errorResult(
  code: ClientToolErrorCode,
  message: string,
): ClientToolError {
  return { _error: true, code, message };
}

/** True when a client tool result records that the user stopped the turn. */
export function isAbortedResult(output: unknown): boolean {
  return (
    !!output &&
    typeof output === 'object' &&
    (output as ClientToolError)._error === true &&
    (output as ClientToolError).code === 'aborted'
  );
}

/**
 * Acquires the credential without prompting. Undefined means the user has not
 * connected the system yet; a rejection means the same.
 */
export async function acquireCredential(
  auth: ClientToolAuthRequirement,
  apis: ApiHolder,
  interactive: boolean,
): Promise<unknown | undefined> {
  if (auth.kind === 'custom') {
    return auth.acquire({ apis, interactive });
  }
  const api = apis.get(auth.apiRef);
  if (!api) return undefined;
  // `optional` returns empty without a session instead of prompting;
  // `instantPopup` opens the provider's popup straight from the click.
  const token = await api.getAccessToken(
    auth.scopes,
    interactive ? { instantPopup: true } : { optional: true },
  );
  return token ? token : undefined;
}

/**
 * Runs one call of `tool` with `input`. Returns the tool's output, or a
 * {@link ClientToolError}.
 */
export async function runClientTool(
  tool: AssistantClientTool<any, any>,
  input: unknown,
  deps: RunClientToolDeps,
): Promise<unknown> {
  const label = tool.title ?? tool.name;
  const aborted = () =>
    errorResult('aborted', `The user stopped the turn before ${label} ran.`);
  if (deps.signal.aborted) return aborted();

  // Ask the user before anything else, so a declined call never acquires a
  // credential.
  const ask = async (payload: ClientToolInterrupt): Promise<unknown> => {
    try {
      return await deps.human(payload);
    } catch {
      // assistant-ui rejects a pending prompt when the run is aborted.
      return undefined;
    }
  };
  if (clientToolNeedsApproval(tool, deps.requireApproval)) {
    const answer = (await ask({
      kind: 'approval',
      toolName: tool.name,
      title: tool.title,
      input,
    })) as { approved?: boolean } | undefined;
    if (deps.signal.aborted) return aborted();
    if (answer?.approved !== true) {
      return errorResult(
        'declined',
        `The user did not approve running ${label}.`,
      );
    }
  }

  let credential: unknown;
  if (tool.auth) {
    try {
      credential = await acquireCredential(tool.auth, deps.apis, false);
    } catch {
      credential = undefined;
    }
    if (credential === undefined) {
      // The card's Connect control acquires interactively on the click and
      // hands the credential back here; nothing else ever holds it.
      const answer = (await ask({
        kind: 'connect',
        toolName: tool.name,
        title: tool.title,
        system: tool.auth.system,
      })) as { credential?: unknown } | undefined;
      if (deps.signal.aborted) return aborted();
      credential = answer?.credential;
      if (credential === undefined) {
        return errorResult(
          'not_authorized',
          `The user has not connected ${tool.auth.system}, which ${label} needs.`,
        );
      }
    }
  }

  if (!tool.execute) {
    return errorResult('failed', `${label} has no execute function.`);
  }

  const timeoutMs = Math.min(
    tool.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  deps.signal.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const output = await tool.execute(input, {
      apis: deps.apis,
      credential,
      signal: controller.signal,
    });
    if (deps.signal.aborted) return aborted();
    if (timedOut) {
      return errorResult(
        'timeout',
        `${label} did not finish in ${timeoutMs} ms.`,
      );
    }
    return shapeResult(output);
  } catch (error) {
    if (deps.signal.aborted) return aborted();
    if (timedOut) {
      return errorResult(
        'timeout',
        `${label} did not finish in ${timeoutMs} ms.`,
      );
    }
    return errorResult(
      'failed',
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timer);
    deps.signal.removeEventListener('abort', onAbort);
  }
}

/** A JSON-serializable copy of the output, or a failure when it is not. */
function shapeResult(output: unknown): unknown {
  if (output === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(output));
  } catch {
    return errorResult('failed', 'The tool returned a value that is not JSON.');
  }
}
