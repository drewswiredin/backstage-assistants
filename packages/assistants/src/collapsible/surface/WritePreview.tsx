import { lazy, Suspense, useEffect, useState } from 'react';
import { makeStyles, useTheme } from '@material-ui/core/styles';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  LinearProgress,
  Typography,
} from '@material-ui/core';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import {
  resolvePreviewField,
  type ApprovalPreview,
  type ApprovalPreviewResponse,
} from '@drewswiredin/backstage-plugin-assistants-common';
import { useToolGuards } from '../toolGuards';

// Loaded on the first write preview only, so chats without one never pay for it.
const DiffViewer = lazy(() => import('react-diff-viewer-continued'));

/** Above this many characters on either side a diff is summarized, not drawn. */
const MAX_DIFF_CHARS = 200_000;

const useStyles = makeStyles(theme => ({
  target: {
    fontFamily: 'monospace',
    fontSize: '0.8rem',
    wordBreak: 'break-all',
  },
  message: {
    margin: theme.spacing(0.5, 0, 1),
    color: theme.palette.text.secondary,
  },
  diff: {
    maxHeight: theme.spacing(40),
    overflow: 'auto',
    borderRadius: theme.shape.borderRadius,
    fontSize: '0.75rem',
  },
  note: {
    color: theme.palette.text.secondary,
    margin: theme.spacing(0.5, 0),
  },
  accordion: {
    background: 'transparent',
    boxShadow: 'none',
    '&:before': { display: 'none' },
  },
}));

interface FileChange {
  path: string;
  content: string;
}

/** The files a call writes, from its input and the preview's field templates. */
function changesOf(
  preview: ApprovalPreview,
  input: Record<string, unknown>,
): FileChange[] {
  const text = (value: unknown) =>
    typeof value === 'string' ? value : JSON.stringify(value ?? '', null, 2);
  if (preview.type === 'file') {
    const path = resolvePreviewField(preview.fields.path, input);
    return [
      {
        path: typeof path === 'string' ? path : '(no path)',
        content: text(resolvePreviewField(preview.fields.content, input)),
      },
    ];
  }
  const files = resolvePreviewField(preview.fields.files, input);
  return Array.isArray(files)
    ? files.map(entry => {
        const file = (entry ?? {}) as Record<string, unknown>;
        return {
          path: typeof file.path === 'string' ? file.path : '(no path)',
          content: text(file.content),
        };
      })
    : [];
}

function FileDiff({
  change,
  base,
  loading,
}: {
  change: FileChange;
  base?: ApprovalPreviewResponse['files'][number];
  loading: boolean;
}) {
  const classes = useStyles();
  const theme = useTheme();
  if (loading) return <LinearProgress />;
  const oldValue = base?.content ?? '';
  let note: string | undefined;
  if (base && !base.exists) note = 'New file';
  else if (base?.error) note = `Current content unavailable: ${base.error}`;
  if (
    oldValue.length > MAX_DIFF_CHARS ||
    change.content.length > MAX_DIFF_CHARS
  ) {
    return (
      <Typography variant="caption" component="div" className={classes.note}>
        Too large to show: {Math.round(oldValue.length / 1024)} KB now,{' '}
        {Math.round(change.content.length / 1024)} KB after the write.
      </Typography>
    );
  }
  return (
    <>
      {note && (
        <Typography variant="caption" component="div" className={classes.note}>
          {note}
        </Typography>
      )}
      <div className={classes.diff}>
        <Suspense fallback={<LinearProgress />}>
          <DiffViewer
            oldValue={oldValue}
            newValue={change.content}
            splitView={false}
            showDiffOnly
            hideSummary
            disableWorker
            useDarkTheme={theme.palette.type === 'dark'}
          />
        </Suspense>
      </div>
    </>
  );
}

/**
 * A pending write shown as its target and a diff instead of raw JSON: the
 * repository, branch, and path, the commit message, and each file's change
 * against its current content (read as the same user when the server has a
 * read tool for it; otherwise the new content alone).
 */
export function WritePreview({
  preview,
  toolName,
  assistantId,
  input,
}: {
  preview: ApprovalPreview;
  toolName: string;
  assistantId: string | undefined;
  input: Record<string, unknown>;
}) {
  const classes = useStyles();
  const { previewApproval } = useToolGuards();
  const canDiff = preview.diff && !!assistantId;
  const [base, setBase] = useState<ApprovalPreviewResponse | undefined>();
  const [loading, setLoading] = useState(canDiff);
  const inputKey = JSON.stringify(input);

  useEffect(() => {
    if (!canDiff) return undefined;
    let active = true;
    setLoading(true);
    previewApproval(assistantId!, toolName, JSON.parse(inputKey))
      .then(response => {
        if (active) setBase(response);
      })
      .catch(error => {
        if (active) {
          setBase({
            files: changesOf(preview, JSON.parse(inputKey)).map(c => ({
              path: c.path,
              exists: true,
              error: error instanceof Error ? error.message : String(error),
            })),
          });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canDiff, assistantId, toolName, inputKey, preview, previewApproval]);

  const changes = changesOf(preview, input);
  const repo = resolvePreviewField(preview.fields.repo, input);
  const branch = resolvePreviewField(preview.fields.branch, input);
  const message = resolvePreviewField(preview.fields.message, input);
  const target = [
    repo,
    branch,
    preview.type === 'file' ? changes[0]?.path : `${changes.length} files`,
  ]
    .filter(part => typeof part === 'string' && part)
    .join(' · ');
  const baseOf = (path: string) => base?.files.find(f => f.path === path);

  return (
    <div>
      <Typography variant="body2" component="div" className={classes.target}>
        {target}
      </Typography>
      {typeof message === 'string' && message && (
        <Typography
          variant="caption"
          component="div"
          className={classes.message}
        >
          {message}
        </Typography>
      )}
      {changes.length === 1 ? (
        <FileDiff
          change={changes[0]}
          base={baseOf(changes[0].path)}
          loading={loading}
        />
      ) : (
        changes.map(change => (
          <Accordion
            key={change.path}
            className={classes.accordion}
            TransitionProps={{ unmountOnExit: true }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="body2" className={classes.target}>
                {change.path}
              </Typography>
            </AccordionSummary>
            <AccordionDetails style={{ display: 'block', padding: 0 }}>
              <FileDiff
                change={change}
                base={baseOf(change.path)}
                loading={loading}
              />
            </AccordionDetails>
          </Accordion>
        ))
      )}
    </div>
  );
}
