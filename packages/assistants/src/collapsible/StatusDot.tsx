/**
 * The single rendering of conversation status as a badge dot — used by the
 * conversation rows, the agent rail, and the nav icon so they can never disagree
 * on look or meaning:
 *   - working (in-flight) → amber, pulsing
 *   - unread → solid red
 *   - read → nothing
 */
import Badge from '@material-ui/core/Badge';
import { makeStyles } from '@material-ui/core/styles';
import type { PropsWithChildren } from 'react';
import type { ConvStatus } from './useThreadStatus';

const WORKING_COLOR = '#e3a008'; // amber / "warning"
const UNREAD_COLOR = '#f44336'; // red

const useStyles = makeStyles({
  '@keyframes auiStatusPulse': {
    '0%': { transform: 'scale(1)', opacity: 1 },
    '50%': { transform: 'scale(1.6)', opacity: 0.4 },
    '100%': { transform: 'scale(1)', opacity: 1 },
  },
  working: {
    backgroundColor: WORKING_COLOR,
    color: WORKING_COLOR,
    animation: '$auiStatusPulse 1.2s ease-in-out infinite',
  },
  unread: { backgroundColor: UNREAD_COLOR, color: UNREAD_COLOR },
});

export interface StatusDotProps {
  status: ConvStatus;
  /** Badge overlap shape around the wrapped element. Defaults to circular. */
  overlap?: 'circular' | 'rectangular';
}

export function StatusDot({
  status,
  overlap = 'circular',
  children,
}: PropsWithChildren<StatusDotProps>) {
  const classes = useStyles();
  return (
    <Badge
      variant="dot"
      overlap={overlap}
      invisible={status === 'read'}
      classes={{ badge: status === 'working' ? classes.working : classes.unread }}
    >
      {children}
    </Badge>
  );
}
