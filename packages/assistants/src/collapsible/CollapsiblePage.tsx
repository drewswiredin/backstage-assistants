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
  Badge,
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
  markThreadRead,
  patchThread,
  type ThreadCustomMetadata,
  type ThreadSummary,
} from './threadListAdapter';
import { makeRuntimeHook } from './useAssistantRuntime';
import { useThreadNotifications } from './useThreadNotifications';

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
  // The "generating" indicator: a pulsing dot, distinct from the solid unread dot.
  '@keyframes auiPulse': {
    '0%': { transform: 'scale(1)', opacity: 1 },
    '50%': { transform: 'scale(1.5)', opacity: 0.45 },
    '100%': { transform: 'scale(1)', opacity: 1 },
  },
  pulseDot: {
    animation: '$auiPulse 1.2s ease-in-out infinite',
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
  const assistant =
    assistants.find(a => a.id === requestedAssistant) ?? assistants[0];
  // Keyed by assistant.id: a fresh server-backed runtime per assistant. Switching
  // never loses an in-flight reply — the backend persists it on finish.
  return (
    <CollapsibleChat key={assistant.id} status={status.value} assistant={assistant} />
  );
}

// ---------------------------------------------------------------------------
// Resolve the backend base URL, then build the runtime
// ---------------------------------------------------------------------------

function CollapsibleChat({
  status,
  assistant,
}: {
  status: StatusResponse;
  assistant: AssistantSummary;
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
      assistant={assistant}
      api={api}
      baseUrl={baseUrl.value}
    />
  );
}

function ChatRuntime({
  status,
  assistant,
  api,
  baseUrl,
}: {
  status: StatusResponse;
  assistant: AssistantSummary;
  api: AssistantsApi;
  baseUrl: string;
}) {
  const defaultModel = assistant.defaultModel ?? status.defaultModel;
  // Drives the transport body; updated by the model picker + on thread switch.
  const modelIdRef = useRef<ModelId>(defaultModel);

  const adapter = useMemo(
    () => createThreadListAdapter(api, assistant.id),
    [api, assistant.id],
  );
  const runtimeHook = useMemo(
    () => makeRuntimeHook({ api, baseUrl, assistantId: assistant.id, modelIdRef }),
    [api, baseUrl, assistant.id],
  );
  const runtime = useRemoteThreadListRuntime({ adapter, runtimeHook });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatChrome
        status={status}
        assistant={assistant}
        api={api}
        modelIdRef={modelIdRef}
        defaultModel={defaultModel}
      />
    </AssistantRuntimeProvider>
  );
}

// ---------------------------------------------------------------------------
// Chrome (inside the runtime provider) — pure view of server thread state
// ---------------------------------------------------------------------------

function ChatChrome({
  status,
  assistant,
  api,
  modelIdRef,
  defaultModel,
}: {
  status: StatusResponse;
  assistant: AssistantSummary;
  api: AssistantsApi;
  modelIdRef: React.MutableRefObject<ModelId>;
  defaultModel: ModelId;
}) {
  const classes = useStyles();
  const runtime = useAssistantRuntime();
  const [, setSearchParams] = useSearchParams();
  const notifications = useThreadNotifications(api);

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

  const { generatingThreadIds } = notifications;
  const conversations = useMemo<ThreadSummary[]>(
    () =>
      threadList.threadIds.map(id => {
        const item = threadList.threadItems[id];
        const custom = item?.custom as Partial<ThreadCustomMetadata> | undefined;
        const generating =
          !!item?.remoteId && generatingThreadIds.has(item.remoteId) && id !== activeId;
        return {
          id,
          remoteId: item?.remoteId,
          title: item?.title ?? 'New Chat',
          pinned: custom?.pinned ?? false,
          // generating and unread are mutually exclusive; generating wins.
          unread: !generating && (custom?.unread ?? false) && id !== activeId,
          generating,
        };
      }),
    [threadList, activeId, generatingThreadIds],
  );

  // A turn finished somewhere — refresh the thread list so the sidebar picks up
  // new titles / unread state for background conversations.
  useEffect(() => {
    if (notifications.finishedTick > 0) {
      void runtime.threads.reload();
    }
  }, [notifications.finishedTick, runtime]);

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

  // Viewing a thread clears its unread flag (server-side), then refresh the list.
  useEffect(() => {
    if (activeRemoteId) {
      markThreadRead(api, activeRemoteId)
        .then(() => runtime.threads.reload())
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRemoteId]);

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
      if (id !== assistant.id) setSearchParams({ assistant: id });
    },
    [assistant.id, setSearchParams],
  );

  const handleNew = useCallback(() => {
    void runtime.threads.switchToNewThread();
  }, [runtime]);

  const handleSelect = useCallback(
    (id: string | null) => {
      if (id) void runtime.threads.switchToThread(id);
    },
    [runtime],
  );

  const handleRename = useCallback(
    (id: string, title: string) => {
      void runtime.threads.getItemById(id).rename(title);
    },
    [runtime],
  );

  const handleDelete = useCallback(
    (id: string) => {
      void runtime.threads.getItemById(id).delete();
    },
    [runtime],
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
                      <Badge
                        color={
                          notifications.generatingAssistantIds.has(a.id)
                            ? 'primary'
                            : 'error'
                        }
                        variant="dot"
                        overlap="circular"
                        invisible={
                          !notifications.generatingAssistantIds.has(a.id) &&
                          !notifications.unreadAssistantIds.has(a.id)
                        }
                        classes={
                          notifications.generatingAssistantIds.has(a.id)
                            ? { dot: classes.pulseDot }
                            : undefined
                        }
                      >
                        <AssistantAvatar color={a.color} size={24} />
                      </Badge>
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
                      <Badge
                        color={conversation.generating ? 'primary' : 'error'}
                        variant="dot"
                        overlap="circular"
                        invisible={
                          !conversation.generating && !conversation.unread
                        }
                        classes={
                          conversation.generating
                            ? { dot: classes.pulseDot }
                            : undefined
                        }
                      >
                        <ChatBubbleOutlineIcon fontSize="small" />
                      </Badge>
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
                unreadAssistantIds={notifications.unreadAssistantIds}
                generatingAssistantIds={notifications.generatingAssistantIds}
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
              <ConversationSurface
                composerPlaceholder={assistant.ui?.composer?.placeholder}
                suggestions={assistant.ui?.suggestions}
                assistantColor={assistant.color}
              />
            </div>
          </main>
        </div>
      </Content>
    </FullHeightRegion>
  );
}
