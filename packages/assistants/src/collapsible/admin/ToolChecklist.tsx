/**
 * The delta-aware tool allow-list editor. Renders the LIVE assignable inventory
 * from `/capabilities` as a grouped, searchable checklist — Backstage actions
 * first, then one group per MCP server (✓ reachable / ⚠ unreachable) — and a
 * separate STALE area for assigned tools that have no live capability, with a
 * red (definitively gone) / amber (unverifiable; server unreachable) classifier
 * and a prune (✕) per row.
 *
 * The picker only offers live items: new additions are pre-filtered to things
 * the server's delta-validation will accept. Stale assignments are preserved
 * (grandfathered) until explicitly pruned.
 */
import { useMemo, useState } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import Checkbox from '@material-ui/core/Checkbox';
import TextField from '@material-ui/core/TextField';
import Typography from '@material-ui/core/Typography';
import Tooltip from '@material-ui/core/Tooltip';
import IconButton from '@material-ui/core/IconButton';
import InputAdornment from '@material-ui/core/InputAdornment';
import SearchIcon from '@material-ui/icons/Search';
import CloseIcon from '@material-ui/icons/Close';
import WarningIcon from '@material-ui/icons/Warning';
import ErrorIcon from '@material-ui/icons/Error';
import CheckCircleIcon from '@material-ui/icons/CheckCircle';
import { CapabilitiesResponse } from '@drewswiredin/backstage-plugin-assistants-common';
import {
  BACKSTAGE_SOURCE,
  mcpToolId,
  partitionTools,
  bareToolName,
} from './adminModel';

const MONO =
  '"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace';

const useStyles = makeStyles(theme => ({
  search: {
    marginBottom: theme.spacing(1),
  },
  group: {
    marginBottom: theme.spacing(1.5),
  },
  groupHead: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    padding: theme.spacing(0.25, 0.5),
  },
  groupName: {
    fontFamily: MONO,
    fontSize: '0.75rem',
    fontWeight: 700,
    color: theme.palette.text.secondary,
  },
  groupTag: {
    fontSize: '0.6rem',
    letterSpacing: 0.3,
    color: theme.palette.text.hint,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 4,
    padding: '1px 5px',
  },
  reachOk: {
    fontSize: '0.95rem',
    color: theme.palette.success?.main ?? '#0a7d52',
  },
  reachWarn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.25),
    fontSize: '0.7rem',
    color: theme.palette.warning?.main ?? '#b06f00',
  },
  reachWarnIcon: {
    fontSize: '0.95rem',
  },
  groupCaption: {
    display: 'block',
    color: theme.palette.text.hint,
    fontSize: '0.68rem',
    padding: theme.spacing(0, 0.5, 0.25),
  },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.25, 0.5),
    borderRadius: theme.shape.borderRadius,
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
  },
  rowText: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    paddingTop: 6,
  },
  toolName: {
    fontFamily: MONO,
    fontSize: '0.8rem',
    fontWeight: 500,
    color: theme.palette.text.primary,
    wordBreak: 'break-all',
  },
  toolDesc: {
    color: theme.palette.text.secondary,
    fontSize: '0.72rem',
  },
  empty: {
    color: theme.palette.text.secondary,
    fontStyle: 'italic',
    padding: theme.spacing(0.5),
  },
  staleHead: {
    display: 'block',
    color: theme.palette.text.secondary,
    fontWeight: 600,
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: theme.spacing(1.5),
    marginBottom: theme.spacing(0.5),
  },
  staleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    padding: theme.spacing(0.25, 0.5),
    borderRadius: theme.shape.borderRadius,
    borderLeft: '3px solid transparent',
  },
  staleGone: {
    borderLeftColor: theme.palette.error.main,
  },
  staleUnverifiable: {
    borderLeftColor: theme.palette.warning?.main ?? '#b06f00',
  },
  staleName: {
    fontFamily: MONO,
    fontSize: '0.78rem',
    flex: 1,
    minWidth: 0,
    wordBreak: 'break-all',
  },
  staleNote: {
    fontSize: '0.68rem',
  },
  staleNoteGone: {
    color: theme.palette.error.main,
  },
  staleNoteUnverifiable: {
    color: theme.palette.warning?.main ?? '#b06f00',
  },
  staleIconGone: {
    fontSize: '1rem',
    color: theme.palette.error.main,
  },
  staleIconUnverifiable: {
    fontSize: '1rem',
    color: theme.palette.warning?.main ?? '#b06f00',
  },
}));

interface ToolItem {
  /** Full `allowedTools` id (bare action id or `<serverId>__<tool>`). */
  id: string;
  /** Display name within the group (bare). */
  name: string;
  description?: string;
}

interface ToolGroup {
  source: string;
  /** Display heading. */
  heading: string;
  reachable: boolean;
  reachError?: string;
  /** Per-group credential caption. */
  caption: string;
  items: ToolItem[];
}

export function ToolChecklist({
  capabilities,
  allowedTools,
  onChange,
}: {
  capabilities: CapabilitiesResponse;
  allowedTools: string[];
  onChange: (next: string[]) => void;
}) {
  const classes = useStyles();
  const [query, setQuery] = useState('');

  const selected = useMemo(() => new Set(allowedTools), [allowedTools]);

  // Build the live groups: Backstage actions first, then each MCP server.
  const groups = useMemo<ToolGroup[]>(() => {
    const result: ToolGroup[] = [];
    result.push({
      source: BACKSTAGE_SOURCE,
      heading: 'Backstage actions',
      reachable: true,
      caption: 'Runs as the calling user.',
      items: capabilities.actions.map(a => ({
        id: a.id,
        name: a.id,
        description: a.description,
      })),
    });
    const servers = [...capabilities.mcpServers].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    for (const server of servers) {
      result.push({
        source: server.id,
        heading: server.id,
        reachable: server.reachable,
        reachError: server.error,
        caption: 'Runs as the server credential (shared, not the user).',
        items: server.tools.map(t => ({
          id: mcpToolId(server.id, t.name),
          name: t.name,
          description: t.description,
        })),
      });
    }
    return result;
  }, [capabilities]);

  const { stale } = useMemo(
    () => partitionTools(allowedTools, capabilities),
    [allowedTools, capabilities],
  );

  const q = query.trim().toLowerCase();
  const matches = (item: ToolItem) =>
    !q ||
    item.id.toLowerCase().includes(q) ||
    item.name.toLowerCase().includes(q) ||
    (item.description?.toLowerCase().includes(q) ?? false);

  const toggle = (id: string, on: boolean) => {
    if (on) {
      if (!selected.has(id)) {
        onChange([...allowedTools, id]);
      }
    } else {
      onChange(allowedTools.filter(t => t !== id));
    }
  };

  const prune = (id: string) => onChange(allowedTools.filter(t => t !== id));

  return (
    <div>
      <TextField
        className={classes.search}
        size="small"
        variant="outlined"
        fullWidth
        placeholder="Search tools…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
        }}
      />

      {groups.map(group => {
        const visible = group.items.filter(matches);
        // Hide an empty (or fully filtered-out) group, except keep an
        // unreachable server visible so its state is discoverable.
        if (visible.length === 0 && (group.reachable || q)) {
          return null;
        }
        return (
          <div key={group.source} className={classes.group}>
            <div className={classes.groupHead}>
              <span className={classes.groupName}>{group.heading}</span>
              <span className={classes.groupTag}>
                {group.source === BACKSTAGE_SOURCE ? 'runs as user' : 'MCP'}
              </span>
              {group.source !== BACKSTAGE_SOURCE &&
                (group.reachable ? (
                  <Tooltip title="Reachable">
                    <CheckCircleIcon className={classes.reachOk} />
                  </Tooltip>
                ) : (
                  <Tooltip title={group.reachError ?? 'Server unreachable'}>
                    <span className={classes.reachWarn}>
                      <WarningIcon className={classes.reachWarnIcon} />
                      unreachable
                    </span>
                  </Tooltip>
                ))}
            </div>
            <Typography variant="caption" className={classes.groupCaption}>
              {group.caption}
            </Typography>
            {visible.length === 0 ? (
              <Typography variant="body2" className={classes.empty}>
                {group.reachable ? 'No tools' : 'No tools (server unreachable)'}
              </Typography>
            ) : (
              visible.map(item => (
                <label key={item.id} className={classes.row}>
                  <Checkbox
                    size="small"
                    color="primary"
                    checked={selected.has(item.id)}
                    onChange={e => toggle(item.id, e.target.checked)}
                  />
                  <span className={classes.rowText}>
                    <span className={classes.toolName}>{item.name}</span>
                    {item.description && (
                      <Typography
                        variant="caption"
                        className={classes.toolDesc}
                      >
                        {item.description}
                      </Typography>
                    )}
                  </span>
                </label>
              ))
            )}
          </div>
        );
      })}

      {stale.length > 0 && (
        <>
          <Typography variant="caption" className={classes.staleHead}>
            Stale assignments ({stale.length})
          </Typography>
          {stale.map(s => {
            const gone = s.reason === 'gone';
            return (
              <div
                key={s.id}
                className={`${classes.staleRow} ${
                  gone ? classes.staleGone : classes.staleUnverifiable
                }`}
              >
                {gone ? (
                  <ErrorIcon className={classes.staleIconGone} />
                ) : (
                  <WarningIcon className={classes.staleIconUnverifiable} />
                )}
                <span className={classes.staleName}>{bareToolName(s.id)}</span>
                <Typography
                  variant="caption"
                  className={`${classes.staleNote} ${
                    gone
                      ? classes.staleNoteGone
                      : classes.staleNoteUnverifiable
                  }`}
                >
                  {gone
                    ? `${
                        s.source === BACKSTAGE_SOURCE ? 'action' : s.source
                      } — no longer available`
                    : `${s.source} unreachable — unverifiable`}
                </Typography>
                <Tooltip title="Remove this assignment">
                  <IconButton
                    size="small"
                    aria-label={`Remove ${s.id}`}
                    onClick={() => prune(s.id)}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
