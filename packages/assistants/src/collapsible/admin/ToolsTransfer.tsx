/**
 * The Tools section: the assigned tools grouped by source (Backstage actions,
 * then the browser's client tools, then one group per MCP server) over an
 * "＋ Add tool" picker drawn from the live `/capabilities` inventory plus the
 * client tools registered in this browser, grouped the same way, with a rule
 * between groups. Each group header gives the source's name (with an MCP
 * server's reachability), its kind, and in words whose identity its tools run
 * under: the user (Backstage permissions, the browser's own sign-ins, or a
 * per-user server's sign-in; a person icon) or a server's shared credential (a
 * key, in amber). Each assigned row leads with that identity's icon, shows a ⚖ when the tool needs approval, and an ⓘ with
 * the tool description. STALE assignments (in `allowedTools` but not live)
 * render flagged RED (gone) / AMBER (unverifiable) with a remove ✕.
 */
import { useMemo } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import Tooltip from '@material-ui/core/Tooltip';
import IconButton from '@material-ui/core/IconButton';
import Button from '@material-ui/core/Button';
import WarningIcon from '@material-ui/icons/Warning';
import ErrorIcon from '@material-ui/icons/Error';
import CheckCircleIcon from '@material-ui/icons/CheckCircle';
import InfoOutlinedIcon from '@material-ui/icons/InfoOutlined';
import PersonOutlineIcon from '@material-ui/icons/PersonOutline';
import VpnKeyOutlinedIcon from '@material-ui/icons/VpnKeyOutlined';
import GavelOutlinedIcon from '@material-ui/icons/GavelOutlined';
import {
  CapabilitiesResponse,
  CLIENT_TOOL_NAME_PATTERN,
  type UserCredentialSpec,
} from '@drewswiredin/backstage-plugin-assistants-common';
import { AssignList, AssignOption, AssignRow } from './AssignList';
import type { AssistantClientTool } from '../../clientTools/types';
import { clientToolNeedsApproval } from '../../clientTools/runClientTool';
import {
  BACKSTAGE_SOURCE,
  CLIENT_SOURCE,
  mcpToolId,
  bareToolName,
  partitionTools,
} from './adminModel';

const useStyles = makeStyles(theme => ({
  // The header is centred over its group: name, kind, then identity.
  groupHead: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: 2,
  },
  groupTitle: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(0.75),
    minHeight: 24,
  },
  kind: {
    fontSize: '0.68rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: theme.palette.text.secondary,
  },
  groupName: {
    fontSize: '0.9rem',
    fontWeight: 700,
    color: theme.palette.text.primary,
  },
  connect: {
    padding: '0 6px',
    minWidth: 0,
    textTransform: 'none',
  },
  identity: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(0.5),
    fontSize: '0.75rem',
    color: theme.palette.text.secondary,
  },
  identityShared: {
    color: theme.palette.warning?.main ?? '#b06f00',
  },
  identityIcon: {
    fontSize: '0.95rem',
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

/** How a stale row names its source. */
function staleSourceLabel(source: string): string {
  if (source === BACKSTAGE_SOURCE) return 'action';
  if (source === CLIENT_SOURCE) return 'client tool';
  return source;
}

/** Where a group's tools come from. */
type SourceKind = 'backstage' | 'client' | 'mcp';

/** Per-source display + reachability metadata for the group headers. */
interface SourceMeta {
  kind: SourceKind;
  /** "Backstage actions", "Browser tools", or the MCP server id. */
  name: string;
  reachable: boolean;
  reachError?: string;
  /** A per-user server: its sign-in, whose token its tools run with. */
  userCredentials?: UserCredentialSpec;
}

const KIND_LABEL: Record<SourceKind, string> = {
  backstage: 'Backstage',
  client: 'Browser',
  mcp: 'MCP server',
};

/** Whose identity a source's tools run under, in words and as an icon. */
interface Identity {
  /** Short: "Runs as you" or "Shared credential". */
  label: string;
  /** The specifics: which sign-in or permissions apply. */
  detail: string;
  /** True when every user acts as one configured identity. */
  shared: boolean;
  Icon: typeof PersonOutlineIcon;
}

function identityOf(meta: SourceMeta): Identity {
  if (meta.kind === 'backstage') {
    return {
      label: 'Runs as you',
      detail: 'your Backstage permissions apply',
      shared: false,
      Icon: PersonOutlineIcon,
    };
  }
  if (meta.kind === 'client') {
    return {
      label: 'Runs as you',
      detail: 'in your browser, with your own sign-in to each system',
      shared: false,
      Icon: PersonOutlineIcon,
    };
  }
  if (meta.userCredentials) {
    return {
      label: 'Runs as you',
      detail: `with your own ${meta.userCredentials.title} sign-in`,
      shared: false,
      Icon: PersonOutlineIcon,
    };
  }
  return {
    label: 'Shared credential',
    detail: "every user acts as the server's configured identity",
    shared: true,
    Icon: VpnKeyOutlinedIcon,
  };
}

/** The leading icon of a tool row: its source's identity, explained on hover. */
function identityIcon(meta: SourceMeta | undefined, className: string) {
  if (!meta) return undefined;
  const { label, detail, Icon } = identityOf(meta);
  return (
    <Tooltip title={`${label}: ${detail}.`}>
      <Icon
        role="img"
        aria-label={`${label}: ${detail}`}
        className={className}
      />
    </Tooltip>
  );
}

export function ToolsTransfer({
  capabilities,
  clientTools = [],
  allowedTools,
  onChange,
  onConnect,
}: {
  capabilities: CapabilitiesResponse;
  /** Sign in to a per-user server's provider and list its tools as the admin. */
  onConnect?: (spec: UserCredentialSpec) => void;
  /** The client tools registered in this browser. */
  clientTools?: ReadonlyArray<AssistantClientTool<any, any>>;
  allowedTools: string[];
  onChange: (next: string[]) => void;
}) {
  const classes = useStyles();

  const selected = useMemo(() => new Set(allowedTools), [allowedTools]);
  // The approval floor plus every client tool that asks on its own account
  // (not read-only, or destructive), so the gavel means the same thing for
  // every tool kind.
  const approvalSet = useMemo(() => {
    const floor = new Set(capabilities.requireApproval);
    const set = new Set(floor);
    for (const t of clientTools) {
      if (clientToolNeedsApproval(t, floor)) set.add(t.name);
    }
    return set;
  }, [capabilities.requireApproval, clientTools]);

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
      kind: 'backstage',
      name: 'Backstage actions',
      reachable: true,
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

    // Built-ins are always offered and never assigned, so they stay out of
    // the picker.
    const contributed = clientTools.filter(t =>
      CLIENT_TOOL_NAME_PATTERN.test(t.name),
    );
    if (contributed.length > 0) {
      meta.set(CLIENT_SOURCE, {
        kind: 'client',
        name: 'Browser tools',
        reachable: true,
      });
    }
    for (const t of contributed) {
      lookup.set(t.name, {
        label: t.name,
        description: t.description,
        source: CLIENT_SOURCE,
      });
      if (!selected.has(t.name)) {
        opts.push({
          id: t.name,
          label: t.name,
          group: CLIENT_SOURCE,
          secondary: t.description,
        });
      }
    }

    const servers = [...capabilities.mcpServers].sort((x, y) =>
      x.id.localeCompare(y.id),
    );
    for (const server of servers) {
      meta.set(server.id, {
        kind: 'mcp',
        name: server.id,
        reachable: server.reachable,
        reachError: server.error,
        userCredentials: server.userCredentials,
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
  }, [capabilities, clientTools, selected]);

  const clientToolIds = useMemo(
    () => new Set(clientTools.map(t => t.name)),
    [clientTools],
  );
  const { live, stale } = useMemo(
    () => partitionTools(allowedTools, capabilities, clientToolIds),
    [allowedTools, capabilities, clientToolIds],
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
          // The group header names the source and its identity.
          icon: identityIcon(sources.get(source), classes.runAs),
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
          ? `${staleSourceLabel(s.source)} — no longer available`
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
    const rank = new Map<string, number>([
      [BACKSTAGE_SOURCE, 0],
      [CLIENT_SOURCE, 1],
    ]);
    [...capabilities.mcpServers]
      .sort((a, b) => a.id.localeCompare(b.id))
      .forEach((s, i) => rank.set(s.id, i + 2));
    const rankOf = (g?: string) =>
      g && rank.has(g) ? (rank.get(g) as number) : Number.MAX_SAFE_INTEGER;
    return [...liveRows, ...staleRows].sort(
      (a, b) => rankOf(a.group) - rankOf(b.group),
    );
  }, [
    allowedTools,
    live,
    stale,
    byId,
    sources,
    classes,
    capabilities.mcpServers,
  ]);

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

  // Three lines per source: its name (and an MCP server's reachability), its
  // kind, then whose identity its tools run under.
  const renderGroupHeader = (group: string) => {
    const m = sources.get(group);
    if (!m) {
      return group;
    }
    const identity = identityOf(m);
    return (
      <div className={classes.groupHead}>
        <div className={classes.groupTitle}>
          <span className={classes.groupName}>{m.name}</span>
          {m.kind === 'mcp' &&
            (m.reachable ? (
              <Tooltip title="Reachable">
                <CheckCircleIcon className={classes.reachOk} />
              </Tooltip>
            ) : (
              <Tooltip title={m.reachError ?? 'Server unreachable'}>
                <WarningIcon className={classes.reachWarn} />
              </Tooltip>
            ))}
          {!m.reachable && m.userCredentials && onConnect && (
            <Button
              size="small"
              color="primary"
              className={classes.connect}
              onClick={() => onConnect(m.userCredentials!)}
            >
              Connect {m.userCredentials.title}
            </Button>
          )}
        </div>
        <div className={classes.kind}>{KIND_LABEL[m.kind]}</div>
        <div
          className={`${classes.identity} ${
            identity.shared ? classes.identityShared : ''
          }`}
        >
          <identity.Icon className={classes.identityIcon} />
          <span>
            <strong>{identity.label}</strong> · {identity.detail}
          </span>
        </div>
      </div>
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
