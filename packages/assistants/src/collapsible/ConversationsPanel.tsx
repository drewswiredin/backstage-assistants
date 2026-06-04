import { MouseEvent, useState } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import {
  ButtonBase,
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
  Typography,
} from '@material-ui/core';
import AddIcon from '@material-ui/icons/Add';
import BookmarkIcon from '@material-ui/icons/Bookmark';
import ChatBubbleOutlineIcon from '@material-ui/icons/ChatBubbleOutline';
import MoreVertIcon from '@material-ui/icons/MoreVert';
import type { Conversation } from './useConversations';

const useStyles = makeStyles(theme => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    padding: theme.spacing(2, 1.5),
    gap: theme.spacing(1),
  },
  newChatButton: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1, 1.5),
    borderRadius: theme.shape.borderRadius,
    color: theme.palette.primary.main,
    fontWeight: 600,
    fontSize: '0.875rem',
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
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
  emptyState: {
    padding: theme.spacing(3, 2),
    textAlign: 'center',
  },
}));

/**
 * Props for {@link ConversationsPanel}.
 *
 * @public
 */
export interface ConversationsPanelProps {
  conversations: Conversation[];
  activeId: string | null;
  onNew: () => void;
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
  onNew,
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

  const handleMenuOpen = (e: MouseEvent<HTMLElement>, id: string) => {
    e.stopPropagation();
    setMenuAnchor({ el: e.currentTarget, id });
  };

  const handleMenuClose = () => setMenuAnchor(null);

  const handleRenameStart = (conv: Conversation) => {
    setRenamingId(conv.id);
    setRenameValue(conv.title);
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
      <ButtonBase className={classes.newChatButton} onClick={onNew}>
        <AddIcon fontSize="small" />
        <Typography variant="body2" color="primary" style={{ fontWeight: 600 }}>
          New Chat
        </Typography>
      </ButtonBase>

      {conversations.length === 0 ? (
        <div className={classes.emptyState}>
          <Typography variant="caption" color="textSecondary">
            No conversations yet
          </Typography>
        </div>
      ) : (
        <List disablePadding dense>
          {conversations.map(conv => (
            <ListItem
              key={conv.id}
              button
              className={
                conv.id === activeId ? classes.activeItem : classes.listItem
              }
              onClick={() => onSelect(conv.id)}
            >
              <ListItemIcon style={{ minWidth: 32 }}>
                <ChatBubbleOutlineIcon fontSize="small" />
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
              <ListItemSecondaryAction>
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
