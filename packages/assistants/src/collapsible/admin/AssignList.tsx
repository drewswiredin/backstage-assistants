/**
 * The compact assignment control shared by the Models, Tools and Access
 * sections: a bare list of assigned rows (no surrounding box — each row carries
 * its own inline actions + a remove ✕) followed by a single "＋ Add …" button
 * that opens a searchable popover to add one unassigned item at a time. Each
 * wrapper supplies its rows, its addable options (optionally grouped), and any
 * per-row action (e.g. the model default ★ or a tool ⓘ); this file owns only the
 * layout, the picker, and the add/remove plumbing.
 *
 * The picker itself is MUI lab's `Autocomplete`, rendered statically open
 * inside the popover (an inline `PopperComponent`), which provides filtering,
 * grouping, freeSolo, and full keyboard navigation for free.
 */
import { HTMLAttributes, ReactNode, useMemo, useState } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import Button from '@material-ui/core/Button';
import IconButton from '@material-ui/core/IconButton';
import Popover from '@material-ui/core/Popover';
import TextField from '@material-ui/core/TextField';
import Tooltip from '@material-ui/core/Tooltip';
import Typography from '@material-ui/core/Typography';
import InputAdornment from '@material-ui/core/InputAdornment';
import AddIcon from '@material-ui/icons/Add';
import CloseIcon from '@material-ui/icons/Close';
import SearchIcon from '@material-ui/icons/Search';
import Autocomplete from '@material-ui/lab/Autocomplete';

/** Tone for a row's left accent + secondary text (drives stale flagging). */
export type RowTone = 'default' | 'error' | 'warning';

/** One assigned row. */
export interface AssignRow {
  id: string;
  label: string;
  /** Muted text shown after the label (provider, source, stale note…). */
  secondary?: string;
  tone?: RowTone;
  /** Optional leading icon. */
  icon?: ReactNode;
  /** Group key for the grouped assigned list (first-seen order is preserved). */
  group?: string;
}

/** One addable option in the popover picker. */
export interface AssignOption {
  id: string;
  label: string;
  secondary?: string;
  /** Group key for the grouped picker (first-seen order is preserved). */
  group?: string;
}

/** The freeSolo "Add “x”" affordance, injected as a synthetic option. */
interface TypedOption extends AssignOption {
  typedValue: string;
}

const isTyped = (o: AssignOption): o is TypedOption => 'typedValue' in o;

export interface AssignListProps {
  rows: AssignRow[];
  options: AssignOption[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  /** Label for the add button, e.g. "Add model". */
  addLabel: string;
  searchPlaceholder?: string;
  /** Group the picker options under {@link renderGroupHeader} headings. */
  grouped?: boolean;
  /** Group the assigned rows under {@link renderGroupHeader} headings too. */
  groupRows?: boolean;
  renderGroupHeader?: (group: string) => ReactNode;
  /** Inline action(s) rendered before the remove ✕ (e.g. ★ default, ⓘ info). */
  renderRowAction?: (row: AssignRow) => ReactNode;
  /** Muted line shown when there are no rows (e.g. "Empty — all allowed"). */
  emptyHint?: ReactNode;
  /** Text when the picker has nothing left to add. */
  noOptionsText?: string;
  /** Allow committing a typed value that matches no option (freeSolo). */
  allowTyped?: boolean;
  onAddTyped?: (query: string) => void;
}

const useStyles = makeStyles(theme => ({
  rows: {
    display: 'flex',
    flexDirection: 'column',
  },
  // Spacing above each assigned group after the first (grouped rows only).
  rowGroup: {
    marginTop: theme.spacing(1),
  },
  rowGroupHeader: {
    padding: theme.spacing(0.5, 0.5, 0.25),
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    minHeight: 34,
    padding: theme.spacing(0, 0.5),
    borderRadius: theme.shape.borderRadius,
    borderLeft: '2px solid transparent',
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
  },
  rowError: {
    borderLeftColor: theme.palette.error.main,
  },
  rowWarning: {
    borderLeftColor: theme.palette.warning?.main ?? '#b06f00',
  },
  rowIcon: {
    display: 'flex',
    flexShrink: 0,
    color: theme.palette.text.secondary,
    fontSize: '1.1rem',
  },
  label: {
    flexShrink: 0,
    fontSize: '0.92rem',
  },
  secondary: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: theme.palette.text.secondary,
    fontSize: '0.8rem',
  },
  secondaryError: {
    color: theme.palette.error.main,
  },
  secondaryWarning: {
    color: theme.palette.warning?.main ?? '#b06f00',
  },
  spacer: {
    flex: 1,
  },
  action: {
    flexShrink: 0,
  },
  addButton: {
    marginTop: theme.spacing(0.5),
    textTransform: 'none',
    color: theme.palette.text.secondary,
  },
  emptyHint: {
    color: theme.palette.text.secondary,
    fontSize: '0.85rem',
    fontStyle: 'italic',
    padding: theme.spacing(0.25, 0.5),
  },
  popover: {
    width: 360,
    maxHeight: 380,
    display: 'flex',
    flexDirection: 'column',
    padding: theme.spacing(1),
    paddingBottom: theme.spacing(0.5),
  },
  // The Autocomplete's inline "popper": rendered in place under the input.
  inlinePopper: {
    position: 'relative',
    width: '100% !important',
  },
  // Restyle the Autocomplete paper/listbox to sit flush inside the popover.
  autocompletePaper: {
    margin: theme.spacing(0.5, 0, 0),
    boxShadow: 'none',
  },
  autocompleteListbox: {
    maxHeight: 300,
    padding: theme.spacing(0, 0, 0.5),
  },
  autocompleteOption: {
    alignItems: 'baseline',
    gap: theme.spacing(1),
    padding: theme.spacing(0.5, 1.25),
    minHeight: 0,
  },
  groupHeader: {
    padding: theme.spacing(0.75, 1.25, 0.25),
  },
  optionLabel: {
    fontSize: '0.92rem',
    flexShrink: 0,
  },
  optionSecondary: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: theme.palette.text.secondary,
    fontSize: '0.8rem',
  },
}));

export function AssignList({
  rows,
  options,
  onAdd,
  onRemove,
  addLabel,
  searchPlaceholder,
  grouped,
  groupRows,
  renderGroupHeader,
  renderRowAction,
  emptyHint,
  noOptionsText,
  allowTyped,
  onAddTyped,
}: AssignListProps) {
  const classes = useStyles();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState('');

  const rowToneClass = (tone?: RowTone) => {
    if (tone === 'error') {
      return classes.rowError;
    }
    if (tone === 'warning') {
      return classes.rowWarning;
    }
    return '';
  };

  const secondaryToneClass = (tone?: RowTone) => {
    if (tone === 'error') {
      return classes.secondaryError;
    }
    if (tone === 'warning') {
      return classes.secondaryWarning;
    }
    return '';
  };

  const closePicker = () => {
    setAnchor(null);
    setQuery('');
  };

  // Match against label AND secondary; append the freeSolo "Add “x”" option
  // when the query matches no option exactly.
  const filterOptions = (
    opts: AssignOption[],
    state: { inputValue: string },
  ): AssignOption[] => {
    const q = state.inputValue.trim().toLowerCase();
    const filtered = !q
      ? opts
      : opts.filter(
          o =>
            o.label.toLowerCase().includes(q) ||
            (o.secondary?.toLowerCase().includes(q) ?? false),
        );
    if (
      allowTyped &&
      q.length > 0 &&
      !opts.some(o => o.label.toLowerCase() === q)
    ) {
      const typed: TypedOption = {
        id: `__typed__:${state.inputValue.trim()}`,
        label: `Add “${state.inputValue.trim()}”`,
        typedValue: state.inputValue.trim(),
      };
      return [typed, ...filtered];
    }
    return filtered;
  };

  const commitOption = (value: AssignOption | string | null) => {
    if (!value) {
      return;
    }
    if (typeof value === 'string') {
      // freeSolo Enter on raw text (no highlighted option).
      const trimmed = value.trim();
      if (trimmed && onAddTyped) {
        onAddTyped(trimmed);
      }
    } else if (isTyped(value)) {
      onAddTyped?.(value.typedValue);
    } else {
      onAdd(value.id);
    }
    setQuery('');
  };

  const renderRow = (row: AssignRow) => (
    <div key={row.id} className={`${classes.row} ${rowToneClass(row.tone)}`}>
      {row.icon && <span className={classes.rowIcon}>{row.icon}</span>}
      <span className={classes.label}>{row.label}</span>
      {row.secondary && (
        <span
          className={`${classes.secondary} ${secondaryToneClass(row.tone)}`}
          title={row.secondary}
        >
          {row.secondary}
        </span>
      )}
      {!row.secondary && <span className={classes.spacer} />}
      {renderRowAction && (
        <span className={classes.action}>{renderRowAction(row)}</span>
      )}
      <Tooltip title="Remove">
        <IconButton
          size="small"
          className={classes.action}
          aria-label={`Remove ${row.label}`}
          onClick={() => onRemove(row.id)}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </div>
  );

  // Group the assigned rows by `row.group` (first-seen order) when requested.
  const rowGroups = useMemo(() => {
    if (!groupRows) {
      return [];
    }
    const order: string[] = [];
    const byGroup = new Map<string, AssignRow[]>();
    for (const r of rows) {
      const g = r.group ?? '';
      if (!byGroup.has(g)) {
        byGroup.set(g, []);
        order.push(g);
      }
      byGroup.get(g)!.push(r);
    }
    return order.map(g => ({ group: g, items: byGroup.get(g)! }));
  }, [rows, groupRows]);

  return (
    <div>
      <div className={classes.rows}>
        {rows.length === 0 && emptyHint && (
          <Typography className={classes.emptyHint}>{emptyHint}</Typography>
        )}
        {groupRows
          ? rowGroups.map(({ group, items }, i) => (
              <div key={group} className={i > 0 ? classes.rowGroup : undefined}>
                <div className={classes.rowGroupHeader}>
                  {renderGroupHeader ? renderGroupHeader(group) : group}
                </div>
                {items.map(renderRow)}
              </div>
            ))
          : rows.map(renderRow)}
      </div>

      <Button
        size="small"
        className={classes.addButton}
        startIcon={<AddIcon />}
        onClick={e => setAnchor(e.currentTarget)}
      >
        {addLabel}
      </Button>

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={closePicker}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        PaperProps={{ className: classes.popover }}
      >
        <Autocomplete
          open
          autoHighlight
          // NO `disablePortal`: in MUI v4 it silently REPLACES a custom
          // PopperComponent with an internal position:absolute div
          // (Autocomplete.js: `disablePortal ? DisablePortal : PopperComponentProp`),
          // which takes the listbox out of flow and collapses the popover to
          // the input's height. The inline PopperComponent below already
          // renders in place — no portal is involved either way.
          freeSolo={allowTyped}
          options={options}
          value={null}
          inputValue={query}
          onInputChange={(_, v, reason) => {
            // `reset` fires after a selection with the chosen label — the input
            // should clear instead so the picker is ready for the next add.
            if (reason !== 'reset') {
              setQuery(v);
            }
          }}
          onChange={(_, value) => commitOption(value)}
          getOptionLabel={o => (typeof o === 'string' ? o : o.label)}
          groupBy={grouped ? o => o.group ?? '' : undefined}
          renderGroup={params => (
            <div key={params.key}>
              <div className={classes.groupHeader}>
                {renderGroupHeader
                  ? renderGroupHeader(params.group)
                  : params.group}
              </div>
              {params.children}
            </div>
          )}
          filterOptions={filterOptions}
          noOptionsText={noOptionsText ?? 'Nothing to add.'}
          renderOption={o => (
            <>
              <span className={classes.optionLabel}>{o.label}</span>
              {o.secondary && (
                <span className={classes.optionSecondary}>{o.secondary}</span>
              )}
            </>
          )}
          // Render the listbox inline under the input (the popover is the
          // "popup"); a nested floating Popper inside a Popover double-floats.
          PopperComponent={({ children, ...props }) => (
            <div
              {...(props as HTMLAttributes<HTMLDivElement>)}
              className={classes.inlinePopper}
              style={{}}
            >
              {/* Popper children may be a render-prop; the listbox needs neither
                  transition nor placement, so call it with a static placement. */}
              {typeof children === 'function'
                ? (children as (p: { placement: string }) => ReactNode)({
                    placement: 'bottom-start',
                  })
                : children}
            </div>
          )}
          classes={{
            paper: classes.autocompletePaper,
            listbox: classes.autocompleteListbox,
            option: classes.autocompleteOption,
          }}
          renderInput={params => (
            <TextField
              {...params}
              // The popover exists solely to search — focus lands where the
              // only interaction is.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              fullWidth
              size="small"
              variant="outlined"
              placeholder={searchPlaceholder ?? 'Search…'}
              InputProps={{
                ...params.InputProps,
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
          )}
        />
      </Popover>
    </div>
  );
}
