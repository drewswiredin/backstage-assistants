import { FC } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import List from '@material-ui/core/List';
import ListItem from '@material-ui/core/ListItem';
import ListItemText from '@material-ui/core/ListItemText';
import Typography from '@material-ui/core/Typography';

const useStyles = makeStyles(theme => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    padding: theme.spacing(0, 1.5, 1),
  },
  label: {
    color: theme.palette.text.secondary,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    padding: theme.spacing(0, 0.5, 0.5),
  },
  empty: {
    color: theme.palette.text.secondary,
    padding: theme.spacing(0, 0.5, 0.5),
  },
}));

/**
 * The Tools section of the sidebar — a plain, informational list of the tool
 * names available to the active assistant (from `AssistantSummary.tools`).
 * Intentionally unstyled beyond the shared list typography; may later move into
 * a gear/settings affordance.
 *
 * @public
 */
export const ToolsList: FC<{ tools: string[] }> = ({ tools }) => {
  const classes = useStyles();

  return (
    <div className={classes.root}>
      <Typography variant="caption" className={classes.label}>
        Tools
      </Typography>
      {tools.length === 0 ? (
        <Typography variant="body2" className={classes.empty}>
          No tools available
        </Typography>
      ) : (
        <List dense disablePadding>
          {tools.map(name => (
            <ListItem key={name} dense>
              <ListItemText
                primary={name}
                primaryTypographyProps={{ variant: 'body2', noWrap: true }}
              />
            </ListItem>
          ))}
        </List>
      )}
    </div>
  );
};
