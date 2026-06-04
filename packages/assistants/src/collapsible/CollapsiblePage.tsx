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
  FormControl,
  IconButton,
  MenuItem,
  Select,
  Tooltip,
  Typography,
} from '@material-ui/core';
import AddIcon from '@material-ui/icons/Add';
import ChatBubbleOutlineIcon from '@material-ui/icons/ChatBubbleOutline';
import ChevronRightIcon from '@material-ui/icons/ChevronRight';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
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
import { AssistantAvatar } from './surface/AssistantAvatar';
import { SidePane } from './SidePane';
import { FullHeightRegion } from './FullHeightRegion';
import { useConversations } from './useConversations';

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
  threadTitle: {
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: theme.palette.text.secondary,
    fontWeight: 500,
  },
  modelSelect: {
    fontSize: theme.typography.caption.fontSize,
    color: theme.palette.text.secondary,
    '& .MuiSelect-select': {
      paddingTop: theme.spacing(0.5),
      paddingBottom: theme.spacing(0.5),
    },
  },
  threadBody: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  },
}));

/**
 * Resolve the label for a model id from the global model pool, falling back to
 * the raw id when it isn't listed.
 */
function modelLabel(id: ModelId, pool: ModelOption[]): string {
  return pool.find(m => m.id === id)?.model ?? id;
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
  initialMessages,
  onFinish,
  composerPlaceholder,
  suggestions,
  assistantColor,
  headerRight,
}: ChatThreadProps) {
  const classes = useStyles();

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
      <main className={classes.threadPane} aria-label="AI chat thread">
        <div className={classes.threadHeader}>
          <Typography
            variant="subtitle2"
            className={classes.threadTitle}
            title={title}
          >
            {title}
          </Typography>
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

interface CollapsibleChatProps {
  status: StatusResponse;
  assistant: AssistantSummary;
}

/**
 * The conversation experience for a single resolved assistant: the collapsible
 * left rail, the per-assistant conversation set, the model picker, and the
 * active thread. Remounted (via `key={assistant.id}`) when the assistant
 * changes so conversation state is re-seeded from that assistant's namespace.
 */
function CollapsibleChat({ status, assistant }: CollapsibleChatProps) {
  const classes = useStyles();
  const api = useApi(assistantsApiRef);

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
  const [modelId, setModelId] = useState<ModelId>(
    () => assistant.defaultModel ?? status.defaultModel,
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

  const convState = useConversations(assistant.id);

  const handleNew = useCallback(() => {
    convState.createConversation();
  }, [convState]);

  const handleFinish = useCallback(
    (messages: UIMessage[]) => {
      const activeId = convState.activeId;
      const shouldGenerateTitle =
        convState.activeConversation?.title === 'New Chat' &&
        messages.some(m => m.role === 'user') &&
        messages.some(m => m.role === 'assistant');

      if (activeId) {
        convState.updateMessages(activeId, messages);
      }

      if (activeId && shouldGenerateTitle) {
        api
          .getTitle({ assistantId: assistant.id, modelId, messages })
          .then(generated => {
            if (generated && generated !== 'New Chat') {
              convState.renameConversation(activeId, generated);
            }
          })
          .catch(() => {
            // Title generation is best-effort only.
          });
      }
    },
    [api, assistant.id, modelId, convState],
  );

  // Auto-create a conversation on first load if none active.
  useEffect(() => {
    if (!convState.activeId) {
      convState.createConversation();
    }
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modelPicker = (
    <FormControl>
      <Select
        value={modelId}
        onChange={e => setModelId(e.target.value as ModelId)}
        disableUnderline
        className={classes.modelSelect}
        inputProps={{ 'aria-label': 'Model' }}
      >
        {allowedModels.map(id => (
          <MenuItem key={id} value={id}>
            {modelLabel(id, status.models)}
          </MenuItem>
        ))}
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
                  <AssistantAvatar color={a.color} size={24} />
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
                  <ChatBubbleOutlineIcon fontSize="small" />
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
            tools={assistant.tools ?? []}
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
      {convState.activeId && (
        <ChatThread
          key={convState.activeId}
          baseUrl={baseUrl.value}
          authFetch={api.fetch}
          assistantId={assistant.id}
          modelId={modelId}
          title={convState.activeConversation?.title ?? assistant.title}
          initialMessages={convState.activeConversation?.messages}
          onFinish={handleFinish}
          composerPlaceholder={assistant.ui?.composer?.placeholder}
          suggestions={assistant.ui?.suggestions}
          assistantColor={assistant.color}
          headerRight={modelPicker}
        />
      )}
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
  return (
    <CollapsibleChat
      key={assistant.id}
      status={status.value}
      assistant={assistant}
    />
  );
}
