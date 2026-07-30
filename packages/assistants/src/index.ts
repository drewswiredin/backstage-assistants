/**
 * Frontend plugin for Backstage AI Assistants.
 *
 * Targets the new frontend system; the plugin itself is published via the
 * `./alpha` subpath export. This entrypoint exposes the route refs and the
 * backend client API ref so host apps (e.g. a custom nav) can read the
 * browser-safe assistant list.
 *
 * @packageDocumentation
 */

export { rootRouteRef } from './routes';
export { assistantsApiRef } from './api';
export type { AssistantsApi } from './api';
/** Nav-rail icon with a live working/unread status dot (for a host's custom nav). */
export { AssistantsNavIcon } from './AssistantsNavIcon';
