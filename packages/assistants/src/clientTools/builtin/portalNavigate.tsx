/**
 * `portal__navigate`: the client tool the model calls to take the user to a
 * page in this portal. `execute` only checks the path and returns
 * `{ navigated: true, path }`; the runtime navigates once the server has
 * accepted that result (see `collapsible/portalNavigation.ts`), so the turn
 * goes on server-side and the conversation follows the user in the panel.
 * Offered only when the app has the panel, which is where the conversation
 * continues; an assistant gets it when its editor enables it under Browser
 * tools.
 */
import { Link, Typography } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import OpenInBrowserIcon from '@material-ui/icons/OpenInBrowser';
import { Link as RouterLink } from 'react-router-dom';
import { appTreeApiRef } from '@backstage/frontend-plugin-api';
import type { AssistantClientTool, ClientToolRenderProps } from '../types';

export const PORTAL_NAVIGATE = 'portal__navigate';

/** The panel module's extension, which carries the conversation across pages. */
const PANEL_EXTENSION_ID = 'app-root-wrapper:app/assistants-panel';

const MAX_PATH_LENGTH = 2000;

export type PortalNavigateInput = {
  path: string;
  reason?: string;
};

export type PortalNavigateOutput =
  | { navigated: true; path: string }
  | { navigated: false; error: string };

/**
 * The portal path to open, or why not: a path relative to this app (same
 * origin, starting with one `/`), never a backend route under `/api`, with no
 * `javascript:`, `data:`, or `vbscript:` anywhere. Query and hash are kept.
 */
export function resolvePortalPath(
  path: unknown,
  origin: string,
): { path: string } | { error: string } {
  if (typeof path !== 'string' || path.trim() === '') {
    return { error: 'path is required' };
  }
  const raw = path.trim();
  if (raw.length > MAX_PATH_LENGTH) {
    return { error: `path is longer than ${MAX_PATH_LENGTH} characters` };
  }
  if (!raw.startsWith('/') || /^[/\\]{2}/.test(raw)) {
    return { error: 'path must be a portal path starting with a single /' };
  }
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Keep the raw path; the scheme check below still reads it.
  }
  if (/(javascript|data|vbscript):/i.test(`${raw} ${decoded}`)) {
    return { error: 'path must not contain a script or data URL' };
  }
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return { error: 'path is not a valid URL path' };
  }
  if (url.origin !== origin) {
    return { error: 'path must stay in this portal' };
  }
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    return { error: 'path is a backend route, not a page' };
  }
  return { path: `${url.pathname}${url.search}${url.hash}` };
}

const useStyles = makeStyles(theme => ({
  note: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    margin: theme.spacing(0.5, 0),
    color: theme.palette.text.secondary,
  },
  icon: { fontSize: 16 },
}));

/** "Opened <path>", linking back to the page, or why it was not opened. */
export function PortalNavigateNote({
  result,
}: ClientToolRenderProps<PortalNavigateInput, PortalNavigateOutput>) {
  const classes = useStyles();
  if (!result || typeof result !== 'object') return null;
  // A call the runtime ended (declined, stopped) carries its own message.
  const failure = result as { _error?: boolean; message?: string };
  const shown: PortalNavigateOutput = failure._error
    ? { navigated: false, error: failure.message ?? 'the call failed' }
    : result;
  return (
    <span className={classes.note}>
      <OpenInBrowserIcon className={classes.icon} />
      <Typography variant="body2" component="span">
        {shown.navigated ? (
          <>
            Opened{' '}
            <Link component={RouterLink} to={shown.path}>
              {shown.path}
            </Link>
          </>
        ) : (
          `Did not open the page: ${shown.error}`
        )}
      </Typography>
    </span>
  );
}

export const portalNavigateTool: AssistantClientTool<
  PortalNavigateInput,
  PortalNavigateOutput
> = {
  name: PORTAL_NAVIGATE,
  title: 'Open a page',
  description:
    'Open a page in this portal for the user. `path` is a path in this portal starting with `/`, with any query and hash. Paths differ between portals (the catalog may live at `/` or at `/catalog`), so take the path from describe_portal, from a link you were given, or from the current page; never guess one. Use it when the user asks to see or go to something, not for reading data (use the read tools). The page changes only after this call returns, so a read_current_page in the same step still sees the old page: read the new page in a later step if you need to. The conversation continues in the side panel next to the page.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'The portal path to open, starting with `/`, with any query and hash.',
      },
      reason: {
        type: 'string',
        description: 'Why the page is being opened, in a few words.',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
  attributes: { readOnly: true, idempotent: true },
  isAvailable: ({ apis }) => {
    const node = apis
      .get(appTreeApiRef)
      ?.getTree()
      .tree.nodes.get(PANEL_EXTENSION_ID);
    return !!node?.instance && !node.spec.disabled;
  },
  execute: async input => {
    const resolved = resolvePortalPath(input.path, window.location.origin);
    return 'error' in resolved
      ? { navigated: false, error: resolved.error }
      : { navigated: true, path: resolved.path };
  },
  render: PortalNavigateNote,
};
