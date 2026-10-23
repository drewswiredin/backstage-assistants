import { useMemo, useState } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import {
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  FormLabel,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@material-ui/core';
import HelpOutlineIcon from '@material-ui/icons/HelpOutline';
import WarningIcon from '@material-ui/icons/Warning';
import {
  isSensitiveElicitationField,
  parseElicitationSchema,
  validateElicitationContent,
  type ElicitationField,
  type ElicitationPrompt,
  type ElicitationResponseRequest,
} from '@drewswiredin/backstage-plugin-assistants-common';
import { useToolGuards } from '../toolGuards';

const useStyles = makeStyles(theme => ({
  card: {
    margin: theme.spacing(0.5, 0),
    padding: theme.spacing(1.25, 1.5),
    border: `1px solid ${
      theme.palette.info?.main ?? theme.palette.primary.main
    }`,
    borderRadius: theme.shape.borderRadius,
    backgroundColor:
      theme.palette.type === 'dark'
        ? 'rgba(33,150,243,0.10)'
        : 'rgba(33,150,243,0.06)',
    maxWidth: 560,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    fontWeight: 600,
    color: theme.palette.info?.main ?? theme.palette.primary.main,
  },
  message: { margin: theme.spacing(0.5, 0, 1), whiteSpace: 'pre-wrap' },
  field: { display: 'block', marginBottom: theme.spacing(1.25) },
  warning: {
    display: 'flex',
    gap: theme.spacing(0.75),
    alignItems: 'flex-start',
    margin: theme.spacing(0.5, 0, 1),
    color: theme.palette.warning?.main ?? '#b07a05',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginTop: theme.spacing(0.5),
  },
  errors: { color: theme.palette.error.main, marginTop: theme.spacing(0.75) },
  summary: { color: theme.palette.text.secondary },
}));

type Values = Record<string, unknown>;

function initialValues(fields: ElicitationField[]): Values {
  const values: Values = {};
  for (const f of fields) {
    if (f.kind === 'boolean') values[f.name] = f.default ?? false;
    else if (f.kind === 'multiselect') values[f.name] = f.default ?? [];
    else if (f.default !== undefined) values[f.name] = String(f.default);
  }
  return values;
}

/** The answer as the server expects it: numbers as numbers, blanks left out. */
function contentOf(fields: ElicitationField[], values: Values): Values {
  const content: Values = {};
  for (const f of fields) {
    const v = values[f.name];
    if (f.kind === 'number') {
      if (v !== undefined && v !== '') content[f.name] = Number(v);
    } else if (f.kind === 'text' || f.kind === 'select') {
      if (typeof v === 'string' && v !== '') content[f.name] = v;
    } else if (v !== undefined) {
      content[f.name] = v;
    }
  }
  return content;
}

/** "Project: Pylon" for the collapsed card, from what this browser sent. */
function summaryOf(fields: ElicitationField[], content: Values): string {
  return fields
    .filter(f => content[f.name] !== undefined)
    .map(f => {
      const v = content[f.name];
      const label = (value: unknown) =>
        f.kind === 'select' || f.kind === 'multiselect'
          ? f.options.find(o => o.value === value)?.label ?? String(value)
          : String(value);
      let shown: string;
      if (Array.isArray(v)) shown = v.map(label).join(', ');
      else if (typeof v === 'boolean') shown = v ? 'yes' : 'no';
      else shown = label(v);
      return `${f.title}: ${shown}`;
    })
    .join(' · ');
}

const OUTCOME: Record<string, string> = {
  accepted: 'Answered',
  declined: 'Declined',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

const OUTCOME_OF_ACTION: Record<ElicitationResponseRequest['action'], string> =
  {
    accept: OUTCOME.accepted,
    decline: OUTCOME.declined,
    cancel: OUTCOME.cancelled,
  };

const INPUT_TYPE: Record<string, string> = {
  email: 'email',
  uri: 'url',
  date: 'date',
  'date-time': 'datetime-local',
};

/** How the question ended, from the server's update, this browser, or the clock. */
function settledState(
  prompt: ElicitationPrompt,
  sent: { status: string; summary?: string } | undefined,
  closed: boolean,
): { status: string; summary?: string } | undefined {
  if (sent) return sent;
  if (prompt.status !== 'open') {
    return {
      status: OUTCOME[prompt.status],
      ...(prompt.answered?.length
        ? { summary: prompt.answered.join(', ') }
        : {}),
    };
  }
  if (Date.parse(prompt.expiresAt) < Date.now()) {
    return { status: OUTCOME.expired };
  }
  return closed ? { status: OUTCOME.cancelled } : undefined;
}

/**
 * An MCP server's question in the middle of a tool call (elicitation),
 * shown on the call as a form. The answer goes to that server only; the
 * model sees just the tool's result. Nothing is sent until the user chooses
 * Submit (enabled once the answer fits the form) or Decline; a question the
 * user walks away from (Stop, timeout, leaving) is cancelled for them. A
 * field that looks like a secret gets a warning, and Decline becomes the
 * main button.
 */
export function ElicitationCard({
  prompt,
  closed = false,
}: {
  prompt: ElicitationPrompt;
  /** The turn ended: an open question can no longer be answered. */
  closed?: boolean;
}) {
  const classes = useStyles();
  const { respondElicitation } = useToolGuards();
  const parsed = useMemo(
    () => parseElicitationSchema(prompt.requestedSchema),
    [prompt.requestedSchema],
  );
  const fields = 'fields' in parsed ? parsed.fields : [];
  const [values, setValues] = useState<Values>(() => initialValues(fields));
  const [errors, setErrors] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ status: string; summary?: string }>();
  const sensitive = fields.some(isSensitiveElicitationField);
  // Submit waits until the answer fits the form.
  const incomplete =
    validateElicitationContent(fields, contentOf(fields, values)).length > 0;

  const header = (
    <Typography variant="body2" component="div" className={classes.header}>
      <HelpOutlineIcon fontSize="small" />
      <span>
        {prompt.serverTitle} needs input for <strong>{prompt.tool}</strong>
      </span>
    </Typography>
  );

  const settled = settledState(prompt, sent, closed);
  if (settled) {
    return (
      <Box className={classes.card}>
        {header}
        <Typography
          variant="caption"
          component="div"
          className={classes.summary}
        >
          {settled.status}
          {settled.summary ? ` — ${settled.summary}` : ''}
        </Typography>
      </Box>
    );
  }

  const send = async (answer: ElicitationResponseRequest) => {
    setSending(true);
    setErrors([]);
    try {
      await respondElicitation(prompt.id, answer);
      setSent({
        status: OUTCOME_OF_ACTION[answer.action],
        ...(answer.action === 'accept'
          ? { summary: summaryOf(fields, answer.content ?? {}) }
          : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/already answered|expired|No such question/i.test(message)) {
        setSent({ status: OUTCOME.expired });
      } else {
        setErrors([message]);
      }
    } finally {
      setSending(false);
    }
  };

  const set = (name: string, value: unknown) =>
    setValues(prev => ({ ...prev, [name]: value }));

  const renderField = (f: ElicitationField) => {
    const label = `${f.title}${f.required ? ' *' : ''}`;
    switch (f.kind) {
      case 'boolean':
        return (
          <FormControlLabel
            key={f.name}
            className={classes.field}
            control={
              <Checkbox
                checked={values[f.name] === true}
                onChange={e => set(f.name, e.target.checked)}
                color="primary"
                size="small"
              />
            }
            label={label}
          />
        );
      case 'select':
        if (f.options.length <= 5) {
          return (
            <FormControl key={f.name} className={classes.field}>
              <FormLabel>{label}</FormLabel>
              <RadioGroup
                value={(values[f.name] as string) ?? ''}
                onChange={e => set(f.name, e.target.value)}
              >
                {f.options.map(o => (
                  <FormControlLabel
                    key={o.value}
                    value={o.value}
                    control={<Radio size="small" color="primary" />}
                    label={o.label}
                  />
                ))}
              </RadioGroup>
              {f.description && (
                <FormHelperText>{f.description}</FormHelperText>
              )}
            </FormControl>
          );
        }
        return (
          <TextField
            key={f.name}
            id={`elicitation-${prompt.id}-${f.name}`}
            select
            fullWidth
            size="small"
            variant="outlined"
            className={classes.field}
            label={label}
            helperText={f.description}
            value={(values[f.name] as string) ?? ''}
            onChange={e => set(f.name, e.target.value)}
          >
            {f.options.map(o => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
        );
      case 'multiselect': {
        const chosen = (values[f.name] as string[]) ?? [];
        return (
          <FormControl key={f.name} className={classes.field}>
            <FormLabel>{label}</FormLabel>
            <FormGroup>
              {f.options.map(o => (
                <FormControlLabel
                  key={o.value}
                  control={
                    <Checkbox
                      size="small"
                      color="primary"
                      checked={chosen.includes(o.value)}
                      onChange={e =>
                        set(
                          f.name,
                          e.target.checked
                            ? [...chosen, o.value]
                            : chosen.filter(v => v !== o.value),
                        )
                      }
                    />
                  }
                  label={o.label}
                />
              ))}
            </FormGroup>
            {f.description && <FormHelperText>{f.description}</FormHelperText>}
          </FormControl>
        );
      }
      case 'number':
        return (
          <TextField
            key={f.name}
            id={`elicitation-${prompt.id}-${f.name}`}
            type="number"
            fullWidth
            size="small"
            variant="outlined"
            className={classes.field}
            label={label}
            helperText={f.description}
            inputProps={{
              min: f.minimum,
              max: f.maximum,
              step: f.integer ? 1 : 'any',
            }}
            value={(values[f.name] as string) ?? ''}
            onChange={e => set(f.name, e.target.value)}
          />
        );
      default:
        return (
          <TextField
            key={f.name}
            id={`elicitation-${prompt.id}-${f.name}`}
            type={(f.format && INPUT_TYPE[f.format]) || 'text'}
            fullWidth
            size="small"
            variant="outlined"
            className={classes.field}
            label={label}
            helperText={f.description}
            InputLabelProps={
              f.format === 'date' || f.format === 'date-time'
                ? { shrink: true }
                : undefined
            }
            inputProps={{ minLength: f.minLength, maxLength: f.maxLength }}
            value={(values[f.name] as string) ?? ''}
            onChange={e => set(f.name, e.target.value)}
          />
        );
    }
  };

  return (
    <Box className={classes.card}>
      {header}
      <Typography variant="body2" className={classes.message}>
        {prompt.message}
      </Typography>
      {'unsupported' in parsed ? (
        <Typography variant="body2" className={classes.warning}>
          <WarningIcon fontSize="small" />
          This request can't be shown here ({parsed.unsupported}).
        </Typography>
      ) : (
        <>
          {sensitive && (
            <Typography variant="body2" className={classes.warning}>
              <WarningIcon fontSize="small" />
              This asks for something that looks like a secret. MCP servers must
              not ask for passwords or tokens this way; decline unless you are
              sure.
            </Typography>
          )}
          {fields.map(renderField)}
        </>
      )}
      <div className={classes.actions}>
        {'fields' in parsed && (
          <Button
            type="button"
            size="small"
            color="primary"
            variant={sensitive ? 'outlined' : 'contained'}
            disabled={sending || incomplete}
            onClick={() =>
              send({ action: 'accept', content: contentOf(fields, values) })
            }
          >
            Submit
          </Button>
        )}
        <Button
          type="button"
          size="small"
          color="primary"
          variant={
            sensitive || 'unsupported' in parsed ? 'contained' : 'outlined'
          }
          disabled={sending}
          onClick={() => send({ action: 'decline' })}
        >
          Decline
        </Button>
      </div>
      {errors.length > 0 && (
        <Typography
          variant="caption"
          component="div"
          className={classes.errors}
        >
          {errors.join('. ')}
        </Typography>
      )}
    </Box>
  );
}
