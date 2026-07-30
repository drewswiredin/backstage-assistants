/**
 * Pure (no-React) helpers shared by the admin editor pieces: the assistant
 * "draft" model, tool-id namespacing, the live/stale tool partition, and the
 * dirty/validity checks. Kept out of the dialog component so the delta-aware
 * logic stays unit-readable and the dialog file stays focused on rendering.
 */
import {
  AssistantDefinition,
  CapabilitiesResponse,
} from '@drewswiredin/backstage-plugin-assistants-common';

/** Sentinel `allowedTools` source for built-in Backstage actions. */
export const BACKSTAGE_SOURCE = 'backstage';

/** The `<serverId>__<tool>` namespace separator for MCP tools. */
export const MCP_SEP = '__';

/**
 * A blank assistant draft for the Create flow. The server assigns the real
 * `id`; new assistants start open to any signed-in user (allowAuthenticated:true,
 * no explicit users/groups) so the access list reads "Any signed-in user" before
 * the first save — the create route persists this access as-is. `id` is empty
 * until persisted.
 */
export function blankDraft(): AssistantDefinition {
  return {
    id: '',
    title: '',
    description: '',
    color: '#7df3e1', // DEFAULT_AVATAR_COLOR (brand teal) — new assistants default to it
    prompt: '',
    access: { allowAuthenticated: true, users: [], groups: [] },
    allowedTools: [],
    models: [],
    defaultModel: null,
    ui: {},
  };
}

/**
 * Clone a definition into a new draft for the Duplicate flow: drop the id +
 * audit fields (the server assigns fresh ones) and suffix the title.
 */
export function duplicateDraft(src: AssistantDefinition): AssistantDefinition {
  return {
    id: '',
    title: `${src.title} (copy)`,
    description: src.description,
    color: src.color,
    prompt: src.prompt,
    access: {
      allowAuthenticated: src.access.allowAuthenticated,
      users: [...src.access.users],
      groups: [...src.access.groups],
    },
    allowedTools: [...src.allowedTools],
    models: [...src.models],
    defaultModel: src.defaultModel,
    ui: src.ui ? JSON.parse(JSON.stringify(src.ui)) : {},
  };
}

/** Deep-clone a definition so form edits never mutate the loaded list row. */
export function cloneDraft(src: AssistantDefinition): AssistantDefinition {
  return JSON.parse(JSON.stringify(src)) as AssistantDefinition;
}

/** Build a namespaced MCP tool id from a server id + bare tool name. */
export function mcpToolId(serverId: string, tool: string): string {
  return `${serverId}${MCP_SEP}${tool}`;
}

/** The source of an `allowedTools` entry: an MCP server id, or BACKSTAGE_SOURCE. */
export function toolSourceOf(id: string): string {
  const i = id.indexOf(MCP_SEP);
  return i === -1 ? BACKSTAGE_SOURCE : id.slice(0, i);
}

/** The bare tool/action name (drop the `<serverId>__` prefix for MCP). */
export function bareToolName(id: string): string {
  const i = id.indexOf(MCP_SEP);
  return i === -1 ? id : id.slice(i + MCP_SEP.length);
}

/** Why an assigned tool no longer maps to a live capability. */
export type StaleReason =
  /** Source is a reachable MCP server / the action registry — definitively gone. */
  | 'gone'
  /** Source is an unreachable MCP server — can't be verified, treat as a warning. */
  | 'unverifiable';

/** A tool in `allowedTools` that has no matching live capability. */
export interface StaleTool {
  id: string;
  source: string;
  reason: StaleReason;
}

/**
 * The full set of live (assignable) tool ids from a capabilities payload:
 * bare action ids + namespaced `<serverId>__<tool>` for each reachable server's
 * advertised tools.
 */
export function liveToolIds(caps: CapabilitiesResponse): Set<string> {
  const ids = new Set<string>();
  for (const a of caps.actions) {
    ids.add(a.id);
  }
  for (const server of caps.mcpServers) {
    for (const tool of server.tools) {
      ids.add(mcpToolId(server.id, tool.name));
    }
  }
  return ids;
}

/**
 * Partition an assistant's `allowedTools` into the ids that resolve to a live
 * capability vs. the STALE ones that don't, classifying each stale id:
 *  - RED ('gone'): its source is a reachable MCP server, or it's a bare action
 *    id absent from the live action list — the item is definitively gone.
 *  - AMBER ('unverifiable'): its source is an MCP server that is currently
 *    unreachable, so we can't confirm whether the tool still exists.
 */
export function partitionTools(
  allowedTools: string[],
  caps: CapabilitiesResponse,
): { live: Set<string>; stale: StaleTool[] } {
  const live = liveToolIds(caps);
  const unreachableServers = new Set(
    caps.mcpServers.filter(s => !s.reachable).map(s => s.id),
  );
  const liveSet = new Set<string>();
  const stale: StaleTool[] = [];
  for (const id of allowedTools) {
    if (live.has(id)) {
      liveSet.add(id);
      continue;
    }
    const source = toolSourceOf(id);
    const reason: StaleReason =
      source !== BACKSTAGE_SOURCE && unreachableServers.has(source)
        ? 'unverifiable'
        : 'gone';
    stale.push({ id, source, reason });
  }
  return { live: liveSet, stale };
}

/** A new assistant requires a non-empty (trimmed) title. */
export function isValid(draft: AssistantDefinition): boolean {
  return draft.title.trim().length > 0;
}

/**
 * Stable, order-insensitive JSON for dirty-tracking: sort the assignment arrays
 * so a reorder (e.g. from a chip picker) isn't reported as a change, and strip
 * audit fields the editor never edits.
 */
function normalize(draft: AssistantDefinition): string {
  const sorted = (arr: string[]) => [...arr].sort();
  return JSON.stringify({
    title: draft.title,
    description: draft.description ?? '',
    color: draft.color ?? '',
    prompt: draft.prompt,
    access: {
      allowAuthenticated: draft.access.allowAuthenticated,
      users: sorted(draft.access.users),
      groups: sorted(draft.access.groups),
    },
    allowedTools: sorted(draft.allowedTools),
    models: sorted(draft.models),
    defaultModel: draft.defaultModel,
    ui: draft.ui ?? {},
  });
}

/** Whether a draft differs from its baseline (the loaded/last-saved value). */
export function isDirty(
  draft: AssistantDefinition,
  baseline: AssistantDefinition | undefined,
): boolean {
  if (!baseline) {
    // A new (unsaved) draft is dirty once it diverges from a blank.
    return normalize(draft) !== normalize(blankDraft());
  }
  return normalize(draft) !== normalize(baseline);
}

/** Compact model label: drop the `provider:` and `vendor/` prefixes. */
export function modelLabel(id: string): string {
  return id.split(/[:/]/).pop() || id;
}
