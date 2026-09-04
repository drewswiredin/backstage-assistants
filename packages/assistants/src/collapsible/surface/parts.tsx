import { useEffect, useMemo, useRef, useState } from 'react';
import { makeStyles, useTheme, type Theme } from '@material-ui/core/styles';
import {
  Box,
  Button,
  CircularProgress,
  Collapse,
  Typography,
} from '@material-ui/core';
import BlockIcon from '@material-ui/icons/Block';
import CheckCircleOutlineIcon from '@material-ui/icons/CheckCircleOutline';
import ErrorOutlineIcon from '@material-ui/icons/ErrorOutline';
import ExpandLessIcon from '@material-ui/icons/ExpandLess';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import { useAuiState } from '@assistant-ui/react';
import type {
  EmptyMessagePartProps,
  ReasoningMessagePartProps,
  ToolCallMessagePartProps,
} from '@assistant-ui/react';
import { useTurnEndReason } from '../interruptedTurns';

const useStyles = makeStyles(theme => ({
  thinkingMessage: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    color: theme.palette.text.secondary,
  },
  errorMessage: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    margin: theme.spacing(0.5, 0),
    padding: theme.spacing(1, 1.5),
    borderRadius: theme.shape.borderRadius,
    backgroundColor:
      theme.palette.type === 'dark'
        ? 'rgba(244,67,54,0.1)'
        : 'rgba(244,67,54,0.06)',
    color: theme.palette.error.main,
  },
  // Neutral (not error) note that the user stopped this turn.
  interruptedMessage: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    margin: theme.spacing(0.5, 0),
    color: theme.palette.text.secondary,
  },
  reasoningToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    margin: theme.spacing(0.5, 0),
    padding: theme.spacing(0.25, 0.75),
    border: 'none',
    borderRadius: theme.shape.borderRadius,
    background: 'none',
    color: theme.palette.text.secondary,
    fontSize: theme.typography.caption.fontSize,
    cursor: 'pointer',
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
  },
  reasoningText: {
    margin: theme.spacing(0.5, 0, 0.5, 2.5),
    padding: theme.spacing(1, 1.5),
    borderLeft: `2px solid ${theme.palette.divider}`,
    color: theme.palette.text.secondary,
    fontFamily: theme.typography.fontFamily as string,
    fontSize: theme.typography.caption.fontSize,
    lineHeight: 1.55,
    whiteSpace: 'pre-wrap',
  },
  toolToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    margin: theme.spacing(0.5, 0),
    padding: theme.spacing(0.25, 0.75),
    border: 'none',
    borderRadius: theme.shape.borderRadius,
    background: 'none',
    color: theme.palette.text.secondary,
    fontSize: theme.typography.caption.fontSize,
    cursor: 'pointer',
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
  },
  toolBody: {
    margin: theme.spacing(0.5, 0, 0.5, 2.5),
    padding: theme.spacing(1, 1.5),
    borderLeft: `2px solid ${theme.palette.divider}`,
  },
  payloadTitle: {
    marginBottom: theme.spacing(0.5),
    color: theme.palette.text.secondary,
    fontWeight: 500,
  },
  payloadBlock: {
    margin: 0,
    padding: theme.spacing(1),
    overflow: 'auto',
    maxHeight: theme.spacing(30),
    borderRadius: theme.shape.borderRadius,
    backgroundColor:
      theme.palette.type === 'dark'
        ? theme.palette.grey[900]
        : theme.palette.grey[100],
    color: theme.palette.text.primary,
    fontFamily: 'monospace',
    fontSize: theme.typography.caption.fontSize,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  approvalCard: {
    margin: theme.spacing(0.5, 0),
    padding: theme.spacing(1.25, 1.5),
    border: `1px solid ${theme.palette.warning?.main ?? '#e3a008'}`,
    borderRadius: theme.shape.borderRadius,
    backgroundColor:
      theme.palette.type === 'dark'
        ? 'rgba(227,160,8,0.10)'
        : 'rgba(227,160,8,0.07)',
    maxWidth: 560,
  },
  approvalHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    marginBottom: theme.spacing(0.75),
    color: theme.palette.warning?.main ?? '#b07a05',
    fontWeight: 600,
  },
  approvalActions: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1.25),
  },
  approvalHint: {
    marginTop: theme.spacing(0.75),
    color: theme.palette.text.secondary,
  },
  approvalDenied: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    margin: theme.spacing(0.5, 0),
    color: theme.palette.text.secondary,
    fontSize: theme.typography.caption.fontSize,
  },
}));

/** Format a byte count to a human-readable string. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Serialize a tool input/output payload for display. */
export function formatPayload(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Check whether a tool result signals an error (backend marks with `_error`). */
function isErrorResult(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  if ('_error' in (result as Record<string, unknown>)) return true;
  if (Array.isArray(result)) {
    return result.some(
      item =>
        item &&
        typeof item === 'object' &&
        typeof (item as { text?: unknown }).text === 'string' &&
        ((item as { text: string }).text.startsWith('Error') ||
          (item as { text: string }).text.includes('Failed')),
    );
  }
  return false;
}

/** Map a tool-call status to a human label + status icon. */
export function getToolStatus(
  status: ToolCallMessagePartProps['status'],
  theme: Theme,
  result?: unknown,
) {
  switch (status?.type) {
    case 'complete':
      if (isErrorResult(result)) {
        return {
          label: 'Error',
          icon: (
            <ErrorOutlineIcon
              fontSize="small"
              htmlColor={theme.palette.warning?.main ?? '#ff9800'}
            />
          ),
        };
      }
      return {
        label: 'Complete',
        icon: (
          <CheckCircleOutlineIcon
            fontSize="small"
            htmlColor={theme.palette.success?.main ?? '#4caf50'}
          />
        ),
      };
    case 'incomplete':
      return {
        label: 'Incomplete',
        icon: (
          <ErrorOutlineIcon
            fontSize="small"
            htmlColor={theme.palette.error.main}
          />
        ),
      };
    case 'running':
      return {
        label: 'Running',
        icon: <CircularProgress size={16} color="inherit" />,
      };
    default:
      // No result and the turn is no longer running ('requires-action' / unknown):
      // the call never returned because the turn was stopped or disconnected.
      // Show it as canceled rather than a perpetual "pending" hourglass.
      return {
        label: 'Canceled',
        icon: (
          <BlockIcon
            fontSize="small"
            htmlColor={theme.palette.text.secondary as string}
          />
        ),
      };
  }
}

/**
 * Default renderer for tool calls that don't have a bespoke UI. Shows a compact
 * toggle with the tool's status, expanding to reveal the input args and result.
 */
export function ToolFallback({
  toolCallId,
  toolName,
  args,
  result,
  status,
  approval,
  respondToApproval,
}: ToolCallMessagePartProps) {
  const classes = useStyles();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  // Reset expand state when this slot is reused for a different tool call —
  // switching conversations reuses the component instance at the same position,
  // which would otherwise carry the open state across conversations.
  useEffect(() => {
    setOpen(false);
  }, [toolCallId]);
  const { icon } = getToolStatus(status, theme, result);
  const hasArgs = args !== undefined && args !== null;
  const hasResult = result !== undefined && result !== null;

  // Deterministic approval gate. When the backend marked this tool
  // the `toolApproval` map, the AI SDK pauses before executing and assistant-ui exposes
  // a pending `approval` (approved === undefined) per call. respondToApproval()
  // is bridged to addToolApprovalResponse by useAISDKRuntime (Allow runs the
  // action server-side, Deny tells the model; the standing "always allow" grant
  // additionally skips this tool for the rest of the chat).
  //
  // The agent often fires several gated calls of the SAME tool in one step
  // (parallel), which would otherwise stack up as one card per call. We COLLAPSE
  // them: the lowest-index pending call is the "leader" and renders ONE control
  // with a count; the rest hide and mirror the leader's decision — so a whole
  // batch is resolved with a single click.
  const awaitingApproval = !!approval && approval.approved === undefined;

  // Same-tool sibling approvals in this message, as a value-stable JSON snapshot
  // (a string, so the external-store selector never churns its identity).
  const groupJson = useAuiState(s => {
    // Read-only view: the store's parts array is readonly, and this selector
    // only filters/maps it.
    const parts = (s.message.parts ?? []) as readonly {
      toolName?: string;
      toolCallId?: string;
      args?: unknown;
      approval?: { approved?: boolean };
    }[];
    return JSON.stringify(
      parts
        .filter(p => p.toolName === toolName && !!p.approval)
        .map(p => ({
          id: p.toolCallId,
          approved: p.approval?.approved ?? null,
          args: p.args,
        })),
    );
  });
  const group = useMemo(
    () =>
      JSON.parse(groupJson) as Array<{
        id?: string;
        approved: boolean | null;
        args: unknown;
      }>,
    [groupJson],
  );
  const groupDecided = group.find(g => g.approved !== null)?.approved as
    | boolean
    | undefined;
  const groupPending = group.filter(g => g.approved === null);
  const isGroupLeader =
    groupPending.length > 0 && groupPending[0].id === toolCallId;

  // Follower: once any sibling call of this tool has been decided, mirror it
  // (the leader's one click resolves the batch). Guarded to fire once per call.
  const mirroredRef = useRef(false);
  useEffect(() => {
    mirroredRef.current = false;
  }, [toolCallId]);
  useEffect(() => {
    if (
      awaitingApproval &&
      groupDecided !== undefined &&
      !mirroredRef.current
    ) {
      mirroredRef.current = true;
      respondToApproval?.({ approved: groupDecided });
    }
  }, [awaitingApproval, groupDecided, respondToApproval]);

  if (awaitingApproval) {
    // A sibling already decided → we mirror it (effect above); render nothing.
    if (groupDecided !== undefined) return null;
    // Not the leader of the pending group → the leader's card represents us.
    if (!isGroupLeader) return null;

    const count = groupPending.length;
    const inputs = groupPending.map(g => g.args);
    return (
      <Box className={classes.approvalCard}>
        <Typography
          variant="body2"
          component="div"
          className={classes.approvalHeader}
        >
          <BlockIcon fontSize="small" />
          {count > 1 ? (
            <>
              Approval required — <strong>{count}</strong> calls to{' '}
              <strong>{toolName}</strong>
            </>
          ) : (
            <>
              Approval required to run <strong>{toolName}</strong>
            </>
          )}
        </Typography>
        <Typography
          variant="caption"
          component="div"
          className={classes.payloadTitle}
        >
          {count > 1 ? `Inputs (${count})` : 'Input'}
        </Typography>
        <pre className={classes.payloadBlock}>
          {formatPayload(count > 1 ? inputs : inputs[0])}
        </pre>
        <div className={classes.approvalActions}>
          <Button
            type="button"
            variant="contained"
            color="primary"
            size="small"
            onClick={() => respondToApproval?.({ approved: true })}
          >
            {count > 1 ? `Allow all (${count})` : 'Allow'}
          </Button>
          <Button
            type="button"
            variant="outlined"
            color="primary"
            size="small"
            // Standing grant: approve these AND skip the prompt for this tool for
            // the rest of the conversation (backend reads `always:<tool>` from
            // history — see the approval gate in router.ts).
            onClick={() =>
              respondToApproval?.({
                approved: true,
                reason: `always:${toolName}`,
              })
            }
          >
            Always allow
          </Button>
          <Button
            type="button"
            variant="text"
            size="small"
            onClick={() => respondToApproval?.({ approved: false })}
          >
            {count > 1 ? 'Deny all' : 'Deny'}
          </Button>
        </div>
        <Typography
          variant="caption"
          component="div"
          className={classes.approvalHint}
        >
          <strong>Always allow</strong> runs <strong>{toolName}</strong> without
          asking again for the rest of this conversation
          {count > 1 ? ' (covers these and any further calls)' : ''}.
        </Typography>
      </Box>
    );
  }

  const denied = !!approval && approval.approved === false;
  return (
    <div>
      {denied && (
        <Typography
          variant="caption"
          component="div"
          className={classes.approvalDenied}
        >
          <BlockIcon style={{ fontSize: 14 }} /> Denied — not run
        </Typography>
      )}
      <button
        type="button"
        className={classes.toolToggle}
        onClick={() => setOpen(v => !v)}
      >
        {icon}
        <span>{toolName}</span>
        {hasResult && !open && (
          <span>({formatBytes(formatPayload(result).length)})</span>
        )}
        {open ? (
          <ExpandLessIcon style={{ fontSize: 14 }} />
        ) : (
          <ExpandMoreIcon style={{ fontSize: 14 }} />
        )}
      </button>

      <Collapse in={open} unmountOnExit>
        <div className={classes.toolBody}>
          {hasArgs && (
            <Box mb={hasResult ? 1 : 0}>
              <Typography
                variant="caption"
                component="div"
                className={classes.payloadTitle}
              >
                Input
              </Typography>
              <pre className={classes.payloadBlock}>{formatPayload(args)}</pre>
            </Box>
          )}
          {hasResult && (
            <Box>
              <Typography
                variant="caption"
                component="div"
                className={classes.payloadTitle}
              >
                Output
              </Typography>
              <pre className={classes.payloadBlock}>
                {formatPayload(result)}
              </pre>
            </Box>
          )}
        </div>
      </Collapse>
    </div>
  );
}

/**
 * Rendered in place of an empty assistant message: a "Reasoning…" spinner while
 * the model is thinking. A failed turn is surfaced by {@link MessageError} at the
 * message level (which covers both empty and mid-stream failures), so there is
 * no placeholder for a non-running empty message here.
 */
export function ThinkingMessage({ status }: EmptyMessagePartProps) {
  const classes = useStyles();

  if (status.type === 'running') {
    return (
      <Box className={classes.thinkingMessage} aria-live="polite">
        <CircularProgress size={14} thickness={5} />
        <Typography variant="body2" component="span">
          Reasoning…
        </Typography>
      </Box>
    );
  }

  return null;
}

/** Coerce an assistant-message error value into readable text. */
function errorToText(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Reads the real failure reason off the current assistant message's status (set
 * by the runtime when a turn errors — e.g. the model rejecting an over-long
 * prompt) and renders it. Returns nothing for a healthy message.
 *
 * Surfacing it at the message level — rather than only in the empty-message
 * placeholder — means it shows whether the turn failed before any tokens
 * streamed OR mid-stream after partial output. Mirrors assistant-ui's internal
 * `useMessageError` via the public `useAuiState` selector.
 */
export function MessageError() {
  const classes = useStyles();
  const error = useAuiState(s =>
    s.message.status?.type === 'incomplete' &&
    s.message.status.reason === 'error'
      ? errorToText(s.message.status.error ?? 'An error occurred')
      : undefined,
  );

  if (!error) {
    return null;
  }

  return (
    <Box className={classes.errorMessage} role="alert">
      <ErrorOutlineIcon fontSize="small" />
      <Typography variant="body2" component="span">
        {error}
      </Typography>
    </Box>
  );
}

/**
 * A neutral "Request interrupted" note shown when the user stopped this turn —
 * one clear entry per interrupted exchange. Two sources, same indicator:
 *   - durable: the backend stamps `metadata.canceled` on the persisted reply,
 *     which round-trips through history load, so it shows on any client / reload.
 *   - live: the tab that clicked Stop records the turn in {@link useTurnInterrupted}
 *     (the streamed message never carries the server flag), so it shows instantly.
 * Distinct from {@link MessageError}: an interruption is user-initiated, not a
 * failure.
 */
export function MessageInterrupted() {
  const classes = useStyles();
  const messageId = useAuiState(s => s.message.id);
  const flagged = useAuiState(
    s =>
      (s.message.metadata as Record<string, unknown> | undefined)?.canceled ===
      true,
  );
  const liveReason = useTurnEndReason(messageId);

  // Live reason (this tab) wins; the durable backend `canceled` flag (reload /
  // other client) is a user-stop → "interrupted".
  const reason = liveReason ?? (flagged ? 'interrupted' : undefined);
  if (!reason) {
    return null;
  }

  if (reason === 'disconnected') {
    return (
      <Box className={classes.interruptedMessage}>
        <ErrorOutlineIcon fontSize="small" />
        <Typography variant="body2" component="span">
          Connection lost — the reply was cut off. Send again to retry.
        </Typography>
      </Box>
    );
  }

  return (
    <Box className={classes.interruptedMessage}>
      <BlockIcon fontSize="small" />
      <Typography variant="body2" component="span">
        Request interrupted
      </Typography>
    </Box>
  );
}

/** Collapsible renderer for an assistant message's reasoning (thinking) part. */
export function ReasoningPart({ text, status }: ReasoningMessagePartProps) {
  const classes = useStyles();
  const [open, setOpen] = useState(false);

  return (
    <div aria-live="polite">
      <button
        type="button"
        className={classes.reasoningToggle}
        onClick={() => setOpen(v => !v)}
      >
        {status.type === 'running' ? (
          <CircularProgress size={12} thickness={5} />
        ) : (
          <span style={{ fontSize: 12 }}>💭</span>
        )}
        <span>Reasoning</span>
        {text &&
          (open ? (
            <ExpandLessIcon style={{ fontSize: 14 }} />
          ) : (
            <ExpandMoreIcon style={{ fontSize: 14 }} />
          ))}
      </button>

      {text && (
        <Collapse in={open} unmountOnExit>
          <pre className={classes.reasoningText}>{text}</pre>
        </Collapse>
      )}
    </div>
  );
}
