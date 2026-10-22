import { createRouteRef, createSubRouteRef } from '@backstage/core-plugin-api';

/**
 * Root route for the Assistants page (Page A — collapsible-sidebar chrome).
 *
 * @public
 */
export const rootRouteRef = createRouteRef({
  id: 'assistants',
});

/**
 * One conversation on the Assistants page: `/assistants/threads/:threadId`.
 * The page selects that thread (and its assistant) once, then replaces the
 * URL with the root path. A thread the caller cannot see lands on the normal
 * page with a notice. The panel's "Open in Assistants" links here.
 *
 * @public
 */
export const threadRouteRef = createSubRouteRef({
  id: 'assistants/thread',
  parent: rootRouteRef,
  path: '/threads/:threadId',
});
