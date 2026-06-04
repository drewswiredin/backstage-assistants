import { FC } from 'react';
import { makeStyles, useTheme, fade } from '@material-ui/core/styles';
import Dialog from '@material-ui/core/Dialog';
import DialogContent from '@material-ui/core/DialogContent';
import IconButton from '@material-ui/core/IconButton';
import Typography from '@material-ui/core/Typography';
import Tooltip from '@material-ui/core/Tooltip';
import CloseIcon from '@material-ui/icons/Close';
import StarIcon from '@material-ui/icons/Star';
import InfoOutlinedIcon from '@material-ui/icons/InfoOutlined';
import { AssistantSummary } from '@drewswiredin/backstage-plugin-assistants-common';
import { AssistantAvatar, resolveAssistantColor } from './surface/AssistantAvatar';

const MONO =
  '"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace';

const useStyles = makeStyles(theme => ({
  // overflow:hidden so the accent bar clips to the dialog's radius.
  paper: {
    overflow: 'hidden',
  },
  accent: {
    height: 3,
    width: '100%',
  },
  closeButton: {
    position: 'absolute',
    right: theme.spacing(1),
    top: theme.spacing(1),
    color: theme.palette.text.secondary,
    zIndex: 1,
  },
  content: {
    padding: theme.spacing(2, 3, 3),
  },
  // Centered, profile-style identity.
  profile: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: theme.spacing(1),
  },
  avatarHalo: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    padding: theme.spacing(1.25),
  },
  name: {
    fontWeight: 600,
  },
  description: {
    color: theme.palette.text.secondary,
    maxWidth: '34ch',
  },
  section: {
    marginTop: theme.spacing(2.5),
  },
  sectionLabel: {
    display: 'block',
    color: theme.palette.text.secondary,
    fontWeight: 600,
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: theme.spacing(0.5),
  },
  count: {
    color: theme.palette.text.hint,
    fontWeight: 400,
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  // Technical list row: monospace name; a hover-revealed ⓘ carries the detail.
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.5, 0.75),
    borderRadius: theme.shape.borderRadius,
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
    '&:hover $infoIcon': {
      opacity: 1,
      pointerEvents: 'auto',
    },
  },
  itemName: {
    fontFamily: MONO,
    fontSize: '0.8rem',
    fontWeight: 500,
    color: theme.palette.text.primary,
  },
  // Hidden until row hover; its tooltip holds the tool's description.
  infoIcon: {
    marginLeft: 'auto',
    flexShrink: 0,
    fontSize: '1rem',
    color: theme.palette.text.hint,
    cursor: 'help',
    opacity: 0,
    pointerEvents: 'none',
    transition: theme.transitions.create('opacity'),
  },
  defaultMarker: {
    marginLeft: 'auto',
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.25),
    flexShrink: 0,
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: theme.palette.text.secondary,
  },
  defaultStar: {
    fontSize: '0.9rem',
  },
  muted: {
    color: theme.palette.text.secondary,
    fontStyle: 'italic',
  },
  // A tool group (one per source: Backstage actions, or each MCP server).
  toolGroup: {
    marginTop: theme.spacing(1.25),
  },
  groupHead: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    padding: theme.spacing(0, 0.75),
    marginBottom: theme.spacing(0.25),
  },
  groupName: {
    fontFamily: MONO,
    fontSize: '0.72rem',
    fontWeight: 700,
    color: theme.palette.text.secondary,
  },
  groupTag: {
    fontSize: '0.6rem',
    letterSpacing: 0.3,
    color: theme.palette.text.hint,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 4,
    padding: '1px 5px',
  },
  groupCount: {
    marginLeft: 'auto',
    color: theme.palette.text.hint,
    fontSize: '0.7rem',
  },
}));

const BACKSTAGE_SOURCE = 'backstage';

/** The tool's source for grouping: explicit `source`, else the MCP namespace
 * prefix in the name, else Backstage. */
const toolSource = (t: { name: string; source?: string }): string =>
  t.source ??
  (t.name.includes('__')
    ? t.name.slice(0, t.name.indexOf('__'))
    : BACKSTAGE_SOURCE);

/** Display name within a group: drop the `<source>__` namespace prefix. */
const toolDisplayName = (name: string): string => {
  const i = name.indexOf('__');
  return i === -1 ? name : name.slice(i + 2);
};

/** Compact model name: drop the `provider:` and `vendor/` prefixes. */
const modelName = (id: string) => id.split(/[:/]/).pop() || id;

/**
 * Assistant detail modal: a centered, profile-style identity (avatar + name +
 * description, with an agent-color accent bar and avatar halo) over technical
 * lists of the assistant's Tools (monospace name + description, full text on
 * hover) and Models (monospace, default marked). All data comes from the
 * browser-safe {@link AssistantSummary}.
 *
 * @public
 */
export const AssistantDetailDialog: FC<{
  assistant?: AssistantSummary;
  open: boolean;
  onClose: () => void;
}> = ({ assistant, open, onClose }) => {
  const classes = useStyles();
  const theme = useTheme();
  if (!assistant) {
    return null;
  }
  const tools = assistant.tools ?? [];
  const models = assistant.models;
  const color = resolveAssistantColor(assistant.color, theme.palette.type);

  // Group tools by source — Backstage actions first, then each MCP server.
  const toolGroups = (() => {
    const map = new Map<string, typeof tools>();
    for (const t of tools) {
      const key = toolSource(t);
      const arr = map.get(key);
      if (arr) arr.push(t);
      else map.set(key, [t]);
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === BACKSTAGE_SOURCE) return -1;
      if (b === BACKSTAGE_SOURCE) return 1;
      return a.localeCompare(b);
    });
  })();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      classes={{ paper: classes.paper }}
    >
      <div className={classes.accent} style={{ backgroundColor: color }} />
      <IconButton
        aria-label="Close"
        className={classes.closeButton}
        size="small"
        onClick={onClose}
      >
        <CloseIcon fontSize="small" />
      </IconButton>

      <DialogContent className={classes.content}>
        <div className={classes.profile}>
          <span
            className={classes.avatarHalo}
            style={{ backgroundColor: fade(color, 0.15) }}
          >
            <AssistantAvatar color={assistant.color} size={56} />
          </span>
          <Typography variant="h6" className={classes.name}>
            {assistant.title}
          </Typography>
          {assistant.description && (
            <Typography variant="body2" className={classes.description}>
              {assistant.description}
            </Typography>
          )}
        </div>

        <div className={classes.section}>
          <Typography variant="caption" className={classes.sectionLabel}>
            Tools <span className={classes.count}>{tools.length}</span>
          </Typography>
          {tools.length === 0 ? (
            <Typography variant="body2" className={classes.muted}>
              No tools available
            </Typography>
          ) : (
            toolGroups.map(([source, groupTools]) => {
              const isBackstage = source === BACKSTAGE_SOURCE;
              return (
                <div key={source} className={classes.toolGroup}>
                  <div className={classes.groupHead}>
                    <span className={classes.groupName}>
                      {isBackstage ? 'Backstage' : source}
                    </span>
                    <span className={classes.groupTag}>
                      {isBackstage ? 'runs as user' : 'MCP'}
                    </span>
                    <span className={classes.groupCount}>
                      {groupTools.length}
                    </span>
                  </div>
                  <ul className={classes.list}>
                    {groupTools.map(t => (
                      <li key={t.name} className={classes.row}>
                        <span className={classes.itemName}>
                          {toolDisplayName(t.name)}
                        </span>
                        {t.description && (
                          <Tooltip title={t.description} placement="top-end">
                            <InfoOutlinedIcon className={classes.infoIcon} />
                          </Tooltip>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </div>

        <div className={classes.section}>
          <Typography variant="caption" className={classes.sectionLabel}>
            Models{' '}
            {models && <span className={classes.count}>{models.length}</span>}
          </Typography>
          {!models ? (
            <Typography variant="body2" className={classes.muted}>
              All available models
            </Typography>
          ) : (
            <ul className={classes.list}>
              {models.map(m => (
                <li key={m} className={classes.row}>
                  <span className={classes.itemName}>{modelName(m)}</span>
                  {m === assistant.defaultModel && (
                    <span className={classes.defaultMarker}>
                      <StarIcon
                        className={classes.defaultStar}
                        style={{ color }}
                      />
                      default
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
