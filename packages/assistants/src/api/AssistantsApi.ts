import {
  createApiRef,
  DiscoveryApi,
  FetchApi,
} from '@backstage/core-plugin-api';
import { ResponseError } from '@backstage/errors';
import {
  AssistantDefinition,
  AssistantId,
  ApprovalPreviewRequest,
  ApprovalPreviewResponse,
  CapabilitiesResponse,
  ElicitationResponseRequest,
  McpOAuthConnection,
  McpOAuthStartResponse,
  McpOAuthStatusResponse,
  ReasoningLevel,
  StatusResponse,
} from '@drewswiredin/backstage-plugin-assistants-common';

/**
 * Per-conversation status row from `GET /threads/status` (all the user's
 * threads across every assistant).
 *
 * @public
 */
export interface ConversationStatusRow {
  threadId: string;
  assistantId: string;
  unread: boolean;
  working: boolean;
  /** Last completed turn's total tokens (input + output) — drives the gauge. */
  tokens?: number;
}

/**
 * Server-side thread fields patchable outside the runtime adapter (pin, model,
 * reasoning level). Rename/archive/delete go through the runtime's
 * `ThreadListItemRuntime`.
 *
 * @public
 */
export interface ThreadPatch {
  title?: string;
  model?: string;
  /** `null` clears the stored level (back to the provider default). */
  reasoningLevel?: ReasoningLevel | null;
  pinned?: boolean;
  archived?: boolean;
}

/**
 * Client for the AI Assistants backend.
 *
 * Resolves the backend base URL via `discoveryApi.getBaseUrl('assistants')` and
 * issues authenticated requests via `fetchApi.fetch`. Components must never read
 * `config 'backend.baseUrl'` or fetch in-component — they go through this API.
 *
 * @public
 */
export interface AssistantsApi {
  /** Fetch the browser-safe plugin status (accessible assistants, models, default). */
  getStatus(): Promise<StatusResponse>;

  /**
   * Resolve the backend base URL (`.../api/assistants`). Used by the chat
   * transport to build the `/chat` (+ cancel/resume) URLs.
   */
  getBaseUrl(): Promise<string>;

  /**
   * The authenticated `fetch`. The chat transport needs the raw authed fetch to
   * wire the AI SDK `DefaultChatTransport`.
   */
  fetch: typeof fetch;

  /**
   * The single authenticated JSON gateway: resolves the base URL, sets the
   * JSON content type on bodied requests, throws a
   * {@link @backstage/errors#ResponseError} on a non-2xx status, and parses
   * the response body (undefined when empty, e.g. a 204). The thread-list
   * adapter builds its REST calls on this instead of hand-rolling transport.
   */
  requestJson<T = void>(path: string, init?: RequestInit): Promise<T>;

  /**
   * The status of every one of the user's conversations across all assistants —
   * the single source the client derives all indicators from. Best-effort:
   * returns `[]` on failure.
   */
  getThreadsStatus(): Promise<ConversationStatusRow[]>;

  /** Mark a thread read on the server (clears its unread flag). Best-effort. */
  markThreadRead(threadId: string): Promise<void>;

  /** Patch a thread's server-side fields (see {@link ThreadPatch}). */
  patchThread(threadId: string, patch: ThreadPatch): Promise<void>;

  /**
   * Fetch the live, assignable capability inventory that feeds the editor's
   * pickers (Backstage actions, the model pool, and MCP servers with their
   * reachability + tools). Admin-gated server-side — rejects (403) for
   * non-admins; only call when the caller has the `assistant.manage` permission.
   * `headers` carries the admin's credentials header, so per-user MCP servers
   * are listed as the admin.
   */
  getCapabilities(
    headers?: Record<string, string>,
  ): Promise<CapabilitiesResponse>;

  /**
   * The current content behind a pending gated write, for the approval
   * card's diff. `headers` carries the user's credentials header, so a
   * per-user server reads as the user.
   */
  previewApproval(
    request: ApprovalPreviewRequest,
    headers?: Record<string, string>,
  ): Promise<ApprovalPreviewResponse>;

  /**
   * The user's connection to each MCP server that runs its own OAuth, keyed
   * by server id. The backend holds those tokens; the browser only sees this.
   */
  getMcpOAuthStatus(): Promise<Record<string, McpOAuthConnection>>;

  /**
   * Start signing in to a server that runs its own OAuth: has the backend
   * issue Backstage's user cookie (the callback checks it belongs to the
   * same user) and returns the authorization URL to open in a popup.
   */
  startMcpOAuth(serverId: string): Promise<string>;

  /** Disconnect from a server that runs its own OAuth. */
  disconnectMcpOAuth(serverId: string): Promise<void>;

  /**
   * Answer an MCP server's question (elicitation). Rejects with the
   * problems when the answer doesn't fit, or when the question was already
   * answered or has expired.
   */
  respondElicitation(
    id: string,
    answer: ElicitationResponseRequest,
  ): Promise<void>;

  /**
   * List the full assistant definitions for the editor
   * (`GET /manage/assistants`). Includes prompt/access/audit fields excluded
   * from the browser-safe `/status` projection. Admin-gated server-side (403
   * for non-admins).
   */
  listManagedAssistants(): Promise<AssistantDefinition[]>;

  /**
   * Create a new assistant (`POST /manage/assistants`). The server assigns the
   * `id` and persists the submitted access as-is (new assistants are seeded open
   * to any signed-in user); the returned definition is the persisted row. Rejects
   * with the server's message on a 400 delta-validation violation (a newly-added
   * tool/model that is not live).
   */
  createAssistant(
    definition: AssistantDefinition,
  ): Promise<AssistantDefinition>;

  /**
   * Update an existing assistant (`PUT /manage/assistants/:id`). Returns the
   * persisted definition. Rejects with the server's message on a 400
   * delta-validation violation.
   */
  updateAssistant(
    id: AssistantId,
    definition: AssistantDefinition,
  ): Promise<AssistantDefinition>;

  /** Delete an assistant (`DELETE /manage/assistants/:id`). */
  deleteAssistant(id: AssistantId): Promise<void>;

  /**
   * Designate the default assistant (`PUT /manage/assistants/:id/default`).
   * Opens it to every signed-in user; returns the persisted definition.
   */
  setDefaultAssistant(id: AssistantId): Promise<AssistantDefinition>;
}

/**
 * API ref for the AI Assistants backend client.
 *
 * @public
 */
export const assistantsApiRef = createApiRef<AssistantsApi>({
  id: 'plugin.assistants.client',
});

/**
 * Default {@link AssistantsApi} implementation backed by `discoveryApi` +
 * `fetchApi`.
 *
 * @public
 */
export class AssistantsClient implements AssistantsApi {
  private readonly discoveryApi: DiscoveryApi;
  private readonly fetchApi: FetchApi;
  private baseUrlPromise?: Promise<string>;

  constructor(options: { discoveryApi: DiscoveryApi; fetchApi: FetchApi }) {
    this.discoveryApi = options.discoveryApi;
    this.fetchApi = options.fetchApi;
  }

  get fetch(): typeof fetch {
    // Bind so callers (e.g. the chat transport) can destructure/pass it freely
    // without losing the FetchApi `this` context.
    return this.fetchApi.fetch.bind(this.fetchApi);
  }

  async getBaseUrl(): Promise<string> {
    this.baseUrlPromise ??= this.discoveryApi.getBaseUrl('assistants');
    return this.baseUrlPromise;
  }

  async requestJson<T = void>(path: string, init?: RequestInit): Promise<T> {
    const baseUrl = await this.getBaseUrl();
    const response = await this.fetchApi.fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw await this.toError(response);
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async getStatus(): Promise<StatusResponse> {
    return this.requestJson<StatusResponse>('/status');
  }

  async getThreadsStatus(): Promise<ConversationStatusRow[]> {
    try {
      const data = await this.requestJson<{ threads: ConversationStatusRow[] }>(
        '/threads/status',
      );
      return data.threads ?? [];
    } catch {
      return [];
    }
  }

  async markThreadRead(threadId: string): Promise<void> {
    try {
      await this.requestJson(`/threads/${encodeURIComponent(threadId)}/read`, {
        method: 'POST',
      });
    } catch {
      // best-effort — unread is recomputed server-side on the next list()
    }
  }

  async patchThread(threadId: string, patch: ThreadPatch): Promise<void> {
    await this.requestJson(`/threads/${encodeURIComponent(threadId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  async getCapabilities(
    headers?: Record<string, string>,
  ): Promise<CapabilitiesResponse> {
    return this.requestJson<CapabilitiesResponse>('/capabilities', {
      headers,
    });
  }

  async previewApproval(
    request: ApprovalPreviewRequest,
    headers?: Record<string, string>,
  ): Promise<ApprovalPreviewResponse> {
    return this.requestJson<ApprovalPreviewResponse>('/preview', {
      method: 'POST',
      body: JSON.stringify(request),
      headers,
    });
  }

  async getMcpOAuthStatus(): Promise<Record<string, McpOAuthConnection>> {
    const body = await this.requestJson<McpOAuthStatusResponse>(
      '/mcp/oauth/status',
    );
    return body.servers ?? {};
  }

  async startMcpOAuth(serverId: string): Promise<string> {
    // The sign-in callback is a top-level navigation with no Backstage token:
    // it identifies the user by the cookie this sets.
    await this.requestJson('/.backstage/auth/v1/cookie', {
      credentials: 'include',
    });
    const { authorizationUrl } = await this.requestJson<McpOAuthStartResponse>(
      `/mcp/${encodeURIComponent(serverId)}/oauth/start`,
      { method: 'POST' },
    );
    return authorizationUrl;
  }

  async disconnectMcpOAuth(serverId: string): Promise<void> {
    await this.requestJson(`/mcp/${encodeURIComponent(serverId)}/oauth`, {
      method: 'DELETE',
    });
  }

  async respondElicitation(
    id: string,
    answer: ElicitationResponseRequest,
  ): Promise<void> {
    const baseUrl = await this.getBaseUrl();
    const response = await this.fetchApi.fetch(
      `${baseUrl}/elicitations/${encodeURIComponent(id)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(answer),
      },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        body?.error?.message ??
          `The answer was not accepted (${response.status})`,
      );
    }
  }

  async listManagedAssistants(): Promise<AssistantDefinition[]> {
    // The endpoint wraps the list as `{ assistants: [...] }`.
    const body = await this.requestJson<{ assistants?: AssistantDefinition[] }>(
      '/manage/assistants',
    );
    return body.assistants ?? [];
  }

  async createAssistant(
    definition: AssistantDefinition,
  ): Promise<AssistantDefinition> {
    return this.requestJson<AssistantDefinition>('/manage/assistants', {
      method: 'POST',
      body: JSON.stringify(definition),
    });
  }

  async updateAssistant(
    id: AssistantId,
    definition: AssistantDefinition,
  ): Promise<AssistantDefinition> {
    return this.requestJson<AssistantDefinition>(
      `/manage/assistants/${encodeURIComponent(id)}`,
      { method: 'PUT', body: JSON.stringify(definition) },
    );
  }

  async deleteAssistant(id: AssistantId): Promise<void> {
    // Tolerate both 204 (no body) and 200 (echoed body); only the status matters.
    await this.requestJson(`/manage/assistants/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async setDefaultAssistant(id: AssistantId): Promise<AssistantDefinition> {
    return this.requestJson<AssistantDefinition>(
      `/manage/assistants/${encodeURIComponent(id)}/default`,
      { method: 'PUT' },
    );
  }

  private async toError(response: Response): Promise<Error> {
    const error = await ResponseError.fromResponse(response);
    // Delta-validation (and other 400s) carry a human-readable reason the editor
    // surfaces inline — throw that message verbatim so callers can show it
    // without the `Request failed with 400 …` envelope.
    const detail = error.body?.error?.message;
    if (response.status === 400 && typeof detail === 'string' && detail) {
      return new Error(detail);
    }
    return error;
  }
}
