/**
 * Held calls: tool calls of a provider that runs its own tool loop, held
 * open inside that loop until the browser answers them through
 * `POST /held-calls/:id`.
 */

/**
 * The id prefix of an approval the backend asks for on a held call. The
 * browser posts the decision for such an approval to `/held-calls/<id>`
 * instead of resuming the turn with it.
 *
 * @public
 */
export const HELD_APPROVAL_PREFIX = 'held-';

/**
 * The `/held-calls` id under which a provider-executed client tool call
 * waits for the browser's result.
 *
 * @public
 */
export function heldToolCallId(toolCallId: string): string {
  return `tool-${toolCallId}`;
}

/**
 * The browser's answer to a held call: an approval decision (`reason`
 * `always:<tool>` grants the tool for the rest of the turn), or a client
 * tool's output or error.
 *
 * @public
 */
export type HeldCallAnswer =
  | { approved: boolean; reason?: string }
  | { output: unknown }
  | { error: string };
