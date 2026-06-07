/**
 * A compact circular context-usage gauge for the composer: a donut ring (used /
 * window) plus a `used / max` token readout. When the model's context window is
 * unknown (no `contextWindow` configured), the ring stays an empty track and the
 * readout shows `used / —` (no percentage).
 *
 * Token counts come from the official `useThreadTokenUsage()` hook upstream; this
 * component is purely presentational.
 */
import { Box, CircularProgress, Tooltip, Typography } from '@material-ui/core';
import { makeStyles, useTheme } from '@material-ui/core/styles';

const useStyles = makeStyles(theme => ({
  root: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    color: theme.palette.text.secondary,
  },
  ringWrap: {
    position: 'relative',
    display: 'inline-flex',
  },
  ringTrack: {
    color: theme.palette.divider,
  },
  ringValue: {
    position: 'absolute',
    left: 0,
  },
  readout: {
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
}));

/** Human-readable token count, e.g. 950 → "950", 12345 → "12.3k", 1200000 → "1.2M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export interface ContextGaugeProps {
  /** Tokens currently occupying the window (latest turn's total), if known. */
  used?: number;
  /** The model's context window (max tokens), if configured. */
  max?: number;
  /** Ring fill color — the active assistant's color (matches the composer glow). */
  color?: string;
  /** Pixel size of the ring. */
  size?: number;
}

export function ContextGauge({ used, max, color, size = 22 }: ContextGaugeProps) {
  const classes = useStyles();
  const theme = useTheme();

  const hasUsed = typeof used === 'number';
  const hasMax = typeof max === 'number' && max > 0;
  const pct = hasUsed && hasMax ? Math.min(100, (used! / max!) * 100) : 0;
  // One color — the assistant color — regardless of fill level (no escalation).
  const fill = color ?? theme.palette.primary.main;

  const readout = `${hasUsed ? formatTokens(used!) : '—'} / ${
    hasMax ? formatTokens(max!) : '—'
  }`;
  const tooltip = hasUsed
    ? `${used!.toLocaleString()} tokens used${
        hasMax
          ? ` of ${max!.toLocaleString()} (${Math.round(pct)}%)`
          : ' (model context window not configured)'
      }`
    : 'No token usage yet';

  return (
    <Tooltip title={tooltip}>
      <Box className={classes.root} aria-label={`Context usage: ${readout}`}>
        <span className={classes.ringWrap}>
          <CircularProgress
            variant="determinate"
            value={100}
            size={size}
            thickness={4}
            className={classes.ringTrack}
          />
          <CircularProgress
            variant="determinate"
            value={pct}
            size={size}
            thickness={4}
            className={classes.ringValue}
            style={{ color: fill }}
          />
        </span>
        <Typography variant="caption" component="span" className={classes.readout}>
          {readout}
        </Typography>
      </Box>
    </Tooltip>
  );
}
