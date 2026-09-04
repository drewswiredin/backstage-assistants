/* eslint-disable jsx-a11y/no-autofocus -- the inline rename field appears on a
   deliberate user action (Rename) and should take focus immediately. */
import { MouseEvent, useState } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import {
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemSecondaryAction,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
} from '@material-ui/core';
import BookmarkIcon from '@material-ui/icons/Bookmark';
import ChatBubbleOutlineIcon from '@material-ui/icons/ChatBubbleOutline';
import MoreVertIcon from '@material-ui/icons/MoreVert';
import { StatusDot } from './StatusDot';
import { toConvStatus } from './useThreadStatus';
import type { ThreadSummary } from './threadListAdapter';

const useStyles = makeStyles(theme => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    padding: theme.spacing(0.5, 1.5, 1),
    gap: theme.spacing(1),
  },
  activeItem: {
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.action.selected,
  },
  listItem: {
    borderRadius: theme.shape.borderRadius,
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
  },
  // Reveal the row's ⋮ only on hover so the title gets the full width otherwise.
  // Must live on the container <li> (ContainerProps): the secondary action is a
  // sibling of the ListItem root, so a :hover on the row can't reach it.
  container: {
    '&:hover $action': {
      opacity: 1,
      pointerEvents: 'auto',
    },
  },
  action: {
    opacity: 0,
    pointerEvents: 'none',
    transition: theme.transitions.create('opacity'),
  },
  // Keep the ⋮ visible while its menu is open (even if the row isn't hovered).
  actionVisible: {
    opacity: 1,
    pointerEvents: 'auto',
  },
  pinnedIcon: {
    color: theme.palette.warning.main,
    fontSize: '0.875rem',
    marginRight: theme.spacing(0.5),
  },
  renameInput: {
    '& input': {
      fontSize: '0.875rem',
      padding: theme.spacing(0.5, 1),
    },
  },
}));

/**
 * Props for {@link ConversationsPanel}.
 *
 * @public
 */
export interface ConversationsPanelProps {
  conversations: ThreadSummary[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * The expanded sidebar's conversation list (ported from Implementation 1): a
 * "New Chat" button, the conversation rows (active highlight, pinned bookmark
 * icon, inline rename), and a per-row overflow (⋮) menu with Rename / Pin /
 * Delete.
 *
 * @public
 */
export function ConversationsPanel({
  conversations,
  activeId,
  onSelect,
  onRename,
  onPin,
  onDelete,
}: ConversationsPanelProps) {
  const classes = useStyles();
  const [menuAnchor, setMenuAnchor] = useState<{
    el: HTMLElement;
    id: string;
  } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // The conversation queued for rename while the menu animates closed (applied
  // in the menu's onExited below — see handleRenameStart).
  const [pendingRename, setPendingRename] = useState<ThreadSummary | null>(
    null,
  );

  const handleMenuOpen = (e: MouseEvent<HTMLElement>, id: string) => {
    e.stopPropagation();
    setMenuAnchor({ el: e.currentTarget, id });
  };

  const handleMenuClose = () => setMenuAnchor(null);

  const handleRenameStart = (conv: ThreadSummary) => {
    // Defer entering edit mode until the menu has fully closed. If we mounted the
    // autofocus input now, MUI's focus restoration when the menu closes would
    // immediately blur it — firing onBlur, which submits and tears the field down
    // before you can type (looks like "rename does nothing"). The menu's onExited
    // applies this once focus has settled.
    setPendingRename(conv);
    handleMenuClose();
  };

  const handleRenameSubmit = () => {
    if (renamingId && renameValue.trim()) {
      onRename(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  };

  return (
    <div className={classes.root}>
      {conversations.length === 0 ? null : (
        <List disablePadding dense>
          {conversations.map(conv => (
            <ListItem
              key={conv.id}
              button
              className={
                conv.id === activeId ? classes.activeItem : classes.listItem
              }
              ContainerProps={{ className: classes.container }}
              onClick={() => onSelect(conv.id)}
            >
              <ListItemIcon style={{ minWidth: 32 }}>
                <StatusDot status={toConvStatus(conv.working, conv.unread)}>
                  <ChatBubbleOutlineIcon fontSize="small" />
                </StatusDot>
              </ListItemIcon>
              {renamingId === conv.id ? (
                <TextField
                  className={classes.renameInput}
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onBlur={handleRenameSubmit}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRenameSubmit();
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  autoFocus
                  fullWidth
                  size="small"
                  variant="standard"
                />
              ) : (
                <Tooltip title={conv.title} placement="right" arrow>
                  <ListItemText
                    primary={
                      <>
                        {conv.pinned && (
                          <BookmarkIcon className={classes.pinnedIcon} />
                        )}
                        {conv.title}
                      </>
                    }
                    primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                  />
                </Tooltip>
              )}
              <ListItemSecondaryAction
                className={`${classes.action}${
                  menuAnchor?.id === conv.id ? ` ${classes.actionVisible}` : ''
                }`}
              >
                <IconButton
                  edge="end"
                  size="small"
                  aria-label="Conversation options"
                  onClick={e => handleMenuOpen(e, conv.id)}
                >
                  <MoreVertIcon fontSize="small" />
                </IconButton>
              </ListItemSecondaryAction>
            </ListItem>
          ))}
        </List>
      )}

      <Menu
        anchorEl={menuAnchor?.el}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
        disableRestoreFocus
        TransitionProps={{
          onExited: () => {
            if (pendingRename) {
              setRenameValue(pendingRename.title);
              setRenamingId(pendingRename.id);
              setPendingRename(null);
            }
          },
        }}
      >
        {menuAnchor &&
          (() => {
            const conv = conversations.find(c => c.id === menuAnchor.id);
            if (!conv) return null;
            return [
              <MenuItem key="rename" onClick={() => handleRenameStart(conv)}>
                Rename
              </MenuItem>,
              <MenuItem
                key="pin"
                onClick={() => {
                  onPin(conv.id);
                  handleMenuClose();
                }}
              >
                {conv.pinned ? 'Unpin' : 'Pin'}
              </MenuItem>,
              <MenuItem
                key="delete"
                onClick={() => {
                  onDelete(conv.id);
                  handleMenuClose();
                }}
              >
                Delete
              </MenuItem>,
            ];
          })()}
      </Menu>
    </div>
  );
}
