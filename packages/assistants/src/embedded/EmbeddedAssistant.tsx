// The vendored react-ui Thread CSS, imported at the top of this chunk for the
// same reason as on the page: react-ui ships `sideEffects: false`, so a bare
// package CSS import would be tree-shaken out of a lazy chunk.
import '../collapsible/surface/styles/assistant-ui.css';
import '../collapsible/surface/styles/assistant-ui-markdown.css';

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { AssistantAvatar } from '../collapsible/surface/AssistantAvatar';
import {
  createSingleThreadAdapter,
  type ThreadCustomMetadata,
} from '../collapsible/threadListAdapter';
import { makeRuntimeHook } from '../collapsible/useAssistantRuntime';
import { useThreadStatus } from '../collapsible/useThreadStatus';
import { resolvePanelAssistant } from '../panel/panelStorage';
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
  picker: {
    flex: 1,
    minWidth: 0,
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
}));

export function EmbeddedAssistant(props: EmbeddedAssistantProps) {
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
  const modelIdRef = useRef<ModelId>(defaultModel);
  // No reasoning control here: the provider default applies.
  const reasoningLevelRef = useRef<ReasoningLevel | undefined>(undefined);
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
        onThreadChange={onThreadChange}
        onOpenFull={onOpenFull}
        onNew={onNew}
        onHide={onHide}
        onClose={onClose}
        onAssistantChange={onAssistantChange}
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
  onThreadChange,
  onOpenFull,
  onNew,
  onHide,
  onClose,
  onAssistantChange,
}: {
  runtime: AssistantRuntime;
  api: AssistantsApi;
  status: StatusResponse;
  assistant: AssistantSummary;
  defaultModel: ModelId;
  remoteIdRef: React.MutableRefObject<string | undefined>;
  modelIdRef: React.MutableRefObject<ModelId>;
  onThreadChange: (remoteId: string) => void;
  onOpenFull: (remoteId: string | undefined, assistantId: string) => void;
  onNew: () => void;
  onHide: () => void;
  onClose: () => void;
  onAssistantChange: (assistantId: string) => void;
}) {
  const classes = useStyles();
  // The assistant picker, offered only when there is a choice.
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  const canPick = status.assistants.length > 1;

  // The runtime's view of the one thread: its server id (set by the first
  // send, or the remembered one once listed) and its saved model.
  const [remoteId, setRemoteId] = useState<string | undefined>(
    remoteIdRef.current,
  );
  const didSelect = useRef(false);
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
      const allowed = assistant.models ?? status.models.map(m => m.id);
      modelIdRef.current =
        custom?.model && allowed.includes(custom.model)
          ? custom.model
          : defaultModel;
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

  const { usageOf } = useThreadStatus(api, remoteId);

  return (
    <div className={classes.root}>
      <div className={classes.header}>
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
            <Menu
              anchorEl={pickerAnchor}
              open={pickerAnchor !== null}
              onClose={() => setPickerAnchor(null)}
              getContentAnchorEl={null}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
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
          </>
        )}
        {remoteId && (
          <Tooltip title="New chat">
            <IconButton size="small" onClick={onNew} aria-label="New chat">
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
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
      </div>
      <div className={classes.body}>
        <ConversationSurface
          className={classes.compact}
          composerPlaceholder={assistant.ui?.composer?.placeholder}
          suggestions={assistant.ui?.suggestions}
          welcome={{
            title: `Ask ${assistant.title}`,
            subtitle: assistant.description,
          }}
          assistantColor={assistant.color}
          contextWindow={
            status.models.find(m => m.id === modelIdRef.current)?.contextWindow
          }
          usedTokens={usageOf(remoteId)}
        />
      </div>
    </div>
  );
}
