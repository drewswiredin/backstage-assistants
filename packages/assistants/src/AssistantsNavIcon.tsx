import { Badge } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import { RiRobot2Line } from '@remixicon/react';
import { useApi } from '@backstage/core-plugin-api';
import { assistantsApiRef } from './api';
import { useThreadStatus } from './collapsible/useThreadStatus';

const useStyles = makeStyles({
  '@keyframes auiNavPulse': {
    '0%': { transform: 'scale(1)', opacity: 1 },
    '50%': { transform: 'scale(1.5)', opacity: 0.45 },
    '100%': { transform: 'scale(1)', opacity: 1 },
  },
  pulseDot: { animation: '$auiNavPulse 1.2s ease-in-out infinite' },
});

/**
 * The Assistants nav-rail icon with a live status dot: a pulsing dot if any
 * conversation (across all assistants) is generating, else a solid red dot if
 * any is unread, else nothing — generating wins. Derived from the same
 * Signals-backed status store as the in-page indicators, so they never disagree.
 *
 * @public
 */
export function AssistantsNavIcon() {
  const classes = useStyles();
  const api = useApi(assistantsApiRef);
  // No focused conversation in the nav context, so pass undefined.
  const { overallStatus } = useThreadStatus(api, undefined);

  return (
    <Badge
      color={overallStatus === 'working' ? 'primary' : 'error'}
      variant="dot"
      overlap="circular"
      invisible={overallStatus === 'read'}
      classes={
        overallStatus === 'working' ? { dot: classes.pulseDot } : undefined
      }
    >
      <RiRobot2Line />
    </Badge>
  );
}
