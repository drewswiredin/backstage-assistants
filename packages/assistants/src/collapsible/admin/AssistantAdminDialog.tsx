/**
 * The assistant admin editor: a large MUI master-detail dialog (90vh). The left
 * rail lists the managed assistants (ordered by title); the right pane edits the
 * selected one's full {@link AssistantDefinition}. Implements the full lifecycle
 * — Create (blank, open to any signed-in user), Duplicate (clone → "(copy)"), Delete
 * (confirm) and Save (dirty-tracked, title required) — over the `/manage` API,
 * with the delta-aware tool checklist + live model/access pickers and inline
 * server-400 validation. On save/delete it refreshes BOTH the manage list and
 * `/status` (via `onChanged`) so the chat rail reflects the change.
 *
 * Sub-components (own files): {@link ToolsTransfer} (compact tool allowlist),
 * {@link ModelsTransfer} (compact model allowlist + default star),
 * {@link AccessList} (one principal list), {@link SuggestionsEditor}
 * (per-assistant starter prompts). The first three share the
 * {@link AssignList} primitive (a bare row list + an "＋ Add" search picker).
 * Pure draft/dirty/stale logic lives in {@link ./adminModel}.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { makeStyles, fade } from '@material-ui/core/styles';
import { alertApiRef, useApi } from '@backstage/core-plugin-api';
import Dialog from '@material-ui/core/Dialog';
import Button from '@material-ui/core/Button';
import ButtonBase from '@material-ui/core/ButtonBase';
import IconButton from '@material-ui/core/IconButton';
import Popover from '@material-ui/core/Popover';
import Typography from '@material-ui/core/Typography';
import TextField from '@material-ui/core/TextField';
import List from '@material-ui/core/List';
import ListItem from '@material-ui/core/ListItem';
import ListItemIcon from '@material-ui/core/ListItemIcon';
import ListItemText from '@material-ui/core/ListItemText';
import CircularProgress from '@material-ui/core/CircularProgress';
import Tooltip from '@material-ui/core/Tooltip';
import Divider from '@material-ui/core/Divider';
import CloseIcon from '@material-ui/icons/Close';
import AddIcon from '@material-ui/icons/Add';
import FileCopyOutlinedIcon from '@material-ui/icons/FileCopyOutlined';
import DeleteOutlineIcon from '@material-ui/icons/DeleteOutline';
import EditIcon from '@material-ui/icons/Edit';
import {
  AssistantDefinition,
  CapabilitiesResponse,
  ModelOption,
  StatusResponse,
} from '@drewswiredin/backstage-plugin-assistants-common';
import type { AssistantsApi } from '../../api';
import {
  AssistantAvatar,
  DEFAULT_AVATAR_COLOR,
} from '../surface/AssistantAvatar';
import { AccessList } from './AccessList';
import { ModelsTransfer } from './ModelsTransfer';
import { ToolsTransfer } from './ToolsTransfer';
import { SuggestionsEditor } from './SuggestionsEditor';
import {
  blankDraft,
  cloneDraft,
  duplicateDraft,
  isDirty,
  isValid,
} from './adminModel';

/** A complete 6-digit hex — the only shape a native color input accepts. */
const HEX6 = /^#[0-9a-f]{6}$/i;

const useStyles = makeStyles(theme => ({
  paper: {
    height: '90vh',
    maxHeight: '90vh',
  },
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1.5, 2),
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  headerTitle: {
    fontWeight: 600,
    flex: 1,
  },
  body: {
    display: 'flex',
    flex: 1,
    minHeight: 0,
  },
  // Left master rail.
  rail: {
    width: 260,
    flexShrink: 0,
    borderRight: `1px solid ${theme.palette.divider}`,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
  railHead: {
    display: 'flex',
    alignItems: 'center',
    padding: theme.spacing(1, 1, 0.5, 2),
  },
  railLabel: {
    color: theme.palette.text.secondary,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: '0.68rem',
    flex: 1,
  },
  railList: {
    overflowY: 'auto',
    flex: 1,
    paddingTop: 0,
  },
  railItem: {
    borderRadius: theme.shape.borderRadius,
  },
  railItemDirty: {
    fontStyle: 'italic',
  },
  railIcon: {
    minWidth: 36,
  },
  railEmpty: {
    color: theme.palette.text.secondary,
    fontStyle: 'italic',
    padding: theme.spacing(2),
    textAlign: 'center',
  },
  // Right detail pane.
  detail: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
  form: {
    overflowY: 'auto',
    flex: 1,
    padding: theme.spacing(2.5, 3),
  },
  field: {
    marginBottom: theme.spacing(2),
  },
  section: {
    marginTop: theme.spacing(1),
    marginBottom: theme.spacing(2),
  },
  // The compact Models + Access sections pair into two columns on wider panes.
  sectionGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    columnGap: theme.spacing(3),
    [theme.breakpoints.up('md')]: {
      gridTemplateColumns: '1fr 1fr',
    },
  },
  // A visible divider between the paired Models | Access columns (vertical when
  // side-by-side, horizontal when they stack on a narrow pane).
  accessCol: {
    [theme.breakpoints.up('md')]: {
      borderLeft: `1px solid ${theme.palette.divider}`,
      paddingLeft: theme.spacing(3),
    },
    [theme.breakpoints.down('sm')]: {
      borderTop: `1px solid ${theme.palette.divider}`,
      paddingTop: theme.spacing(2),
    },
  },
  sectionLabel: {
    display: 'block',
    color: theme.palette.text.secondary,
    fontWeight: 600,
    fontSize: '0.78rem',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: theme.spacing(1),
  },
  // Identity "employee card": a large logo on the left, title + description right.
  identityCard: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(3),
    padding: theme.spacing(2, 1, 2.5),
    marginBottom: theme.spacing(1),
  },
  identityFields: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
  },
  colorField: {
    flex: 1,
    minWidth: 0,
  },
  // The click-to-open color picker — a focus/hover ring + corner edit badge make
  // it discoverable as an interactive control.
  colorTrigger: {
    borderRadius: '50%',
    cursor: 'pointer',
    position: 'relative',
    transition: 'box-shadow 120ms ease',
    '&:hover': {
      boxShadow: `0 0 0 2px ${theme.palette.action.active}`,
    },
    '&:focus-visible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: 2,
    },
  },
  editBadge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 22,
    height: 22,
    borderRadius: '50%',
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${theme.palette.divider}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBadgeIcon: {
    fontSize: '0.85rem',
    color: theme.palette.text.secondary,
  },
  colorPopover: {
    padding: theme.spacing(1.5),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.25),
    width: 220,
  },
  colorPickRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  // The native OS color picker, shown as a square swatch.
  nativeColor: {
    width: 44,
    height: 44,
    flexShrink: 0,
    padding: 0,
    border: 'none',
    borderRadius: 8,
    background: 'none',
    cursor: 'pointer',
    '&::-webkit-color-swatch-wrapper': { padding: 0 },
    '&::-webkit-color-swatch': {
      border: `1px solid ${theme.palette.divider}`,
      borderRadius: 6,
    },
    '&::-moz-color-swatch': {
      border: `1px solid ${theme.palette.divider}`,
      borderRadius: 6,
    },
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1.5, 3),
    borderTop: `1px solid ${theme.palette.divider}`,
  },
  footerSpacer: {
    flex: 1,
  },
  validationError: {
    color: theme.palette.error.main,
    fontSize: '0.78rem',
  },
  audit: {
    color: theme.palette.text.hint,
    fontSize: '0.7rem',
    marginTop: theme.spacing(2),
  },
  loadingPane: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(1),
    color: theme.palette.text.secondary,
  },
  errorPane: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(1.5),
    padding: theme.spacing(3),
    textAlign: 'center',
  },
  detailEmpty: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: theme.palette.text.secondary,
    fontStyle: 'italic',
  },
}));

/** Props for {@link AssistantAdminDialog}. @public */
export interface AssistantAdminDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Close handler (the dialog itself confirms discard of unsaved edits). */
  onClose: () => void;
  /** The browser-safe status (the model pool fallback + admin gate). */
  status: StatusResponse;
  /** The backend client (manage + capabilities endpoints). */
  api: AssistantsApi;
  /**
   * Called after a successful create/update/delete so the host can refresh the
   * chat rail's `/status` (new/renamed/removed assistants). Optional.
   */
  onChanged?: () => void;
}

/**
 * Avatar color control: shows the colored logo with a small corner edit badge;
 * clicking it opens a popover with a native color picker + a hex field (flagged
 * when the hex is malformed). Collapses back to the logo.
 */
function AvatarColorPicker({
  color,
  onChange,
  size = 40,
}: {
  color?: string;
  onChange: (color: string) => void;
  size?: number;
}) {
  const classes = useStyles();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const hexRef = useRef<HTMLInputElement>(null);
  const current = color || DEFAULT_AVATAR_COLOR;
  const hexInvalid = Boolean(color) && !HEX6.test(color as string);

  return (
    <>
      <ButtonBase
        className={classes.colorTrigger}
        style={{
          backgroundColor: fade(
            HEX6.test(current) ? current : DEFAULT_AVATAR_COLOR,
            0.15,
          ),
          padding: Math.round(size * 0.18),
        }}
        aria-label="Change avatar color"
        onClick={e => setAnchor(e.currentTarget)}
      >
        <AssistantAvatar color={color || undefined} size={size} />
        <span className={classes.editBadge}>
          <EditIcon className={classes.editBadgeIcon} />
        </span>
      </ButtonBase>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        TransitionProps={{ onEntered: () => hexRef.current?.focus() }}
      >
        <div className={classes.colorPopover}>
          <div className={classes.colorPickRow}>
            <input
              type="color"
              className={classes.nativeColor}
              value={HEX6.test(current) ? current : DEFAULT_AVATAR_COLOR}
              onChange={e => onChange(e.target.value)}
              aria-label="Pick a color"
            />
            <TextField
              className={classes.colorField}
              label="Hex"
              size="small"
              variant="outlined"
              value={current}
              error={hexInvalid}
              helperText={hexInvalid ? 'Use #rrggbb' : undefined}
              inputRef={hexRef}
              onChange={e => onChange(e.target.value)}
            />
          </div>
          <Button size="small" onClick={() => setAnchor(null)}>
            Done
          </Button>
        </div>
      </Popover>
    </>
  );
}

/** A small confirm dialog used for discard + delete prompts. */
function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  destructive,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <div style={{ padding: 24 }}>
        <Typography variant="h6" gutterBottom>
          {title}
        </Typography>
        <Typography variant="body2" color="textSecondary">
          {message}
        </Typography>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 24,
          }}
        >
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            variant="contained"
            color={destructive ? 'secondary' : 'primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function AssistantAdminDialog({
  open,
  onClose,
  status,
  api,
  onChanged,
}: AssistantAdminDialogProps) {
  const classes = useStyles();
  const alertApi = useApi(alertApiRef);

  // Loaded server state.
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [list, setList] = useState<AssistantDefinition[]>([]);
  const [capabilities, setCapabilities] = useState<
    CapabilitiesResponse | undefined
  >();

  // Selection + the editable draft of the selected assistant.
  // `selectedId` is the persisted id, or '' for a not-yet-saved new/dup draft.
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [draft, setDraft] = useState<AssistantDefinition | undefined>();
  // The baseline the draft is diffed against (the loaded row, or undefined for
  // an unsaved create/duplicate — which diffs against a blank).
  const [baseline, setBaseline] = useState<AssistantDefinition | undefined>();

  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | undefined>();

  // Pending confirm action (discard-then-do, or delete).
  const [pendingSelect, setPendingSelect] = useState<{
    kind: 'select' | 'create' | 'duplicate' | 'close';
    id?: string;
    src?: AssistantDefinition;
  } | null>(null);
  const [pendingDelete, setPendingDelete] =
    useState<AssistantDefinition | null>(null);

  const dirty = useMemo(
    () => (draft ? isDirty(draft, baseline) : false),
    [draft, baseline],
  );
  const valid = draft ? isValid(draft) : false;

  // The model pool the pickers offer: prefer the live capabilities pool, fall
  // back to the browser-safe /status pool until capabilities load.
  const modelPool: ModelOption[] = useMemo(
    () => capabilities?.models ?? status.models,
    [capabilities, status.models],
  );

  /** Sort a list by title (case-insensitive), stable on ties. */
  const sortByTitle = (defs: AssistantDefinition[]) =>
    [...defs].sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
    );

  // Select an assistant row into the editable draft (no dirty-check here; the
  // caller gates that). selectedId '' selects an unsaved draft (src provided).
  const selectInto = useCallback(
    (id: string | undefined, def: AssistantDefinition | undefined) => {
      setSelectedId(id);
      setDraft(def ? cloneDraft(def) : undefined);
      // A persisted row is its own baseline; an unsaved draft has none (blank).
      setBaseline(id ? def && cloneDraft(def) : undefined);
      setValidationError(undefined);
    },
    [],
  );

  // Initial load (on open): manage list + capabilities in parallel.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    let active = true;
    setLoading(true);
    setLoadError(undefined);
    Promise.all([api.listManagedAssistants(), api.getCapabilities()])
      .then(([defs, caps]) => {
        if (!active) {
          return;
        }
        const sorted = sortByTitle(defs);
        setList(sorted);
        setCapabilities(caps);
        // Initial selection = first (per design); empty list → empty state.
        const first = sorted[0];
        selectInto(first?.id, first);
      })
      .catch(err => {
        if (active) {
          setLoadError(
            err instanceof Error ? err.message : 'Failed to load assistants.',
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [open, api, selectInto]);

  // Patch the draft immutably.
  const patch = (p: Partial<AssistantDefinition>) =>
    setDraft(d => (d ? { ...d, ...p } : d));

  // ---- Selection lifecycle (dirty-guarded) ----

  const guardedSelect = (id: string) => {
    if (id === selectedId) {
      return;
    }
    const target = list.find(a => a.id === id);
    if (dirty) {
      setPendingSelect({ kind: 'select', id });
      return;
    }
    selectInto(id, target);
  };

  const doCreate = useCallback(() => {
    // New draft: blank, open to any signed-in user (see blankDraft). Unsaved → selectedId ''.
    selectInto('', blankDraft());
  }, [selectInto]);

  const doDuplicate = useCallback(
    (src: AssistantDefinition) => {
      selectInto('', duplicateDraft(src));
    },
    [selectInto],
  );

  const guardedCreate = () => {
    if (dirty) {
      setPendingSelect({ kind: 'create' });
      return;
    }
    doCreate();
  };

  const guardedDuplicate = () => {
    if (!draft) {
      return;
    }
    const src = draft;
    if (dirty) {
      setPendingSelect({ kind: 'duplicate', src });
      return;
    }
    doDuplicate(src);
  };

  const guardedClose = () => {
    if (dirty) {
      setPendingSelect({ kind: 'close' });
      return;
    }
    onClose();
  };

  // Resolve a pending discard-confirmed action.
  const confirmDiscard = () => {
    const action = pendingSelect;
    setPendingSelect(null);
    if (!action) {
      return;
    }
    switch (action.kind) {
      case 'select':
        selectInto(
          action.id,
          list.find(a => a.id === action.id),
        );
        break;
      case 'create':
        doCreate();
        break;
      case 'duplicate':
        if (action.src) {
          doDuplicate(action.src);
        }
        break;
      case 'close':
        onClose();
        break;
      default:
        break;
    }
  };

  // ---- Save ----

  const handleSave = async () => {
    if (!draft || !valid || saving) {
      return;
    }
    setSaving(true);
    setValidationError(undefined);
    try {
      const saved = selectedId
        ? await api.updateAssistant(selectedId, draft)
        : await api.createAssistant(draft);
      // Refresh the list from the persisted row, keep the saved row selected.
      setList(prev => {
        const without = prev.filter(a => a.id !== saved.id);
        return sortByTitle([...without, saved]);
      });
      selectInto(saved.id, saved);
      alertApi.post({
        message: `Saved “${saved.title}”.`,
        severity: 'success',
        display: 'transient',
      });
      onChanged?.();
    } catch (err) {
      // Surface server 400 delta-validation messages inline; the api client
      // throws the server's message verbatim for 400s.
      const message =
        err instanceof Error ? err.message : 'Failed to save the assistant.';
      setValidationError(message);
      alertApi.post({ message, severity: 'error', display: 'transient' });
    } finally {
      setSaving(false);
    }
  };

  // ---- Delete ----

  const handleDelete = async (target: AssistantDefinition) => {
    setPendingDelete(null);
    try {
      await api.deleteAssistant(target.id);
      const remaining = sortByTitle(list.filter(a => a.id !== target.id));
      setList(remaining);
      // Move selection to the first remaining (or empty state).
      const next = remaining[0];
      selectInto(next?.id, next);
      alertApi.post({
        message: `Deleted “${target.title}”.`,
        severity: 'success',
        display: 'transient',
      });
      onChanged?.();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to delete the assistant.';
      alertApi.post({ message, severity: 'error', display: 'transient' });
    }
  };

  // ---- Render ----

  const renderForm = () => {
    if (!draft || !capabilities) {
      return (
        <div className={classes.detailEmpty}>
          {list.length === 0
            ? 'No assistants yet — create one to get started.'
            : 'Select an assistant to edit.'}
        </div>
      );
    }
    const ui = draft.ui ?? {};
    return (
      <>
        <div className={classes.form}>
          {/* Identity — an "employee card": large logo left, title + description right. */}
          <div className={classes.identityCard}>
            <AvatarColorPicker
              color={draft.color}
              size={96}
              onChange={c => patch({ color: c })}
            />
            <div className={classes.identityFields}>
              <TextField
                label="Title"
                required
                fullWidth
                variant="outlined"
                value={draft.title}
                error={draft.title.trim().length === 0}
                helperText={
                  draft.title.trim().length === 0
                    ? 'Title is required.'
                    : undefined
                }
                onChange={e => patch({ title: e.target.value })}
              />
              <TextField
                label="Description"
                fullWidth
                variant="outlined"
                value={draft.description ?? ''}
                onChange={e => patch({ description: e.target.value })}
              />
            </div>
          </div>

          <Divider className={classes.section} />

          {/* Per-assistant UI */}
          <div className={classes.section}>
            <Typography variant="caption" className={classes.sectionLabel}>
              Conversation UI
            </Typography>
            <TextField
              className={classes.field}
              label="Composer placeholder"
              fullWidth
              variant="outlined"
              size="small"
              value={ui.composer?.placeholder ?? ''}
              onChange={e =>
                patch({
                  ui: {
                    ...ui,
                    composer: { ...ui.composer, placeholder: e.target.value },
                  },
                })
              }
            />
            <Typography variant="caption" className={classes.sectionLabel}>
              Starter suggestions
            </Typography>
            <SuggestionsEditor
              value={ui.suggestions ?? []}
              onChange={suggestions => patch({ ui: { ...ui, suggestions } })}
            />
          </div>

          <Divider className={classes.section} />

          {/* Models + Access — paired into two columns on wider panes. */}
          <div className={classes.sectionGrid}>
            <div className={classes.section}>
              <Typography variant="caption" className={classes.sectionLabel}>
                Models
              </Typography>
              <ModelsTransfer
                pool={modelPool}
                models={draft.models}
                defaultModel={draft.defaultModel}
                platformDefault={status.defaultModel}
                onModelsChange={models => patch({ models })}
                onDefaultChange={defaultModel => patch({ defaultModel })}
              />
            </div>

            <div className={`${classes.section} ${classes.accessCol}`}>
              <Typography variant="caption" className={classes.sectionLabel}>
                Access
              </Typography>
              <AccessList
                access={draft.access}
                onChange={access => patch({ access })}
              />
            </div>
          </div>

          <Divider className={classes.section} />

          {/* Prompt */}
          <TextField
            className={classes.field}
            label="System prompt"
            fullWidth
            multiline
            minRows={24}
            maxRows={48}
            variant="outlined"
            value={draft.prompt}
            onChange={e => patch({ prompt: e.target.value })}
          />

          <Divider className={classes.section} />

          {/* Tools */}
          <div className={classes.section}>
            <Typography variant="caption" className={classes.sectionLabel}>
              Tools
            </Typography>
            <ToolsTransfer
              capabilities={capabilities}
              allowedTools={draft.allowedTools}
              onChange={allowedTools => patch({ allowedTools })}
            />
          </div>

          {(draft.created_by || draft.updated_by) && (
            <Typography variant="caption" className={classes.audit}>
              {draft.created_by && <>Created by {draft.created_by}</>}
              {draft.created_at && <> on {draft.created_at}</>}
              {draft.updated_by && (
                <>
                  {' · '}Last edited by {draft.updated_by}
                </>
              )}
              {draft.updated_at && <> on {draft.updated_at}</>}
            </Typography>
          )}
        </div>

        {/* Detail footer: Save / Delete / Duplicate. */}
        <div className={classes.footer}>
          {validationError && (
            <Typography role="alert" className={classes.validationError}>
              {validationError}
            </Typography>
          )}
          <span className={classes.footerSpacer} />
          <Button
            startIcon={<FileCopyOutlinedIcon />}
            onClick={guardedDuplicate}
            disabled={saving}
          >
            Duplicate
          </Button>
          {selectedId && (
            <Button
              startIcon={<DeleteOutlineIcon />}
              onClick={() => setPendingDelete(draft)}
              disabled={saving}
            >
              Delete
            </Button>
          )}
          <Button
            variant="contained"
            color="primary"
            onClick={handleSave}
            disabled={!dirty || !valid || saving}
            startIcon={
              saving ? <CircularProgress size={16} thickness={5} /> : undefined
            }
          >
            {selectedId ? 'Save' : 'Create'}
          </Button>
        </div>
      </>
    );
  };

  // The dialog body: a loading spinner, an error/permission pane, or the
  // master-detail editor. Extracted to keep the JSX flat (no nested ternary).
  const renderContent = () => {
    if (loading) {
      return (
        <div className={classes.loadingPane}>
          <CircularProgress size={20} thickness={5} />
          <Typography variant="body2">Loading…</Typography>
        </div>
      );
    }
    if (loadError) {
      return (
        <div className={classes.errorPane}>
          <Typography variant="body1" color="error">
            {loadError}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            You may not have permission to manage assistants.
          </Typography>
        </div>
      );
    }
    return (
      <div className={classes.body}>
        {/* Master rail */}
        <div className={classes.rail}>
          <div className={classes.railHead}>
            <Typography variant="caption" className={classes.railLabel}>
              Assistants
            </Typography>
            <Tooltip title="Create assistant">
              <IconButton size="small" onClick={guardedCreate}>
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </div>
          <List className={classes.railList} dense>
            {/* The in-progress unsaved draft (create/duplicate) shows as a
                provisional row pinned at the top until first save. */}
            {selectedId === '' && draft && (
              <ListItem
                selected
                className={`${classes.railItem} ${classes.railItemDirty}`}
              >
                <ListItemIcon className={classes.railIcon}>
                  <AssistantAvatar color={draft.color || undefined} size={24} />
                </ListItemIcon>
                <ListItemText
                  primary={draft.title || 'Untitled (new)'}
                  primaryTypographyProps={{ noWrap: true }}
                />
              </ListItem>
            )}
            {list.map(a => {
              const isSelected = a.id === selectedId;
              return (
                <ListItem
                  button
                  key={a.id}
                  selected={isSelected}
                  className={`${classes.railItem} ${
                    isSelected && dirty ? classes.railItemDirty : ''
                  }`}
                  onClick={() => guardedSelect(a.id)}
                >
                  <ListItemIcon className={classes.railIcon}>
                    <AssistantAvatar color={a.color || undefined} size={24} />
                  </ListItemIcon>
                  <ListItemText
                    primary={`${a.title}${isSelected && dirty ? ' •' : ''}`}
                    primaryTypographyProps={{ noWrap: true }}
                  />
                </ListItem>
              );
            })}
            {list.length === 0 && selectedId !== '' && (
              <Typography className={classes.railEmpty}>
                No assistants. Click + to create one.
              </Typography>
            )}
          </List>
        </div>

        {/* Detail pane */}
        <div className={classes.detail}>{renderForm()}</div>
      </div>
    );
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={guardedClose}
        maxWidth="lg"
        fullWidth
        classes={{ paper: classes.paper }}
      >
        <div className={classes.root}>
          <div className={classes.header}>
            <Typography variant="h6" className={classes.headerTitle}>
              Manage assistants
            </Typography>
            <IconButton aria-label="Close" size="small" onClick={guardedClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </div>

          {renderContent()}
        </div>
      </Dialog>

      <ConfirmDialog
        open={pendingSelect !== null}
        title="Discard changes?"
        message="You have unsaved edits. Discard them?"
        confirmLabel="Discard"
        destructive
        onConfirm={confirmDiscard}
        onCancel={() => setPendingSelect(null)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete “${pendingDelete?.title ?? ''}”?`}
        message="This assistant will be removed and its conversations will become inaccessible. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => pendingDelete && handleDelete(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
