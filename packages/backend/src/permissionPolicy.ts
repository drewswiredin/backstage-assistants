/*
 * A custom Backstage PermissionPolicy that gates ONLY the two assistant.*
 * permissions by the caller's group membership, and ALLOWs everything else so
 * that catalog / scaffolder / search / etc. keep working in development.
 *
 *   assistant.manage  -> allowed iff the caller is in group 'assistants-admins'
 *   assistant.use     -> allowed iff the caller is in group 'assistants-users'
 *                        OR 'assistants-admins'
 *   <any other perm>  -> ALLOW
 *
 * Group membership is read from the caller's ownershipEntityRefs. In this dev
 * app the guest auth provider populates them from
 * `auth.providers.guest.ownershipEntityRefs` (see the app-config.role-*.yaml
 * overlays). This is the same signal the assistants plugin's per-assistant
 * access policy uses.
 *
 * Registered in the new backend system via the permission plugin's
 * `policyExtensionPoint` (see ./index.ts). This REPLACES
 * `@backstage/plugin-permission-backend-module-allow-all-policy`; that module
 * must be removed, because the extension point's `setPolicy` throws
 * "Policy already set" if two modules try to install a policy.
 */
import {
  createBackendModule,
  coreServices,
} from '@backstage/backend-plugin-api';
import {
  AuthorizeResult,
  PolicyDecision,
} from '@backstage/plugin-permission-common';
import {
  PolicyQuery,
  PolicyQueryUser,
  PermissionPolicy,
} from '@backstage/plugin-permission-node';
import { policyExtensionPoint } from '@backstage/plugin-permission-node/alpha';

// Permission names are referenced by string to avoid a backend -> plugin
// dependency. These must stay in sync with the `name` values declared in
// @drewswiredin/backstage-plugin-assistants-common (permissions.ts):
//   assistantUsePermission    -> 'assistant.use'
//   assistantManagePermission -> 'assistant.manage'
const ASSISTANT_USE_PERMISSION = 'assistant.use';
const ASSISTANT_MANAGE_PERMISSION = 'assistant.manage';

// Group entity refs, matched verbatim against the caller's ownershipEntityRefs.
// The `development` namespace matches the guest user refs in the role overlays.
const GROUP_ADMINS = 'group:development/assistants-admins';
const GROUP_USERS = 'group:development/assistants-users';

const allow: PolicyDecision = { result: AuthorizeResult.ALLOW };
const deny: PolicyDecision = { result: AuthorizeResult.DENY };

/**
 * Decides assistant.* permissions by group membership; allows everything else.
 */
export class AssistantsPermissionPolicy implements PermissionPolicy {
  async handle(
    request: PolicyQuery,
    user?: PolicyQueryUser,
  ): Promise<PolicyDecision> {
    const permissionName = request.permission.name;

    // Only the two assistant.* permissions are gated. Everything else is
    // allowed so the rest of Backstage keeps working in dev.
    if (
      permissionName !== ASSISTANT_USE_PERMISSION &&
      permissionName !== ASSISTANT_MANAGE_PERMISSION
    ) {
      return allow;
    }

    // No authenticated user (e.g. an unauthenticated request) -> deny the
    // gated assistant permissions.
    if (!user) {
      return deny;
    }

    // ownershipEntityRefs includes the caller's own userEntityRef plus every
    // group they belong to (from the guest overlay's ownershipEntityRefs).
    const ownershipRefs = user.info.ownershipEntityRefs;
    const isAdmin = ownershipRefs.includes(GROUP_ADMINS);
    const isUser = ownershipRefs.includes(GROUP_USERS);

    if (permissionName === ASSISTANT_MANAGE_PERMISSION) {
      return isAdmin ? allow : deny;
    }

    // permissionName === ASSISTANT_USE_PERMISSION
    return isAdmin || isUser ? allow : deny;
  }
}

/**
 * Backend module that installs {@link AssistantsPermissionPolicy} into the
 * permission backend. Add to the backend with:
 *
 *   backend.add(import('./permissionPolicy'));
 */
export default createBackendModule({
  pluginId: 'permission',
  moduleId: 'assistants-policy',
  register(reg) {
    reg.registerInit({
      deps: {
        policy: policyExtensionPoint,
        // coreServices.userInfo is requested only to keep the module future
        // proof; the policy itself reads ownershipEntityRefs from the
        // PolicyQueryUser handed to handle(). It is not used directly here.
        logger: coreServices.logger,
      },
      async init({ policy, logger }) {
        policy.setPolicy(new AssistantsPermissionPolicy());
        logger.info(
          'Installed AssistantsPermissionPolicy (assistant.* gated by group; all else allowed)',
        );
      },
    });
  },
});
