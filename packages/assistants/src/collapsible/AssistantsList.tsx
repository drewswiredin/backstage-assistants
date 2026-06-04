import { FC } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import List from '@material-ui/core/List';
import ListItem from '@material-ui/core/ListItem';
import ListItemIcon from '@material-ui/core/ListItemIcon';
import ListItemText from '@material-ui/core/ListItemText';
import Typography from '@material-ui/core/Typography';
import { AssistantSummary } from '@drewswiredin/backstage-plugin-assistants-common';
import { AssistantAvatar } from './surface/AssistantAvatar';

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
  },
  icon: {
    minWidth: 32,
    display: 'inline-flex',
    alignItems: 'center',
  },
}));

/**
 * The in-page assistant switcher (top tier of the left sidebar). Lists every
 * accessible assistant; selecting one drives `?assistant=<id>` via `onSelect`,
 * which remounts the chat onto that assistant's (siloed) conversation set. The
 * active assistant is highlighted.
 *
 * @public
 */
export const AssistantsList: FC<{
  assistants: AssistantSummary[];
  activeId: string;
  onSelect: (id: string) => void;
}> = ({ assistants, activeId, onSelect }) => {
  const classes = useStyles();

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
          </ListItem>
        ))}
      </List>
    </div>
  );
};
