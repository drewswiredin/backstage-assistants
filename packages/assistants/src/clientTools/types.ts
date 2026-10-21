import type { ComponentType } from 'react';
import type { ApiHolder, ApiRef, OAuthApi } from '@backstage/core-plugin-api';
import type { JsonObject } from '@backstage/types';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import type { ClientToolAttributes } from '@drewswiredin/backstage-plugin-assistants-common';

/**
 * The credential a client tool needs. The runtime acquires it silently first
 * and, when that yields nothing, shows a "Connect" control in the
 * conversation and acquires it interactively on the click, so a login popup
 * is never opened outside a user gesture.
 *
 * @public
 */
export type ClientToolAuthRequirement =
  | {
      kind: 'oauth';
      /** The system the credential is for, shown on the Connect control. */
      system: string;
      /** A Backstage OAuth API, e.g. `microsoftAuthApiRef` or `githubAuthApiRef`. */
      apiRef: ApiRef<OAuthApi>;
      /** The scopes to request. */
      scopes: string[];
    }
  | {
      kind: 'custom';
      /** The system the credential is for, shown on the Connect control. */
      system: string;
      /**
       * Returns the credential, or undefined when none is available without
       * user interaction. Called with `interactive: false` first; on the
       * user's click it is called again with `interactive: true` and may
       * prompt. Rejecting is treated as "not connected".
       */
      acquire(options: {
        apis: ApiHolder;
        interactive: boolean;
      }): Promise<unknown | undefined>;
    };

/**
 * What a client tool's `execute` receives besides its input.
 *
 * @public
 */
export interface ClientToolContext {
  /** The app's API holder, for any frontend API the tool needs. */
  apis: ApiHolder;
  /** The credential {@link ClientToolAuthRequirement} acquired; undefined when the tool declares no `auth`. */
  credential?: unknown;
  /** Aborted when the user stops the turn or the tool's time budget runs out. */
  signal: AbortSignal;
}

/**
 * The props a client tool's `render` receives: assistant-ui's tool-call part
 * props, with the model's input as `args` and the tool's output as `result`.
 *
 * @public
 */
export type ClientToolRenderProps<
  TInput = JsonObject,
  TOutput = unknown,
> = ToolCallMessagePartProps<TInput, TOutput>;

/**
 * A tool that runs in the user's browser, registered through
 * {@link AssistantClientToolBlueprint}. The backend offers its declaration
 * (name, description, input schema, attributes) to the model; `execute` and
 * any credential stay in the browser.
 *
 * A tool with `execute` runs code once the model calls it. A tool without
 * `execute` is answered by its `render` through `addResult`: an inline form
 * or picker whose submission is the result. Both kinds resume the turn with
 * the result.
 *
 * @public
 */
export interface AssistantClientTool<
  TInput extends JsonObject = JsonObject,
  TOutput = unknown,
> {
  /** `<namespace>__<tool>`, e.g. `kubernetes__get_workload_status`. */
  name: string;
  /** Shown instead of the name in approval and connect prompts. */
  title?: string;
  /** What the tool does, for the model. At most 4000 characters. */
  description: string;
  /** JSON Schema (`type: object`) of the input, at most 8 KB serialized. */
  inputSchema: JsonObject;
  /**
   * What the tool does to its system. A tool that is not read-only, or is
   * destructive, asks the user for approval on every call. A tool without
   * `execute` should be read-only.
   */
  attributes: ClientToolAttributes;
  /** The credential the tool needs; acquired by the runtime before `execute`. */
  auth?: ClientToolAuthRequirement;
  /**
   * Whether the tool can work in this app right now (the plugin it uses is
   * installed, its config is present). An unavailable tool is not offered to
   * the model. Resolved once per page load.
   */
  isAvailable?(options: { apis: ApiHolder }): boolean | Promise<boolean>;
  /** Runs in the browser; returns a JSON-serializable result for the model. */
  execute?(input: TInput, context: ClientToolContext): Promise<TOutput>;
  /**
   * Renders the call in the conversation. Optional for a tool with
   * `execute`, which otherwise shows the generic input and output view;
   * required for a tool without one, which must call `addResult`.
   */
  render?: ComponentType<ClientToolRenderProps<TInput, TOutput>>;
  /** Time budget for `execute`; default 30 s, at most 120 s. */
  timeoutMs?: number;
}

/**
 * What the runtime asks the user for while a client tool runs; rendered by
 * the tool's card and answered with `resume`.
 *
 * @public
 */
export type ClientToolInterrupt =
  | { kind: 'approval'; toolName: string; title?: string; input: unknown }
  | { kind: 'connect'; toolName: string; title?: string; system: string };
