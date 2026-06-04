import { createRouteRef } from '@backstage/core-plugin-api';

/**
 * Root route for the Assistants page (Page A — collapsible-sidebar chrome).
 *
 * @public
 */
export const rootRouteRef = createRouteRef({
  id: 'assistants',
});
