/**
 * The compact assignment control shared by the Models, Tools and Access
 * sections: a bare list of assigned rows (no surrounding box — each row carries
 * its own inline actions + a remove ✕) followed by a single "＋ Add …" button
 * that opens a searchable popover to add one unassigned item at a time. Each
 * wrapper supplies its rows, its addable options (optionally grouped), and any
 * per-row action (e.g. the model default ★ or a tool ⓘ); this file owns only the
 * layout, the search/popover, and the add/remove plumbing.
 */
import { ReactNode, useMemo, useRef, useState } from 'react';
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
  },
  searchBox: {
    padding: theme.spacing(1),
    paddingBottom: theme.spacing(0.5),
  },
  optionList: {
    overflowY: 'auto',
    paddingBottom: theme.spacing(0.5),
  },
  groupHeader: {
    padding: theme.spacing(0.75, 1.25, 0.25),
  },
  option: {
    display: 'flex',
    alignItems: 'baseline',
    gap: theme.spacing(1),
    width: '100%',
    textAlign: 'left',
    padding: theme.spacing(0.5, 1.25),
    cursor: 'pointer',
    border: 'none',
    background: 'none',
    font: 'inherit',
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
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
  empty: {
    color: theme.palette.text.secondary,
    fontSize: '0.85rem',
    padding: theme.spacing(1, 1.25),
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
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return options;
    }
    return options.filter(
      o =>
        o.label.toLowerCase().includes(q) ||
        (o.secondary?.toLowerCase().includes(q) ?? false),
    );
  }, [options, query]);

  // Preserve first-seen group order for the grouped picker.
  const groups = useMemo(() => {
    if (!grouped) {
      return [];
    }
    const order: string[] = [];
    const byGroup = new Map<string, AssignOption[]>();
    for (const o of filtered) {
      const g = o.group ?? '';
      if (!byGroup.has(g)) {
        byGroup.set(g, []);
        order.push(g);
      }
      byGroup.get(g)!.push(o);
    }
    return order.map(g => ({ group: g, items: byGroup.get(g)! }));
  }, [filtered, grouped]);

  // Show a "create" affordance when freeSolo and the query matches no option.
  const typedAdd =
    allowTyped &&
    query.trim().length > 0 &&
    !options.some(o => o.label.toLowerCase() === query.trim().toLowerCase());

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

  const commitTyped = () => {
    if (typedAdd && onAddTyped) {
      onAddTyped(query.trim());
      setQuery('');
    }
  };

  const renderOption = (o: AssignOption) => (
    <button
      key={o.id}
      type="button"
      className={classes.option}
      onClick={() => onAdd(o.id)}
    >
      <span className={classes.optionLabel}>{o.label}</span>
      {o.secondary && (
        <span className={classes.optionSecondary}>{o.secondary}</span>
      )}
    </button>
  );

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
        TransitionProps={{ onEntered: () => searchRef.current?.focus() }}
      >
        <div className={classes.searchBox}>
          <TextField
            inputRef={searchRef}
            fullWidth
            size="small"
            variant="outlined"
            placeholder={searchPlaceholder ?? 'Search…'}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key !== 'Enter') {
                return;
              }
              e.preventDefault();
              if (typedAdd) {
                commitTyped();
              } else if (filtered.length === 1) {
                // Filtered to a single match — add it without reaching for the mouse.
                onAdd(filtered[0].id);
              }
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
        </div>
        <div className={classes.optionList}>
          {typedAdd && (
            <button
              type="button"
              className={classes.option}
              onClick={commitTyped}
            >
              <span className={classes.optionLabel}>Add “{query.trim()}”</span>
            </button>
          )}
          {grouped
            ? groups.map(({ group, items }) => (
                <div key={group}>
                  <div className={classes.groupHeader}>
                    {renderGroupHeader ? renderGroupHeader(group) : group}
                  </div>
                  {items.map(renderOption)}
                </div>
              ))
            : filtered.map(renderOption)}
          {!typedAdd && filtered.length === 0 && (
            <Typography className={classes.empty}>
              {noOptionsText ?? 'Nothing to add.'}
            </Typography>
          )}
        </div>
      </Popover>
    </div>
  );
}
