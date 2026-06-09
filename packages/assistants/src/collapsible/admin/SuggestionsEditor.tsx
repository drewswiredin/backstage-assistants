/**
 * A small editable list of starter-prompt suggestions ({title, prompt}[]) for an
 * assistant's per-assistant `ui.suggestions`. Add / edit / remove rows; an empty
 * list clears the assistant's own suggestions (the runtime deep-merge then falls
 * back to the global `ui.suggestions`).
 */
import { makeStyles } from '@material-ui/core/styles';
import TextField from '@material-ui/core/TextField';
import IconButton from '@material-ui/core/IconButton';
import Button from '@material-ui/core/Button';
import Tooltip from '@material-ui/core/Tooltip';
import CloseIcon from '@material-ui/icons/Close';
import AddIcon from '@material-ui/icons/Add';

const useStyles = makeStyles(theme => ({
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1),
  },
  title: {
    flex: '0 0 30%',
  },
  prompt: {
    flex: 1,
  },
  remove: {
    marginTop: theme.spacing(0.5),
  },
  add: {
    textTransform: 'none',
  },
}));

export interface Suggestion {
  title: string;
  prompt: string;
}

export function SuggestionsEditor({
  value,
  onChange,
}: {
  value: Suggestion[];
  onChange: (next: Suggestion[]) => void;
}) {
  const classes = useStyles();

  const update = (index: number, patch: Partial<Suggestion>) =>
    onChange(value.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const remove = (index: number) =>
    onChange(value.filter((_s, i) => i !== index));

  const add = () => onChange([...value, { title: '', prompt: '' }]);

  return (
    <div>
      {value.map((s, i) => (
        // Index keys are safe here: rows are only added/removed at the end or
        // via explicit remove, and each field is fully controlled.
        // eslint-disable-next-line react/no-array-index-key
        <div className={classes.row} key={i}>
          <TextField
            className={classes.title}
            size="small"
            variant="outlined"
            label="Label"
            value={s.title}
            onChange={e => update(i, { title: e.target.value })}
          />
          <TextField
            className={classes.prompt}
            size="small"
            variant="outlined"
            label="Prompt sent on click"
            value={s.prompt}
            onChange={e => update(i, { prompt: e.target.value })}
          />
          <Tooltip title="Remove suggestion">
            <IconButton
              className={classes.remove}
              size="small"
              aria-label="Remove suggestion"
              onClick={() => remove(i)}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </div>
      ))}
      <Button
        className={classes.add}
        size="small"
        startIcon={<AddIcon />}
        onClick={add}
      >
        Add suggestion
      </Button>
    </div>
  );
}
