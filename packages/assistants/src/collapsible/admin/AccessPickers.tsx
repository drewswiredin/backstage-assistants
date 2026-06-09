/**
 * User + group entity-ref pickers for an assistant's access policy, backed by
 * the catalog (`catalogApiRef.getEntities`, kinds User / Group). Multi-select
 * freeSolo @material-ui/lab Autocompletes that store canonical entity refs
 * (`user:ns/name`, `group:ns/name`). Lenient: a typed value that isn't a known
 * entity is still accepted as a ref (normalized to a default-namespace ref when
 * it's a bare name) — the backend tolerates dangling refs (they grant nobody).
 */
import { useEffect, useMemo, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import {
  parseEntityRef,
  stringifyEntityRef,
  DEFAULT_NAMESPACE,
} from '@backstage/catalog-model';
import Autocomplete from '@material-ui/lab/Autocomplete';
import TextField from '@material-ui/core/TextField';
import Chip from '@material-ui/core/Chip';

/** Normalize a typed token to a canonical entity ref of the given kind. */
function toRef(kind: 'user' | 'group', raw: string): string {
  const value = raw.trim();
  if (!value) {
    return value;
  }
  try {
    // Accept an already-qualified ref (`user:ns/name`, `ns/name`, `name`) and
    // re-stringify it canonically with the expected default kind/namespace.
    const parsed = parseEntityRef(value, {
      defaultKind: kind,
      defaultNamespace: DEFAULT_NAMESPACE,
    });
    return stringifyEntityRef(parsed);
  } catch {
    // Unparseable token — store as typed (lenient; backend tolerates it).
    return value;
  }
}

/** A short human label for a stored ref (drop the kind + default namespace). */
function refLabel(ref: string): string {
  try {
    const { kind, namespace, name } = parseEntityRef(ref);
    const ns =
      namespace && namespace !== DEFAULT_NAMESPACE ? `${namespace}/` : '';
    return `${ns}${name}`;
  } catch {
    return ref;
  }
}

function EntityRefPicker({
  kind,
  label,
  placeholder,
  value,
  onChange,
}: {
  kind: 'user' | 'group';
  label: string;
  placeholder: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const catalogApi = useApi(catalogApiRef);
  const [options, setOptions] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    catalogApi
      .getEntities({
        filter: { kind: kind === 'user' ? 'User' : 'Group' },
        fields: ['kind', 'metadata.name', 'metadata.namespace'],
      })
      .then(res => {
        if (!active) {
          return;
        }
        setOptions(res.items.map(e => stringifyEntityRef(e)));
      })
      .catch(() => {
        // Catalog unavailable — degrade to a freeSolo text field (typed refs
        // still work). No alert; the picker is non-essential when denying all.
        if (active) {
          setOptions([]);
        }
      });
    return () => {
      active = false;
    };
  }, [catalogApi, kind]);

  return (
    <Autocomplete<string, true, false, true>
      multiple
      freeSolo
      size="small"
      options={options}
      value={value}
      getOptionLabel={refLabel}
      filterSelectedOptions
      onChange={(_e, next) => {
        // `next` mixes picked options (canonical refs) and freeSolo strings.
        const refs = (next as string[]).map(v => toRef(kind, v));
        // De-dupe (a typed ref may normalize to an existing pick).
        onChange([...new Set(refs.filter(Boolean))]);
      }}
      renderTags={(tagValue, getTagProps) =>
        tagValue.map((ref, index) => (
          <Chip
            size="small"
            label={refLabel(ref)}
            {...getTagProps({ index })}
            key={ref}
          />
        ))
      }
      renderInput={params => (
        <TextField
          {...params}
          variant="outlined"
          label={label}
          placeholder={value.length === 0 ? placeholder : undefined}
        />
      )}
    />
  );
}

/**
 * The user + group access pickers shown when an assistant is NOT available to
 * all signed-in users. Edits the `users` / `groups` entity-ref arrays.
 */
export function AccessPickers({
  users,
  groups,
  onUsersChange,
  onGroupsChange,
  className,
}: {
  users: string[];
  groups: string[];
  onUsersChange: (next: string[]) => void;
  onGroupsChange: (next: string[]) => void;
  className?: string;
}) {
  // Stable identity for the field labels (avoids re-creating per render).
  const labels = useMemo(
    () => ({
      user: 'Users',
      group: 'Groups',
    }),
    [],
  );

  return (
    <div className={className}>
      <EntityRefPicker
        kind="user"
        label={labels.user}
        placeholder="Add a user (e.g. user:default/jane)"
        value={users}
        onChange={onUsersChange}
      />
      <EntityRefPicker
        kind="group"
        label={labels.group}
        placeholder="Add a group (e.g. group:default/team-a)"
        value={groups}
        onChange={onGroupsChange}
      />
    </div>
  );
}
