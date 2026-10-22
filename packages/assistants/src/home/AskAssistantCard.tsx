import { useState, type FormEvent, type KeyboardEvent } from 'react';
import useAsync from 'react-use/lib/useAsync';
import { useApi } from '@backstage/core-plugin-api';
import { useRouteRef } from '@backstage/frontend-plugin-api';
import { usePermission } from '@backstage/plugin-permission-react';
import { makeStyles } from '@material-ui/core/styles';
import { IconButton, InputBase, Tooltip } from '@material-ui/core';
import SendIcon from '@material-ui/icons/Send';
import { assistantUsePermission } from '@drewswiredin/backstage-plugin-assistants-common';
import { assistantsApiRef } from '../api';
import { AssistantAvatar } from '../collapsible/surface/AssistantAvatar';
import {
  loadPanelAssistant,
  resolvePanelAssistant,
} from '../panel/panelStorage';
import { usePanelControl } from '../panel/panelControl';
import { rootRouteRef } from '../routes';

const useStyles = makeStyles(theme => ({
  // The home card is the bar: no second border inside it. The card's content
  // padding is reclaimed so a one-row card holds the bar without scrolling.
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    margin: theme.spacing(-1.25, -0.5),
    padding: theme.spacing(0.25, 0),
  },
  input: {
    flex: 1,
    fontSize: theme.typography.body1.fontSize,
  },
}));

/**
 * The homepage composer: one bar, like a search bar, with the assistant's
 * avatar, a text box, and send. Sending opens the panel with the message
 * already sent, so the bar is a way in, not a second chat. Without the panel
 * it takes the question to the Assistants page. Renders nothing for a user
 * without `assistant.use` or when no assistant is available.
 */
export function AskAssistantCard() {
  const classes = useStyles();
  const api = useApi(assistantsApiRef);
  const panel = usePanelControl();
  const rootRoute = useRouteRef(rootRouteRef);
  const canUse = usePermission({ permission: assistantUsePermission });
  const status = useAsync(
    async () => (canUse.allowed ? api.getStatus() : undefined),
    [api, canUse.allowed],
  );
  const [text, setText] = useState('');

  const assistant =
    canUse.allowed && status.value
      ? resolvePanelAssistant(
          status.value.assistants,
          loadPanelAssistant(),
          status.value.defaultAssistant,
        )
      : undefined;
  if (!assistant) {
    return null;
  }

  const send = (prompt: string) => {
    const message = prompt.trim();
    if (!message) return;
    if (panel) {
      panel.open({ assistantId: assistant.id, prompt: message });
      setText('');
      return;
    }
    // No panel in this app: the page is the only surface.
    const root = rootRoute?.();
    if (root) {
      window.location.assign(
        `${root}?assistant=${encodeURIComponent(assistant.id)}`,
      );
    }
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(text);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(text);
    }
  };

  return (
    <form className={classes.bar} onSubmit={onSubmit}>
      <AssistantAvatar color={assistant.color} size={26} />
      <InputBase
        className={classes.input}
        placeholder={
          assistant.ui?.composer?.placeholder ?? `Ask ${assistant.title}…`
        }
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={onKeyDown}
        multiline
        maxRows={3}
        inputProps={{ 'aria-label': 'Ask the assistant' }}
      />
      <Tooltip title="Ask">
        <span>
          <IconButton
            type="submit"
            size="small"
            color="primary"
            disabled={!text.trim()}
            aria-label="Ask"
          >
            <SendIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </form>
  );
}
