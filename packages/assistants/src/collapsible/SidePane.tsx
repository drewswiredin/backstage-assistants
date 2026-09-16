import { makeStyles } from '@material-ui/core/styles';
import { IconButton, Tooltip, Typography } from '@material-ui/core';
import AddIcon from '@material-ui/icons/Add';
import ChevronLeftIcon from '@material-ui/icons/ChevronLeft';
import SettingsOutlinedIcon from '@material-ui/icons/SettingsOutlined';
import { AssistantSummary } from '@drewswiredin/backstage-plugin-assistants-common';
import { AssistantsList } from './AssistantsList';
import { ConversationsPanel } from './ConversationsPanel';
import type { ThreadSummary } from './threadListAdapter';
import type { ConvStatus } from './useThreadStatus';

const useStyles = makeStyles(theme => ({
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    minHeight: 44,
    padding: theme.spacing(0, 1),
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  // Flex column so the manage footer pins to the bottom while the list scrolls.
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  footer: {
    flexShrink: 0,
    borderTop: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(0.5),
    display: 'flex',
    justifyContent: 'flex-end',
  },
  manageItem: {
    color: theme.palette.text.secondary,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing(1.5, 0.5, 0, 2),
  },
  sectionLabel: {
    color: theme.palette.text.secondary,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  divider: {
    margin: theme.spacing(1, 1.5, 0),
    borderTop: `1px solid ${theme.palette.divider}`,
  },
}));

/**
 * Props for {@link SidePane}.
 *
 * @public
 */
export interface SidePaneProps {
  /** All assistants the caller may access (top tier — the switcher). */
  assistants: AssistantSummary[];
  /** The currently active assistant id. */
  activeAssistantId: string;
  /** Switch assistant (drives `?assistant=<id>`). */
  onSelectAssistant: (id: string) => void;
  /** Per-assistant rollup status (working/unread/read) for the rail dots. */
  assistantStatus?: (assistantId: string) => ConvStatus;
  conversations: ThreadSummary[];
  activeId: string | null;
  onNew: () => void;
  onSelect: (id: string | null) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string) => void;
  onDelete: (id: string) => void;
  onCollapse: () => void;
  /** Whether the caller may manage assistants (gates the manage gear). */
  canManage?: boolean;
  /** Open the assistant management editor. */
  onManage?: () => void;
}

/**
 * The expanded (320px) left sidebar: a collapse header, the
 * {@link AssistantsList} switcher on top, then the conversation list (with a
 * "new chat" + next to the section label). Adapted from Implementation 1's side
 * pane (the tools list moved into the assistant detail dialog).
 *
 * @public
 */
export function SidePane(props: SidePaneProps) {
  const {
    assistants,
    activeAssistantId,
    onSelectAssistant,
    assistantStatus,
    conversations,
    activeId,
    onNew,
    onSelect,
    onRename,
    onPin,
    onDelete,
    onCollapse,
    canManage,
    onManage,
  } = props;
  const classes = useStyles();

  return (
    <div className={classes.root}>
      <div className={classes.header}>
        <Tooltip title="Collapse" placement="bottom">
          <IconButton
            size="small"
            aria-label="Collapse AI chat sidebar"
            onClick={onCollapse}
          >
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </div>

      <div className={classes.body}>
        <AssistantsList
          assistants={assistants}
          activeId={activeAssistantId}
          onSelect={onSelectAssistant}
          assistantStatus={assistantStatus}
        />

        <div className={classes.divider} />

        <div className={classes.sectionHeader}>
          <Typography variant="caption" className={classes.sectionLabel}>
            Conversations
          </Typography>
          <Tooltip title="New chat" placement="bottom">
            <IconButton size="small" aria-label="New chat" onClick={onNew}>
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </div>
        <ConversationsPanel
          conversations={conversations}
          activeId={activeId}
          onSelect={onSelect}
          onRename={onRename}
          onPin={onPin}
          onDelete={onDelete}
        />
      </div>

      {canManage && onManage && (
        <div className={classes.footer}>
          <IconButton
            size="small"
            className={classes.manageItem}
            aria-label="Manage assistants"
            onClick={onManage}
          >
            <SettingsOutlinedIcon fontSize="small" />
          </IconButton>
        </div>
      )}
    </div>
  );
}
