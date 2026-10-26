import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import useAsync from 'react-use/lib/useAsync';
import { useApi } from '@backstage/core-plugin-api';
import { useRouteRef } from '@backstage/frontend-plugin-api';
import { usePermission } from '@backstage/plugin-permission-react';
import {
  makeStyles,
  ThemeProvider,
  useTheme,
  type Theme,
} from '@material-ui/core/styles';
import useMediaQuery from '@material-ui/core/useMediaQuery';
import { Fab, IconButton, LinearProgress, Tooltip } from '@material-ui/core';
import ChevronLeftIcon from '@material-ui/icons/ChevronLeft';
import { RiRobot2Line } from '@remixicon/react';
import { assistantUsePermission } from '@drewswiredin/backstage-plugin-assistants-common';
import { assistantsApiRef, type AssistantsApi } from '../api';
import { clientToolsApiRef } from '../clientTools/api';
import { StatusDot } from '../collapsible/StatusDot';
import { useThreadStatus } from '../collapsible/useThreadStatus';
import { rootRouteRef, threadRouteRef } from '../routes';
import {
  PanelControlProvider,
  PanelPinProvider,
  type PanelControl,
  type PanelHandoff,
  type PanelPin,
} from './panelControl';
import {
  clampPanelWidth,
  loadPanelAssistant,
  loadPanelPinned,
  loadPanelThread,
  loadPanelWidth,
  onPanelAssistantChange,
  savePanelAssistant,
  savePanelPinned,
  savePanelThread,
  savePanelWidth,
} from './panelStorage';

// The conversation surface and the vendored assistant-ui CSS load on first
// open, not with the app.
const EmbeddedAssistant = lazy(() =>
  import('../embedded/EmbeddedAssistant').then(m => ({
    default: m.EmbeddedAssistant,
  })),
);

/**
 * closed: the button only. open: the panel beside the page, no button.
 * collapsed: a narrow strip at the right edge; the conversation stays put.
 */
type PanelMode = 'closed' | 'open' | 'collapsed';

const STRIP_WIDTH = 48;
const TRANSITION = 'width 225ms cubic-bezier(0, 0, 0.2, 1)';

/** Clicks inside these never collapse the panel (its own portals included). */
const INSIDE_SELECTOR = [
  '[data-assistants-panel]',
  '[data-assistants-strip]',
  '[role="presentation"]', // MUI modals: menus, popovers, dialogs
  '[role="dialog"]', // Backstage UI (react-aria) dialogs
  '[role="tooltip"]',
  '.MuiPopper-root',
].join(', ');

/** A Backstage dialog or drawer is open; it owns Escape. */
const OVERLAY_SELECTOR = [
  '.MuiDialog-root',
  '.MuiDrawer-modal',
  '[class*="bui-DialogOverlay"]',
].join(', ');

/** The panel column's width, which dialogs and drawers keep clear of. */
const INSET_VAR = '--assistants-panel-inset';

/**
 * MUI dialogs and drawers keep focus inside themselves by pulling it back;
 * off, so the composer beside an open one can be typed in. Their backdrop
 * click and Escape still close them.
 */
export const withFreeFocus = (outer: Theme): Theme => ({
  ...outer,
  props: {
    ...outer.props,
    MuiModal: { ...outer.props?.MuiModal, disableEnforceFocus: true },
  },
});

const useStyles = makeStyles(theme => ({
  // Dialogs and drawers open beside the panel column, never over it, so the
  // panel and the strip stay usable while one is open.
  '@global': {
    // Full-viewport roots (and their backdrops) end at the panel column.
    '.MuiDialog-root, .MuiDrawer-modal, [class*="bui-DialogOverlay"]': {
      right: `var(${INSET_VAR}, 0px) !important`,
      width: 'auto !important',
    },
    // A right-hand drawer keeps its own width and sits left of the column.
    '.MuiDrawer-paperAnchorRight': {
      right: `var(${INSET_VAR}, 0px) !important`,
    },
  },
  // The app layout and the panel side by side. The page column shrinks as
  // the panel column grows, so the panel never covers content.
  shell: {
    display: 'flex',
    alignItems: 'stretch',
    width: '100%',
  },
  main: {
    flex: '1 1 auto',
    minWidth: 0,
  },
  // The panel column: its width animates between 0, the strip, and the
  // panel. Sticky, so it stays in view while the page scrolls. It clips its
  // content, so nothing ever reaches past the viewport.
  aside: {
    flex: '0 0 auto',
    position: 'sticky',
    top: 0,
    alignSelf: 'flex-start',
    height: '100vh',
    overflow: 'hidden',
    transition: TRANSITION,
    zIndex: theme.zIndex.appBar - 1,
  },
  // Pinned to the column's right edge at its full width, so as the column
  // narrows the panel slides out of view instead of reflowing.
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: theme.palette.background.paper,
    borderLeft: `1px solid ${theme.palette.divider}`,
  },
  handle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 6,
    cursor: 'col-resize',
    zIndex: 1,
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
  },
  content: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  strip: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: STRIP_WIDTH,
    zIndex: 2,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'space-between',
    // The expand chevron at the top; the assistant icon at the bottom, where
    // the floating button sits when the panel is closed.
    paddingTop: theme.spacing(1),
    paddingBottom: theme.spacing(3),
    backgroundColor: theme.palette.background.paper,
    borderLeft: `1px solid ${theme.palette.divider}`,
    cursor: 'pointer',
  },
  stripIcon: {
    display: 'inline-flex',
    color: theme.palette.primary.main,
  },
  stripChevron: {
    color: theme.palette.text.secondary,
  },
  // Above dialogs and drawers, so the panel can always be opened.
  fab: {
    position: 'fixed',
    right: theme.spacing(3),
    bottom: theme.spacing(3),
    zIndex: theme.zIndex.modal + 1,
  },
}));

/**
 * The app root wrapper that adds the floating button and the side panel.
 *
 * Closed shows the button only. Open slides the panel out beside the page
 * (the page column shrinks) and hides the button. Unpinned, a click on the
 * page or Escape collapses the panel to a strip at the right edge with the
 * conversation kept; pinned, it stays open while you work on the page.
 * Ctrl+/ toggles open and collapsed either way. Close (the x) removes the
 * strip and brings the button back. Either way the conversation is remembered: only "+" and
 * "Open in Assistants" forget it.
 *
 * On the Assistants page itself, for a user without `assistant.use`, and
 * while the backend lists no assistant, the wrapper renders the page alone.
 */
export function AssistantsPanel({ children }: { children: ReactNode }) {
  const classes = useStyles();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('xs'));
  const api = useApi(assistantsApiRef);
  const { tools: clientTools } = useApi(clientToolsApiRef);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const rootRoute = useRouteRef(rootRouteRef);
  const threadRoute = useRouteRef(threadRouteRef);

  const canUse = usePermission({ permission: assistantUsePermission });
  // One `/status` per app load, only to know whether to show the button.
  const status = useAsync(
    async () => (canUse.allowed ? api.getStatus() : undefined),
    [api, canUse.allowed],
  );
  const hasAssistants = (status.value?.assistants.length ?? 0) > 0;

  const [mode, setMode] = useState<PanelMode>('closed');
  const [pinned, setPinned] = useState(loadPanelPinned);
  const pin = useMemo<PanelPin>(
    () => ({
      pinned,
      toggle: () => {
        savePanelPinned(!pinned);
        setPinned(!pinned);
      },
    }),
    [pinned],
  );
  const [width, setWidth] = useState(() => loadPanelWidth(window.innerWidth));
  const [dragging, setDragging] = useState(false);
  // The remembered conversation, and a session counter that remounts the
  // surface on New / hand-off (a thread id change alone never remounts).
  const [remoteId, setRemoteId] = useState<string | undefined>(loadPanelThread);
  const [session, setSession] = useState(0);
  // The assistant the user picked in the panel; the default one otherwise.
  const [pickedAssistant, setPickedAssistant] = useState<string | undefined>(
    loadPanelAssistant,
  );
  // A first message (with its model and effort) handed in by a page
  // component, the homepage composer, sent once the fresh surface is ready.
  const [handoff, setHandoff] = useState<PanelHandoff | undefined>();

  const onAssistantsPage = (() => {
    const root = rootRoute?.();
    return (
      root !== undefined &&
      (pathname === root || pathname.startsWith(`${root}/`))
    );
  })();
  const active = canUse.allowed && hasAssistants && !onAssistantsPage;

  const open = useCallback(() => setMode('open'), []);
  const hide = useCallback(
    () => setMode(m => (m === 'open' ? 'collapsed' : m)),
    [],
  );
  const close = useCallback(() => setMode('closed'), []);
  const toggle = useCallback(
    () => setMode(m => (m === 'open' ? 'collapsed' : 'open')),
    [],
  );

  // Ctrl+/ (⌘/ on macOS) toggles; Escape hides unless pinned.
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'Escape' && mode === 'open' && !pinned) {
        if (document.querySelector(OVERLAY_SELECTOR)) return;
        hide();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, toggle, hide, mode, pinned]);

  // A click on the page beside the open panel hides it unless pinned (the
  // conversation is kept). Clicks inside the panel, its menus, tooltips, and
  // any dialog do not count.
  useEffect(() => {
    if (mode !== 'open' || pinned) return undefined;
    const onDown = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.closest(INSIDE_SELECTOR)) return;
      hide();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [mode, pinned, hide]);

  // Dialogs and drawers keep clear of the panel column (see '@global').
  useEffect(() => {
    if (!active) return undefined;
    let inset = 0;
    if (mode === 'open' && !fullScreen) inset = width;
    else if (mode === 'collapsed') inset = STRIP_WIDTH;
    const root = document.documentElement;
    root.style.setProperty(INSET_VAR, `${inset}px`);
    return () => {
      root.style.removeProperty(INSET_VAR);
    };
  }, [active, mode, width, fullScreen]);

  const rememberThread = useCallback((id: string) => {
    savePanelThread(id);
    setRemoteId(id);
  }, []);
  const forgetThread = useCallback(() => {
    savePanelThread(undefined);
    setRemoteId(undefined);
    setSession(s => s + 1);
  }, []);
  // Switching assistant starts fresh under the new one; the old chat stays in
  // history. A pick made elsewhere (the homepage composer) switches too.
  const pickedRef = useRef(pickedAssistant);
  const adoptAssistant = useCallback(
    (id: string | undefined) => {
      pickedRef.current = id;
      setPickedAssistant(id);
      forgetThread();
    },
    [forgetThread],
  );
  const pickAssistant = useCallback(
    (id: string) => {
      adoptAssistant(id);
      savePanelAssistant(id);
    },
    [adoptAssistant],
  );
  useEffect(
    () =>
      onPanelAssistantChange(id => {
        if (id !== pickedRef.current) adoptAssistant(id);
      }),
    [adoptAssistant],
  );

  // An earlier conversation picked from the history menu: remember it and
  // remount the surface on it.
  const pickThread = useCallback((id: string) => {
    savePanelThread(id);
    setRemoteId(id);
    setSession(s => s + 1);
  }, []);

  // The controls a page component uses to open the panel, with a prompt that
  // starts a fresh conversation.
  const control = useMemo<PanelControl>(
    () => ({
      open: options => {
        if (options?.assistantId) pickAssistant(options.assistantId);
        if (options?.threadId) pickThread(options.threadId);
        if (options?.prompt) {
          if (!options.assistantId) forgetThread();
          setHandoff({
            prompt: options.prompt,
            modelId: options.modelId,
            reasoningLevel: options.reasoningLevel,
          });
        }
        setMode('open');
      },
    }),
    [pickAssistant, pickThread, forgetThread],
  );
  const handoffSent = useCallback(() => setHandoff(undefined), []);

  const openFull = useCallback(
    (id: string | undefined, assistantId: string) => {
      const root = rootRoute?.();
      if (root === undefined) return;
      const target =
        id && threadRoute
          ? threadRoute({ threadId: id })
          : `${root}?assistant=${encodeURIComponent(assistantId)}`;
      close();
      forgetThread();
      navigate(target);
    },
    [rootRoute, threadRoute, navigate, close, forgetThread],
  );

  // Resize by dragging the left edge (no width animation while dragging).
  const onHandleDown = (e: ReactMouseEvent) => {
    e.preventDefault();
    setDragging(true);
    const onMove = (ev: MouseEvent) => {
      setWidth(
        clampPanelWidth(window.innerWidth - ev.clientX, window.innerWidth),
      );
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDragging(false);
      setWidth(w => {
        savePanelWidth(w);
        return w;
      });
      window.dispatchEvent(new Event('resize'));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Content that measures itself only on window resize (the home page's
  // grid, charts) must learn that the page column changed width. Fired when
  // the column's width transition ends, and after a drag resize.
  const notifyResize = useCallback(() => {
    window.dispatchEvent(new Event('resize'));
  }, []);

  // Double-click (or Home) on the edge goes back to the default width.
  const resetWidth = () => {
    savePanelWidth(undefined);
    setWidth(loadPanelWidth(window.innerWidth));
    window.dispatchEvent(new Event('resize'));
  };

  const onHandleKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Home') {
      e.preventDefault();
      resetWidth();
      return;
    }
    let step = 0;
    if (e.key === 'ArrowLeft') step = 24;
    if (e.key === 'ArrowRight') step = -24;
    if (!step) return;
    e.preventDefault();
    setWidth(w => {
      const next = clampPanelWidth(w + step, window.innerWidth);
      savePanelWidth(next);
      return next;
    });
  };

  if (!active) {
    return <>{children}</>;
  }

  const panelWidth = fullScreen ? window.innerWidth : width;
  let asideWidth = 0;
  if (mode === 'open') asideWidth = panelWidth;
  else if (mode === 'collapsed') asideWidth = STRIP_WIDTH;

  const icon = remoteId ? (
    <PanelStatusDot api={api} remoteId={remoteId}>
      <RiRobot2Line />
    </PanelStatusDot>
  ) : (
    <RiRobot2Line />
  );

  return (
    <ThemeProvider theme={withFreeFocus}>
      <div className={classes.shell}>
        <div className={classes.main}>
          <PanelControlProvider value={control}>
            {children}
          </PanelControlProvider>
        </div>
        <aside
          className={classes.aside}
          style={{
            width: asideWidth,
            transition: dragging ? 'none' : undefined,
          }}
          aria-label="Assistant panel"
          aria-hidden={mode === 'closed'}
          // A Backstage UI (react-aria) dialog doesn't close on clicks here,
          // lets focus in, and doesn't hide the panel from assistive tech.
          data-react-aria-top-layer="true"
          onTransitionEnd={e => {
            if (e.target === e.currentTarget && e.propertyName === 'width') {
              notifyResize();
            }
          }}
        >
          {/* Mounted while open or collapsed, and kept mounted while closed
            if a conversation exists, so a stream keeps rendering and
            reopening shows it live. Blank and closed mounts nothing, so the
            surface's chunk loads on first open, not with the app. */}
          {(mode !== 'closed' || remoteId !== undefined) && (
            <div
              className={classes.panel}
              style={{ width: panelWidth }}
              // Marks the panel for the page reader to skip.
              data-assistants-panel="true"
            >
              {!fullScreen && (
                <Tooltip
                  title={
                    dragging ? '' : 'Drag to resize. Double-click to reset.'
                  }
                  placement="left"
                  enterDelay={600}
                >
                  {/* A focusable separator is interactive per ARIA (drag or
                      arrow keys resize), which the a11y rules do not model. */}
                  {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
                  <div
                    className={classes.handle}
                    onMouseDown={onHandleDown}
                    onDoubleClick={resetWidth}
                    onKeyDown={onHandleKey}
                    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                    tabIndex={0}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize panel. Home resets the width."
                    aria-valuenow={width}
                  />
                </Tooltip>
              )}
              <div className={classes.content}>
                <Suspense fallback={<LinearProgress />}>
                  <PanelPinProvider value={pin}>
                    <EmbeddedAssistant
                      key={session}
                      assistantId={pickedAssistant}
                      threadId={remoteId}
                      clientTools={clientTools}
                      onThreadChange={rememberThread}
                      onAssistantChange={pickAssistant}
                      onThreadPick={pickThread}
                      handoff={handoff}
                      onHandoffSent={handoffSent}
                      onOpenFull={openFull}
                      onNew={forgetThread}
                      onClose={close}
                      active={mode === 'open'}
                    />
                  </PanelPinProvider>
                </Suspense>
              </div>
            </div>
          )}
          {mode === 'collapsed' && (
            // The whole strip is one control: anything on it shows the panel.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
            <div
              className={classes.strip}
              data-assistants-strip="true"
              onClick={open}
            >
              <Tooltip title="Show assistant (Ctrl+/)" placement="left">
                <IconButton
                  size="small"
                  className={classes.stripChevron}
                  aria-label="Show assistant"
                >
                  <ChevronLeftIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <span className={classes.stripIcon}>{icon}</span>
            </div>
          )}
        </aside>
        {mode === 'closed' && (
          <Tooltip title="Ask an assistant (Ctrl+/)" placement="left">
            <Fab
              color="primary"
              size="medium"
              aria-label="Ask an assistant"
              className={classes.fab}
              onClick={open}
              data-react-aria-top-layer="true"
            >
              {icon}
            </Fab>
          </Tooltip>
        )}
      </div>
    </ThemeProvider>
  );
}

/**
 * The panel conversation's own working/unread dot on the button and the
 * strip. Mounted only while a conversation exists, so a blank panel costs no
 * status polling.
 */
function PanelStatusDot({
  api,
  remoteId,
  children,
}: {
  api: AssistantsApi;
  remoteId: string;
  children: ReactNode;
}) {
  // Unfocused (the panel is not open), so unread shows until it is opened.
  const { statusOf } = useThreadStatus(api, undefined);
  return <StatusDot status={statusOf(remoteId)}>{children}</StatusDot>;
}
