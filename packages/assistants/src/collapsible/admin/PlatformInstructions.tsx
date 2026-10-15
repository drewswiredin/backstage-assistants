/**
 * Read-only view of the platform instructions the backend sends before every
 * assistant's prompt, so an admin sees everything the model is told.
 * Collapsed by default under the prompt field.
 */
import { useState } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import Button from '@material-ui/core/Button';
import Collapse from '@material-ui/core/Collapse';
import Typography from '@material-ui/core/Typography';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import ExpandLessIcon from '@material-ui/icons/ExpandLess';
import { PLATFORM_INSTRUCTIONS } from '@drewswiredin/backstage-plugin-assistants-common';

const useStyles = makeStyles(theme => ({
  toggle: {
    textTransform: 'none',
    color: theme.palette.text.secondary,
  },
  hint: {
    display: 'block',
    color: theme.palette.text.secondary,
    margin: theme.spacing(1, 0),
  },
  text: {
    margin: 0,
    padding: theme.spacing(1.5),
    maxHeight: 360,
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    fontFamily: 'monospace',
    fontSize: '0.75rem',
    color: theme.palette.text.secondary,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
  },
}));

export function PlatformInstructions() {
  const classes = useStyles();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button
        size="small"
        className={classes.toggle}
        endIcon={open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        Platform instructions
      </Button>
      <Collapse in={open} unmountOnExit>
        <Typography variant="caption" className={classes.hint}>
          Sent before the system prompt on every turn, for every assistant. The
          system prompt takes precedence where they differ.
        </Typography>
        <pre className={classes.text}>{PLATFORM_INSTRUCTIONS}</pre>
      </Collapse>
    </div>
  );
}
