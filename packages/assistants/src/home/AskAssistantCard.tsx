import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '@backstage/core-plugin-api';
import { useRouteRef } from '@backstage/frontend-plugin-api';
import { makeStyles } from '@material-ui/core/styles';
import { clientToolsApiRef } from '../clientTools/api';
import { EmbeddedAssistant } from '../embedded/EmbeddedAssistant';
import { usePanelControl } from '../panel/panelControl';
import { loadPanelAssistant, savePanelAssistant } from '../panel/panelStorage';
import { threadRouteRef } from '../routes';

const useStyles = makeStyles(theme => ({
  // The page's chat pane frame around the embedded surface, filling the home
  // card by cancelling the card's content padding.
  frame: {
    margin: theme.spacing(-2),
    height: `calc(100% + ${theme.spacing(4)}px)`,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    overflow: 'hidden',
  },
}));

/**
 * The homepage composer: the panel's surface in composer-only mode, so the
 * header's assistant picker and the composer (model, effort, attachments)
 * are the same components as everywhere else. The first send creates the
 * conversation; it is handed to the panel, which continues it, and the card
 * starts over. Without the panel the conversation opens on the page.
 */
export function AskAssistantCard() {
  const classes = useStyles();
  const panel = usePanelControl();
  const navigate = useNavigate();
  const threadRoute = useRouteRef(threadRouteRef);
  const { tools } = useApi(clientToolsApiRef);
  const [assistantId, setAssistantId] = useState<string | undefined>(
    loadPanelAssistant,
  );
  // Remounting the surface starts it over on a fresh thread.
  const [session, setSession] = useState(0);

  const handOff = useCallback(
    (remoteId: string) => {
      if (panel) panel.open({ threadId: remoteId });
      else if (threadRoute) navigate(threadRoute({ threadId: remoteId }));
      setSession(s => s + 1);
    },
    [panel, threadRoute, navigate],
  );
  const pickAssistant = useCallback((id: string) => {
    savePanelAssistant(id);
    setAssistantId(id);
    setSession(s => s + 1);
  }, []);
  const noop = useCallback(() => {}, []);

  return (
    <div className={classes.frame}>
      <EmbeddedAssistant
        key={session}
        composerOnly
        assistantId={assistantId}
        clientTools={tools}
        active={false}
        onThreadChange={handOff}
        onAssistantChange={pickAssistant}
        onThreadPick={noop}
        onOpenFull={noop}
        onNew={noop}
        onHide={noop}
        onClose={noop}
      />
    </div>
  );
}
