// The vendored assistant-ui composer CSS, so this composer looks exactly like
// the page's and the panel's. Imported at the top of this lazy chunk (react-ui
// ships `sideEffects: false`, so a bare package CSS import would be shaken).
import '../collapsible/surface/styles/assistant-ui.css';

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import useAsync from 'react-use/lib/useAsync';
import { useApi } from '@backstage/core-plugin-api';
import { useRouteRef } from '@backstage/frontend-plugin-api';
import { usePermission } from '@backstage/plugin-permission-react';
import { makeStyles, useTheme } from '@material-ui/core/styles';
import {
  ButtonBase,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from '@material-ui/core';
import ArrowDropDownIcon from '@material-ui/icons/ArrowDropDown';
import CheckIcon from '@material-ui/icons/Check';
import { SendHorizontalIcon } from 'lucide-react';
import {
  assistantUsePermission,
  type AssistantSummary,
  type ModelId,
  type ReasoningLevel,
  type StatusResponse,
} from '@drewswiredin/backstage-plugin-assistants-common';
import { assistantsApiRef } from '../api';
import {
  AssistantAvatar,
  resolveAssistantColor,
} from '../collapsible/surface/AssistantAvatar';
import { ContextGauge } from '../collapsible/surface/ContextGauge';
import { ModelControls } from '../collapsible/surface/ModelControls';
import {
  auiThemeVars,
  composerFocusStyle,
  useComposerStyles,
} from '../collapsible/surface/composerStyles';
import {
  loadPanelAssistant,
  resolvePanelAssistant,
  savePanelAssistant,
} from '../panel/panelStorage';
import { usePanelControl } from '../panel/panelControl';
import { rootRouteRef } from '../routes';

const useStyles = makeStyles(theme => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    // Reclaim the home card's content padding so the header and composer
    // fill the card the way the panel fills its column.
    margin: theme.spacing(-1, -0.5),
  },
  host: {
    ...auiThemeVars(theme),
    '& .aui-composer-root:focus-within': {
      borderColor: 'var(--aui-composer-focus)',
      boxShadow: '0 0 0 1px var(--aui-composer-focus)',
    },
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  picker: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.5, 0.5, 0.5, 0.25),
    borderRadius: theme.shape.borderRadius,
    textAlign: 'left',
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
  },
  title: {
    fontWeight: 600,
  },
  // The stock textarea class is restyled by the shared composer styles; this
  // keeps it from inheriting the card's font.
  textarea: {
    font: 'inherit',
  },
}));

/**
 * The homepage composer: the panel's header (the assistant, with a menu to
 * pick another) and the same composer as the page and the panel, with the
 * model and reasoning effort pickers, but no conversation. Sending opens the
 * panel on a fresh conversation with the message, the assistant, the model,
 * and the effort already chosen. Without the panel it takes the question to
 * the Assistants page. Renders nothing for a user without `assistant.use`.
 */
export function AskAssistantCard() {
  const api = useApi(assistantsApiRef);
  const canUse = usePermission({ permission: assistantUsePermission });
  const status = useAsync(
    async () => (canUse.allowed ? api.getStatus() : undefined),
    [api, canUse.allowed],
  );
  if (
    !canUse.allowed ||
    !status.value ||
    status.value.assistants.length === 0
  ) {
    return null;
  }
  return <Composer status={status.value} />;
}

function Composer({ status }: { status: StatusResponse }) {
  const classes = useStyles();
  const composer = useComposerStyles();
  const theme = useTheme();
  const panel = usePanelControl();
  const rootRoute = useRouteRef(rootRouteRef);

  // The assistant: the user's pick (shared with the panel), else the default.
  const [assistantId, setAssistantId] = useState<string | undefined>(
    loadPanelAssistant,
  );
  const assistant = resolvePanelAssistant(
    status.assistants,
    assistantId,
    status.defaultAssistant,
  ) as AssistantSummary;
  const allowed = assistant.models ?? status.models.map(m => m.id);
  const assistantDefault =
    assistant.defaultModel && allowed.includes(assistant.defaultModel)
      ? assistant.defaultModel
      : status.defaultModel;

  // Model and effort for the conversation about to start; reset when the
  // assistant changes.
  const [modelId, setModelId] = useState<ModelId>(assistantDefault);
  const [reasoningLevel, setReasoningLevel] = useState<
    ReasoningLevel | undefined
  >(undefined);
  useEffect(() => {
    setModelId(assistantDefault);
    setReasoningLevel(undefined);
  }, [assistant.id, assistantDefault]);

  const [text, setText] = useState('');
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const color = resolveAssistantColor(assistant.color, theme.palette.type);
  const reasons = status.models.find(m => m.id === modelId)?.reasoning === true;

  const send = () => {
    const prompt = text.trim();
    if (!prompt) return;
    if (panel) {
      panel.open({
        assistantId: assistant.id,
        prompt,
        modelId,
        reasoningLevel: reasons ? reasoningLevel : undefined,
      });
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
    send();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className={`${classes.root} ${classes.host}`}>
      <div className={classes.header}>
        <ButtonBase
          className={classes.picker}
          onClick={e => setPickerAnchor(e.currentTarget)}
          aria-haspopup="menu"
          aria-label={`Assistant: ${assistant.title}. Choose another`}
          disabled={status.assistants.length < 2}
        >
          <AssistantAvatar color={assistant.color} size={26} />
          <Typography variant="subtitle1" className={classes.title}>
            {assistant.title}
          </Typography>
          {status.assistants.length > 1 && (
            <ArrowDropDownIcon fontSize="small" color="action" />
          )}
        </ButtonBase>
        <Menu
          anchorEl={pickerAnchor}
          open={pickerAnchor !== null}
          onClose={() => setPickerAnchor(null)}
          getContentAnchorEl={null}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        >
          {status.assistants.map(a => (
            <MenuItem
              key={a.id}
              selected={a.id === assistant.id}
              onClick={() => {
                setPickerAnchor(null);
                savePanelAssistant(a.id);
                setAssistantId(a.id);
              }}
            >
              <ListItemIcon>
                <AssistantAvatar color={a.color} size={22} />
              </ListItemIcon>
              <ListItemText
                primary={a.title}
                secondary={a.isDefault ? 'Default' : undefined}
              />
              {a.id === assistant.id && (
                <CheckIcon fontSize="small" color="action" />
              )}
            </MenuItem>
          ))}
        </Menu>
      </div>
      {/* The same markup and classes as the runtime composer, minus the
          attachment control (attachments join in the panel). A click on the
          composer's empty space focuses the input, as on the page. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <form
        className={`aui-composer-root ${composer.composerRoot}`}
        style={composerFocusStyle(color)}
        onSubmit={onSubmit}
        onMouseDown={e => {
          const target = e.target as HTMLElement;
          if (
            target.closest(
              'button, a, textarea, input, select, [role="button"]',
            )
          ) {
            return;
          }
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <textarea
          ref={inputRef}
          className={`aui-composer-input ${composer.composerInput} ${classes.textarea}`}
          rows={1}
          placeholder={
            assistant.ui?.composer?.placeholder ?? 'Ask the assistant…'
          }
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Ask the assistant"
        />
        <div className={composer.composerRow2}>
          <ModelControls
            pool={status.models}
            allowed={allowed}
            modelId={modelId}
            defaultModel={assistantDefault}
            onModelChange={next => {
              setModelId(next);
              if (status.models.find(m => m.id === next)?.reasoning !== true) {
                setReasoningLevel(undefined);
              }
            }}
            reasoningLevel={reasoningLevel}
            onReasoningChange={setReasoningLevel}
          />
          <span className={composer.composerRow2Spacer} />
          <span className={composer.gaugeSlot}>
            <ContextGauge
              used={undefined}
              max={status.models.find(m => m.id === modelId)?.contextWindow}
              color={color}
            />
          </span>
          <button
            type="submit"
            className="aui-button aui-button-primary aui-button-icon aui-composer-send"
            disabled={!text.trim()}
            aria-label="Send"
            title="Send"
          >
            <SendHorizontalIcon />
          </button>
        </div>
      </form>
    </div>
  );
}
