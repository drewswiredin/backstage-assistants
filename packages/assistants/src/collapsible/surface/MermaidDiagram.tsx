import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import {
  CircularProgress,
  Dialog,
  IconButton,
  Tooltip,
  Typography,
} from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import CloseIcon from '@material-ui/icons/Close';

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  themeVariables: {
    background: '#ffffff',
    mainBkg: '#ffffff',
    primaryColor: '#f8fafc',
    primaryTextColor: '#111827',
    primaryBorderColor: '#334155',
    lineColor: '#475569',
    secondaryColor: '#eef2ff',
    tertiaryColor: '#f8fafc',
    clusterBkg: '#f8fafc',
    clusterBorder: '#cbd5e1',
    edgeLabelBackground: '#ffffff',
    fontFamily: 'Inter, Roboto, Arial, sans-serif',
  },
  suppressErrorRendering: true,
});

let idCounter = 0;
const DEBOUNCE_MS = 600;

const useStyles = makeStyles(theme => ({
  wrapper: {
    position: 'relative',
    margin: theme.spacing(1.5, 0),
    borderRadius: theme.shape.borderRadius,
    overflow: 'hidden',
    minHeight: 80,
  },
  diagram: {
    display: 'flex',
    justifyContent: 'center',
    padding: theme.spacing(1),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    backgroundColor: '#ffffff',
    color: '#111827',
    cursor: 'zoom-in',
    overflow: 'auto',
    transition: 'filter 0.3s ease, opacity 0.3s ease',
    '&:focus-visible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: 2,
    },
    '& svg': {
      maxWidth: '100%',
      height: 'auto',
    },
  },
  diagramLoading: {
    filter: 'blur(4px)',
    opacity: 0.4,
    pointerEvents: 'none',
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(1),
    zIndex: 1,
    // frosted glass
    backgroundColor:
      theme.palette.type === 'dark'
        ? 'rgba(30, 30, 30, 0.6)'
        : 'rgba(255, 255, 255, 0.6)',
    backdropFilter: 'blur(8px)',
    borderRadius: theme.shape.borderRadius,
  },
  dialogPaper: {
    backgroundColor: theme.palette.background.default,
  },
  dialogBody: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: theme.spacing(7, 3, 3),
    overflow: 'auto',
  },
  closeButton: {
    position: 'fixed',
    top: theme.spacing(1.5),
    right: theme.spacing(1.5),
    zIndex: 1,
    backgroundColor: theme.palette.background.paper,
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
  },
  fullscreenDiagram: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '100%',
    padding: theme.spacing(2),
    borderRadius: theme.shape.borderRadius,
    backgroundColor: '#ffffff',
    color: '#111827',
    '& svg': {
      width: 'auto',
      height: 'auto',
      maxWidth: 'calc(100vw - 48px)',
      maxHeight: 'calc(100vh - 96px)',
    },
  },
  error: {
    margin: theme.spacing(1.5, 0),
    padding: theme.spacing(1.5),
    overflow: 'auto',
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    backgroundColor:
      theme.palette.type === 'dark'
        ? theme.palette.grey[900]
        : theme.palette.grey[100],
    color: theme.palette.text.primary,
    fontSize: theme.typography.caption.fontSize,
  },
}));

/**
 * Streaming-safe Mermaid renderer.
 *
 * Renders the first frame immediately, then debounces subsequent renders to
 * avoid thrashing while the diagram source is still streaming in. Keeps the
 * last good render on screen if an in-progress (incomplete) diagram fails to
 * parse, and only surfaces a parse error once the stream has settled. Clicking
 * the rendered diagram opens a fullscreen dialog.
 */
export function MermaidDiagram({ code }: { code: string }) {
  const classes = useStyles();
  const [svg, setSvg] = useState<string>('');
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState<string>('');
  const [showError, setShowError] = useState(false);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const errorTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const lastRenderedCode = useRef<string>('');

  useEffect(() => {
    const trimmed = code.trim();

    // If this is the first render (no svg yet), render immediately
    // Otherwise debounce to avoid rapid re-renders during streaming
    const isFirst = !svg && !error;
    const delay = isFirst ? 0 : DEBOUNCE_MS;

    setRendering(true);
    setError('');
    setShowError(false);

    clearTimeout(timerRef.current);
    clearTimeout(errorTimerRef.current);
    timerRef.current = setTimeout(() => {
      // Skip if code hasn't changed since last successful render
      if (trimmed === lastRenderedCode.current) {
        setRendering(false);
        return;
      }

      let active = true;
      const id = `mermaid-${++idCounter}`;

      mermaid
        .render(id, trimmed)
        .then(({ svg: rendered }) => {
          if (active) {
            setSvg(rendered);
            setError('');
            lastRenderedCode.current = trimmed;
            setRendering(false);
          }
        })
        .catch((err: Error) => {
          if (active) {
            // During streaming, don't replace a good render with an error
            // from incomplete code — just keep showing the loading state
            if (svg) {
              setRendering(false);
            } else {
              setError(err.message);
              setRendering(false);
              errorTimerRef.current = setTimeout(() => {
                setShowError(true);
              }, 1500);
            }
          }
        });

      return () => {
        active = false;
      };
    }, delay);

    return () => {
      clearTimeout(timerRef.current);
      clearTimeout(errorTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
    }
  };

  if (error && !svg && showError) {
    return (
      <pre className={classes.error}>
        <code>{code}</code>
      </pre>
    );
  }

  const isLoading = rendering && !!svg;
  const isInitialLoading = !svg && (rendering || (error && !showError));

  return (
    <>
      <div className={classes.wrapper}>
        {isLoading && (
          <div className={classes.overlay}>
            <CircularProgress size={24} />
            <Typography variant="caption" color="textSecondary">
              Rendering diagram…
            </Typography>
          </div>
        )}

        {isInitialLoading && (
          <div className={classes.overlay}>
            <CircularProgress size={24} />
            <Typography variant="caption" color="textSecondary">
              Rendering diagram…
            </Typography>
          </div>
        )}

        {svg && (
          <Tooltip title="Open diagram fullscreen">
            <div
              className={`${classes.diagram} ${
                isLoading ? classes.diagramLoading : ''
              }`}
              dangerouslySetInnerHTML={{ __html: svg }}
              role="button"
              tabIndex={0}
              aria-label="Open Mermaid diagram fullscreen"
              onClick={() => !isLoading && setOpen(true)}
              onKeyDown={handleKeyDown}
            />
          </Tooltip>
        )}
      </div>

      <Dialog
        fullScreen
        open={open}
        onClose={() => setOpen(false)}
        PaperProps={{ className: classes.dialogPaper }}
      >
        <div className={classes.dialogBody}>
          <Tooltip title="Close">
            <IconButton
              className={classes.closeButton}
              aria-label="Close fullscreen diagram"
              onClick={() => setOpen(false)}
            >
              <CloseIcon />
            </IconButton>
          </Tooltip>
          <div
            className={classes.fullscreenDiagram}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </Dialog>
    </>
  );
}
