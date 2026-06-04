/**
 * A self-bounding, full-height page region for the chat surface.
 *
 * The page renders inside Backstage's `Content` area, which is `width: 100%`
 * with AUTO height (not a viewport-bounded flex column). A naive `height: 100%`
 * therefore doesn't bound to the viewport and the page overflows below the fold
 * (the composer gets pushed off-screen).
 *
 * Instead of trusting the CSS height chain, we MEASURE this element's own top
 * offset and fill from there to the viewport bottom (`innerHeight - rect.top`).
 * That's correct regardless of header height or sidebar, with no magic pixel
 * constants. The element is a flex column that clips, so the chat's own
 * `Viewport` owns the only scroll and the composer pins.
 */
import { ReactNode, useLayoutEffect, useRef } from 'react';
import { makeStyles } from '@material-ui/core/styles';

const useStyles = makeStyles(
  {
    root: {
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      overflow: 'hidden',
    },
  },
  { name: 'AssistantsCollapsibleFullHeightRegion' },
);

/** @public */
export function FullHeightRegion(props: {
  className?: string;
  children: ReactNode;
}) {
  const classes = useStyles();
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof window === 'undefined') {
      return undefined;
    }

    const apply = () => {
      const top = el.getBoundingClientRect().top;
      el.style.height = `${Math.max(0, window.innerHeight - top)}px`;
    };

    apply();
    window.addEventListener('resize', apply);

    // The page header (our previous sibling in the Content flow) determines our
    // top offset; react to its size changes too. Falls back to resize-only.
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => apply());
      const header = el.previousElementSibling;
      if (header) {
        observer.observe(header);
      }
    }

    return () => {
      window.removeEventListener('resize', apply);
      observer?.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      className={
        props.className ? `${classes.root} ${props.className}` : classes.root
      }
    >
      {props.children}
    </div>
  );
}
