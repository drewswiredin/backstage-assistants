import { FC } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import Dialog from '@material-ui/core/Dialog';
import DialogTitle from '@material-ui/core/DialogTitle';
import DialogContent from '@material-ui/core/DialogContent';
import IconButton from '@material-ui/core/IconButton';
import Typography from '@material-ui/core/Typography';
import Chip from '@material-ui/core/Chip';
import CloseIcon from '@material-ui/icons/Close';
import { AssistantSummary } from '@drewswiredin/backstage-plugin-assistants-common';
import { AssistantAvatar } from './surface/AssistantAvatar';

const useStyles = makeStyles(theme => ({
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    paddingRight: theme.spacing(4),
  },
  titleText: {
    fontWeight: 600,
  },
  closeButton: {
    position: 'absolute',
    right: theme.spacing(1),
    top: theme.spacing(1),
    color: theme.palette.text.secondary,
  },
  section: {
    marginTop: theme.spacing(2.5),
  },
  sectionLabel: {
    display: 'block',
    color: theme.palette.text.secondary,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing(1),
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.5),
  },
  muted: {
    color: theme.palette.text.secondary,
    fontStyle: 'italic',
  },
}));

/** Strip the `<providerId>:` prefix from a model id for display. */
const modelSlug = (id: string) => id.split(':').slice(1).join(':') || id;

/**
 * Assistant detail modal: avatar + name, description, the assistant's available
 * tools, and its allowed models (default marked). All data comes from the
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
  if (!assistant) {
    return null;
  }
  const tools = assistant.tools ?? [];
  const models = assistant.models;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle disableTypography>
        <div className={classes.titleRow}>
          <AssistantAvatar color={assistant.color} size={32} />
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
          <Typography variant="body2" color="textPrimary">
            {assistant.description}
          </Typography>
        )}

        <div className={classes.section}>
          <Typography variant="caption" className={classes.sectionLabel}>
            Tools
          </Typography>
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
          <Typography variant="caption" className={classes.sectionLabel}>
            Models
          </Typography>
          {!models ? (
            <Typography variant="body2" className={classes.muted}>
              All available models
            </Typography>
          ) : (
            <div className={classes.chips}>
              {models.map(m => {
                const isDefault = m === assistant.defaultModel;
                return (
                  <Chip
                    key={m}
                    size="small"
                    variant={isDefault ? 'default' : 'outlined'}
                    color={isDefault ? 'primary' : 'default'}
                    label={isDefault ? `${modelSlug(m)} · default` : modelSlug(m)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
