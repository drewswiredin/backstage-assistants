/**
 * The model and reasoning-effort pickers, rendered inside the composer so
 * every surface (the page, the panel) offers them in the same place. The
 * host owns the state and the thread PATCH; this renders and reports.
 */
import { useMemo } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import {
  FormControl,
  ListItemIcon,
  ListSubheader,
  MenuItem,
  Select,
  Tooltip,
} from '@material-ui/core';
import CheckIcon from '@material-ui/icons/Check';
import StarIcon from '@material-ui/icons/Star';
import {
  REASONING_LEVELS,
  type ModelId,
  type ModelOption,
  type ReasoningLevel,
} from '@drewswiredin/backstage-plugin-assistants-common';

const useStyles = makeStyles(theme => ({
  root: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.25),
    minWidth: 0,
  },
  select: {
    fontSize: theme.typography.caption.fontSize,
    color: theme.palette.text.secondary,
    borderRadius: 999,
    maxWidth: 220,
    transition: theme.transitions.create('background-color'),
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
    '& .MuiSelect-select': {
      display: 'flex',
      alignItems: 'center',
      borderRadius: 999,
      paddingTop: theme.spacing(0.5),
      paddingBottom: theme.spacing(0.5),
      paddingLeft: theme.spacing(1.25),
      paddingRight: theme.spacing(3),
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      '&:focus': {
        backgroundColor: 'transparent',
        borderRadius: 999,
      },
    },
    '& .MuiSelect-icon': {
      color: theme.palette.text.secondary,
      right: theme.spacing(0.5),
    },
  },
  groupLabel: {
    lineHeight: 2,
    fontSize: theme.typography.caption.fontSize,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: theme.palette.text.secondary,
    backgroundColor: theme.palette.background.paper,
  },
  item: {
    paddingTop: theme.spacing(0.75),
    paddingBottom: theme.spacing(0.75),
  },
  itemCheck: {
    minWidth: theme.spacing(3.5),
    color: theme.palette.primary.main,
  },
  defaultStar: {
    fontSize: '1rem',
    color: theme.palette.warning.main,
    marginLeft: theme.spacing(1),
  },
}));

/**
 * Split a model id into a display vendor + name. Models route through one
 * provider (e.g. `openrouter`) but the meaningful family is the vendor prefix
 * in the model name (`google/gemini-2.5-flash`). Falls back to the provider /
 * raw id when there is no `/`.
 */
export function splitModel(
  id: ModelId,
  pool: ModelOption[],
): { vendor: string; name: string } {
  const opt = pool.find(m => m.id === id);
  const raw = opt?.model ?? id;
  const slash = raw.indexOf('/');
  if (slash !== -1) {
    return { vendor: raw.slice(0, slash), name: raw.slice(slash + 1) };
  }
  return { vendor: opt?.provider ?? 'models', name: raw };
}

/** The short model name (after the vendor prefix), for the selector trigger. */
export function modelLabel(id: ModelId, pool: ModelOption[]): string {
  return splitModel(id, pool).name;
}

/** Menu labels for the effort tiers a reasoning model offers. */
const REASONING_LABELS: Record<ReasoningLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  max: 'Max',
};

const MENU_PROPS = {
  anchorOrigin: { vertical: 'top', horizontal: 'left' },
  transformOrigin: { vertical: 'bottom', horizontal: 'left' },
  getContentAnchorEl: null,
} as const;

export interface ModelControlsProps {
  /** The platform model pool (for labels and the reasoning flag). */
  pool: ModelOption[];
  /** The models this conversation may use. */
  allowed: ModelId[];
  modelId: ModelId;
  /** The assistant's default, starred in the menu. */
  defaultModel: ModelId;
  onModelChange: (modelId: ModelId) => void;
  /** The chosen effort, or undefined for the provider's own default. */
  reasoningLevel: ReasoningLevel | undefined;
  onReasoningChange: (level: ReasoningLevel | undefined) => void;
}

export function ModelControls({
  pool,
  allowed,
  modelId,
  defaultModel,
  onModelChange,
  reasoningLevel,
  onReasoningChange,
}: ModelControlsProps) {
  const classes = useStyles();
  const groups = useMemo<Array<[string, ModelId[]]>>(() => {
    const byVendor = new Map<string, ModelId[]>();
    for (const id of allowed) {
      const { vendor } = splitModel(id, pool);
      const list = byVendor.get(vendor);
      if (list) list.push(id);
      else byVendor.set(vendor, [id]);
    }
    return [...byVendor.entries()];
  }, [allowed, pool]);
  const reasons = pool.find(m => m.id === modelId)?.reasoning === true;

  return (
    <span className={classes.root}>
      <FormControl>
        <Select
          value={modelId}
          onChange={e => onModelChange(e.target.value as ModelId)}
          disableUnderline
          className={classes.select}
          inputProps={{ 'aria-label': 'Model' }}
          renderValue={value => modelLabel(value as ModelId, pool)}
          MenuProps={MENU_PROPS}
        >
          {groups.flatMap(([vendor, ids]) => [
            <ListSubheader
              key={`group-${vendor}`}
              disableSticky
              className={classes.groupLabel}
            >
              {vendor}
            </ListSubheader>,
            ...ids.map(id => (
              <MenuItem key={id} value={id} className={classes.item}>
                <ListItemIcon className={classes.itemCheck}>
                  {id === modelId ? <CheckIcon fontSize="small" /> : null}
                </ListItemIcon>
                <span style={{ flexGrow: 1 }}>{modelLabel(id, pool)}</span>
                {id === defaultModel && (
                  <Tooltip title="Assistant default">
                    <StarIcon
                      className={classes.defaultStar}
                      aria-label="Assistant default"
                    />
                  </Tooltip>
                )}
              </MenuItem>
            )),
          ])}
        </Select>
      </FormControl>
      {/* Only for a reasoning model, so a non-reasoning model shows no dead
          control. "Default" clears the choice and lets the provider decide. */}
      {reasons && (
        <FormControl>
          <Select
            value={reasoningLevel ?? ''}
            onChange={e => {
              const next = e.target.value as ReasoningLevel | '';
              onReasoningChange(next ? next : undefined);
            }}
            disableUnderline
            // Without displayEmpty, MUI skips renderValue for the empty (= no
            // explicit level) value and the trigger renders as a bare caret.
            displayEmpty
            className={classes.select}
            inputProps={{ 'aria-label': 'Reasoning effort' }}
            renderValue={value =>
              value ? `Effort: ${value as ReasoningLevel}` : 'Effort: default'
            }
            MenuProps={MENU_PROPS}
          >
            <MenuItem value="" className={classes.item}>
              <ListItemIcon className={classes.itemCheck}>
                {reasoningLevel === undefined ? (
                  <CheckIcon fontSize="small" />
                ) : null}
              </ListItemIcon>
              <span style={{ flexGrow: 1 }}>Default</span>
            </MenuItem>
            {REASONING_LEVELS.map(level => (
              <MenuItem key={level} value={level} className={classes.item}>
                <ListItemIcon className={classes.itemCheck}>
                  {level === reasoningLevel ? (
                    <CheckIcon fontSize="small" />
                  ) : null}
                </ListItemIcon>
                <span style={{ flexGrow: 1 }}>{REASONING_LABELS[level]}</span>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}
    </span>
  );
}
