/**
 * The browser-to-backend contract for client tools: tools a frontend plugin or
 * module registers in the browser and executes there, with the signed-in
 * user's own browser credentials. The backend only ever sees the declaration
 * below, which it offers to the model; the `execute` function and any
 * credential stay in the browser.
 */

/**
 * What a client tool does to the system it talks to. Mirrors the Backstage
 * actions registry attributes so one policy applies to every tool kind.
 *
 * @public
 */
export interface ClientToolAttributes {
  /** True when the tool only reads. A tool that is not read-only always asks for approval. */
  readOnly: boolean;
  /** True when the tool deletes, restarts, or otherwise destroys state. */
  destructive?: boolean;
  /** True when repeating the call has no further effect. */
  idempotent?: boolean;
}

/**
 * A client tool as the browser declares it on every `/chat` request: the
 * assistant-ui serialized tool (`description`, JSON Schema `parameters`) plus
 * its {@link ClientToolAttributes}. Never carries a function or a credential.
 *
 * @public
 */
export interface ClientToolDeclaration {
  /** What the tool does, for the model. */
  description?: string;
  /** JSON Schema (`type: object`) of the tool's input. */
  parameters: Record<string, unknown>;
  /** What the tool does to its system; absent means not read-only. */
  attributes?: ClientToolAttributes;
}

/**
 * The name shape of a host-contributed client tool: `<namespace>__<tool>`,
 * for example `kubernetes__get_workload_status`. The namespace keeps a
 * plugin's tools apart from Backstage actions and from MCP servers.
 *
 * @public
 */
export const CLIENT_TOOL_NAME_PATTERN =
  /^[a-z][a-z0-9-]{1,30}__[a-z0-9_]{1,40}$/;

/**
 * The client tools the plugin itself ships. They are registered through the
 * same blueprint as a host's tools and are always offered to the model.
 *
 * @public
 */
export const BUILTIN_CLIENT_TOOLS: readonly string[] = [
  'render_form',
  'download_file',
];

/**
 * True for a name a client tool may use: one of the built-ins, or the
 * `<namespace>__<tool>` shape.
 *
 * @public
 */
export function isClientToolName(name: string): boolean {
  return (
    BUILTIN_CLIENT_TOOLS.includes(name) || CLIENT_TOOL_NAME_PATTERN.test(name)
  );
}

/**
 * Ceilings applied to the declarations a request carries, so a browser can
 * neither flood the prompt with tools nor send an oversized schema.
 *
 * @public
 */
export const CLIENT_TOOL_LIMITS = {
  /** Client tools offered on one request, built-ins included. */
  maxPerRequest: 30,
  /** Characters of one tool's description. */
  maxDescriptionChars: 4000,
  /** Characters of one tool's serialized input schema. */
  maxSchemaChars: 8192,
} as const;

/**
 * The failure codes a client tool result may carry alongside `_error: true`,
 * so the model can explain instead of retrying.
 *
 * @public
 */
export type ClientToolErrorCode =
  /** The user declined the approval prompt. */
  | 'declined'
  /** The user did not connect the system the tool needs. */
  | 'not_authorized'
  /** The tool ran past its time budget. */
  | 'timeout'
  /** The user stopped the turn while the tool was running. */
  | 'aborted'
  /** The tool threw. */
  | 'failed';

/**
 * The structured error result a client tool returns instead of throwing, in
 * the same `_error` envelope Backstage action and MCP tools use.
 *
 * @public
 */
export interface ClientToolError {
  /** Marks the result as a failure. */
  _error: true;
  /** Why the tool did not produce a result. */
  code: ClientToolErrorCode;
  /** What happened, for the model to relay. */
  message: string;
}
