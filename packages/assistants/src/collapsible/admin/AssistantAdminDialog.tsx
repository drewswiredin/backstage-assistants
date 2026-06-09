/**
 * The assistant admin editor: a full-screen MUI master-detail dialog. The left
 * rail lists the managed assistants (ordered by title); the right pane edits the
 * selected one's full {@link AssistantDefinition}. Implements the full lifecycle
 * — Create (blank, access-deny default), Duplicate (clone → "(copy)"), Delete
 * (confirm) and Save (dirty-tracked, title required) — over the `/manage` API,
 * with the delta-aware tool checklist + live model/access pickers and inline
 * server-400 validation. On save/delete it refreshes BOTH the manage list and
 * `/status` (via `onChanged`) so the chat rail reflects the change.
 *
 * Sub-components (own files): {@link ToolChecklist} (delta-aware tool allowlist),
 * {@link AccessPickers} (catalog-backed user/group refs), {@link SuggestionsEditor}
 * (per-assistant starter prompts). Pure draft/dirty/stale logic lives in
 * {@link ./adminModel}.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { makeStyles, useTheme, fade } from '@material-ui/core/styles';
import { alertApiRef, useApi } from '@backstage/core-plugin-api';
import Dialog from '@material-ui/core/Dialog';
import Button from '@material-ui/core/Button';
import IconButton from '@material-ui/core/IconButton';
import Typography from '@material-ui/core/Typography';
import TextField from '@material-ui/core/TextField';
import Switch from '@material-ui/core/Switch';
import FormControlLabel from '@material-ui/core/FormControlLabel';
import Select from '@material-ui/core/Select';
import MenuItem from '@material-ui/core/MenuItem';
import InputLabel from '@material-ui/core/InputLabel';
import FormControl from '@material-ui/core/FormControl';
import List from '@material-ui/core/List';
import ListItem from '@material-ui/core/ListItem';
import ListItemIcon from '@material-ui/core/ListItemIcon';
import ListItemText from '@material-ui/core/ListItemText';
import CircularProgress from '@material-ui/core/CircularProgress';
import Tooltip from '@material-ui/core/Tooltip';
import Chip from '@material-ui/core/Chip';
import Divider from '@material-ui/core/Divider';
import Autocomplete from '@material-ui/lab/Autocomplete';
import CloseIcon from '@material-ui/icons/Close';
import AddIcon from '@material-ui/icons/Add';
import FileCopyOutlinedIcon from '@material-ui/icons/FileCopyOutlined';
import DeleteOutlineIcon from '@material-ui/icons/DeleteOutline';
import {
  AssistantDefinition,
  CapabilitiesResponse,
  ModelId,
  ModelOption,
  StatusResponse,
} from '@drewswiredin/backstage-plugin-assistants-common';
import type { AssistantsApi } from '../../api';
import { AssistantAvatar, DEFAULT_AVATAR_COLOR } from '../surface/AssistantAvatar';
import { AccessPickers } from './AccessPickers';
import { ToolChecklist } from './ToolChecklist';
import { SuggestionsEditor } from './SuggestionsEditor';
import {
  blankDraft,
  cloneDraft,
  duplicateDraft,
  isDirty,
  isValid,
  modelLabel,
} from './adminModel';

/** Sentinel Select value for "fall back to the platform default" (maps to null). */
const PLATFORM_DEFAULT = '__platform_default__';

/** A few preset avatar swatches, plus the brand default. */
const PRESET_COLORS = [
  DEFAULT_AVATAR_COLOR,
  '#c2410c',
  '#2563eb',
  '#7c3aed',
  '#16a34a',
  '#db2777',
  '#0891b2',
];

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
  sectionLabel: {
    display: 'block',
    color: theme.palette.text.secondary,
    fontWeight: 600,
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: theme.spacing(1),
  },
  helper: {
    color: theme.palette.text.hint,
    fontSize: '0.72rem',
    marginTop: theme.spacing(0.25),
    display: 'block',
  },
  colorRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
  },
  colorPreview: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    padding: theme.spacing(0.75),
    flexShrink: 0,
  },
  colorField: {
    width: 140,
  },
  swatches: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.75),
  },
  swatch: {
    width: 22,
    height: 22,
    borderRadius: '50%',
    border: `2px solid ${theme.palette.background.paper}`,
    boxShadow: `0 0 0 1px ${theme.palette.divider}`,
    cursor: 'pointer',
    padding: 0,
    outline: 'none',
  },
  swatchActive: {
    boxShadow: `0 0 0 2px ${theme.palette.primary.main}`,
  },
  inlineRow: {
    display: 'flex',
    gap: theme.spacing(2),
  },
  modelDefault: {
    minWidth: 220,
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
  const theme = useTheme();
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
  const [pendingDelete, setPendingDelete] = useState<AssistantDefinition | null>(
    null,
  );

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
    // New draft: blank, access-deny default (server is the source of truth, we
    // mirror it). Unsaved → selectedId ''.
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
        selectInto(action.id, list.find(a => a.id === action.id));
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

  // ---- Derived model picker state ----

  // The chosen allowlist (draft.models); empty = all models.
  const modelAllowlist = useMemo(() => draft?.models ?? [], [draft]);
  // The default-model Select options: the chosen allowlist, or the full pool if
  // empty (mirrors the runtime "empty = all" rule).
  const defaultModelOptions: ModelId[] = useMemo(() => {
    if (modelAllowlist.length > 0) {
      return modelAllowlist;
    }
    return modelPool.map(m => m.id);
  }, [modelAllowlist, modelPool]);

  const modelOptionIds = useMemo(() => modelPool.map(m => m.id), [modelPool]);

  // ---- Render ----

  const color = draft?.color || DEFAULT_AVATAR_COLOR;

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
          {/* Identity */}
          <TextField
            className={classes.field}
            label="Title"
            required
            fullWidth
            variant="outlined"
            value={draft.title}
            error={draft.title.trim().length === 0}
            helperText={
              draft.title.trim().length === 0 ? 'Title is required.' : undefined
            }
            onChange={e => patch({ title: e.target.value })}
          />
          <TextField
            className={classes.field}
            label="Description"
            fullWidth
            variant="outlined"
            value={draft.description ?? ''}
            onChange={e => patch({ description: e.target.value })}
          />

          {/* Color */}
          <div className={classes.field}>
            <Typography variant="caption" className={classes.sectionLabel}>
              Avatar color
            </Typography>
            <div className={classes.colorRow}>
              <span
                className={classes.colorPreview}
                style={{ backgroundColor: fade(color, 0.15) }}
              >
                <AssistantAvatar color={draft.color || undefined} size={40} />
              </span>
              <TextField
                className={classes.colorField}
                label="Hex"
                size="small"
                variant="outlined"
                placeholder={DEFAULT_AVATAR_COLOR}
                value={draft.color ?? ''}
                onChange={e => patch({ color: e.target.value })}
              />
              <div className={classes.swatches}>
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Use color ${c}`}
                    className={`${classes.swatch} ${
                      (draft.color || DEFAULT_AVATAR_COLOR).toLowerCase() ===
                      c.toLowerCase()
                        ? classes.swatchActive
                        : ''
                    }`}
                    style={{ backgroundColor: c }}
                    onClick={() => patch({ color: c })}
                  />
                ))}
              </div>
            </div>
            <span className={classes.helper}>
              Leave blank for the default brand tint.
            </span>
          </div>

          {/* Prompt */}
          <TextField
            className={classes.field}
            label="System prompt"
            fullWidth
            multiline
            minRows={6}
            maxRows={20}
            variant="outlined"
            value={draft.prompt}
            onChange={e => patch({ prompt: e.target.value })}
          />

          <Divider className={classes.section} />

          {/* Models */}
          <div className={classes.section}>
            <Typography variant="caption" className={classes.sectionLabel}>
              Models
            </Typography>
            <Autocomplete<ModelId, true, false, false>
              multiple
              size="small"
              options={modelOptionIds}
              value={modelAllowlist}
              getOptionLabel={modelLabel}
              filterSelectedOptions
              onChange={(_e, next) => {
                const ids = next as ModelId[];
                // Keep the default valid: clear it if it's no longer allowed
                // (and the allowlist is non-empty).
                const stillAllowed =
                  ids.length === 0 ||
                  (draft.defaultModel !== null &&
                    ids.includes(draft.defaultModel));
                patch({
                  models: ids,
                  defaultModel: stillAllowed ? draft.defaultModel : null,
                });
              }}
              renderTags={(tagValue, getTagProps) =>
                tagValue.map((id, index) => (
                  <Chip
                    size="small"
                    label={modelLabel(id)}
                    {...getTagProps({ index })}
                    key={id}
                  />
                ))
              }
              renderInput={params => (
                <TextField
                  {...params}
                  variant="outlined"
                  label="Allowed models"
                  placeholder={
                    modelAllowlist.length === 0 ? 'Empty = all models' : undefined
                  }
                />
              )}
            />
            <span className={classes.helper}>
              Empty = all models. Leave empty to allow the full pool.
            </span>

            <FormControl
              variant="outlined"
              size="small"
              className={classes.modelDefault}
              style={{ marginTop: theme.spacing(1.5) }}
            >
              <InputLabel id="default-model-label">Default model</InputLabel>
              <Select
                labelId="default-model-label"
                label="Default model"
                value={draft.defaultModel ?? PLATFORM_DEFAULT}
                onChange={e => {
                  const v = e.target.value as string;
                  patch({
                    defaultModel: v === PLATFORM_DEFAULT ? null : (v as ModelId),
                  });
                }}
              >
                <MenuItem value={PLATFORM_DEFAULT}>
                  <em>Platform default</em>
                </MenuItem>
                {defaultModelOptions.map(id => (
                  <MenuItem key={id} value={id}>
                    {modelLabel(id)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </div>

          <Divider className={classes.section} />

          {/* Access */}
          <div className={classes.section}>
            <Typography variant="caption" className={classes.sectionLabel}>
              Access
            </Typography>
            <FormControlLabel
              control={
                <Switch
                  color="primary"
                  checked={draft.access.allowAuthenticated}
                  onChange={e =>
                    patch({
                      access: {
                        ...draft.access,
                        allowAuthenticated: e.target.checked,
                      },
                    })
                  }
                />
              }
              label="Available to all signed-in users"
            />
            {!draft.access.allowAuthenticated && (
              <AccessPickers
                users={draft.access.users}
                groups={draft.access.groups}
                onUsersChange={users =>
                  patch({ access: { ...draft.access, users } })
                }
                onGroupsChange={groups =>
                  patch({ access: { ...draft.access, groups } })
                }
              />
            )}
          </div>

          <Divider className={classes.section} />

          {/* Tools */}
          <div className={classes.section}>
            <Typography variant="caption" className={classes.sectionLabel}>
              Tools
            </Typography>
            <ToolChecklist
              capabilities={capabilities}
              allowedTools={draft.allowedTools}
              onChange={allowedTools => patch({ allowedTools })}
            />
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
              onChange={suggestions =>
                patch({ ui: { ...ui, suggestions } })
              }
            />
          </div>

          {(draft.created_by || draft.updated_by) && (
            <Typography variant="caption" className={classes.audit}>
              {draft.created_by && (
                <>Created by {draft.created_by}</>
              )}
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
            <Typography className={classes.validationError}>
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
            <IconButton
              aria-label="Close"
              size="small"
              onClick={guardedClose}
            >
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
