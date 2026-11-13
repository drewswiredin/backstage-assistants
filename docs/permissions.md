# Grant assistant.use and assistant.manage

The plugin defines two Backstage permissions in
`@drewswiredin/backstage-plugin-assistants-common` (exported as
`assistantUsePermission`, `assistantManagePermission`, and the
`assistantsPermissions` array):

| Permission                  | `name`             | `action` | Gates                                                                                 |
| --------------------------- | ------------------ | -------- | ------------------------------------------------------------------------------------- |
| `assistantUsePermission`    | `assistant.use`    | `read`   | the user-facing routes (`GET /status`, `POST /chat`, `/threads`) and the chat surface |
| `assistantManagePermission` | `assistant.manage` | `update` | `/manage/*` + `/capabilities` and the admin editor (the gear)                         |

Both are enforced server-side (403 when denied) and gated client-side with
`usePermission`. They are registered with `coreServices.permissionsRegistry`,
so they are published on
`GET /api/assistants/.well-known/backstage/permissions/metadata` and show up in
permission UIs that discover permissions through that endpoint (the RBAC role
editor, for one). Which assistants an `assistant.use` holder then sees is the
per-assistant access policy stored on each definition, orthogonal to these
permissions. A group in that policy covers its own members and the members of
every group beneath it in the catalog (`childOf`, which a group's
`spec.parent` produces), the way the RBAC plugin resolves group roles; the
backend reads the hierarchy from the catalog and reuses it for a minute.

Default-allow, like every plugin: a create-app backend ships
`permission.enabled: true` with
`@backstage/plugin-permission-backend-module-allow-all-policy`, under which
every signed-in user holds both permissions; with `permission.enabled` unset or
`false` Backstage skips policy evaluation, with the same effect. Gating takes
effect once permissions are enabled and a policy like one of the two below is
installed.

To gate with your own
[`PermissionPolicy`](https://backstage.io/docs/permissions/writing-a-policy),
authorize the two permissions for the right users (here, by group membership):

```ts
// packages/backend/src/permissionPolicy.ts
import { createBackendModule } from '@backstage/backend-plugin-api';
import { policyExtensionPoint } from '@backstage/plugin-permission-node/alpha';
import {
  PermissionPolicy,
  PolicyQuery,
  PolicyQueryUser,
} from '@backstage/plugin-permission-node';
import {
  AuthorizeResult,
  PolicyDecision,
} from '@backstage/plugin-permission-common';

class AssistantsPolicy implements PermissionPolicy {
  async handle(
    req: PolicyQuery,
    user?: PolicyQueryUser,
  ): Promise<PolicyDecision> {
    const name = req.permission.name;
    if (name === 'assistant.use' || name === 'assistant.manage') {
      // Group memberships arrive as ownership entity refs on the caller.
      const groups = user?.info.ownershipEntityRefs ?? [];
      const isAdmin = groups.includes('group:default/assistants-admins');
      const isUser = groups.includes('group:default/assistants-users');
      const allowed = name === 'assistant.manage' ? isAdmin : isUser || isAdmin;
      return { result: allowed ? AuthorizeResult.ALLOW : AuthorizeResult.DENY };
    }
    // Leave every other plugin's permissions to your wider policy.
    return { result: AuthorizeResult.ALLOW };
  }
}

export default createBackendModule({
  pluginId: 'permission',
  moduleId: 'assistants-policy',
  register(reg) {
    reg.registerInit({
      deps: { policy: policyExtensionPoint },
      async init({ policy }) {
        policy.setPolicy(new AssistantsPolicy());
      },
    });
  },
});
```

Then wire it into the backend and drop the allow-all module (the policy
extension point accepts exactly one policy):

```ts
// packages/backend/src/index.ts
backend.add(import('@backstage/plugin-permission-backend'));
// backend.add(import('@backstage/plugin-permission-backend-module-allow-all-policy')); // remove
backend.add(import('./permissionPolicy'));
```

Grant `assistant.use` to anyone who may chat, and `assistant.manage` to admins
who may run the editor. Group membership comes from the caller's
`ownershipEntityRefs`, resolved by your auth provider from the catalog, so the
groups referenced above must exist and the users be members.

With
[`@backstage-community/plugin-rbac-backend`](https://github.com/backstage/community-plugins/tree/main/workspaces/rbac)
in place of a hand-written policy, list the plugin so its permissions are
discoverable, then bind them to roles from the RBAC UI or a policy file:

```yaml
# app-config.yaml
permission:
  enabled: true
  rbac:
    pluginsWithPermission: [assistants]
```

```csv
# rbac-policy.csv
p, role:default/assistants-users, assistant.use, read, allow
p, role:default/assistants-admins, assistant.manage, update, allow
g, group:default/assistants-users, role:default/assistants-users
g, group:default/assistants-admins, role:default/assistants-admins
```
