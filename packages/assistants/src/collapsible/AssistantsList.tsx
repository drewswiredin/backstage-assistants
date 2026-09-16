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
import { StatusDot } from './StatusDot';
import type { ConvStatus } from './useThreadStatus';

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
  // The hover rule lives on the container <li> (ListItem's ContainerProps), which
  // wraps BOTH the row and the secondary action. The action is a *sibling* of the
  // ListItem root, so a :hover rule on the row itself can't reach it.
  container: {
    '&:hover $infoAction': {
      opacity: 1,
      pointerEvents: 'auto',
    },
  },
  icon: {
    minWidth: 32,
    display: 'inline-flex',
    alignItems: 'center',
  },
  // Hidden until row hover (opacity + pointer-events so it's not clickable while
  // hidden); no reserved gutter so the title uses full width and truncates later.
  infoAction: {
    opacity: 0,
    pointerEvents: 'none',
    color: theme.palette.text.secondary,
    transition: theme.transitions.create('opacity'),
  },
}));

/**
 * The in-page assistant switcher (top tier of the left sidebar). Lists every
 * accessible assistant; selecting one drives `?assistant=<id>` via `onSelect`,
 * which switches the (never-remounted) runtime onto that assistant's siloed
 * conversation set. The
 * active assistant is highlighted. A hover-revealed info button opens the
 * {@link AssistantDetailDialog} (description, tools, models).
 *
 * @public
 */
export const AssistantsList: FC<{
  assistants: AssistantSummary[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Per-assistant rollup status (working/unread/read) for the rail dots. */
  assistantStatus?: (assistantId: string) => ConvStatus;
}> = ({ assistants, activeId, onSelect, assistantStatus }) => {
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
            ContainerProps={{ className: classes.container }}
            onClick={() => onSelect(a.id)}
          >
            <ListItemIcon className={classes.icon}>
              <StatusDot status={assistantStatus?.(a.id) ?? 'read'}>
                <AssistantAvatar color={a.color} size={22} />
              </StatusDot>
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
