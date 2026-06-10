/**
 * The Access section: ONE compact list of the principals who may use the
 * assistant, over an "＋ Add person or group" picker. The list maps directly to
 * the real {@link AssistantAccess} model — there is no "Everyone" group in
 * Backstage, so the `allowAuthenticated` boolean is shown truthfully as a single
 * "Any signed-in user" row, alongside the `users` / `groups` catalog refs.
 *
 * Rendered rows  = (allowAuthenticated ? ["Any signed-in user"] : []) + users + groups
 * Picker options = (allowAuthenticated ? [] : ["Any signed-in user"]) + catalog
 *                  users/groups not already assigned. A typed value that matches
 *                  no option is accepted as a raw entity ref (freeSolo).
 */
import { useEffect, useMemo, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import {
  parseEntityRef,
  stringifyEntityRef,
  DEFAULT_NAMESPACE,
} from '@backstage/catalog-model';
import PersonOutlineIcon from '@material-ui/icons/PersonOutline';
import GroupOutlinedIcon from '@material-ui/icons/GroupOutlined';
import PeopleAltOutlinedIcon from '@material-ui/icons/PeopleAltOutlined';
import { AssistantAccess } from '@drewswiredin/backstage-plugin-assistants-common';
import { AssignList, AssignOption, AssignRow } from './AssignList';

/** Sentinel row/option id for the `allowAuthenticated` (any signed-in user) flag. */
const ANY_AUTH = '__any_authenticated__';
const ANY_AUTH_LABEL = 'Any signed-in user';

/** A short human label for a stored ref (drop the kind + default namespace). */
function refLabel(ref: string): string {
  try {
    const { namespace, name } = parseEntityRef(ref);
    const ns =
      namespace && namespace !== DEFAULT_NAMESPACE ? `${namespace}/` : '';
    return `${ns}${name}`;
  } catch {
    return ref;
  }
}

/** Normalize a typed token to a canonical entity ref; classify its kind. */
function classifyTyped(raw: string): { kind: 'user' | 'group'; ref: string } {
  const value = raw.trim();
  let kind: 'user' | 'group' = 'user';
  try {
    const parsed = parseEntityRef(value, {
      defaultKind: 'user',
      defaultNamespace: DEFAULT_NAMESPACE,
    });
    kind = parsed.kind.toLowerCase() === 'group' ? 'group' : 'user';
    return { kind, ref: stringifyEntityRef(parsed) };
  } catch {
    return { kind: 'user', ref: value };
  }
}

/** The catalog kind of a canonical ref id ('user' | 'group'). */
function kindOf(ref: string): 'user' | 'group' {
  try {
    return parseEntityRef(ref).kind.toLowerCase() === 'group'
      ? 'group'
      : 'user';
  } catch {
    return 'user';
  }
}

const personIcon = <PersonOutlineIcon fontSize="small" />;
const groupIcon = <GroupOutlinedIcon fontSize="small" />;
const anyIcon = <PeopleAltOutlinedIcon fontSize="small" />;

export function AccessList({
  access,
  onChange,
}: {
  access: AssistantAccess;
  onChange: (next: AssistantAccess) => void;
}) {
  const catalogApi = useApi(catalogApiRef);

  // Catalog users + groups for the add picker.
  const [catalog, setCatalog] = useState<AssignOption[]>([]);

  useEffect(() => {
    let active = true;
    Promise.all([
      catalogApi.getEntities({
        filter: { kind: 'User' },
        fields: ['kind', 'metadata.name', 'metadata.namespace'],
      }),
      catalogApi.getEntities({
        filter: { kind: 'Group' },
        fields: ['kind', 'metadata.name', 'metadata.namespace'],
      }),
    ])
      .then(([users, groups]) => {
        if (!active) {
          return;
        }
        const u: AssignOption[] = users.items.map(e => {
          const ref = stringifyEntityRef(e);
          return { id: ref, label: refLabel(ref), secondary: 'user' };
        });
        const g: AssignOption[] = groups.items.map(e => {
          const ref = stringifyEntityRef(e);
          return { id: ref, label: refLabel(ref), secondary: 'group' };
        });
        setCatalog([...u, ...g]);
      })
      .catch(() => {
        // Catalog unavailable — typed refs still work via freeSolo.
        if (active) {
          setCatalog([]);
        }
      });
    return () => {
      active = false;
    };
  }, [catalogApi]);

  // Rendered rows: Any-signed-in (if on) + users + groups.
  const rows: AssignRow[] = useMemo(() => {
    const result: AssignRow[] = [];
    if (access.allowAuthenticated) {
      result.push({ id: ANY_AUTH, label: ANY_AUTH_LABEL, icon: anyIcon });
    }
    for (const ref of access.users) {
      result.push({ id: ref, label: refLabel(ref), icon: personIcon });
    }
    for (const ref of access.groups) {
      result.push({ id: ref, label: refLabel(ref), icon: groupIcon });
    }
    return result;
  }, [access]);

  // Picker options: Any-signed-in (unless on) + catalog refs not yet assigned.
  const options: AssignOption[] = useMemo(() => {
    const assigned = new Set([...access.users, ...access.groups]);
    const result: AssignOption[] = [];
    if (!access.allowAuthenticated) {
      result.push({ id: ANY_AUTH, label: ANY_AUTH_LABEL });
    }
    for (const o of catalog) {
      if (!assigned.has(o.id)) {
        result.push(o);
      }
    }
    return result;
  }, [access, catalog]);

  const add = (id: string) => {
    if (id === ANY_AUTH) {
      onChange({ ...access, allowAuthenticated: true });
      return;
    }
    if (kindOf(id) === 'group') {
      if (!access.groups.includes(id)) {
        onChange({ ...access, groups: [...access.groups, id] });
      }
    } else if (!access.users.includes(id)) {
      onChange({ ...access, users: [...access.users, id] });
    }
  };

  const addTyped = (raw: string) => {
    const { kind, ref } = classifyTyped(raw);
    if (!ref) {
      return;
    }
    if (kind === 'group') {
      if (!access.groups.includes(ref)) {
        onChange({ ...access, groups: [...access.groups, ref] });
      }
    } else if (!access.users.includes(ref)) {
      onChange({ ...access, users: [...access.users, ref] });
    }
  };

  const remove = (id: string) => {
    if (id === ANY_AUTH) {
      onChange({ ...access, allowAuthenticated: false });
      return;
    }
    onChange({
      ...access,
      users: access.users.filter(r => r !== id),
      groups: access.groups.filter(r => r !== id),
    });
  };

  return (
    <AssignList
      rows={rows}
      options={options}
      onAdd={add}
      onRemove={remove}
      addLabel="Add person or group"
      searchPlaceholder="Search people and groups…"
      emptyHint="No one can use this assistant yet."
      noOptionsText="No people or groups to add."
      allowTyped
      onAddTyped={addTyped}
    />
  );
}
