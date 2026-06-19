import { createPermission } from '@backstage/plugin-permission-common';

/**
 * Permission to use the assistants plugin — load the chat surface and converse
 * with the assistants you can access. Gates `GET /status`, `POST /chat`,
 * `POST /title`, and the conversation (`/threads`) routes on the backend, and
 * the chat page on the frontend.
 *
 * Which assistants a holder actually sees is a separate, per-assistant decision
 * (the {@link AssistantAccess} policy stored on each definition), not a
 * permission.
 *
 * @public
 */
export const assistantUsePermission = createPermission({
  name: 'assistant.use',
  attributes: { action: 'read' },
});

/**
 * Permission to manage assistant definitions — open the admin editor and
 * create / edit / delete assistants. Gates `/manage/*` and `/capabilities` on
 * the backend and the editor gear on the frontend.
 *
 * @public
 */
export const assistantManagePermission = createPermission({
  name: 'assistant.manage',
  attributes: {},
});

/**
 * Every permission this plugin defines, for registration in a host's permission
 * policy.
 *
 * @public
 */
export const assistantsPermissions = [
  assistantUsePermission,
  assistantManagePermission,
];
