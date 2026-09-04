/**
 * The Tools section: the assigned tools grouped by source (Backstage
 * runs-as-you actions first, then one group per MCP server) over an "＋ Add tool"
 * picker drawn from the live `/capabilities` inventory. The picker groups
 * addable tools the same way (✓ reachable / ⚠ unreachable) and only offers live
 * items. Each
 * assigned row leads with a "runs as" icon (👤 the calling user for Backstage
 * actions / 🔑 the server's shared credential for MCP tools), shows a ⚖ when the
 * tool is in the global approval floor, and an ⓘ with the tool description.
 * STALE assignments (in `allowedTools` but not live) render flagged RED (gone) /
 * AMBER (unverifiable) with a remove ✕.
 */
import { ReactNode, useMemo } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import Tooltip from '@material-ui/core/Tooltip';
import IconButton from '@material-ui/core/IconButton';
import WarningIcon from '@material-ui/icons/Warning';
import ErrorIcon from '@material-ui/icons/Error';
import CheckCircleIcon from '@material-ui/icons/CheckCircle';
import InfoOutlinedIcon from '@material-ui/icons/InfoOutlined';
import PersonOutlineIcon from '@material-ui/icons/PersonOutline';
import VpnKeyOutlinedIcon from '@material-ui/icons/VpnKeyOutlined';
import GavelOutlinedIcon from '@material-ui/icons/GavelOutlined';
import { CapabilitiesResponse } from '@drewswiredin/backstage-plugin-assistants-common';
import { AssignList, AssignOption, AssignRow } from './AssignList';
import {
  BACKSTAGE_SOURCE,
  mcpToolId,
  bareToolName,
  partitionTools,
} from './adminModel';

const useStyles = makeStyles(theme => ({
  groupHead: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    fontSize: '0.8rem',
    fontWeight: 700,
    color: theme.palette.text.secondary,
  },
  reachOk: {
    fontSize: '0.9rem',
    color: theme.palette.success?.main ?? '#0a7d52',
  },
  reachWarn: {
    fontSize: '0.9rem',
    color: theme.palette.warning?.main ?? '#b06f00',
  },
  info: {
    fontSize: '1rem',
    color: theme.palette.text.hint,
  },
  runAs: {
    fontSize: '1.05rem',
    color: theme.palette.text.hint,
  },
  approval: {
    fontSize: '1.05rem',
    color: theme.palette.warning?.main ?? '#b06f00',
  },
  staleIconGone: {
    fontSize: '1.05rem',
    color: theme.palette.error.main,
  },
  staleIconWarn: {
    fontSize: '1.05rem',
    color: theme.palette.warning?.main ?? '#b06f00',
  },
}));

/** Per-source display + reachability metadata for the picker group headers. */
interface SourceMeta {
  heading: string;
  reachable: boolean;
  reachError?: string;
  isBackstage: boolean;
}

/**
 * The leading "runs as" indicator for a tool row: Backstage actions run as the
 * calling user; MCP tools run as the server's shared configured credential.
 */
function runAsIcon(source: string, className: string): ReactNode {
  if (source === BACKSTAGE_SOURCE) {
    return (
      <Tooltip title="Runs as you (Backstage action).">
        <PersonOutlineIcon
          role="img"
          aria-label="Runs as you (Backstage action)"
          className={className}
        />
      </Tooltip>
    );
  }
  return (
    <Tooltip title="Runs as the server's configured credential (shared, not you).">
      <VpnKeyOutlinedIcon
        role="img"
        aria-label="Runs as the server's configured credential (shared)"
        className={className}
      />
    </Tooltip>
  );
}

export function ToolsTransfer({
  capabilities,
  allowedTools,
  onChange,
}: {
  capabilities: CapabilitiesResponse;
  allowedTools: string[];
  onChange: (next: string[]) => void;
}) {
  const classes = useStyles();

  const selected = useMemo(() => new Set(allowedTools), [allowedTools]);
  const approvalSet = useMemo(
    () => new Set(capabilities.requireApproval),
    [capabilities.requireApproval],
  );

  // Source metadata + a tool-id → {label, description, source} lookup + the
  // grouped addable options (live, not-yet-assigned).
  const { sources, byId, options } = useMemo(() => {
    const meta = new Map<string, SourceMeta>();
    const lookup = new Map<
      string,
      { label: string; description?: string; source: string }
    >();
    const opts: AssignOption[] = [];

    meta.set(BACKSTAGE_SOURCE, {
      heading: 'Backstage actions',
      reachable: true,
      isBackstage: true,
    });
    for (const a of capabilities.actions) {
      lookup.set(a.id, {
        label: a.id,
        description: a.description,
        source: BACKSTAGE_SOURCE,
      });
      if (!selected.has(a.id)) {
        opts.push({
          id: a.id,
          label: a.id,
          group: BACKSTAGE_SOURCE,
          secondary: a.description,
        });
      }
    }

    const servers = [...capabilities.mcpServers].sort((x, y) =>
      x.id.localeCompare(y.id),
    );
    for (const server of servers) {
      meta.set(server.id, {
        heading: server.id,
        reachable: server.reachable,
        reachError: server.error,
        isBackstage: false,
      });
      for (const t of server.tools) {
        const id = mcpToolId(server.id, t.name);
        lookup.set(id, {
          label: t.name,
          description: t.description,
          source: server.id,
        });
        if (!selected.has(id)) {
          opts.push({
            id,
            label: t.name,
            group: server.id,
            secondary: t.description,
          });
        }
      }
    }
    return { sources: meta, byId: lookup, options: opts };
  }, [capabilities, selected]);

  const { live, stale } = useMemo(
    () => partitionTools(allowedTools, capabilities),
    [allowedTools, capabilities],
  );

  // Assigned rows grouped by source — Backstage (runs-as-you) first, then MCP
  // servers by id — with stale rows nested in their source group, flagged.
  const rows: AssignRow[] = useMemo(() => {
    const liveRows: AssignRow[] = allowedTools
      .filter(id => live.has(id))
      .map(id => {
        const info = byId.get(id);
        const source = info?.source ?? BACKSTAGE_SOURCE;
        return {
          id,
          label: info?.label ?? bareToolName(id),
          secondary: source === BACKSTAGE_SOURCE ? undefined : source,
          icon: runAsIcon(source, classes.runAs),
          group: source,
        };
      });
    const staleRows: AssignRow[] = stale.map(s => {
      const gone = s.reason === 'gone';
      return {
        id: s.id,
        label: bareToolName(s.id),
        tone: gone ? 'error' : 'warning',
        secondary: gone
          ? `${
              s.source === BACKSTAGE_SOURCE ? 'action' : s.source
            } — no longer available`
          : `${s.source} unreachable — unverifiable`,
        icon: gone ? (
          <ErrorIcon className={classes.staleIconGone} />
        ) : (
          <WarningIcon className={classes.staleIconWarn} />
        ),
        group: s.source,
      };
    });
    // Group order: Backstage first, then MCP servers by id, then any leftover
    // (e.g. a removed server). Stable sort preserves within-group order.
    const rank = new Map<string, number>([[BACKSTAGE_SOURCE, 0]]);
    [...capabilities.mcpServers]
      .sort((a, b) => a.id.localeCompare(b.id))
      .forEach((s, i) => rank.set(s.id, i + 1));
    const rankOf = (g?: string) =>
      g && rank.has(g) ? (rank.get(g) as number) : Number.MAX_SAFE_INTEGER;
    return [...liveRows, ...staleRows].sort(
      (a, b) => rankOf(a.group) - rankOf(b.group),
    );
  }, [allowedTools, live, stale, byId, classes, capabilities.mcpServers]);

  const add = (id: string) => {
    if (!selected.has(id)) {
      onChange([...allowedTools, id]);
    }
  };
  const remove = (id: string) => onChange(allowedTools.filter(t => t !== id));

  const renderAction = (row: AssignRow) => {
    if (row.tone) {
      return null; // stale rows show only the remove ✕
    }
    const needsApproval = approvalSet.has(row.id);
    const desc = byId.get(row.id)?.description;
    if (!needsApproval && !desc) {
      return null;
    }
    return (
      <>
        {needsApproval && (
          <Tooltip title="Requires approval before each run.">
            <GavelOutlinedIcon
              role="img"
              aria-label="Requires approval before each run"
              className={classes.approval}
            />
          </Tooltip>
        )}
        {desc && (
          <Tooltip title={desc} placement="left">
            <IconButton size="small" aria-label={`Details for ${row.label}`}>
              <InfoOutlinedIcon className={classes.info} />
            </IconButton>
          </Tooltip>
        )}
      </>
    );
  };

  const renderGroupHeader = (group: string) => {
    const m = sources.get(group);
    if (!m) {
      return group;
    }
    return (
      <span className={classes.groupHead}>
        {m.heading}
        {!m.isBackstage &&
          (m.reachable ? (
            <Tooltip title="Reachable">
              <CheckCircleIcon className={classes.reachOk} />
            </Tooltip>
          ) : (
            <Tooltip title={m.reachError ?? 'Server unreachable'}>
              <WarningIcon className={classes.reachWarn} />
            </Tooltip>
          ))}
      </span>
    );
  };

  return (
    <AssignList
      rows={rows}
      options={options}
      onAdd={add}
      onRemove={remove}
      grouped
      groupRows
      renderGroupHeader={renderGroupHeader}
      renderRowAction={renderAction}
      addLabel="Add tool"
      searchPlaceholder="Search tools…"
      emptyHint="No tools assigned."
      noOptionsText="No tools available to add."
    />
  );
}
