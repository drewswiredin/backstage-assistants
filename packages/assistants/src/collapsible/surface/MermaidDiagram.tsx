import {
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import mermaid from 'mermaid';
import {
  CircularProgress,
  Dialog,
  IconButton,
  Tooltip,
  Typography,
} from '@material-ui/core';
import { makeStyles, useTheme, type Theme } from '@material-ui/core/styles';
import CloseIcon from '@material-ui/icons/Close';
import AddIcon from '@material-ui/icons/Add';
import RemoveIcon from '@material-ui/icons/Remove';
import CropFreeIcon from '@material-ui/icons/CropFree';
import { useAuiState } from '@assistant-ui/react';

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
  dialogPaper: {
    // Match the chat thread surface (ConversationSurface threadHost
    // `--aui-background`) so the fullscreen view reproduces the chat backdrop.
    // If this were left at background.default it would equal mermaid's clusterBkg
    // (also background.default), so subgraph shading would blend into the backdrop
    // and look like it vanished while the borders (divider) remained — which is
    // exactly the discrepancy reported between the inline and fullscreen views.
    backgroundColor:
      theme.palette.type === 'dark' ? 'hsl(0, 0%, 18%)' : 'hsl(0, 0%, 100%)',
  },
  dialogBody: {
    position: 'relative',
    width: '100%',
    height: '100vh',
    overflow: 'hidden',
  },
  // Pan/zoom viewport: clips the (possibly oversized) transformed diagram and
  // captures wheel-to-zoom + drag-to-pan.
  fullscreenViewport: {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    touchAction: 'none',
    cursor: 'grab',
    userSelect: 'none',
    '&:active': {
      cursor: 'grabbing',
    },
  },
  // The diagram itself, positioned at the viewport origin and moved/scaled purely
  // via a CSS transform (transformOrigin 0,0 so cursor-anchored zoom math is exact).
  // The box gets a definite width/height (from the SVG viewBox) inline; the SVG
  // fills it. Without a definite box, mermaid's width:100%/max-width svg collapses
  // to 0 in this absolutely-positioned container and the view goes blank.
  fullscreenContent: {
    position: 'absolute',
    top: 0,
    left: 0,
    transformOrigin: '0 0',
    willChange: 'transform',
    color: theme.palette.text.primary,
    '& svg': {
      display: 'block',
      width: '100%',
      height: '100%',
      maxWidth: 'none',
    },
  },
  controls: {
    position: 'absolute',
    top: theme.spacing(1.5),
    right: theme.spacing(1.5),
    zIndex: 2,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  },
  controlButton: {
    backgroundColor: theme.palette.background.paper,
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
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

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 8;
const clampZoom = (s: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));

/**
 * Fullscreen diagram viewer with wheel-to-zoom and drag-to-pan.
 *
 * The same rendered `svg` string is shown here as inline (so the fills are
 * identical — see `dialogPaper` for why the backdrop must match the chat surface).
 * Mounted only while the dialog is open, so it re-fits each time it opens.
 */
function FullscreenDiagram({
  svg,
  classes,
  onClose,
}: {
  svg: string;
  classes: ReturnType<typeof useStyles>;
  onClose: () => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });

  // Mermaid sizes its <svg> with max-width / width:100%, which collapses to 0 in an
  // absolutely-positioned shrink-wrap container (→ a blank fullscreen). Read the
  // natural size from the viewBox and give the content a definite box so it lays
  // out; the SVG then fills that box.
  const dims = useMemo(() => {
    const m = svg.match(/viewBox="\s*[\d.-]+\s+[\d.-]+\s+([\d.-]+)\s+([\d.-]+)/);
    return m ? { w: parseFloat(m[1]), h: parseFloat(m[2]) } : null;
  }, [svg]);

  // Center the diagram in the viewport, shrinking large diagrams to fit but never
  // upscaling on open (avoids a blurry start). Prefer the viewBox dims; fall back
  // to the measured layout size (both are untransformed, independent of zoom).
  const fit = useCallback(() => {
    const vp = viewportRef.current;
    const content = contentRef.current;
    if (!vp || !content) return;
    const w = dims?.w || content.offsetWidth;
    const h = dims?.h || content.offsetHeight;
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    if (!w || !h || !vw || !vh) return;
    const scale = Math.min(vw / w, vh / h, 1);
    setView({ scale, tx: (vw - w * scale) / 2, ty: (vh - h * scale) / 2 });
  }, [dims]);

  useLayoutEffect(() => {
    fit();
  }, [fit, svg]);

  // Zoom anchored at a viewport point (cursor for wheel, center for buttons): keep
  // the point under (cx,cy) fixed as scale changes. transformOrigin is 0,0.
  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setView(v => {
      const scale = clampZoom(v.scale * factor);
      const ratio = scale / v.scale;
      return {
        scale,
        tx: cx - ratio * (cx - v.tx),
        ty: cy - ratio * (cy - v.ty),
      };
    });
  }, []);

  // Wheel = zoom. A native non-passive listener is required: React's onWheel is
  // passive, so it can't preventDefault and the dialog would scroll instead.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setView(v => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  };
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  };

  const zoomFromCenter = (factor: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    zoomAt(factor, vp.clientWidth / 2, vp.clientHeight / 2);
  };

  return (
    <div
      ref={viewportRef}
      className={classes.fullscreenViewport}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onDoubleClick={fit}
    >
      <div
        ref={contentRef}
        className={classes.fullscreenContent}
        style={{
          width: dims?.w,
          height: dims?.h,
          transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
        }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      {/* stopPropagation so clicking a control doesn't also start a pan drag */}
      <div className={classes.controls} onPointerDown={e => e.stopPropagation()}>
        <Tooltip title="Zoom in">
          <IconButton
            className={classes.controlButton}
            aria-label="Zoom in"
            onClick={() => zoomFromCenter(1.2)}
          >
            <AddIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Zoom out">
          <IconButton
            className={classes.controlButton}
            aria-label="Zoom out"
            onClick={() => zoomFromCenter(1 / 1.2)}
          >
            <RemoveIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Reset / fit">
          <IconButton
            className={classes.controlButton}
            aria-label="Reset zoom and fit diagram"
            onClick={fit}
          >
            <CropFreeIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Close">
          <IconButton
            className={classes.controlButton}
            aria-label="Close fullscreen diagram"
            onClick={onClose}
          >
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}

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

      <Dialog
        fullScreen
        open={open}
        onClose={() => setOpen(false)}
        PaperProps={{ className: classes.dialogPaper }}
      >
        <div className={classes.dialogBody}>
          <FullscreenDiagram
            svg={svg}
            classes={classes}
            onClose={() => setOpen(false)}
          />
        </div>
      </Dialog>
    </>
  );
}
