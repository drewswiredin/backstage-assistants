import {
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import mermaid from 'mermaid';
import { CircularProgress, Tooltip, Typography } from '@material-ui/core';
import { makeStyles, useTheme, type Theme } from '@material-ui/core/styles';
import { useAuiState } from '@assistant-ui/react';
import { PanZoomDialog } from './PanZoomViewer';

/**
 * Mermaid config derived from the active Backstage theme so diagrams follow
 * light/dark mode. The diagram background is transparent so it blends with the
 * conversation surface (no mismatched light box on a dark thread); nodes, text,
 * borders, and lines come from the palette.
 */
function mermaidConfig(theme: Theme) {
  const p = theme.palette;
  return {
    startOnLoad: false,
    theme: 'base' as const,
    suppressErrorRendering: true,
    themeVariables: {
      background: 'transparent',
      mainBkg: p.background.paper,
      primaryColor: p.background.paper,
      primaryTextColor: p.text.primary,
      primaryBorderColor: p.divider,
      lineColor: p.text.secondary,
      secondaryColor: p.background.default,
      tertiaryColor: p.background.default,
      clusterBkg: p.background.default,
      clusterBorder: p.divider,
      edgeLabelBackground: p.background.default,
      textColor: p.text.primary,
      fontFamily: 'Inter, Roboto, Arial, sans-serif',
    },
  };
}

let idCounter = 0;
// Small coalescing delay before rendering once the stream has settled (lets the
// final code + completion status land together).
const RENDER_SETTLE_MS = 120;

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
    backgroundColor: 'transparent',
    color: theme.palette.text.primary,
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
  // Fixed-height loading state shown while the diagram has no render yet (during
  // streaming, and the brief post-stream render). Fixed height + keyed only on
  // `!svg` makes it remount-resilient: the height can't oscillate as the stream
  // churns through the opening fence, so there's nothing to jitter.
  loadingBox: {
    position: 'relative',
    margin: theme.spacing(1.5, 0),
    height: 200,
    borderRadius: theme.shape.borderRadius,
    border: `1px solid ${theme.palette.divider}`,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  // A faint, blurred faux-flowchart behind the frosted overlay so the area reads
  // as "a diagram is coming" rather than an empty box. Gently pulses.
  skeleton: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    filter: 'blur(3px)',
    animation: '$pulse 1.8s ease-in-out infinite',
  },
  '@keyframes pulse': {
    '0%, 100%': { opacity: theme.palette.type === 'dark' ? 0.18 : 0.3 },
    '50%': { opacity: theme.palette.type === 'dark' ? 0.32 : 0.5 },
  },
  skeletonSvg: {
    width: 240,
    maxWidth: '85%',
    height: 'auto',
    '& line': {
      stroke: theme.palette.text.secondary,
      strokeWidth: 2,
      strokeLinecap: 'round',
    },
    '& rect': {
      fill: theme.palette.text.secondary,
      fillOpacity: 0.18,
      stroke: theme.palette.text.secondary,
      strokeWidth: 2,
    },
  },
  // Frosted glass over the skeleton, holding the spinner + caption. Lighter than
  // the re-render overlay so the blurred skeleton still shows through.
  loadingOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(1),
    backgroundColor:
      theme.palette.type === 'dark'
        ? 'rgba(20, 20, 20, 0.35)'
        : 'rgba(255, 255, 255, 0.4)',
    backdropFilter: 'blur(2px)',
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
 * Mermaid re-lays-out the entire diagram on every change, so rendering one whose
 * source is still streaming makes its height oscillate and scrolls the chat
 * (debouncing the render doesn't stop the rendered height from jumping each time).
 * So we DON'T render while the message is streaming: a stable-height placeholder
 * holds the space, and the diagram renders once — after the stream settles.
 * (`closeStreamingMermaidFence` keeps the half-streamed fence parsed as a mermaid
 * block, so the source never leaks as raw text meanwhile.) Keeps the last good
 * render across re-renders (e.g. theme change), surfaces a parse error only once
 * settled, and opens a fullscreen dialog on click.
 */
export function MermaidDiagram({ code }: { code: string }) {
  const classes = useStyles();
  const theme = useTheme();
  // Whole-message streaming status — only render once it's no longer running.
  // Optional-chained so a non-message context simply renders immediately.
  const isStreaming = useAuiState(s => s.message?.status?.type === 'running');
  const [svg, setSvg] = useState<string>('');
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState<string>('');
  const [showError, setShowError] = useState(false);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const errorTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const lastRenderedCode = useRef<string>('');

  useEffect(() => {
    // Cleared by the effect cleanup so an in-flight render can't setState after
    // unmount / re-run.
    let active = true;
    const trimmed = code.trim();

    // While the message is still streaming, hold a stable-height placeholder and
    // render nothing — rendering an in-progress diagram is what makes the height
    // oscillate and scrolls the chat. The render below fires once streaming ends.
    if (isStreaming) {
      if (!svg) setRendering(true);
      return () => {
        active = false;
      };
    }

    setRendering(true);
    setError('');
    setShowError(false);

    clearTimeout(timerRef.current);
    clearTimeout(errorTimerRef.current);
    // Re-render when either the code or the theme (light/dark) changes.
    const renderKey = `${theme.palette.type}\n${trimmed}`;
    timerRef.current = setTimeout(() => {
      // Skip if nothing relevant changed since the last successful render.
      if (renderKey === lastRenderedCode.current) {
        setRendering(false);
        return;
      }

      const id = `mermaid-${++idCounter}`;

      // Apply the current Backstage theme before rendering.
      mermaid.initialize(mermaidConfig(theme));
      mermaid
        .render(id, trimmed)
        .then(({ svg: rendered }) => {
          if (active) {
            setSvg(rendered);
            setError('');
            lastRenderedCode.current = renderKey;
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
    }, RENDER_SETTLE_MS);

    return () => {
      active = false;
      clearTimeout(timerRef.current);
      clearTimeout(errorTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, theme.palette.type, isStreaming]);

  // Natural diagram size from the SVG viewBox, handed to the fullscreen viewer so
  // its content box has a definite size — mermaid's `width:100%` svg would otherwise
  // collapse to 0 in the absolutely-positioned pan/zoom container (a blank view).
  const dims = useMemo(() => {
    const m = svg.match(/viewBox="\s*[\d.-]+\s+[\d.-]+\s+([\d.-]+)\s+([\d.-]+)/);
    return m ? { w: parseFloat(m[1]), h: parseFloat(m[2]) } : null;
  }, [svg]);

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

  // No diagram yet — while streaming, or the first frame is still rendering —
  // show a fixed-height frosted placeholder (blurred skeleton + spinner). Fixed
  // height keyed only on `!svg` is remount-resilient: the height stays constant
  // no matter how the stream churns through the opening fence, so it can't jitter.
  // The diagram replaces it once, when it's ready (the effect renders after the
  // stream settles).
  if (!svg) {
    return (
      <div className={classes.loadingBox}>
        <div className={classes.skeleton} aria-hidden="true">
          <svg className={classes.skeletonSvg} viewBox="0 0 240 130">
            <rect x="90" y="6" width="60" height="26" rx="5" />
            <line x1="120" y1="40" x2="65" y2="50" />
            <line x1="120" y1="40" x2="175" y2="50" />
            <rect x="30" y="50" width="70" height="26" rx="5" />
            <rect x="140" y="50" width="70" height="26" rx="5" />
            <line x1="65" y1="76" x2="65" y2="96" />
            <line x1="175" y1="76" x2="175" y2="96" />
            <rect x="30" y="96" width="70" height="26" rx="5" />
            <rect x="140" y="96" width="70" height="26" rx="5" />
          </svg>
        </div>
        <div className={classes.loadingOverlay}>
          <CircularProgress size={28} />
          <Typography variant="caption" color="textSecondary">
            Rendering diagram…
          </Typography>
        </div>
      </div>
    );
  }

  // Past this point there's a rendered diagram. `rendering` here means a re-render
  // (e.g. a theme toggle) over the existing one — the overlay sits on top without
  // changing the height.
  const isLoading = rendering;

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

      <PanZoomDialog
        open={open}
        onClose={() => setOpen(false)}
        width={dims?.w}
        height={dims?.h}
        fitKey={svg}
        ariaLabel="Mermaid diagram (fullscreen)"
      >
        <div
          style={{ width: '100%', height: '100%' }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </PanZoomDialog>
    </>
  );
}
