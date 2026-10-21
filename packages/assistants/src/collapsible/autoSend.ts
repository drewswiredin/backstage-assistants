import { isAbortedResult } from '../clientTools/runClientTool';

/** The slice of a UI message part the auto-send rule reads. */
interface PartLike {
  type?: string;
  state?: string;
  output?: unknown;
}

/**
 * The `sendAutomaticallyWhen` rule: flush the turn back to the server once
 * every tool part in the latest step is settled and at least one of them was
 * settled in the browser.
 *
 * Scoped to the latest step (the parts after the final `step-start`) so it
 * fires exactly once: after the server continues, the settled parts are in a
 * prior step and no longer match. Two client-settled cases:
 *   1. A client tool (`render_form`, `download_file`, or a contributed tool)
 *      produced its output, unless that output records that the user stopped
 *      the turn, which must not resume it.
 *   2. A deterministic approval gate (`toolApproval`) the user answered: the
 *      part moved to `approval-responded` and the server must run the approved
 *      tool or record the denial.
 * It never fires while a part is still streaming, awaiting input, or awaiting
 * an approval decision, and it requires a client-settled part, so a server
 * tool truncated at `maxSteps` is never auto-resumed.
 */
export function shouldSendAutomatically(
  messages: ReadonlyArray<{ role?: string; parts?: ReadonlyArray<PartLike> }>,
  isClientTool: (name: string) => boolean,
): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant') return false;
  const parts = last.parts ?? [];
  const lastStepStart = parts.reduce(
    (idx, p, i) => (p.type === 'step-start' ? i : idx),
    -1,
  );
  const latestStepTools = parts
    .slice(lastStepStart + 1)
    .filter(p => typeof p.type === 'string' && p.type.startsWith('tool-'));
  if (latestStepTools.length === 0) return false;
  const allSettled = latestStepTools.every(
    p =>
      p.state === 'output-available' ||
      p.state === 'output-error' ||
      p.state === 'approval-responded',
  );
  if (!allSettled) return false;
  const clientResolved = latestStepTools.some(
    p =>
      isClientTool((p.type as string).slice('tool-'.length)) &&
      (p.state === 'output-error' ||
        (p.state === 'output-available' && !isAbortedResult(p.output))),
  );
  const approvalResolved = latestStepTools.some(
    p => p.state === 'approval-responded',
  );
  return clientResolved || approvalResolved;
}
