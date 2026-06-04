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
import { makeStyles, useTheme } from '@material-ui/core/styles';
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
import { AssistantRuntimeProvider, useThread } from '@assistant-ui/react';
import { useChatRuntime } from '@assistant-ui/react-ai-sdk';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import type {
  AssistantSummary,
  ModelId,
  ModelOption,
  StatusResponse,
} from '@drewswiredin/backstage-plugin-assistants-common';
import { assistantsApiRef } from '../api';
import { ConversationSurface } from './surface';
import {
  AssistantAvatar,
  resolveAssistantColor,
} from './surface/AssistantAvatar';
import { SidePane } from './SidePane';
import { FullHeightRegion } from './FullHeightRegion';
import {
  persistConversationMessages,
  useConversations,
} from './useConversations';
import {
  clearUnread,
  hasUnread,
  isConversationUnread,
  markUnread,
  useUnreadVersion,
} from './unreadStore';

const SIDEPANE_COLLAPSED_KEY = 'ai-chat-sidepane-collapsed';

function loadSidePaneCollapsed() {
  try {
    return localStorage.getItem(SIDEPANE_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

const useStyles = makeStyles(theme => ({
  // Flex-column fill inside the measured FullHeightRegion (mirrors the native
  // page): lets the shell own the remaining height without a nested <Page>.
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
    // Symmetric margin so the chat card is enclosed on all four sides (no left
    // gutter since it abuts the sidebar). Composer breathing room lives on the
    // Thread's own footer (see ConversationSurface) — same bg, no seam.
    padding: theme.spacing(1),
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
    minHeight: 44,
    padding: theme.spacing(0, 2),
    borderBottom: `1px solid ${theme.palette.divider}`,
    backgroundColor: theme.palette.background.paper,
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
  // Trigger label: vendor in muted text, model name emphasized.
  modelTriggerVendor: {
    color: theme.palette.text.hint,
    marginRight: theme.spacing(0.5),
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
    // NOTE: no paddingBottom here — the Thread fills this box with its own
    // --aui-background; padding would expose the card's paper bg and create a
    // two-tone seam. Composer breathing room lives on .aui-thread-viewport-footer
    // (same bg) in ConversationSurface.
  },
  // Background thread: kept mounted (stream alive) but out of view/layout.
  threadPaneHidden: {
    display: 'none',
  },
}));

/**
 * Bridges the active thread runtime's running state up to the live-thread
 * manager. Rendered inside {@link ChatThread}'s `AssistantRuntimeProvider`.
 */
function RunningReporter({
  onRunningChange,
}: {
  onRunningChange?: (running: boolean) => void;
}) {
  const isRunning = useThread(t => t.isRunning);
  useEffect(() => {
    onRunningChange?.(isRunning);
  }, [isRunning, onRunningChange]);
  return null;
}

/**
 * Split a model id into a display vendor + name. Our models route through one
 * provider (e.g. `openrouter`) but the meaningful family is the vendor prefix in
 * the model name (`google/gemini-2.5-flash` -> {vendor: "google", name:
 * "gemini-2.5-flash"}). Falls back to the provider / raw id when there's no `/`.
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

interface ChatThreadProps {
  /** Backend base URL (`.../api/assistants`); the transport posts to `/chat`. */
  baseUrl: string;
  /** Authenticated fetch from the assistants API client. */
  authFetch: typeof fetch;
  /** Assistant the turn is sent to. */
  assistantId: string;
  /** Selected `provider:model` id. */
  modelId: ModelId;
  /** Header title (the active conversation's title). */
  title: string;
  /** The active assistant's display name (shown in the header identity). */
  assistantName: string;
  initialMessages?: UIMessage[];
  onFinish?: (messages: UIMessage[]) => void;
  /** Composer placeholder from the assistant's `ui`. */
  composerPlaceholder?: string;
  /** Starter prompts from the assistant's `ui`. */
  suggestions?: Array<{ title: string; prompt: string }>;
  /** The assistant's avatar color (tints the assistant message + welcome). */
  assistantColor?: string;
  /** Thread header content rendered to the right of the title. */
  headerRight?: React.ReactNode;
  /**
   * Render but visually hide the thread (kept mounted so a background stream
   * keeps running). The live-thread manager shows exactly one thread at a time.
   */
  hidden?: boolean;
  /** Notified when this thread starts/stops streaming (drives keep-alive). */
  onRunningChange?: (running: boolean) => void;
}

/**
 * A single chat thread: owns its `useChatRuntime` (AI SDK
 * `DefaultChatTransport`) and renders the {@link ConversationSurface}. Mounted
 * with `key={activeId}` by the page so a fresh runtime is created per
 * conversation, seeded with that conversation's `initialMessages`.
 */
function ChatThread({
  baseUrl,
  authFetch,
  assistantId,
  modelId,
  title,
  assistantName,
  initialMessages,
  onFinish,
  composerPlaceholder,
  suggestions,
  assistantColor,
  headerRight,
  hidden,
  onRunningChange,
}: ChatThreadProps) {
  const classes = useStyles();
  const theme = useTheme();
  const accentColor = resolveAssistantColor(assistantColor, theme.palette.type);

  // Keep the assistant/model selection current without remounting the runtime:
  // the transport reads them from a ref via the function-form `body`.
  const selectionRef = useRef({ assistantId, modelId });
  selectionRef.current = { assistantId, modelId };

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${baseUrl}/chat`,
        fetch: authFetch,
        body: () => ({
          assistantId: selectionRef.current.assistantId,
          modelId: selectionRef.current.modelId,
        }),
      }),
    [authFetch, baseUrl],
  );

  // Keep onFinish ref stable so useChatRuntime doesn't remount mid-stream.
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  const stableOnFinish = useCallback(({ messages }: { messages: UIMessage[] }) => {
    onFinishRef.current?.(messages);
  }, []);

  const runtime = useChatRuntime({
    transport,
    messages: initialMessages,
    onFinish: stableOnFinish,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <RunningReporter onRunningChange={onRunningChange} />
      <main
        className={
          hidden ? `${classes.threadPane} ${classes.threadPaneHidden}` : classes.threadPane
        }
        style={hidden ? undefined : { borderTop: `3px solid ${accentColor}` }}
        aria-label="AI chat thread"
        aria-hidden={hidden}
      >
        <div className={classes.threadHeader}>
          <div className={classes.threadIdentity}>
            <AssistantAvatar color={assistantColor} size={22} />
            <Typography variant="subtitle2" className={classes.assistantName}>
              {assistantName}
            </Typography>
            {title && (
              <Typography
                variant="body2"
                className={classes.threadTitle}
                title={title}
              >
                · {title}
              </Typography>
            )}
          </div>
          {headerRight}
        </div>
        <div className={classes.threadBody}>
          <ConversationSurface
            composerPlaceholder={composerPlaceholder}
            suggestions={suggestions}
            assistantColor={assistantColor}
          />
        </div>
      </main>
    </AssistantRuntimeProvider>
  );
}

/**
 * Everything the live-thread manager needs to mount a {@link ChatThread}
 * independently of which assistant is currently on screen. Captured (snapshot)
 * when a conversation first becomes active, so a thread can keep streaming in the
 * background after the user switches conversation or assistant.
 */
interface ThreadDescriptor {
  convId: string;
  agentId: string;
  assistantTitle: string;
  assistantColor?: string;
  modelId: ModelId;
  initialMessages?: UIMessage[];
  composerPlaceholder?: string;
  suggestions?: Array<{ title: string; prompt: string }>;
}

/**
 * Keeps a {@link ChatThread} mounted while it is the active conversation OR still
 * streaming, so navigating away doesn't abort an in-flight reply. Returns the set
 * of descriptors to render (active + any still-running background threads) and a
 * callback to report each thread's running state.
 *
 * Reconciliation runs in an effect (not during render) so the discarded render
 * that React performs when `useConversations` re-seeds on an assistant switch
 * can't capture a half-updated descriptor.
 */
function useLiveThreads(active: ThreadDescriptor | null) {
  const [mounted, setMounted] = useState<ThreadDescriptor[]>([]);
  const [running, setRunning] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const a = activeRef.current;
    setMounted(prev => {
      const byId = new Map(prev.map(d => [d.convId, d] as const));
      // Snapshot the active descriptor the first time it mounts; never overwrite
      // an already-mounted (live) thread.
      if (a && !byId.has(a.convId)) {
        byId.set(a.convId, a);
      }
      const keep = new Set<string>(running);
      if (a) {
        keep.add(a.convId);
      }
      const next: ThreadDescriptor[] = [];
      for (const d of prev) {
        if (keep.has(d.convId)) {
          next.push(byId.get(d.convId) ?? d);
          keep.delete(d.convId);
        }
      }
      for (const id of keep) {
        const d = byId.get(id);
        if (d) {
          next.push(d);
        }
      }
      const unchanged =
        next.length === prev.length &&
        next.every((d, i) => d.convId === prev[i].convId);
      return unchanged ? prev : next;
    });
  }, [active?.convId, running]);

  const setThreadRunning = useCallback((convId: string, isRunning: boolean) => {
    setRunning(prev => {
      const has = prev.has(convId);
      if (isRunning === has) {
        return prev;
      }
      const next = new Set(prev);
      if (isRunning) {
        next.add(convId);
      } else {
        next.delete(convId);
      }
      return next;
    });
  }, []);

  // Always render the active thread immediately, even before the effect folds it
  // into `mounted` (avoids a one-frame empty pane on open / switch).
  const threads =
    active && !mounted.some(d => d.convId === active.convId)
      ? [...mounted, active]
      : mounted;

  return { threads, setThreadRunning };
}

interface CollapsibleChatProps {
  status: StatusResponse;
  assistant: AssistantSummary;
}

/**
 * The conversation experience for the resolved assistant: the collapsible left
 * rail, the per-assistant conversation set, the model picker, and the live
 * threads. NOT remounted on assistant switch — `useConversations` re-seeds from
 * the new namespace, and the {@link useLiveThreads} manager keeps background
 * threads streaming across the switch.
 */
function CollapsibleChat({ status, assistant }: CollapsibleChatProps) {
  const classes = useStyles();
  const api = useApi(assistantsApiRef);
  useUnreadVersion(); // re-render the rail's unread dots on change

  // Switching assistant drives `?assistant=<id>`; the page re-resolves and
  // remounts this component (keyed by assistant.id) onto that assistant's
  // siloed conversation set.
  const [, setSearchParams] = useSearchParams();
  const handleSelectAssistant = useCallback(
    (id: string) => {
      if (id !== assistant.id) {
        setSearchParams({ assistant: id });
      }
    },
    [assistant.id, setSearchParams],
  );

  const baseUrl = useAsync(() => api.getBaseUrl(), [api]);

  // Model picker: limited to the assistant's allowlist (else the global pool),
  // defaulting to the assistant's default (else the global default).
  const allowedModels = useMemo<ModelId[]>(
    () => assistant.models ?? status.models.map(m => m.id),
    [assistant.models, status.models],
  );
  // The model marked with a default star in the menu.
  const defaultModel = assistant.defaultModel ?? status.defaultModel;
  // Group allowed models by vendor (the prefix in the model name) for the menu.
  const modelGroups = useMemo<Array<[string, ModelId[]]>>(() => {
    const byVendor = new Map<string, ModelId[]>();
    for (const id of allowedModels) {
      const { vendor } = splitModel(id, status.models);
      const list = byVendor.get(vendor);
      if (list) {
        list.push(id);
      } else {
        byVendor.set(vendor, [id]);
      }
    }
    return [...byVendor.entries()];
  }, [allowedModels, status.models]);
  const convState = useConversations(assistant.id);

  // Per-conversation model memory. Seed from the active conversation's saved
  // model, validated against this assistant's allowlist; fall back to the
  // assistant default when absent or no longer available.
  const resolveModel = useCallback(
    (stored: ModelId | undefined) =>
      stored && allowedModels.includes(stored) ? stored : defaultModel,
    [allowedModels, defaultModel],
  );
  const [modelId, setModelId] = useState<ModelId>(() =>
    resolveModel(convState.activeConversation?.model),
  );
  // Adopt the active conversation's saved model when switching conversations.
  // Keyed on activeId only (not the conversation object, whose identity changes
  // on every streamed message) so an in-flight chat can't clobber the pick.
  useEffect(() => {
    setModelId(resolveModel(convState.activeConversation?.model));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convState.activeId]);
  // Persist the user's pick onto the active conversation.
  const handleModelChange = useCallback(
    (next: ModelId) => {
      setModelId(next);
      if (convState.activeId) {
        convState.setConversationModel(convState.activeId, next);
      }
    },
    [convState],
  );

  const [sidePaneCollapsed, setSidePaneCollapsed] = useState(
    loadSidePaneCollapsed,
  );
  useEffect(() => {
    try {
      localStorage.setItem(SIDEPANE_COLLAPSED_KEY, String(sidePaneCollapsed));
    } catch {
      // storage unavailable
    }
  }, [sidePaneCollapsed]);

  const handleNew = useCallback(() => {
    convState.createConversation();
  }, [convState]);

  // A turn finished — possibly in a background thread (different conversation or
  // even a different assistant than the one on screen).
  const handleThreadFinish = useCallback(
    (descriptor: ThreadDescriptor, messages: UIMessage[]) => {
      const sameAgent = descriptor.agentId === assistant.id;
      const viewing = sameAgent && descriptor.convId === convState.activeId;

      // Persist: reactively for the on-screen assistant, directly to storage for
      // any other assistant (whose conversation state isn't mounted here).
      if (sameAgent) {
        convState.updateMessages(descriptor.convId, messages);
      } else {
        persistConversationMessages(
          descriptor.agentId,
          descriptor.convId,
          messages,
        );
      }

      // Unread dot if the reply landed somewhere the user isn't looking.
      if (!viewing) {
        markUnread(descriptor.agentId, descriptor.convId);
      }

      // Best-effort title for brand-new chats of the on-screen assistant (its
      // conversation state is mounted, so the rename is reactive).
      if (sameAgent) {
        const conv = convState.conversations.find(
          c => c.id === descriptor.convId,
        );
        const shouldTitle =
          conv?.title === 'New Chat' &&
          messages.some(m => m.role === 'user') &&
          messages.some(m => m.role === 'assistant');
        if (shouldTitle) {
          api
            .getTitle({
              assistantId: descriptor.agentId,
              modelId: descriptor.modelId,
              messages,
            })
            .then(generated => {
              if (generated && generated !== 'New Chat') {
                convState.renameConversation(descriptor.convId, generated);
              }
            })
            .catch(() => {
              // Title generation is best-effort only.
            });
        }
      }
    },
    [api, assistant.id, convState],
  );

  // Auto-create a conversation on first load if none active.
  useEffect(() => {
    if (!convState.activeId) {
      convState.createConversation();
    }
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Viewing a conversation clears its unread dot (and does so on assistant
  // switch, since the active conversation changes with it).
  useEffect(() => {
    if (convState.activeId) {
      clearUnread(assistant.id, convState.activeId);
    }
  }, [assistant.id, convState.activeId]);

  // The active conversation, as a descriptor, plus any background threads still
  // streaming. The manager keeps them mounted across conversation/assistant
  // switches so their replies finish and persist.
  const activeDescriptor: ThreadDescriptor | null = convState.activeId
    ? {
        convId: convState.activeId,
        agentId: assistant.id,
        assistantTitle: assistant.title,
        assistantColor: assistant.color,
        modelId,
        initialMessages: convState.activeConversation?.messages,
        composerPlaceholder: assistant.ui?.composer?.placeholder,
        suggestions: assistant.ui?.suggestions,
      }
    : null;
  const { threads, setThreadRunning } = useLiveThreads(activeDescriptor);

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
              <span style={{ flexGrow: 1 }}>
                {modelLabel(id, status.models)}
              </span>
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
          <nav
            className={classes.sidePaneRailAssistants}
            aria-label="Assistants"
          >
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
                    color="error"
                    variant="dot"
                    overlap="circular"
                    invisible={!hasUnread(a.id)}
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
            {convState.conversations.map(conversation => (
              <Tooltip
                key={conversation.id}
                title={conversation.title}
                placement="right"
              >
                <IconButton
                  size="small"
                  className={`${classes.sidePaneRailButton} ${
                    conversation.id === convState.activeId
                      ? classes.sidePaneRailButtonActive
                      : ''
                  }`}
                  aria-label={conversation.title}
                  onClick={() => convState.selectConversation(conversation.id)}
                >
                  <Badge
                    color="error"
                    variant="dot"
                    overlap="circular"
                    invisible={
                      conversation.id === convState.activeId ||
                      !isConversationUnread(assistant.id, conversation.id)
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
            conversations={convState.conversations}
            activeId={convState.activeId}
            onNew={handleNew}
            onSelect={convState.selectConversation}
            onRename={convState.renameConversation}
            onPin={convState.pinConversation}
            onDelete={convState.deleteConversation}
            onCollapse={() => setSidePaneCollapsed(true)}
          />
        </aside>
      )}
      {threads.map(d => {
        const isActive =
          d.agentId === assistant.id && d.convId === convState.activeId;
        return (
          <ChatThread
            key={d.convId}
            hidden={!isActive}
            baseUrl={baseUrl.value}
            authFetch={api.fetch}
            assistantId={d.agentId}
            modelId={isActive ? modelId : d.modelId}
            title={isActive ? convState.activeConversation?.title ?? '' : ''}
            assistantName={isActive ? assistant.title : d.assistantTitle}
            initialMessages={d.initialMessages}
            onFinish={messages => handleThreadFinish(d, messages)}
            onRunningChange={running => setThreadRunning(d.convId, running)}
            composerPlaceholder={d.composerPlaceholder}
            suggestions={d.suggestions}
            assistantColor={isActive ? assistant.color : d.assistantColor}
            headerRight={isActive ? modelPicker : undefined}
          />
        );
      })}
        </div>
      </Content>
    </FullHeightRegion>
  );
}

/**
 * Implementation 1's collapsible AI chat page, faithfully reproduced as a
 * fully self-contained Backstage page module.
 *
 * Reads the target assistant from `?assistant=<id>` (the assistant rail lives
 * in the Backstage nav), loads `/status`, and renders the collapsible
 * conversation experience for the chosen assistant (or the first accessible
 * one). Backend wiring goes through `assistantsApiRef` — never `config`.
 *
 * @public
 */
export function CollapsiblePage() {
  const api = useApi(assistantsApiRef);
  const [searchParams] = useSearchParams();
  const requestedAssistant = searchParams.get('assistant');

  const status = useAsync(() => api.getStatus(), [api]);

  // No <Page> wrapper: the new frontend system already renders this extension
  // inside the app's page chrome (header/breadcrumb). A nested <Page> adds its
  // own min-height and pushes the layout past the viewport (outer scrollbar).
  // The chat fills the viewport via FullHeightRegion inside CollapsibleChat.
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
  // Intentionally NOT keyed by assistant.id: the page persists across assistant
  // switches so background chat threads keep streaming. useConversations
  // re-seeds itself from the new assistant's namespace.
  return <CollapsibleChat status={status.value} assistant={assistant} />;
}
