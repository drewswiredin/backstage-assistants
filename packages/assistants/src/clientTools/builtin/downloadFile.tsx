/**
 * `download_file`: the built-in client tool the model calls with
 * `{ filename, content, mimeType? }` to hand the user a generated text file.
 * The card shows the file as a {@link DownloadChip}; the file content lives in
 * the tool-call input (persisted with the message), so the chip re-renders
 * and stays downloadable across reloads. `execute` acknowledges the delivery
 * and the turn resumes with that result.
 */
import { CircularProgress, Typography } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import {
  DownloadChip,
  textToDataUrl,
} from '../../collapsible/surface/DownloadChip';
import type { AssistantClientTool, ClientToolRenderProps } from '../types';

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

/** The download chip for one call, rendered from the (streamed) args. */
export function DownloadFile({
  args,
}: ClientToolRenderProps<DownloadFileArgs, { delivered: true }>) {
  const classes = useStyles();
  const ready =
    typeof args?.content === 'string' &&
    typeof args?.filename === 'string' &&
    args.filename.length > 0;

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
}

/** The built-in `download_file` client tool. */
export const downloadFileTool: AssistantClientTool<any, { delivered: true }> = {
  name: 'download_file',
  title: 'Download',
  description:
    'Deliver a downloadable file to the user. Use when the user asks for a ' +
    'file, export, or download, or when a downloadable artifact is more ' +
    'useful than inline text (e.g. a CSV, JSON, Markdown, code, or config ' +
    'file you generated). Provide `filename` (with extension), `content` ' +
    '(the COMPLETE file text), and optionally `mimeType`. The file appears ' +
    'in the chat as a download chip the user can save or copy — put the full ' +
    'content in `content`, do not also paste it into your message.',
  inputSchema: {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description: 'File name including extension, e.g. "report.csv".',
      },
      content: {
        type: 'string',
        description: 'The complete file contents, as text.',
      },
      mimeType: {
        type: 'string',
        description:
          'Optional MIME type, e.g. "text/csv". Inferred from the ' +
          'filename extension when omitted.',
      },
    },
    required: ['filename', 'content'],
    additionalProperties: false,
  },
  attributes: { readOnly: true },
  execute: async () => ({ delivered: true }),
  render: DownloadFile,
};
