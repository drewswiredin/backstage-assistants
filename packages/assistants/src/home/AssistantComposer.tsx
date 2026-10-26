import {
  useCallback,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '@backstage/core-plugin-api';
import { useRouteRef } from '@backstage/frontend-plugin-api';
import { makeStyles } from '@material-ui/core/styles';
import { clientToolsApiRef } from '../clientTools/api';
import { EmbeddedAssistant } from '../embedded/EmbeddedAssistant';
import { usePanelControl } from '../panel/panelControl';
import {
  loadPanelAssistant,
  onPanelAssistantChange,
  savePanelAssistant,
} from '../panel/panelStorage';
import { threadRouteRef } from '../routes';

/**
 * How the homepage composer looks:
 *
 * - `bar`: the composer alone, one row (input and send), like a search bar.
 *   No header, no assistant picker; the remembered pick or the default.
 * - `padded`: the panel's header (assistant picker) and the full composer,
 *   framed, inside the card's padding.
 * - `full`: the same, filling the card edge to edge.
 * - `titled`: `padded` under a card header, like the other home cards.
 *
 * @public
 */
export type AssistantComposerVariant = 'bar' | 'padded' | 'full' | 'titled';

const useStyles = makeStyles(theme => ({
  // The page's chat pane frame around the embedded surface.
  frame: {
    height: '100%',
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    overflow: 'hidden',
  },
  // Fills the home card by cancelling its content padding.
  full: {
    margin: theme.spacing(-2),
    height: `calc(100% + ${theme.spacing(4)}px)`,
  },
  // The bar carries no frame: the composer's own border is the outline.
  bar: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
  },
}));

/**
 * The homepage composer: the panel's surface in composer-only mode, so the
 * assistant picker and the composer are the same components as everywhere
 * else. The first send creates the conversation; it is handed to the panel,
 * which continues it, and the composer starts over. Without the panel the
 * conversation opens on the Assistants page.
 *
 * `assistantsHomeModule` places it on a `@backstage/plugin-home` home page;
 * an app can also render it inside its own card or page. `full` assumes the
 * home card's 16 px content padding.
 *
 * @public
 */
export function AssistantComposer({
  variant = 'padded',
  width,
}: {
  variant?: AssistantComposerVariant;
  /**
   * The composer's width as a percentage of the card, 20 to 100. Defaults to
   * 100 for `bar`, like a search bar, and 80 for the others.
   */
  width?: number;
}) {
  const classes = useStyles();
  const panel = usePanelControl();
  const navigate = useNavigate();
  const threadRoute = useRouteRef(threadRouteRef);
  const { tools } = useApi(clientToolsApiRef);
  // The pick shared with the panel: one made there shows here at once.
  const assistantId = useSyncExternalStore(
    onPanelAssistantChange,
    loadPanelAssistant,
  );
  // Remounting the surface starts it over on a fresh thread (a new session,
  // or a new pick).
  const [session, setSession] = useState(0);

  const handOff = useCallback(
    (remoteId: string) => {
      if (panel) panel.open({ threadId: remoteId });
      else if (threadRoute) navigate(threadRoute({ threadId: remoteId }));
      setSession(s => s + 1);
    },
    [panel, threadRoute, navigate],
  );
  const pickAssistant = useCallback((id: string) => savePanelAssistant(id), []);
  const noop = useCallback(() => {}, []);

  let className = classes.frame;
  if (variant === 'full') className = `${classes.frame} ${classes.full}`;
  if (variant === 'bar') className = classes.bar;

  return (
    <div
      className={className}
      style={
        width
          ? ({
              '--assistant-composer-width': `${Math.min(
                Math.max(width, 20),
                100,
              )}%`,
            } as CSSProperties)
          : undefined
      }
    >
      <EmbeddedAssistant
        key={`${session}:${assistantId ?? ''}`}
        composerOnly
        bare={variant === 'bar'}
        assistantId={assistantId}
        clientTools={tools}
        active={false}
        onThreadChange={handOff}
        onAssistantChange={pickAssistant}
        onThreadPick={noop}
        onOpenFull={noop}
        onNew={noop}
        onClose={noop}
      />
    </div>
  );
}
