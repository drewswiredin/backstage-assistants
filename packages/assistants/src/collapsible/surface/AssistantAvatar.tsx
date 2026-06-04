import { makeStyles, useTheme } from '@material-ui/core/styles';
import { BackstageLogo } from './BackstageLogo';

/**
 * Default avatar tint for assistants with no configured `color`. Matches the
 * official Backstage brand teal used by the app's own logo (LogoIcon/LogoFull).
 *
 * @public
 */
export const DEFAULT_AVATAR_COLOR = '#7df3e1';

const clamp = (n: number, min: number, max: number) =>
  Math.min(Math.max(n, min), max);

function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h
      .split('')
      .map(c => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    return null;
  }
  const num = parseInt(h, 16);
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) {
      h = ((gn - bn) / d) % 6;
    } else if (max === gn) {
      h = (bn - rn) / d + 2;
    } else {
      h = (rn - gn) / d + 4;
    }
    h = h * 60;
    if (h < 0) {
      h += 360;
    }
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const channel = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`;
}

/**
 * Resolve an assistant's configured `color` to a shade with enough contrast for
 * the active theme's surfaces. The hue and saturation (the assistant's identity)
 * are preserved; only lightness is clamped into a legible band — bright on dark,
 * deep on light — so a single configured color works as a floating, no-background
 * icon in both modes. Non-hex values are returned unchanged, and the function is
 * idempotent (re-resolving a resolved color is a no-op).
 *
 * @public
 */
export function resolveAssistantColor(
  color: string | undefined,
  themeType: 'light' | 'dark',
): string {
  const base = color ?? DEFAULT_AVATAR_COLOR;
  const rgb = hexToRgb(base);
  if (!rgb) {
    return base;
  }
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const adjustedL =
    themeType === 'dark' ? clamp(l, 0.6, 0.82) : clamp(l, 0.3, 0.46);
  return hslToHex(h, s, adjustedL);
}

const useStyles = makeStyles({
  // Transparent — the tinted logo "floats", no disc fill.
  disc: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  logo: {
    height: '100%',
    width: 'auto',
  },
});

/**
 * Avatar generator: the Backstage logo mark tinted by a hex `color` on a neutral
 * disc. `color` is the assistant's configured color; it falls back to
 * {@link DEFAULT_AVATAR_COLOR}. Reused in the assistant switcher list and the
 * collapsed rail (the chat surface tints its own message/welcome avatars with
 * the same color). A future variant can also emit a data-URI for `<img>`/favicon
 * use.
 *
 * @public
 */
export function AssistantAvatar({
  color,
  size = 28,
  className,
}: {
  color?: string;
  size?: number;
  className?: string;
}) {
  const classes = useStyles();
  const theme = useTheme();
  const resolved = resolveAssistantColor(color, theme.palette.type);
  return (
    <span
      aria-hidden
      className={className ? `${classes.disc} ${className}` : classes.disc}
      style={{ width: size, height: size, color: resolved }}
    >
      <BackstageLogo className={classes.logo} />
    </span>
  );
}
