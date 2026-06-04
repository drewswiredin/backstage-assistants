import { makeStyles } from '@material-ui/core/styles';
import { BackstageLogo } from './BackstageLogo';

/**
 * Default avatar tint for assistants with no configured `color`. Backstage teal.
 *
 * @public
 */
export const DEFAULT_AVATAR_COLOR = '#36baa2';

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
  return (
    <span
      aria-hidden
      className={className ? `${classes.disc} ${className}` : classes.disc}
      style={{ width: size, height: size, color: color ?? DEFAULT_AVATAR_COLOR }}
    >
      <BackstageLogo className={classes.logo} />
    </span>
  );
}
