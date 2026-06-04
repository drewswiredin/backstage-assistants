import { FC } from 'react';
import { makeStyles, useTheme, fade } from '@material-ui/core/styles';
import Dialog from '@material-ui/core/Dialog';
import DialogTitle from '@material-ui/core/DialogTitle';
import DialogContent from '@material-ui/core/DialogContent';
import IconButton from '@material-ui/core/IconButton';
import Typography from '@material-ui/core/Typography';
import Chip from '@material-ui/core/Chip';
import CloseIcon from '@material-ui/icons/Close';
import BuildIcon from '@material-ui/icons/Build';
import MemoryIcon from '@material-ui/icons/Memory';
import StarIcon from '@material-ui/icons/Star';
import { AssistantSummary } from '@drewswiredin/backstage-plugin-assistants-common';
import { AssistantAvatar, resolveAssistantColor } from './surface/AssistantAvatar';

const useStyles = makeStyles(theme => ({
  // overflow:hidden so the colored accent bar clips to the dialog's radius.
  paper: {
    overflow: 'hidden',
  },
  accent: {
    height: 4,
    width: '100%',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    paddingRight: theme.spacing(4),
  },
  // Faint agent-color halo behind the floating avatar.
  avatarHalo: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    padding: theme.spacing(1),
  },
  titleText: {
    fontWeight: 600,
  },
  closeButton: {
    position: 'absolute',
    right: theme.spacing(1),
    top: theme.spacing(1.5),
    color: theme.palette.text.secondary,
  },
  description: {
    marginTop: theme.spacing(0.5),
  },
  section: {
    marginTop: theme.spacing(2.5),
  },
  sectionHead: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1),
  },
  sectionIcon: {
    fontSize: '1.1rem',
    color: theme.palette.text.secondary,
  },
  sectionLabel: {
    color: theme.palette.text.secondary,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.75),
  },
  defaultChip: {
    fontWeight: 600,
  },
  defaultStar: {
    color: theme.palette.warning.main,
  },
  muted: {
    color: theme.palette.text.secondary,
    fontStyle: 'italic',
  },
}));

/** Compact model name: drop the `provider:` and `vendor/` prefixes. */
const modelName = (id: string) => id.split(/[:/]/).pop() || id;

/**
 * Assistant detail modal, themed by the assistant's color: a top accent bar and
 * a faint avatar halo in the (theme-resolved) agent color, icon-led Tools and
 * Models sections, and a starred "default" chip for the default model. All data
 * comes from the browser-safe {@link AssistantSummary}.
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

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      classes={{ paper: classes.paper }}
    >
      <div className={classes.accent} style={{ backgroundColor: color }} />
      <DialogTitle disableTypography>
        <div className={classes.titleRow}>
          <span
            className={classes.avatarHalo}
            style={{ backgroundColor: fade(color, 0.15) }}
          >
            <AssistantAvatar color={assistant.color} size={32} />
          </span>
          <Typography variant="h6" className={classes.titleText}>
            {assistant.title}
          </Typography>
        </div>
        <IconButton
          aria-label="Close"
          className={classes.closeButton}
          size="small"
          onClick={onClose}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {assistant.description && (
          <Typography
            variant="body2"
            color="textPrimary"
            className={classes.description}
          >
            {assistant.description}
          </Typography>
        )}

        <div className={classes.section}>
          <div className={classes.sectionHead}>
            <BuildIcon className={classes.sectionIcon} />
            <Typography variant="caption" className={classes.sectionLabel}>
              Tools
            </Typography>
          </div>
          {tools.length === 0 ? (
            <Typography variant="body2" className={classes.muted}>
              No tools available
            </Typography>
          ) : (
            <div className={classes.chips}>
              {tools.map(t => (
                <Chip key={t} size="small" variant="outlined" label={t} />
              ))}
            </div>
          )}
        </div>

        <div className={classes.section}>
          <div className={classes.sectionHead}>
            <MemoryIcon className={classes.sectionIcon} />
            <Typography variant="caption" className={classes.sectionLabel}>
              Models
            </Typography>
          </div>
          {!models ? (
            <Typography variant="body2" className={classes.muted}>
              All available models
            </Typography>
          ) : (
            <div className={classes.chips}>
              {models.map(m =>
                m === assistant.defaultModel ? (
                  <Chip
                    key={m}
                    size="small"
                    color="primary"
                    className={classes.defaultChip}
                    icon={<StarIcon className={classes.defaultStar} />}
                    label={`${modelName(m)} · default`}
                  />
                ) : (
                  <Chip
                    key={m}
                    size="small"
                    variant="outlined"
                    label={modelName(m)}
                  />
                ),
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
