import { FC, MouseEvent, useState } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import List from '@material-ui/core/List';
import ListItem from '@material-ui/core/ListItem';
import ListItemIcon from '@material-ui/core/ListItemIcon';
import ListItemSecondaryAction from '@material-ui/core/ListItemSecondaryAction';
import ListItemText from '@material-ui/core/ListItemText';
import IconButton from '@material-ui/core/IconButton';
import Tooltip from '@material-ui/core/Tooltip';
import Typography from '@material-ui/core/Typography';
import InfoOutlinedIcon from '@material-ui/icons/InfoOutlined';
import { AssistantSummary } from '@drewswiredin/backstage-plugin-assistants-common';
import { AssistantAvatar } from './surface/AssistantAvatar';
import { AssistantDetailDialog } from './AssistantDetailDialog';

const useStyles = makeStyles(theme => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    padding: theme.spacing(1, 1.5, 0),
  },
  label: {
    color: theme.palette.text.secondary,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    padding: theme.spacing(0, 0.5, 0.5),
  },
  item: {
    borderRadius: theme.shape.borderRadius,
    paddingRight: theme.spacing(5),
    '&:hover $infoAction': {
      visibility: 'visible',
    },
  },
  icon: {
    minWidth: 32,
    display: 'inline-flex',
    alignItems: 'center',
  },
  infoAction: {
    visibility: 'hidden',
  },
}));

/**
 * The in-page assistant switcher (top tier of the left sidebar). Lists every
 * accessible assistant; selecting one drives `?assistant=<id>` via `onSelect`,
 * which remounts the chat onto that assistant's (siloed) conversation set. The
 * active assistant is highlighted. A hover-revealed info button opens the
 * {@link AssistantDetailDialog} (description, tools, models).
 *
 * @public
 */
export const AssistantsList: FC<{
  assistants: AssistantSummary[];
  activeId: string;
  onSelect: (id: string) => void;
}> = ({ assistants, activeId, onSelect }) => {
  const classes = useStyles();
  const [detailId, setDetailId] = useState<string | null>(null);

  const openDetail = (e: MouseEvent<HTMLElement>, id: string) => {
    e.stopPropagation();
    setDetailId(id);
  };

  return (
    <div className={classes.root}>
      <Typography variant="caption" className={classes.label}>
        Assistants
      </Typography>
      <List dense disablePadding>
        {assistants.map(a => (
          <ListItem
            key={a.id}
            button
            selected={a.id === activeId}
            className={classes.item}
            onClick={() => onSelect(a.id)}
          >
            <ListItemIcon className={classes.icon}>
              <AssistantAvatar color={a.color} size={22} />
            </ListItemIcon>
            <ListItemText
              primary={a.title}
              primaryTypographyProps={{ variant: 'body2', noWrap: true }}
            />
            <ListItemSecondaryAction className={classes.infoAction}>
              <Tooltip title="Details">
                <IconButton
                  edge="end"
                  size="small"
                  aria-label={`${a.title} details`}
                  onClick={e => openDetail(e, a.id)}
                >
                  <InfoOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </ListItemSecondaryAction>
          </ListItem>
        ))}
      </List>

      <AssistantDetailDialog
        assistant={assistants.find(a => a.id === detailId)}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
      />
    </div>
  );
};
