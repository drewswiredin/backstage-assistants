/**
 * The Models section: a compact list of the assigned models over an "＋ Add
 * model" picker (searchable, drawn from the global pool). Each assigned row
 * carries a ★ that marks it the default — starred = `defaultModel`; clicking
 * toggles it — plus an ⓘ with the full `provider:model` id and context window.
 * The first model added auto-becomes the default, and removing the default
 * promotes the next, so a restricted list always has an in-list default (never a
 * silent fall-through to the platform default). An empty allowlist means "all
 * models" — the hint then names the platform default that applies.
 */
import { useMemo } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import IconButton from '@material-ui/core/IconButton';
import Tooltip from '@material-ui/core/Tooltip';
import StarIcon from '@material-ui/icons/Star';
import StarBorderIcon from '@material-ui/icons/StarBorder';
import InfoOutlinedIcon from '@material-ui/icons/InfoOutlined';
import {
  ModelId,
  ModelOption,
} from '@drewswiredin/backstage-plugin-assistants-common';
import { AssignList, AssignOption, AssignRow } from './AssignList';
import { modelLabel } from './adminModel';

const useStyles = makeStyles(theme => ({
  star: {
    color: theme.palette.text.hint,
  },
  starActive: {
    color: theme.palette.warning?.main ?? '#b06f00',
  },
  info: {
    fontSize: '1rem',
    color: theme.palette.text.hint,
  },
}));

export function ModelsTransfer({
  pool,
  models,
  defaultModel,
  platformDefault,
  onModelsChange,
  onDefaultChange,
}: {
  /** The global model pool. */
  pool: ModelOption[];
  /** The current allowlist (empty = all models). */
  models: ModelId[];
  /** The current default model (null = platform default). */
  defaultModel: ModelId | null;
  /** The platform-wide default model, shown when no per-assistant default is set. */
  platformDefault: ModelId;
  /** Change the allowlist. */
  onModelsChange: (next: ModelId[]) => void;
  /** Change the default model. */
  onDefaultChange: (next: ModelId | null) => void;
}) {
  const classes = useStyles();

  const byId = useMemo(() => new Map(pool.map(m => [m.id, m])), [pool]);
  const assignedSet = useMemo(() => new Set(models), [models]);

  // Assigned rows in allowlist order; resolve provider from the pool when known.
  const rows: AssignRow[] = useMemo(
    () =>
      models.map(id => ({
        id,
        label: modelLabel(id),
        secondary: byId.get(id)?.provider,
      })),
    [models, byId],
  );

  const options: AssignOption[] = useMemo(
    () =>
      pool
        .filter(m => !assignedSet.has(m.id))
        .map(m => ({
          id: m.id,
          label: modelLabel(m.id),
          secondary: m.provider,
        })),
    [pool, assignedSet],
  );

  const add = (id: string) => {
    if (assignedSet.has(id)) {
      return;
    }
    onModelsChange([...models, id as ModelId]);
    // First model (or any add while none is set) becomes the default, so a
    // restricted list always has an in-list default — never the platform one.
    if (defaultModel === null) {
      onDefaultChange(id as ModelId);
    }
  };

  const remove = (id: string) => {
    const next = models.filter(m => m !== id);
    onModelsChange(next);
    // Removing the default promotes the first remaining model (or clears to the
    // platform default when the list goes empty).
    if (defaultModel === id) {
      onDefaultChange(next[0] ?? null);
    }
  };

  const toggleDefault = (id: string) =>
    onDefaultChange(defaultModel === id ? null : (id as ModelId));

  const renderAction = (row: AssignRow) => {
    const active = defaultModel === row.id;
    const opt = byId.get(row.id as ModelId);
    const info = opt?.contextWindow
      ? `${row.id} · ${opt.contextWindow.toLocaleString()} ctx`
      : row.id;
    return (
      <>
        <Tooltip title={active ? 'Default model' : 'Make default'}>
          <IconButton
            size="small"
            aria-label={
              active
                ? `Unset default ${row.label}`
                : `Make ${row.label} default`
            }
            aria-pressed={active}
            className={active ? classes.starActive : classes.star}
            onClick={() => toggleDefault(row.id)}
          >
            {active ? (
              <StarIcon fontSize="small" />
            ) : (
              <StarBorderIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
        <Tooltip title={info} placement="left">
          <IconButton size="small" aria-label={`Details for ${row.label}`}>
            <InfoOutlinedIcon className={classes.info} />
          </IconButton>
        </Tooltip>
      </>
    );
  };

  return (
    <AssignList
      rows={rows}
      options={options}
      onAdd={add}
      onRemove={remove}
      renderRowAction={renderAction}
      addLabel="Add model"
      searchPlaceholder="Search models…"
      emptyHint={`All models allowed · platform default: ${modelLabel(
        platformDefault,
      )}`}
      noOptionsText="All models are assigned."
    />
  );
}
