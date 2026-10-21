import { useState } from 'react';
import { Box, Button, CircularProgress, Typography } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import BlockIcon from '@material-ui/icons/Block';
import LinkIcon from '@material-ui/icons/Link';
import { useApiHolder } from '@backstage/core-plugin-api';
import type { ClientToolError } from '@drewswiredin/backstage-plugin-assistants-common';
import { formatPayload, ToolFallback } from '../collapsible/surface/parts';
import { acquireCredential } from './runClientTool';
import type {
  AssistantClientTool,
  ClientToolInterrupt,
  ClientToolRenderProps,
} from './types';

const useStyles = makeStyles(theme => ({
  card: {
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
  connectCard: {
    borderColor: theme.palette.primary.main,
    backgroundColor:
      theme.palette.type === 'dark'
        ? 'rgba(33,150,243,0.10)'
        : 'rgba(33,150,243,0.06)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    marginBottom: theme.spacing(0.75),
    color: theme.palette.warning?.main ?? '#b07a05',
    fontWeight: 600,
  },
  connectHeader: {
    color: theme.palette.primary.main,
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
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1.25),
  },
  hint: {
    marginTop: theme.spacing(0.75),
    color: theme.palette.text.secondary,
  },
  note: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    margin: theme.spacing(0.5, 0),
    color: theme.palette.text.secondary,
    fontSize: theme.typography.caption.fontSize,
  },
}));

/** The note shown above a settled call that did not run. */
function outcomeNote(result: unknown): string | undefined {
  const r = result as Partial<ClientToolError> | undefined;
  if (!r || r._error !== true) return undefined;
  switch (r.code) {
    case 'declined':
      return 'Declined — not run';
    case 'not_authorized':
      return 'Not connected — not run';
    case 'aborted':
      return 'Stopped';
    case 'timeout':
      return 'Timed out';
    default:
      return undefined;
  }
}

/**
 * The card for one client tool call. While the runtime waits on the user it
 * shows the approval prompt or the Connect control; once the call settles it
 * shows the tool's own `render`, or the generic input and output view.
 */
export function ClientToolCall({
  tool,
  ...props
}: ClientToolRenderProps<any, any> & { tool: AssistantClientTool<any, any> }) {
  const classes = useStyles();
  const apis = useApiHolder();
  const [connecting, setConnecting] = useState(false);
  const label = tool.title ?? tool.name;
  const interrupt =
    props.interrupt?.type === 'human'
      ? (props.interrupt.payload as ClientToolInterrupt)
      : undefined;

  if (interrupt?.kind === 'approval') {
    return (
      <Box className={classes.card}>
        <Typography variant="body2" component="div" className={classes.header}>
          <BlockIcon fontSize="small" />
          Approval required to run <strong>{label}</strong>
        </Typography>
        <Typography
          variant="caption"
          component="div"
          className={classes.payloadTitle}
        >
          Input
        </Typography>
        <pre className={classes.payloadBlock}>
          {formatPayload(interrupt.input)}
        </pre>
        <div className={classes.actions}>
          <Button
            type="button"
            variant="contained"
            color="primary"
            size="small"
            onClick={() => props.resume({ approved: true })}
          >
            Allow
          </Button>
          <Button
            type="button"
            variant="text"
            size="small"
            onClick={() => props.resume({ approved: false })}
          >
            Deny
          </Button>
        </div>
        <Typography variant="caption" component="div" className={classes.hint}>
          Runs in your browser as you. Every call asks.
        </Typography>
      </Box>
    );
  }

  if (interrupt?.kind === 'connect') {
    const connect = async () => {
      if (!tool.auth) return;
      setConnecting(true);
      try {
        // On the click, so the provider's popup is not blocked. The
        // credential goes straight back to the waiting `execute`.
        const credential = await acquireCredential(tool.auth, apis, true);
        props.resume(credential === undefined ? {} : { credential });
      } catch {
        props.resume({});
      } finally {
        setConnecting(false);
      }
    };
    return (
      <Box className={`${classes.card} ${classes.connectCard}`}>
        <Typography
          variant="body2"
          component="div"
          className={`${classes.header} ${classes.connectHeader}`}
        >
          <LinkIcon fontSize="small" />
          <strong>{label}</strong> needs access to {interrupt.system}
        </Typography>
        <div className={classes.actions}>
          <Button
            type="button"
            variant="contained"
            color="primary"
            size="small"
            disabled={connecting}
            onClick={connect}
            startIcon={
              connecting ? <CircularProgress size={14} color="inherit" /> : null
            }
          >
            Connect to {interrupt.system}
          </Button>
          <Button
            type="button"
            variant="text"
            size="small"
            disabled={connecting}
            onClick={() => props.resume({})}
          >
            Not now
          </Button>
        </div>
        <Typography variant="caption" component="div" className={classes.hint}>
          Signs you in to {interrupt.system} in this browser; the credential
          never leaves it.
        </Typography>
      </Box>
    );
  }

  const note = outcomeNote(props.result);
  const Render = tool.render;
  return (
    <div>
      {note && (
        <Typography variant="caption" component="div" className={classes.note}>
          <BlockIcon style={{ fontSize: 14 }} /> {note}
        </Typography>
      )}
      {Render ? <Render {...props} /> : <ToolFallback {...props} />}
    </div>
  );
}
