import {
  createApiRef,
  DiscoveryApi,
  FetchApi,
} from '@backstage/core-plugin-api';
import {
  AssistantDefinition,
  AssistantId,
  CapabilitiesResponse,
  StatusResponse,
} from '@drewswiredin/backstage-plugin-assistants-common';

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
   * transport to build the `/chat` and `/title` URLs.
   */
  getBaseUrl(): Promise<string>;

  /**
   * The authenticated `fetch`. The chat transport needs the raw authed fetch to
   * wire the AI SDK `DefaultChatTransport`.
   */
  fetch: typeof fetch;

  /**
   * Fetch the live, assignable capability inventory that feeds the editor's
   * pickers (Backstage actions, the model pool, and MCP servers with their
   * reachability + tools). Admin-gated server-side — rejects (403) for
   * non-admins; only call when the caller has the `assistant.manage` permission.
   */
  getCapabilities(): Promise<CapabilitiesResponse>;

  /**
   * List the full assistant definitions for the editor (`GET
   * /manage/assistants`). Includes prompt/access/audit fields excluded from the
   * browser-safe `/status` projection. Admin-gated server-side (403 for
   * non-admins).
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
    return this.discoveryApi.getBaseUrl('assistants');
  }

  async getStatus(): Promise<StatusResponse> {
    const baseUrl = await this.getBaseUrl();
    const response = await this.fetchApi.fetch(`${baseUrl}/status`);
    if (!response.ok) {
      throw await this.toError(response);
    }
    return (await response.json()) as StatusResponse;
  }

  async getCapabilities(): Promise<CapabilitiesResponse> {
    const baseUrl = await this.getBaseUrl();
    const response = await this.fetchApi.fetch(`${baseUrl}/capabilities`);
    if (!response.ok) {
      throw await this.toError(response);
    }
    return (await response.json()) as CapabilitiesResponse;
  }

  async listManagedAssistants(): Promise<AssistantDefinition[]> {
    const baseUrl = await this.getBaseUrl();
    const response = await this.fetchApi.fetch(`${baseUrl}/manage/assistants`);
    if (!response.ok) {
      throw await this.toError(response);
    }
    // The endpoint wraps the list as `{ assistants: [...] }`.
    const body = (await response.json()) as {
      assistants?: AssistantDefinition[];
    };
    return body.assistants ?? [];
  }

  async createAssistant(
    definition: AssistantDefinition,
  ): Promise<AssistantDefinition> {
    const baseUrl = await this.getBaseUrl();
    const response = await this.fetchApi.fetch(`${baseUrl}/manage/assistants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(definition),
    });
    if (!response.ok) {
      throw await this.toError(response);
    }
    return (await response.json()) as AssistantDefinition;
  }

  async updateAssistant(
    id: AssistantId,
    definition: AssistantDefinition,
  ): Promise<AssistantDefinition> {
    const baseUrl = await this.getBaseUrl();
    const response = await this.fetchApi.fetch(
      `${baseUrl}/manage/assistants/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(definition),
      },
    );
    if (!response.ok) {
      throw await this.toError(response);
    }
    return (await response.json()) as AssistantDefinition;
  }

  async deleteAssistant(id: AssistantId): Promise<void> {
    const baseUrl = await this.getBaseUrl();
    const response = await this.fetchApi.fetch(
      `${baseUrl}/manage/assistants/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    // Tolerate both 204 (no body) and 200 (echoed body); only the status matters.
    if (!response.ok) {
      throw await this.toError(response);
    }
  }

  private async toError(response: Response): Promise<Error> {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error?.message ?? body?.message ?? '';
    } catch {
      // non-JSON body; fall back to status text
    }
    // Delta-validation (and other 400s) carry a human-readable reason the editor
    // surfaces inline — throw that message verbatim so callers can show it
    // without the `Request failed with 400 …` envelope. The original status is
    // still available on the attached `status` field.
    if (response.status === 400 && detail) {
      const error = new Error(detail) as Error & { status?: number };
      error.status = response.status;
      return error;
    }
    const suffix = detail ? `: ${detail}` : '';
    const error = new Error(
      `Request failed with ${response.status} ${response.statusText}${suffix}`,
    ) as Error & { status?: number };
    error.status = response.status;
    return error;
  }
}
