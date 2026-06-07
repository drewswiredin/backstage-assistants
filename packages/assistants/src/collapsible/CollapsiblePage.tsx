// Vendored react-ui Thread CSS. Imported at the TOP of this page entry so it
// bundles into this page's lazy chunk: react-ui ships `sideEffects: false`, so
// a bare `@assistant-ui/react-ui` CSS import gets tree-shaken and the Thread
// renders unstyled. These local copies are not subject to that.
import './surface/styles/assistant-ui.css';
import './surface/styles/assistant-ui-markdown.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import useAsync from 'react-use/lib/useAsync';
import { useApi } from '@backstage/core-plugin-api';
import { Content, Progress, ResponseErrorPanel } from '@backstage/core-components';
import { makeStyles } from '@material-ui/core/styles';
import {
  Button,
  FormControl,
  IconButton,
  ListItemIcon,
  ListSubheader,
  MenuItem,
  Select,
  Tooltip,
  Typography,
} from '@material-ui/core';
import AddIcon from '@material-ui/icons/Add';
import ChatBubbleOutlineIcon from '@material-ui/icons/ChatBubbleOutline';
import CheckIcon from '@material-ui/icons/Check';
import ChevronRightIcon from '@material-ui/icons/ChevronRight';
import StarIcon from '@material-ui/icons/Star';
import {
  AssistantRuntimeProvider,
  useAssistantRuntime,
  useRemoteThreadListRuntime,
  type ThreadListState,
} from '@assistant-ui/react';
import type {
  AssistantSummary,
  ModelId,
  ModelOption,
  StatusResponse,
} from '@drewswiredin/backstage-plugin-assistants-common';
import { assistantsApiRef, type AssistantsApi } from '../api';
import { ConversationSurface } from './surface';
import { AssistantAvatar } from './surface/AssistantAvatar';
import { SidePane } from './SidePane';
import { FullHeightRegion } from './FullHeightRegion';
import {
  createThreadListAdapter,
  patchThread,
  type ThreadCustomMetadata,
  type ThreadSummary,
} from './threadListAdapter';
import { signalApiRef } from '@backstage/plugin-signals-react';
import type { JsonObject } from '@backstage/types';
import { makeRuntimeHook } from './useAssistantRuntime';
import { StatusDot } from './StatusDot';
import {
  useThreadStatus,
  toConvStatus,
  type ConvStatus,
} from './useThreadStatus';

const SIDEPANE_COLLAPSED_KEY = 'ai-chat-sidepane-collapsed';

function loadSidePaneCollapsed() {
  try {
    return localStorage.getItem(SIDEPANE_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

const useStyles = makeStyles(theme => ({
  content: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  shell: {
    display: 'flex',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    backgroundColor: theme.palette.background.default,
    paddingTop: 0,
    paddingRight: theme.spacing(1),
    paddingBottom: theme.spacing(1),
    paddingLeft: 0,
    gap: theme.spacing(1),
  },
  sidePane: {
    width: 320,
    flexShrink: 0,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  sidePaneRail: {
    width: 56,
    flexShrink: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    paddingBottom: theme.spacing(0.5),
    borderRight: `1px solid ${theme.palette.divider}`,
    overflow: 'hidden',
  },
  sidePaneRailHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    minHeight: 44,
    flexShrink: 0,
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  sidePaneRailAssistants: {
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    paddingTop: theme.spacing(0.75),
  },
  sidePaneRailDivider: {
    flexShrink: 0,
    width: 24,
    borderTop: `1px solid ${theme.palette.divider}`,
    margin: theme.spacing(0.75, 0),
  },
  sidePaneRailControls: {
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    paddingBottom: theme.spacing(1),
  },
  sidePaneRailChats: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  sidePaneRailButton: {
    color: theme.palette.text.secondary,
  },
  sidePaneRailButtonActive: {
    color: theme.palette.primary.main,
    backgroundColor: theme.palette.action.selected,
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
  },
  threadPane: {
    display: 'flex',
    flex: 1,
    flexDirection: 'column',
    minWidth: 0,
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    boxShadow: theme.shadows[1],
    overflow: 'hidden',
  },
  threadHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    minHeight: 36,
    padding: theme.spacing(0, 2),
    backgroundColor: theme.palette.background.paper,
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  threadIdentity: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    minWidth: 0,
    flex: 1,
  },
  assistantName: {
    fontWeight: 600,
    color: theme.palette.text.primary,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  threadTitle: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: theme.palette.text.secondary,
  },
  modelSelect: {
    fontSize: theme.typography.caption.fontSize,
    color: theme.palette.text.secondary,
    borderRadius: 999,
    transition: theme.transitions.create('background-color'),
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
    '& .MuiSelect-select': {
      display: 'flex',
      alignItems: 'center',
      borderRadius: 999,
      paddingTop: theme.spacing(0.5),
      paddingBottom: theme.spacing(0.5),
      paddingLeft: theme.spacing(1.25),
      paddingRight: theme.spacing(3),
      '&:focus': {
        backgroundColor: 'transparent',
        borderRadius: 999,
      },
    },
    '& .MuiSelect-icon': {
      color: theme.palette.text.secondary,
      right: theme.spacing(0.5),
    },
  },
  modelGroupLabel: {
    lineHeight: 2,
    fontSize: theme.typography.caption.fontSize,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: theme.palette.text.secondary,
    backgroundColor: theme.palette.background.paper,
  },
  modelItem: {
    paddingTop: theme.spacing(0.75),
    paddingBottom: theme.spacing(0.75),
  },
  modelItemCheck: {
    minWidth: theme.spacing(3.5),
    color: theme.palette.primary.main,
  },
  modelDefaultStar: {
    fontSize: '1rem',
    color: theme.palette.warning.main,
    marginLeft: theme.spacing(1),
  },
  threadBody: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  // Bare-agent empty state (no conversation selected; new chats are "+"-only).
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(1),
    height: '100%',
    textAlign: 'center',
    color: theme.palette.text.secondary,
    padding: theme.spacing(3),
  },
  emptyTitle: {
    fontWeight: 600,
    color: theme.palette.text.primary,
  },
  emptyButton: {
    marginTop: theme.spacing(1),
  },
}));

/**
 * Split a model id into a display vendor + name. Our models route through one
 * provider (e.g. `openrouter`) but the meaningful family is the vendor prefix in
 * the model name (`google/gemini-2.5-flash`). Falls back to the provider / raw
 * id when there's no `/`.
 */
function splitModel(
  id: ModelId,
  pool: ModelOption[],
): { vendor: string; name: string } {
  const opt = pool.find(m => m.id === id);
  const raw = opt?.model ?? id;
  const slash = raw.indexOf('/');
  if (slash !== -1) {
    return { vendor: raw.slice(0, slash), name: raw.slice(slash + 1) };
  }
  return { vendor: opt?.provider ?? 'models', name: raw };
}

/** The short model name (after the vendor prefix), for the selector trigger. */
function modelLabel(id: ModelId, pool: ModelOption[]): string {
  return splitModel(id, pool).name;
}

// ---------------------------------------------------------------------------
// Page entry
// ---------------------------------------------------------------------------

/**
 * The collapsible AI chat page. Reads the target assistant from
 * `?assistant=<id>` (the assistant rail lives in the Backstage nav), loads
 * `/status`, and renders the conversation experience for the chosen assistant.
 * Conversations persist server-side (see ADR-free architecture: docs/architecture.html).
 *
 * @public
 */
export function CollapsiblePage() {
  const api = useApi(assistantsApiRef);
  const [searchParams] = useSearchParams();
  const requestedAssistant = searchParams.get('assistant');

  const status = useAsync(() => api.getStatus(), [api]);

  if (status.loading) {
    return <Progress />;
  }
  if (status.error) {
    return <ResponseErrorPanel error={status.error} />;
  }
  if (!status.value) {
    return null;
  }
  const assistants = status.value.assistants;
  if (assistants.length === 0) {
    return (
      <ResponseErrorPanel
        error={new Error('No assistants are available to you.')}
      />
    );
  }
  // The active agent is UI state, NOT a remount key: one runtime carries every
  // conversation across all agents (see ChatRuntime). `?assistant=` only seeds
  // the initially-focused agent.
  const initialAssistantId =
    assistants.find(a => a.id === requestedAssistant)?.id ?? assistants[0].id;
  return (
    <CollapsibleChat
      status={status.value}
      initialAssistantId={initialAssistantId}
    />
  );
}

/** The id of an agent's most-recently-updated conversation, or undefined if none. */
function mostRecentThreadFor(
  assistantId: string,
  threadList: ThreadListState,
): string | undefined {
  const updatedAt = (id: string) =>
    (threadList.threadItems[id]?.custom as Partial<ThreadCustomMetadata> | undefined)
      ?.updatedAt ?? '';
  return [...threadList.threadIds]
    .filter(
      id =>
        (threadList.threadItems[id]?.custom as
          | Partial<ThreadCustomMetadata>
          | undefined)?.assistantId === assistantId,
    )
    .sort((a, b) => (updatedAt(a) < updatedAt(b) ? 1 : -1))[0];
}

// ---------------------------------------------------------------------------
// Resolve the backend base URL, then build the runtime
// ---------------------------------------------------------------------------

function CollapsibleChat({
  status,
  initialAssistantId,
}: {
  status: StatusResponse;
  initialAssistantId: string;
}) {
  const api = useApi(assistantsApiRef);
  const baseUrl = useAsync(() => api.getBaseUrl(), [api]);

  if (baseUrl.loading) {
    return <Progress />;
  }
  if (baseUrl.error || !baseUrl.value) {
    return (
      <ResponseErrorPanel
        error={baseUrl.error ?? new Error('Failed to resolve backend URL')}
      />
    );
  }
  return (
    <ChatRuntime
      status={status}
      api={api}
      baseUrl={baseUrl.value}
      initialAssistantId={initialAssistantId}
    />
  );
}

function ChatRuntime({
  status,
  api,
  baseUrl,
  initialAssistantId,
}: {
  status: StatusResponse;
  api: AssistantsApi;
  baseUrl: string;
  initialAssistantId: string;
}) {
  // ONE runtime for the whole tab carrying every conversation across all agents.
  // The active agent is a live ref the adapter/runtime read when creating or
  // tagging a new thread — so switching agent or conversation never mounts or
  // unmounts a runtime (no remount churn, no stream loss).
  const activeAssistantIdRef = useRef<string>(initialAssistantId);
  // Drives the transport body; updated by the model picker + on thread switch.
  const modelIdRef = useRef<ModelId>(status.defaultModel);

  const adapter = useMemo(
    () => createThreadListAdapter(api, () => activeAssistantIdRef.current),
    [api],
  );
  const runtimeHook = useMemo(
    () =>
      makeRuntimeHook({
        api,
        baseUrl,
        getActiveAssistantId: () => activeAssistantIdRef.current,
        modelIdRef,
      }),
    [api, baseUrl],
  );
  const runtime = useRemoteThreadListRuntime({ adapter, runtimeHook });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatChrome
        status={status}
        api={api}
        modelIdRef={modelIdRef}
        activeAssistantIdRef={activeAssistantIdRef}
        initialAssistantId={initialAssistantId}
      />
    </AssistantRuntimeProvider>
  );
}

// ---------------------------------------------------------------------------
// Chrome (inside the runtime provider) — pure view of server thread state
// ---------------------------------------------------------------------------

function ChatChrome({
  status,
  api,
  modelIdRef,
  activeAssistantIdRef,
  initialAssistantId,
}: {
  status: StatusResponse;
  api: AssistantsApi;
  modelIdRef: React.MutableRefObject<ModelId>;
  activeAssistantIdRef: React.MutableRefObject<string>;
  initialAssistantId: string;
}) {
  const classes = useStyles();
  const runtime = useAssistantRuntime();
  const signals = useApi(signalApiRef);
  const [, setSearchParams] = useSearchParams();

  // Active agent: UI state, with a ref mirror so the adapter/runtime can tag a
  // brand-new thread synchronously (before React re-renders). The active
  // conversation always belongs to this agent (the list is filtered by it).
  const [activeAssistantId, setActiveAssistantIdState] = useState(
    initialAssistantId,
  );
  const setActiveAssistantId = useCallback(
    (id: string) => {
      activeAssistantIdRef.current = id;
      setActiveAssistantIdState(id);
    },
    [activeAssistantIdRef],
  );
  const assistant = useMemo(
    () =>
      status.assistants.find(a => a.id === activeAssistantId) ??
      status.assistants[0],
    [status.assistants, activeAssistantId],
  );
  const defaultModel = assistant.defaultModel ?? status.defaultModel;

  // Reactive snapshot of the server-backed thread list.
  const [threadList, setThreadList] = useState<ThreadListState>(() =>
    runtime.threads.getState(),
  );
  useEffect(() => {
    setThreadList(runtime.threads.getState());
    return runtime.threads.subscribe(() =>
      setThreadList(runtime.threads.getState()),
    );
  }, [runtime]);

  const activeId = threadList.mainThreadId;
  const activeItem = threadList.threadItems[activeId];
  const activeRemoteId = activeItem?.remoteId;
  const activeTitle = activeItem?.title ?? '';
  // A bare agent with no conversation: the blank, uninitialized draft slot. New
  // chats are created only via "+", so we show an empty state here (no composer)
  // instead of a chat box — removing the ambiguous "type to start" path.
  const isBlankDraft = activeId === threadList.newThreadId && !activeRemoteId;

  // Single source of truth for read/working/unread, derived from server + signals.
  const { statusOf, agentStatus } = useThreadStatus(api, activeRemoteId);

  // On first load for this agent (the component is keyed by assistant.id), land
  // on the agent's MOST RECENT conversation. The runtime defaults the main thread
  // to a blank "new thread"; we switch off it to the latest existing conversation
  // so selecting an agent shows a conversation, never a bare agent. An agent with
  // no conversations stays on the unpersisted draft (the only no-"+" empty state).
  // A new conversation is created ONLY via "+", never by typing.
  const didSelectInitial = useRef(false);
  useEffect(() => {
    if (didSelectInitial.current || threadList.isLoading) return;
    didSelectInitial.current = true;
    // Land on the active agent's most-recent conversation; if it has none, stay
    // on the blank draft (never empty). Don't override a user pick.
    if (activeId !== threadList.newThreadId) return;
    const mostRecent = mostRecentThreadFor(
      activeAssistantIdRef.current,
      threadList,
    );
    if (mostRecent) void runtime.threads.switchToThread(mostRecent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadList.isLoading]);

  const conversations = useMemo<ThreadSummary[]>(
    () =>
      threadList.threadIds
        .filter(id => {
          // The conversation you're viewing always shows; other blank drafts
          // don't; the rest are filtered to the active agent. A just-sent thread
          // has no assistantId metadata until the next reload, but it's the
          // active thread, so it stays visible via the first clause.
          if (id === activeId) return true;
          if (id === threadList.newThreadId) return false;
          const aid = (
            threadList.threadItems[id]?.custom as
              | Partial<ThreadCustomMetadata>
              | undefined
          )?.assistantId;
          return aid === activeAssistantId;
        })
        .map(id => {
          const item = threadList.threadItems[id];
          const custom = item?.custom as Partial<ThreadCustomMetadata> | undefined;
          // Every dot derives from the single status snapshot. `working` shows
          // even for the focused conversation; `unread` is suppressed for it.
          const st: ConvStatus = statusOf(item?.remoteId);
          return {
            id,
            remoteId: item?.remoteId,
            title: item?.title ?? 'New Chat',
            pinned: custom?.pinned ?? false,
            unread: st === 'unread',
            working: st === 'working',
          };
        }),
    [threadList, statusOf, activeAssistantId, activeId],
  );

  // Refresh the thread list ONLY on metadata changes (a generated title), never
  // mid-turn: reloading re-keys an in-flight new thread (localId → remoteId) and
  // would break its stream. The 'updated' signal fires after a turn completes.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sub = signals.subscribe('assistants:threads', (msg: JsonObject) => {
      if ((msg as { type?: string }).type !== 'updated') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void runtime.threads.reload(), 150);
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.unsubscribe();
    };
  }, [signals, runtime]);

  // Model picker: limited to the assistant's allowlist (else the global pool).
  const allowedModels = useMemo<ModelId[]>(
    () => assistant.models ?? status.models.map(m => m.id),
    [assistant.models, status.models],
  );
  const modelGroups = useMemo<Array<[string, ModelId[]]>>(() => {
    const byVendor = new Map<string, ModelId[]>();
    for (const id of allowedModels) {
      const { vendor } = splitModel(id, status.models);
      const list = byVendor.get(vendor);
      if (list) list.push(id);
      else byVendor.set(vendor, [id]);
    }
    return [...byVendor.entries()];
  }, [allowedModels, status.models]);
  const resolveModel = useCallback(
    (stored: string | null | undefined): ModelId =>
      stored && allowedModels.includes(stored) ? stored : defaultModel,
    [allowedModels, defaultModel],
  );

  const [modelId, setModelId] = useState<ModelId>(() =>
    resolveModel((activeItem?.custom as Partial<ThreadCustomMetadata> | undefined)?.model),
  );

  // Adopt the active thread's saved model on switch (keyed on the active id only).
  useEffect(() => {
    const stored = (
      threadList.threadItems[activeId]?.custom as
        | Partial<ThreadCustomMetadata>
        | undefined
    )?.model;
    const next = resolveModel(stored);
    setModelId(next);
    modelIdRef.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const [sidePaneCollapsed, setSidePaneCollapsed] = useState(loadSidePaneCollapsed);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEPANE_COLLAPSED_KEY, String(sidePaneCollapsed));
    } catch {
      // storage unavailable
    }
  }, [sidePaneCollapsed]);

  const handleSelectAssistant = useCallback(
    (id: string) => {
      if (id === activeAssistantId) return;
      setActiveAssistantId(id);
      setSearchParams({ assistant: id }); // deep-link / survive refresh
      // Land on that agent's most-recent conversation, else a fresh draft.
      const mostRecent = mostRecentThreadFor(id, threadList);
      if (mostRecent) void runtime.threads.switchToThread(mostRecent);
      else void runtime.threads.switchToNewThread();
    },
    [activeAssistantId, setActiveAssistantId, setSearchParams, threadList, runtime],
  );

  const handleNew = useCallback(() => {
    void (async () => {
      await runtime.threads.switchToNewThread();
      try {
        await runtime.threads.mainItem.initialize();
        await runtime.threads.reload();
      } catch {
        // already initialized; safe to ignore
      }
    })();
  }, [runtime]);

  const handleSelect = useCallback(
    (id: string | null) => {
      if (id) void runtime.threads.switchToThread(id);
    },
    [runtime],
  );

  const handleRename = useCallback(
    (id: string, title: string) => {
      void (async () => {
        await runtime.threads.getItemById(id).rename(title);
        await runtime.threads.reload();
      })();
    },
    [runtime],
  );

  const handleDelete = useCallback(
    (id: string) => {
      void (async () => {
        const wasActive = id === activeId;
        await runtime.threads.getItemById(id).delete();
        await runtime.threads.reload();
        if (!wasActive) return; // deleting a background chat doesn't move you
        // Land somewhere valid: the agent's most-recent remaining chat, else the
        // empty state (same as a first visit). No conversation is auto-created.
        const remaining = mostRecentThreadFor(
          activeAssistantIdRef.current,
          runtime.threads.getState(),
        );
        if (remaining) await runtime.threads.switchToThread(remaining);
        else await runtime.threads.switchToNewThread();
      })();
    },
    [runtime, activeId, activeAssistantIdRef],
  );

  const handlePin = useCallback(
    async (id: string) => {
      const item = threadList.threadItems[id];
      if (!item?.remoteId) return;
      const pinned =
        (item.custom as Partial<ThreadCustomMetadata> | undefined)?.pinned ??
        false;
      try {
        await patchThread(api, item.remoteId, { pinned: !pinned });
        await runtime.threads.reload();
      } catch {
        // best-effort
      }
    },
    [api, runtime, threadList],
  );

  const handleModelChange = useCallback(
    (next: ModelId) => {
      setModelId(next);
      modelIdRef.current = next;
      if (activeRemoteId) {
        void patchThread(api, activeRemoteId, { model: next });
      }
    },
    [api, activeRemoteId, modelIdRef],
  );

  const modelPicker = (
    <FormControl>
      <Select
        value={modelId}
        onChange={e => handleModelChange(e.target.value as ModelId)}
        disableUnderline
        className={classes.modelSelect}
        inputProps={{ 'aria-label': 'Model' }}
        renderValue={value => modelLabel(value as ModelId, status.models)}
        MenuProps={{
          anchorOrigin: { vertical: 'bottom', horizontal: 'right' },
          transformOrigin: { vertical: 'top', horizontal: 'right' },
          getContentAnchorEl: null,
        }}
      >
        {modelGroups.flatMap(([vendor, ids]) => [
          <ListSubheader
            key={`group-${vendor}`}
            disableSticky
            className={classes.modelGroupLabel}
          >
            {vendor}
          </ListSubheader>,
          ...ids.map(id => (
            <MenuItem key={id} value={id} className={classes.modelItem}>
              <ListItemIcon className={classes.modelItemCheck}>
                {id === modelId ? <CheckIcon fontSize="small" /> : null}
              </ListItemIcon>
              <span style={{ flexGrow: 1 }}>{modelLabel(id, status.models)}</span>
              {id === defaultModel && (
                <Tooltip title="Assistant default">
                  <StarIcon
                    className={classes.modelDefaultStar}
                    aria-label="Assistant default"
                  />
                </Tooltip>
              )}
            </MenuItem>
          )),
        ])}
      </Select>
    </FormControl>
  );

  return (
    <FullHeightRegion>
      <Content noPadding className={classes.content}>
        <div className={classes.shell}>
          {sidePaneCollapsed ? (
            <aside
              className={classes.sidePaneRail}
              aria-label="AI chat sidebar collapsed"
            >
              <div className={classes.sidePaneRailHeader}>
                <Tooltip title="Expand" placement="right">
                  <IconButton
                    size="small"
                    className={classes.sidePaneRailButton}
                    aria-label="Expand AI chat sidebar"
                    onClick={() => setSidePaneCollapsed(false)}
                  >
                    <ChevronRightIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </div>
              <nav className={classes.sidePaneRailAssistants} aria-label="Assistants">
                {status.assistants.map(a => (
                  <Tooltip key={a.id} title={a.title} placement="right">
                    <IconButton
                      size="small"
                      className={`${classes.sidePaneRailButton} ${
                        a.id === assistant.id
                          ? classes.sidePaneRailButtonActive
                          : ''
                      }`}
                      aria-label={a.title}
                      onClick={() => handleSelectAssistant(a.id)}
                    >
                      <StatusDot status={agentStatus(a.id)}>
                        <AssistantAvatar color={a.color} size={24} />
                      </StatusDot>
                    </IconButton>
                  </Tooltip>
                ))}
              </nav>
              <div className={classes.sidePaneRailDivider} />
              <div className={classes.sidePaneRailControls}>
                <Tooltip title="New Chat" placement="right">
                  <IconButton
                    size="small"
                    className={classes.sidePaneRailButton}
                    aria-label="New Chat"
                    onClick={handleNew}
                  >
                    <AddIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </div>
              <nav
                className={classes.sidePaneRailChats}
                aria-label="AI chat conversations"
              >
                {conversations.map(conversation => (
                  <Tooltip
                    key={conversation.id}
                    title={conversation.title}
                    placement="right"
                  >
                    <IconButton
                      size="small"
                      className={`${classes.sidePaneRailButton} ${
                        conversation.id === activeId
                          ? classes.sidePaneRailButtonActive
                          : ''
                      }`}
                      aria-label={conversation.title}
                      onClick={() => handleSelect(conversation.id)}
                    >
                      <StatusDot
                        status={toConvStatus(
                          conversation.working,
                          conversation.unread,
                        )}
                      >
                        <ChatBubbleOutlineIcon fontSize="small" />
                      </StatusDot>
                    </IconButton>
                  </Tooltip>
                ))}
              </nav>
            </aside>
          ) : (
            <aside className={classes.sidePane} aria-label="AI chat sidepane">
              <SidePane
                assistants={status.assistants}
                activeAssistantId={assistant.id}
                onSelectAssistant={handleSelectAssistant}
                agentStatus={agentStatus}
                conversations={conversations}
                activeId={activeId}
                onNew={handleNew}
                onSelect={handleSelect}
                onRename={handleRename}
                onPin={handlePin}
                onDelete={handleDelete}
                onCollapse={() => setSidePaneCollapsed(true)}
              />
            </aside>
          )}

          <main className={classes.threadPane} aria-label="AI chat thread">
            <div className={classes.threadHeader}>
              <div className={classes.threadIdentity}>
                <AssistantAvatar color={assistant.color} size={22} />
                <Typography variant="subtitle2" className={classes.assistantName}>
                  {assistant.title}
                </Typography>
                {activeTitle && (
                  <Typography
                    variant="body2"
                    className={classes.threadTitle}
                    title={activeTitle}
                  >
                    · {activeTitle}
                  </Typography>
                )}
              </div>
              {modelPicker}
            </div>
            <div className={classes.threadBody}>
              {isBlankDraft ? (
                <div className={classes.emptyState}>
                  <Typography variant="body1" className={classes.emptyTitle}>
                    No conversation yet
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    Start a new chat with {assistant.title}.
                  </Typography>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={handleNew}
                    className={classes.emptyButton}
                  >
                    New chat
                  </Button>
                </div>
              ) : (
                <ConversationSurface
                  composerPlaceholder={assistant.ui?.composer?.placeholder}
                  suggestions={assistant.ui?.suggestions}
                  assistantColor={assistant.color}
                />
              )}
            </div>
          </main>
        </div>
      </Content>
    </FullHeightRegion>
  );
}
