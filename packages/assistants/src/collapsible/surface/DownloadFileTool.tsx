/**
 * Generative-UI download tool. The assistant calls the backend `download_file`
 * tool (a client-side tool — no server `execute`) with `{ filename, content,
 * mimeType? }`; this renderer shows the file as a {@link DownloadChip} inline in
 * the message. The file content lives in the tool-call input (persisted with the
 * message), so the chip re-renders and stays downloadable across reloads.
 *
 * We acknowledge the call with a trivial result so the tool part settles, but this
 * does NOT resume the turn (see `sendAutomaticallyWhen` in useAssistantRuntime,
 * which only auto-resends for `render_form` / approvals) — the file IS the output,
 * so there's no need to round-trip back to the model.
 */
import { useEffect, useRef } from 'react';
import { CircularProgress, Typography } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import { makeAssistantToolUI } from '@assistant-ui/react';
import { DownloadChip, textToDataUrl } from './DownloadChip';

interface DownloadFileArgs {
  filename?: string;
  content?: string;
  mimeType?: string;
}

const useStyles = makeStyles(theme => ({
  preparing: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    margin: theme.spacing(0.5, 0),
    color: theme.palette.text.secondary,
  },
}));

/** Best-effort mime from the filename extension when the model omits `mimeType`. */
function mimeFromName(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const map: Record<string, string> = {
    csv: 'text/csv',
    json: 'application/json',
    md: 'text/markdown',
    markdown: 'text/markdown',
    txt: 'text/plain',
    html: 'text/html',
    xml: 'application/xml',
    yaml: 'application/x-yaml',
    yml: 'application/x-yaml',
    js: 'text/javascript',
    ts: 'text/plain',
    py: 'text/x-python',
    sh: 'text/x-shellscript',
    sql: 'application/sql',
  };
  return map[ext] ?? 'text/plain';
}

export const DownloadFileTool = makeAssistantToolUI<DownloadFileArgs, unknown>({
  toolName: 'download_file',
  render: function DownloadFile({ args, result, addResult }) {
    const classes = useStyles();
    const acked = useRef(false);
    const ready =
      typeof args?.content === 'string' &&
      typeof args?.filename === 'string' &&
      args.filename.length > 0;

    // Settle the tool once the (streamed) args are complete. Idempotent: only the
    // first ack matters; it acknowledges to the model without resuming the turn.
    useEffect(() => {
      if (ready && result === undefined && !acked.current) {
        acked.current = true;
        addResult({ delivered: true });
      }
    }, [ready, result, addResult]);

    if (!ready) {
      return (
        <span className={classes.preparing}>
          <CircularProgress size={14} thickness={5} />
          <Typography variant="body2" component="span">
            Preparing file…
          </Typography>
        </span>
      );
    }

    const name = args.filename as string;
    const mimeType = args.mimeType || mimeFromName(name);
    const dataUrl = textToDataUrl(args.content as string, mimeType);

    return <DownloadChip name={name} mimeType={mimeType} dataUrl={dataUrl} />;
  },
});
