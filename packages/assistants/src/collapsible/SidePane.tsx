import { makeStyles } from '@material-ui/core/styles';
import { IconButton, Tooltip, Typography } from '@material-ui/core';
import ChevronLeftIcon from '@material-ui/icons/ChevronLeft';
import { ConversationsPanel } from './ConversationsPanel';
import type { Conversation } from './useConversations';

const useStyles = makeStyles(theme => ({
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    padding: theme.spacing(0, 1, 0, 2),
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  headerTitle: {
    color: theme.palette.text.secondary,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
}));

/**
 * Props for {@link SidePane}.
 *
 * @public
 */
export interface SidePaneProps {
  conversations: Conversation[];
  activeId: string | null;
  onNew: () => void;
  onSelect: (id: string | null) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string) => void;
  onDelete: (id: string) => void;
  onCollapse: () => void;
}

/**
 * The expanded (320px) left sidebar: a header with a collapse chevron, and the
 * {@link ConversationsPanel} (New Chat + conversation list). Adapted from
 * Implementation 1's side pane with the Connections tab removed — Conversations
 * are rendered directly, with no Tabs.
 *
 * @public
 */
export function SidePane(props: SidePaneProps) {
  const {
    conversations,
    activeId,
    onNew,
    onSelect,
    onRename,
    onPin,
    onDelete,
    onCollapse,
  } = props;
  const classes = useStyles();

  return (
    <div>
      <div className={classes.header}>
        <Typography variant="caption" className={classes.headerTitle}>
          Conversations
        </Typography>
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
      <ConversationsPanel
        conversations={conversations}
        activeId={activeId}
        onNew={onNew}
        onSelect={onSelect}
        onRename={onRename}
        onPin={onPin}
        onDelete={onDelete}
      />
    </div>
  );
}
