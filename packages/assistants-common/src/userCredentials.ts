/**
 * The browser-to-backend contract for per-user MCP servers and guarded write
 * tools: which sign-in each per-user server needs, how the browser hands the
 * signed-in user's tokens to `/chat`, and how the approval card previews a
 * write. Tokens travel only in a request header, so they never reach a
 * request body, a persisted message, or a thread export.
 */

/**
 * The request header that carries the signed-in user's tokens for per-user
 * MCP servers: base64 of a JSON object keyed by MCP server id. Sent on `/chat`,
 * `/capabilities`, and the approval preview; never stored.
 *
 * @public
 */
export const USER_CREDENTIALS_HEADER = 'x-assistants-credentials';

/**
 * The sign-in a per-user MCP server needs, as the browser sees it: enough to
 * ask Backstage's auth APIs for the user's token, and nothing secret.
 *
 * @public
 */
export interface UserCredentialSpec {
  /** The configured MCP server id: the key of its token in the header. */
  server: string;
  /**
   * The Backstage auth provider: `github`, `gitlab`, `microsoft`, `google`,
   * `atlassian`, `okta`, `onelogin`, `bitbucket`, `bitbucketServer`,
   * `openshift`, or `vmwareCloud`.
   */
  provider: string;
  /**
   * The source-control host, e.g. `github.com`. When set, the token comes from
   * Backstage's SCM auth (which picks the provider by host, so GitHub
   * Enterprise and self-hosted GitLab work); otherwise from the provider's own
   * auth API.
   */
  host?: string;
  /** OAuth scopes to request; empty means the provider's defaults. */
  scopes?: string[];
  /** Display name for the sign-in, e.g. `GitHub` in "Connect GitHub". */
  title: string;
}

/**
 * How the approval card shows a write instead of raw JSON: the call's target
 * and, when the server has a read tool for it, a diff against what is there
 * now. Field values are templates over the call's input: `{owner}/{repo}`
 * interpolates, a bare name such as `path` reads that argument.
 *
 * @public
 */
export interface ApprovalPreview {
  /** `file`: one file's new content. `files`: a list of files in one commit. */
  type: 'file' | 'files';
  /** Templates for the card's header and body. */
  fields: {
    /** The repository or project, e.g. `{owner}/{repo}`. */
    repo?: string;
    /** The branch written to. */
    branch?: string;
    /** `file`: the file path. */
    path?: string;
    /** `file`: the new content. */
    content?: string;
    /** `files`: the argument holding `[{ path, content }]`. */
    files?: string;
    /** The commit message. */
    message?: string;
  };
  /**
   * True when the server has a read tool for the current content, fetched
   * through the approval preview endpoint as the same user for a diff.
   */
  diff: boolean;
}

/**
 * Body of `POST /api/assistants/preview`: the pending call to preview. The
 * backend runs the read tool configured for that tool, never a tool the
 * browser names.
 *
 * @public
 */
export interface ApprovalPreviewRequest {
  /** The assistant whose conversation holds the call. */
  assistantId: string;
  /** The namespaced tool awaiting approval, e.g. `github__create_or_update_file`. */
  tool: string;
  /** The call's input. */
  input: Record<string, unknown>;
}

/**
 * The current content behind a pending write, one entry per file.
 *
 * @public
 */
export interface ApprovalPreviewResponse {
  files: Array<{
    path: string;
    /** False when the file does not exist yet: the write creates it. */
    exists: boolean;
    /** The current content, when it exists and is text. */
    content?: string;
    /** Why the current content couldn't be read, when it couldn't. */
    error?: string;
  }>;
}

/**
 * Resolve an {@link ApprovalPreview} field template against a call's input:
 * a template with `{name}` placeholders interpolates each argument; a bare
 * name returns that argument as is (a string, or the array of a `files`
 * field). Missing arguments resolve to undefined, and to an empty string
 * inside a template.
 *
 * @public
 */
export function resolvePreviewField(
  template: string | undefined,
  input: Record<string, unknown>,
): unknown {
  if (!template) return undefined;
  if (!template.includes('{')) return input[template];
  return template.replace(/\{([^{}]+)\}/g, (_, name: string) => {
    const value = input[name.trim()];
    return typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : '';
  });
}
