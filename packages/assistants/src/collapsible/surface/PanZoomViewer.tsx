/**
 * Shared fullscreen pan/zoom viewer — wheel-to-zoom (anchored at the cursor),
 * drag-to-pan, zoom/fit/close controls, double-click to re-fit.
 *
 * Extracted from the Mermaid fullscreen viewer so images and diagrams share the
 * exact same interaction. The content is moved/scaled purely via a CSS transform
 * (transformOrigin 0,0 so the cursor-anchored zoom math is exact).
 *
 * Sizing: pass the content's natural `width`/`height` when known (e.g. a Mermaid
 * SVG whose own `width:100%` would otherwise collapse to 0 in this absolutely-
 * positioned container). For content with intrinsic size that shrink-wraps on its
 * own (a plain `<img>`), omit them and the viewport measures the laid-out box;
 * bump `fitKey` once the content has loaded so it re-fits against the real size.
 */
import {
  PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Dialog, IconButton, Tooltip } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import CloseIcon from '@material-ui/icons/Close';
import AddIcon from '@material-ui/icons/Add';
import RemoveIcon from '@material-ui/icons/Remove';
import CropFreeIcon from '@material-ui/icons/CropFree';

const useStyles = makeStyles(theme => ({
  // Default fullscreen backdrop. Matches the chat thread surface (so a Mermaid
  // diagram's subgraph shading reads the same as inline); a neutral dark/light
  // surface that images sit well on too. Override via `paperClassName`.
  dialogPaper: {
    backgroundColor:
      theme.palette.type === 'dark' ? 'hsl(0, 0%, 18%)' : 'hsl(0, 0%, 100%)',
  },
  dialogBody: {
    position: 'relative',
    width: '100%',
    height: '100vh',
    overflow: 'hidden',
  },
  // Pan/zoom viewport: clips the (possibly oversized) transformed content and
  // captures wheel-to-zoom + drag-to-pan.
  viewport: {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    touchAction: 'none',
    cursor: 'grab',
    userSelect: 'none',
    '&:active': { cursor: 'grabbing' },
  },
  // The content, positioned at the viewport origin and moved/scaled via transform.
  // An SVG is stretched to the (definite) box; an <img> keeps its intrinsic size so
  // the box can shrink-wrap it when no explicit width/height is given.
  content: {
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
    '& img': {
      display: 'block',
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
    '&:hover': { backgroundColor: theme.palette.action.hover },
  },
}));

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 8;
const clampZoom = (s: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));

interface ViewportProps {
  width?: number;
  height?: number;
  fitKey?: unknown;
  onClose: () => void;
  classes: ReturnType<typeof useStyles>;
  children: ReactNode;
}

/**
 * The interactive viewport. Mounted only while the dialog is open (MUI Dialog
 * unmounts its children on close), so it re-fits every time it opens.
 */
function Viewport({
  width,
  height,
  fitKey,
  onClose,
  classes,
  children,
}: ViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });

  // Center the content in the viewport, shrinking large content to fit but never
  // upscaling on open (avoids a blurry start). Prefer the explicit natural size;
  // fall back to the measured layout box (both are untransformed → zoom-independent).
  const fit = useCallback(() => {
    const vp = viewportRef.current;
    const content = contentRef.current;
    if (!vp || !content) return;
    const w = width || content.offsetWidth;
    const h = height || content.offsetHeight;
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    if (!w || !h || !vw || !vh) return;
    const scale = Math.min(vw / w, vh / h, 1);
    setView({ scale, tx: (vw - w * scale) / 2, ty: (vh - h * scale) / 2 });
  }, [width, height]);

  useLayoutEffect(() => {
    fit();
  }, [fit, fitKey]);

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
      className={classes.viewport}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onDoubleClick={fit}
    >
      <div
        ref={contentRef}
        className={classes.content}
        style={{
          width,
          height,
          transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
        }}
      >
        {children}
      </div>

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
            aria-label="Reset zoom and fit to screen"
            onClick={fit}
          >
            <CropFreeIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Close">
          <IconButton
            className={classes.controlButton}
            aria-label="Close fullscreen viewer"
            onClick={onClose}
          >
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}

export interface PanZoomDialogProps {
  open: boolean;
  onClose: () => void;
  /** Natural content size; given for content (e.g. an SVG) that won't shrink-wrap. */
  width?: number;
  height?: number;
  /** Change this once async content (e.g. an image) has loaded, to force a re-fit. */
  fitKey?: unknown;
  /** Override the backdrop Paper class (defaults to the chat-surface backdrop). */
  paperClassName?: string;
  ariaLabel?: string;
  children: ReactNode;
}

/**
 * Fullscreen dialog wrapping the {@link Viewport}. The content to display is
 * passed as `children` (an `<img>`, or a `<div dangerouslySetInnerHTML>` of SVG).
 */
export function PanZoomDialog({
  open,
  onClose,
  width,
  height,
  fitKey,
  paperClassName,
  ariaLabel,
  children,
}: PanZoomDialogProps) {
  const classes = useStyles();
  return (
    <Dialog
      fullScreen
      open={open}
      onClose={onClose}
      aria-label={ariaLabel}
      PaperProps={{ className: paperClassName ?? classes.dialogPaper }}
    >
      <div className={classes.dialogBody}>
        <Viewport
          width={width}
          height={height}
          fitKey={fitKey}
          onClose={onClose}
          classes={classes}
        >
          {children}
        </Viewport>
      </div>
    </Dialog>
  );
}
