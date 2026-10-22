// The vendored react-ui Thread CSS, imported at the top of this chunk for the
// same reason as on the page: react-ui ships `sideEffects: false`, so a bare
// package CSS import would be tree-shaken out of a lazy chunk.
import '../collapsible/surface/styles/assistant-ui.css';
import '../collapsible/surface/styles/assistant-ui-markdown.css';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation } from 'react-router-dom';
import useAsync from 'react-use/lib/useAsync';
import useAsyncRetry from 'react-use/lib/useAsyncRetry';
import { useApi } from '@backstage/core-plugin-api';
import { usePermission } from '@backstage/plugin-permission-react';
import { makeStyles } from '@material-ui/core/styles';
import {
  Button,
  ButtonBase,
  IconButton,
  LinearProgress,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@material-ui/core';
import AddIcon from '@material-ui/icons/Add';
import ArrowDropDownIcon from '@material-ui/icons/ArrowDropDown';
import CheckIcon from '@material-ui/icons/Check';
import HistoryIcon from '@material-ui/icons/History';
import ChevronRightIcon from '@material-ui/icons/ChevronRight';
import CloseIcon from '@material-ui/icons/Close';
import OpenInNewIcon from '@material-ui/icons/OpenInNew';
import {
  AssistantRuntimeProvider,
  useRemoteThreadListRuntime,
  type AssistantRuntime,
} from '@assistant-ui/react';
import {
  assistantUsePermission,
  REASONING_LEVELS,
  type AssistantSummary,
  type ClientToolAttributes,
  type ModelId,
  type ReasoningLevel,
  type StatusResponse,
} from '@drewswiredin/backstage-plugin-assistants-common';
import { assistantsApiRef, type AssistantsApi } from '../api';
import {
  ClientToolsProvider,
  useClientTools,
} from '../clientTools/ClientToolsProvider';
import { ClientToolRegistrations } from '../clientTools/ClientToolRegistrations';
import type { AssistantClientTool } from '../clientTools/types';
import { ConversationSurface } from '../collapsible/surface';
import { ModelControls } from '../collapsible/surface/ModelControls';
import { AssistantAvatar } from '../collapsible/surface/AssistantAvatar';
import {
  createSingleThreadAdapter,
  type ThreadCustomMetadata,
} from '../collapsible/threadListAdapter';
import { makeRuntimeHook } from '../collapsible/useAssistantRuntime';
import { useThreadStatus } from '../collapsible/useThreadStatus';
import { resolvePanelAssistant } from '../panel/panelStorage';
import type { PanelHandoff } from '../panel/panelControl';
import { derivePageContext } from '../pageContext/pageContext';

/**
 * One conversation outside the Assistants page: the assistant's defaults for
 * model and reasoning, its suggestions and placeholder, no thread list and no
 * pickers. The panel is its first mount.
 *
 * The runtime is the page's (`useRemoteThreadListRuntime` with the same
 * per-thread hook, history adapter, auto-send, resume, and client tool
 * registrations) over a single-thread adapter: the remembered thread or
 * nothing. The first send creates the thread; `onThreadChange` reports its
 * server id so the host can remember it. Remount (change `key`) to start
 * over; a prop change alone never remounts, so a stream is never cut.
 */
export interface EmbeddedAssistantProps {
  /**
   * The user's pick, when still accessible; else the default assistant
   * (`/status`), else the first accessible one.
   */
  assistantId?: string;
  /** The user picked another assistant in the header menu. */
  onAssistantChange: (assistantId: string) => void;
  /** The user picked an earlier conversation from the history menu. */
  onThreadPick: (remoteId: string) => void;
  /**
   * Whether the surface is in view. Only a surface in view focuses its
   * conversation (marking it read); a hidden one leaves a reply that lands
   * unread, so the button and the strip can show it.
   */
  active: boolean;
  /**
   * Only the header's assistant picker and the composer: no conversation,
   * no history, no panel controls. The homepage composer; the first send
   * creates the thread, reported through `onThreadChange`, and the host
   * hands it to the panel.
   */
  composerOnly?: boolean;
  /**
   * With `composerOnly`: no header and a one-row composer (input and send),
   * like a search bar. The assistant is the remembered pick or the default.
   */
  bare?: boolean;
  /** A first message, with its model and effort, sent once ready. */
  handoff?: PanelHandoff;
  /** The handoff went out (the host clears it). */
  onHandoffSent?: () => void;
  /** The conversation to show (a server thread id), or none. */
  threadId?: string;
  /** The conversation's server id once it exists. */
  onThreadChange: (remoteId: string) => void;
  /** The client tools contributed to the app (the same input as the page). */
  clientTools: ReadonlyArray<AssistantClientTool<any, any>>;
  /** "Open in Assistants": the conversation, if any, and its assistant. */
  onOpenFull: (remoteId: string | undefined, assistantId: string) => void;
  /** "+": start a fresh conversation (the host remounts this component). */
  onNew: () => void;
  /** Hide: the host collapses the surface; the conversation is kept. */
  onHide: () => void;
  /** Close: the host removes the surface; the conversation is still remembered. */
  onClose: () => void;
}

/** The assistant picker's fixed width; its menu is the same width. */
const PICKER_WIDTH = 240;

const useStyles = makeStyles(theme => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    backgroundColor: theme.palette.background.paper,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.5, 0.5, 0.5, 1.5),
    borderBottom: `1px solid ${theme.palette.divider}`,
    flexShrink: 0,
  },
  title: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: 600,
  },
  // The assistant name as a menu trigger when there is more than one.
  // A fixed-width picker (a wide header no longer floats the arrow to the
  // far edge); a long name is cut with an ellipsis, and the menu matches.
  picker: {
    flex: '0 0 auto',
    width: PICKER_WIDTH,
    maxWidth: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.5, 0.5, 0.5, 0),
    borderRadius: theme.shape.borderRadius,
    textAlign: 'left',
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
  },
  headerSpacer: {
    flex: 1,
  },
  body: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  // Compact density for a narrow host: full-width messages, tighter padding,
  // a smaller welcome. Everything else is the page's surface unchanged.
  compact: {
    '& .aui-thread-root': {
      '--aui-thread-max-width': '100%',
    },
    '& .aui-thread-viewport': {
      paddingLeft: theme.spacing(1.5),
      paddingRight: theme.spacing(1.5),
    },
    '& .aui-thread-viewport-footer': {
      maxWidth: '100%',
      paddingLeft: theme.spacing(1.5),
      paddingRight: theme.spacing(1.5),
    },
    '& .aui-thread-welcome-root h5': {
      fontSize: theme.typography.h6.fontSize,
    },
  },
  notice: {
    padding: theme.spacing(3, 2),
    textAlign: 'center',
  },
  // Composer only: the thread viewport shows nothing but its footer (the
  // composer), capped at the page's composer width.
  composerOnly: {
    // Beats the compact class's full-width footer: the composer takes most
    // of the card without running edge to edge.
    '& .aui-thread-viewport-footer': {
      maxWidth: '80%',
    },
    '& .aui-thread-viewport': {
      paddingTop: 0,
      justifyContent: 'flex-end',
      overflow: 'hidden',
    },
    '& .aui-thread-viewport > :not(.aui-thread-viewport-footer)': {
      display: 'none',
    },
  },
  hidden: {
    display: 'none',
  },
  // Bare: the composer alone, full width, on whatever it sits on.
  bare: {
    backgroundColor: 'transparent',
    '& .aui-thread-root': {
      backgroundColor: 'transparent',
    },
    '& .aui-thread-viewport': {
      paddingLeft: 0,
      paddingRight: 0,
      justifyContent: 'center',
    },
    '& .aui-thread-viewport-footer': {
      maxWidth: '100%',
      marginTop: 0,
      paddingLeft: 0,
      paddingRight: 0,
      paddingBottom: 0,
    },
  },
}));

/** Bare mode, read by the chrome without threading it through every layer. */
const BareContext = createContext(false);

/** "just now", "5m ago", "3h ago", "2d ago", else the date. */
function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function EmbeddedAssistant(props: EmbeddedAssistantProps) {
  return (
    <BareContext.Provider value={props.bare === true}>
      <EmbeddedAssistantInner {...props} />
    </BareContext.Provider>
  );
}

function EmbeddedAssistantInner(props: EmbeddedAssistantProps) {
  const classes = useStyles();
  const api = useApi(assistantsApiRef);
  const canUse = usePermission({ permission: assistantUsePermission });
  const status = useAsyncRetry(() => api.getStatus(), [api]);

  if (canUse.loading || status.loading) {
    return (
      <div className={classes.root}>
        <LinearProgress />
      </div>
    );
  }
  if (!canUse.allowed) {
    return null;
  }
  if (status.error || !status.value) {
    return (
      <div className={classes.root}>
        <div className={classes.notice}>
          <Typography variant="body2" color="textSecondary" gutterBottom>
            The assistants backend is not reachable.
          </Typography>
          <Button size="small" variant="outlined" onClick={status.retry}>
            Retry
          </Button>
        </div>
      </div>
    );
  }
  const assistants = status.value.assistants;
  const assistant = resolvePanelAssistant(
    assistants,
    props.assistantId,
    status.value.defaultAssistant,
  );
  if (!assistant) {
    return (
      <div className={classes.root}>
        <Typography
          variant="body2"
          color="textSecondary"
          className={classes.notice}
        >
          No assistant is available to you.
        </Typography>
      </div>
    );
  }
  return (
    <ClientToolsProvider
      tools={props.clientTools}
      requireApproval={status.value.requireApproval}
    >
      <EmbeddedChat {...props} status={status.value} assistant={assistant} />
    </ClientToolsProvider>
  );
}

function EmbeddedChat({
  status,
  assistant,
  threadId,
  onThreadChange,
  onOpenFull,
  onNew,
  onHide,
  onClose,
  onAssistantChange,
  onThreadPick,
  active,
  composerOnly,
  handoff,
  onHandoffSent,
}: EmbeddedAssistantProps & {
  status: StatusResponse;
  assistant: AssistantSummary;
}) {
  const classes = useStyles();
  const api = useApi(assistantsApiRef);
  const baseUrl = useAsync(() => api.getBaseUrl(), [api]);

  if (baseUrl.loading) {
    return (
      <div className={classes.root}>
        <LinearProgress />
      </div>
    );
  }
  if (baseUrl.error || !baseUrl.value) {
    return (
      <div className={classes.root}>
        <Typography
          variant="body2"
          color="textSecondary"
          className={classes.notice}
        >
          The assistants backend is not reachable.
        </Typography>
      </div>
    );
  }
  return (
    <EmbeddedRuntime
      api={api}
      baseUrl={baseUrl.value}
      status={status}
      assistant={assistant}
      initialThreadId={threadId}
      onThreadChange={onThreadChange}
      onOpenFull={onOpenFull}
      onNew={onNew}
      onHide={onHide}
      onClose={onClose}
      onAssistantChange={onAssistantChange}
      onThreadPick={onThreadPick}
      active={active}
      composerOnly={composerOnly}
      handoff={handoff}
      onHandoffSent={onHandoffSent}
    />
  );
}

function EmbeddedRuntime({
  api,
  baseUrl,
  status,
  assistant,
  initialThreadId,
  onThreadChange,
  onOpenFull,
  onNew,
  onHide,
  onClose,
  onAssistantChange,
  onThreadPick,
  active,
  composerOnly,
  handoff,
  onHandoffSent,
}: {
  api: AssistantsApi;
  baseUrl: string;
  status: StatusResponse;
  assistant: AssistantSummary;
  initialThreadId: string | undefined;
  onThreadChange: (remoteId: string) => void;
  onOpenFull: (remoteId: string | undefined, assistantId: string) => void;
  onNew: () => void;
  onHide: () => void;
  onClose: () => void;
  onAssistantChange: (assistantId: string) => void;
  onThreadPick: (remoteId: string) => void;
  active: boolean;
  composerOnly?: boolean;
  handoff?: PanelHandoff;
  onHandoffSent?: () => void;
}) {
  // The assistant's default when the pool still offers it, else the
  // platform default (an assistant can outlive a model it was given).
  const defaultModel =
    assistant.defaultModel &&
    status.models.some(m => m.id === assistant.defaultModel)
      ? assistant.defaultModel
      : status.defaultModel;

  // The thread this mount shows: the remembered one (listed by id) until the
  // first send creates one. Read live by the adapter, so no remount.
  const remoteIdRef = useRef<string | undefined>(initialThreadId);
  const assistantIdRef = useRef<string>(assistant.id);
  assistantIdRef.current = assistant.id;
  // A handed-in model and effort (the homepage composer's picks) start the
  // conversation; otherwise the assistant's default and the provider default.
  const handoffModel =
    handoff?.modelId &&
    (assistant.models ?? status.models.map(m => m.id)).includes(handoff.modelId)
      ? handoff.modelId
      : undefined;
  const modelIdRef = useRef<ModelId>(handoffModel ?? defaultModel);
  const reasoningLevelRef = useRef<ReasoningLevel | undefined>(
    handoffModel ? handoff?.reasoningLevel : undefined,
  );
  // The page beside the surface, read live by the transport on each send.
  const { pathname } = useLocation();
  const pageContextRef = useRef(derivePageContext(pathname, document.title));
  pageContextRef.current = derivePageContext(pathname, document.title);

  const adapter = useMemo(
    () =>
      createSingleThreadAdapter(
        api,
        () => assistantIdRef.current,
        () => remoteIdRef.current,
      ),
    [api],
  );
  const { tools: clientTools } = useClientTools();
  const clientToolAttributesRef = useRef<Record<string, ClientToolAttributes>>(
    {},
  );
  clientToolAttributesRef.current = Object.fromEntries(
    clientTools.map(t => [t.name, t.attributes]),
  );
  const runtimeHook = useMemo(
    () =>
      makeRuntimeHook({
        api,
        baseUrl,
        getActiveAssistantId: () => assistantIdRef.current,
        modelIdRef,
        reasoningLevelRef,
        getClientToolAttributes: () => clientToolAttributesRef.current,
        getPageContext: () => pageContextRef.current,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, baseUrl],
  );
  const runtime = useRemoteThreadListRuntime({ adapter, runtimeHook });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ClientToolRegistrations />
      <EmbeddedChrome
        runtime={runtime}
        api={api}
        status={status}
        assistant={assistant}
        defaultModel={defaultModel}
        remoteIdRef={remoteIdRef}
        modelIdRef={modelIdRef}
        reasoningLevelRef={reasoningLevelRef}
        onThreadChange={onThreadChange}
        onOpenFull={onOpenFull}
        onNew={onNew}
        onHide={onHide}
        onClose={onClose}
        onAssistantChange={onAssistantChange}
        onThreadPick={onThreadPick}
        active={active}
        composerOnly={composerOnly}
        handoff={handoff}
        onHandoffSent={onHandoffSent}
      />
    </AssistantRuntimeProvider>
  );
}

function EmbeddedChrome({
  runtime,
  api,
  status,
  assistant,
  defaultModel,
  remoteIdRef,
  modelIdRef,
  reasoningLevelRef,
  onThreadChange,
  onOpenFull,
  onNew,
  onHide,
  onClose,
  onAssistantChange,
  onThreadPick,
  active,
  composerOnly,
  handoff,
  onHandoffSent,
}: {
  runtime: AssistantRuntime;
  api: AssistantsApi;
  status: StatusResponse;
  assistant: AssistantSummary;
  defaultModel: ModelId;
  remoteIdRef: React.MutableRefObject<string | undefined>;
  modelIdRef: React.MutableRefObject<ModelId>;
  reasoningLevelRef: React.MutableRefObject<ReasoningLevel | undefined>;
  onThreadChange: (remoteId: string) => void;
  onOpenFull: (remoteId: string | undefined, assistantId: string) => void;
  onNew: () => void;
  onHide: () => void;
  onClose: () => void;
  onAssistantChange: (assistantId: string) => void;
  onThreadPick: (remoteId: string) => void;
  active: boolean;
  composerOnly?: boolean;
  handoff?: PanelHandoff;
  onHandoffSent?: () => void;
}) {
  const classes = useStyles();
  const bare = useContext(BareContext);
  // The assistant picker, offered only when there is a choice.
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  const canPick = status.assistants.length > 1;

  // The runtime's view of the one thread: its server id (set by the first
  // send, or the remembered one once listed) and its saved model.
  const [remoteId, setRemoteId] = useState<string | undefined>(
    remoteIdRef.current,
  );
  // The model and effort for this conversation: the thread's saved choice,
  // else the assistant's default; changed from the composer and PATCHed.
  const allowedModels = useMemo<ModelId[]>(
    () => assistant.models ?? status.models.map(m => m.id),
    [assistant.models, status.models],
  );
  const [modelId, setModelId] = useState<ModelId>(modelIdRef.current);
  const [reasoningLevel, setReasoningLevel] = useState<
    ReasoningLevel | undefined
  >(reasoningLevelRef.current);
  const reasons = (id: ModelId) =>
    status.models.find(m => m.id === id)?.reasoning === true;
  const handleModelChange = (next: ModelId) => {
    setModelId(next);
    modelIdRef.current = next;
    const level = reasons(next) ? reasoningLevelRef.current : undefined;
    setReasoningLevel(level);
    reasoningLevelRef.current = level;
    if (remoteIdRef.current) {
      void api.patchThread(remoteIdRef.current, {
        model: next,
        reasoningLevel: level ?? null,
      });
    }
  };
  const handleReasoningChange = (level: ReasoningLevel | undefined) => {
    setReasoningLevel(level);
    reasoningLevelRef.current = level;
    if (remoteIdRef.current) {
      void api.patchThread(remoteIdRef.current, {
        reasoningLevel: level ?? null,
      });
    }
  };
  const didSelect = useRef(false);
  const adopted = useRef(false);
  useEffect(() => {
    const sync = () => {
      const state = runtime.threads.getState();
      // The remembered thread lists as the only item; select it once loaded
      // (the runtime starts on a blank new thread).
      if (!didSelect.current && !state.isLoading) {
        didSelect.current = true;
        const existing = [...state.threadIds, ...state.archivedThreadIds][0];
        if (existing && state.mainThreadId === state.newThreadId) {
          void runtime.threads.switchToThread(existing);
          return;
        }
      }
      const item = state.threadItems[state.mainThreadId];
      const custom = item?.custom as Partial<ThreadCustomMetadata> | undefined;
      // Adopt the thread's saved model and effort once it is listed.
      if (custom?.model !== undefined && !adopted.current) {
        adopted.current = true;
        const model =
          custom.model && allowedModels.includes(custom.model)
            ? custom.model
            : defaultModel;
        const level =
          custom.reasoningLevel &&
          reasons(model) &&
          REASONING_LEVELS.includes(custom.reasoningLevel as ReasoningLevel)
            ? (custom.reasoningLevel as ReasoningLevel)
            : undefined;
        modelIdRef.current = model;
        reasoningLevelRef.current = level;
        setModelId(model);
        setReasoningLevel(level);
      }
      const id = item?.remoteId;
      if (id && id !== remoteIdRef.current) {
        remoteIdRef.current = id;
        setRemoteId(id);
        onThreadChange(id);
      }
    };
    sync();
    return runtime.threads.subscribe(sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime]);

  // Earlier conversations with this assistant, fetched when the menu opens.
  const [historyAnchor, setHistoryAnchor] = useState<HTMLElement | null>(null);
  const history = useAsync(async () => {
    if (!historyAnchor) return undefined;
    const data = await api.requestJson<{
      threads: Array<{ id: string; title: string; updatedAt: string }>;
    }>(`/threads?assistantId=${encodeURIComponent(assistant.id)}`);
    return (data.threads ?? []).slice(0, 10);
  }, [historyAnchor, api, assistant.id]);

  // Focus (which marks the conversation read) only while in view.
  const { usageOf } = useThreadStatus(api, active ? remoteId : undefined);

  // A handed-in first message goes out once the thread list has loaded (so
  // the runtime is on its fresh thread), exactly once.
  const sentInitial = useRef(false);
  useEffect(() => {
    if (!handoff || sentInitial.current) return undefined;
    const trySend = () => {
      if (runtime.threads.getState().isLoading) return false;
      sentInitial.current = true;
      runtime.thread.append(handoff.prompt);
      onHandoffSent?.();
      return true;
    };
    if (trySend()) return undefined;
    return runtime.threads.subscribe(() => {
      if (!sentInitial.current) trySend();
    });
  }, [handoff, runtime, onHandoffSent]);

  return (
    <div
      className={`${classes.root} ${composerOnly ? classes.composerOnly : ''} ${
        bare ? classes.bare : ''
      }`}
    >
      <div className={`${classes.header} ${bare ? classes.hidden : ''}`}>
        {canPick ? (
          <>
            <ButtonBase
              className={classes.picker}
              onClick={e => setPickerAnchor(e.currentTarget)}
              aria-haspopup="menu"
              aria-label={`Assistant: ${assistant.title}. Choose another`}
            >
              <AssistantAvatar color={assistant.color} size={24} />
              <Typography variant="subtitle2" className={classes.title}>
                {assistant.title}
              </Typography>
              <ArrowDropDownIcon fontSize="small" color="action" />
            </ButtonBase>
            <span className={classes.headerSpacer} />
            <Menu
              anchorEl={pickerAnchor}
              open={pickerAnchor !== null}
              onClose={() => setPickerAnchor(null)}
              getContentAnchorEl={null}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
              PaperProps={{
                style: { width: pickerAnchor?.offsetWidth ?? PICKER_WIDTH },
              }}
            >
              {status.assistants.map(a => (
                <MenuItem
                  key={a.id}
                  selected={a.id === assistant.id}
                  onClick={() => {
                    setPickerAnchor(null);
                    if (a.id !== assistant.id) onAssistantChange(a.id);
                  }}
                >
                  <ListItemIcon>
                    <AssistantAvatar color={a.color} size={22} />
                  </ListItemIcon>
                  <ListItemText
                    primary={a.title}
                    secondary={a.isDefault ? 'Default' : undefined}
                  />
                  {a.id === assistant.id && (
                    <CheckIcon fontSize="small" color="action" />
                  )}
                </MenuItem>
              ))}
            </Menu>
          </>
        ) : (
          <>
            <AssistantAvatar color={assistant.color} size={24} />
            <Typography variant="subtitle2" className={classes.title}>
              {assistant.title}
            </Typography>
            <span className={classes.headerSpacer} />
          </>
        )}
        {!composerOnly && remoteId && (
          <Tooltip title="New chat">
            <IconButton size="small" onClick={onNew} aria-label="New chat">
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {!composerOnly && (
          <Tooltip title="Earlier conversations">
            <IconButton
              size="small"
              onClick={e => setHistoryAnchor(e.currentTarget)}
              aria-label="Earlier conversations"
              aria-haspopup="menu"
            >
              <HistoryIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Menu
          anchorEl={historyAnchor}
          open={historyAnchor !== null}
          onClose={() => setHistoryAnchor(null)}
          getContentAnchorEl={null}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          {history.loading && (
            <MenuItem disabled>
              <ListItemText primary="Loading…" />
            </MenuItem>
          )}
          {history.value?.length === 0 && (
            <MenuItem disabled>
              <ListItemText primary="No earlier conversations" />
            </MenuItem>
          )}
          {history.value?.map(t => (
            <MenuItem
              key={t.id}
              selected={t.id === remoteId}
              onClick={() => {
                setHistoryAnchor(null);
                if (t.id !== remoteId) onThreadPick(t.id);
              }}
            >
              <ListItemText
                primary={t.title}
                secondary={relativeTime(t.updatedAt)}
                primaryTypographyProps={{ noWrap: true }}
              />
            </MenuItem>
          ))}
        </Menu>
        {!composerOnly && (
          <>
            <Tooltip title="Open in Assistants">
              <IconButton
                size="small"
                onClick={() => onOpenFull(remoteId, assistant.id)}
                aria-label="Open in Assistants"
              >
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Hide (Esc). Your chat is kept.">
              <IconButton size="small" onClick={onHide} aria-label="Hide">
                <ChevronRightIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Close the panel. Your chat is kept.">
              <IconButton size="small" onClick={onClose} aria-label="Close">
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
      </div>
      <div className={classes.body}>
        <ConversationSurface
          className={classes.compact}
          composerMinimal={bare}
          composerPlaceholder={assistant.ui?.composer?.placeholder}
          suggestions={assistant.ui?.suggestions}
          welcome={{
            title: `Ask ${assistant.title}`,
            subtitle: assistant.description,
          }}
          assistantColor={assistant.color}
          contextWindow={
            status.models.find(m => m.id === modelId)?.contextWindow
          }
          usedTokens={usageOf(remoteId)}
          composerControls={
            <ModelControls
              pool={status.models}
              allowed={allowedModels}
              modelId={modelId}
              defaultModel={defaultModel}
              onModelChange={handleModelChange}
              reasoningLevel={reasoningLevel}
              onReasoningChange={handleReasoningChange}
            />
          }
        />
      </div>
    </div>
  );
}
