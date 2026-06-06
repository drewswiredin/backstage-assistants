/**
 * Caps the size of a single tool result before it enters the model prompt (and
 * the persisted conversation).
 *
 * A single oversized tool output — e.g. a multi-megabyte code search — can blow
 * past the model's context window and kill the entire turn ("prompt is too
 * long"). Trimming it at the tool-output boundary fixes BOTH failure modes: the
 * per-turn prompt overflow AND the database bloat, because the trimmed value is
 * exactly what gets streamed, persisted, and reloaded on the next turn.
 *
 * The model still sees the head and tail plus an explicit elision marker, so it
 * can tell the result was truncated and refine its query — no silent data loss.
 * History-level compression (summarizing OLD messages) is intentionally out of
 * scope; this only bounds individual tool results.
 *
 * The budget is a character count, not a token count: at this boundary we have a
 * serialized string and no tokenizer (and the model's true context window isn't
 * reliably known here). A generous absolute cap defangs the pathological case
 * without needing per-model token math.
 */

/** Share of the budget kept from the head vs. the tail of an oversized result. */
const HEAD_FRACTION = 0.7;
const TAIL_FRACTION = 0.2;

/**
 * Returns `output` unchanged if it serializes to `<= maxChars` characters (or if
 * truncation is disabled with `maxChars <= 0`); otherwise returns a string
 * holding the head + tail of the serialized output around an elision marker.
 */
export function truncateToolResult(output: unknown, maxChars: number): unknown {
  // A non-positive or non-finite budget disables truncation.
  if (!Number.isFinite(maxChars) || maxChars <= 0) {
    return output;
  }

  let serialized: string | undefined;
  try {
    serialized = typeof output === 'string' ? output : JSON.stringify(output);
  } catch {
    // Non-serializable (e.g. a circular structure) — leave it for the SDK.
    return output;
  }

  // JSON.stringify yields undefined for e.g. a bare `undefined` or a function.
  if (serialized === undefined || serialized.length <= maxChars) {
    return output;
  }

  const headChars = Math.floor(maxChars * HEAD_FRACTION);
  const tailChars = Math.floor(maxChars * TAIL_FRACTION);
  const omitted = serialized.length - headChars - tailChars;

  return (
    `${serialized.slice(0, headChars)}\n\n` +
    `...[tool result truncated: ${omitted} of ${serialized.length} characters ` +
    `omitted to fit the context window; refine your query to narrow the ` +
    `result]...\n\n` +
    `${serialized.slice(serialized.length - tailChars)}`
  );
}
