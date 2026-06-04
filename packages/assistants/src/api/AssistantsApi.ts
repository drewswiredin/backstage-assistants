import {
  createApiRef,
  DiscoveryApi,
  FetchApi,
} from '@backstage/core-plugin-api';
import {
  AssistantId,
  ModelId,
  StatusResponse,
} from '@drewswiredin/backstage-plugin-assistants-common';

/**
 * Arguments for {@link AssistantsApi.getTitle}. Mirrors the backend `POST /title`
 * body (the shared `ChatRequest` schema): the assistant + model to title with
 * and the opening conversation messages.
 *
 * @public
 */
export interface GetTitleRequest {
  assistantId: AssistantId;
  modelId: ModelId;
  /** Opening UI messages; the backend builds the title prompt from these. */
  messages: unknown[];
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
   * transport to build the `/chat` and `/title` URLs.
   */
  getBaseUrl(): Promise<string>;

  /**
   * The authenticated `fetch`. The chat transport needs the raw authed fetch to
   * wire the AI SDK `DefaultChatTransport`.
   */
  fetch: typeof fetch;

  /**
   * Generate a short conversation title via the backend `POST /title`.
   * Best-effort by contract — the backend already falls back to a default title
   * on generation failure; callers should additionally tolerate a rejected
   * promise (network error) without breaking the conversation list.
   */
  getTitle(request: GetTitleRequest): Promise<string>;
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

  async getTitle(request: GetTitleRequest): Promise<string> {
    const baseUrl = await this.getBaseUrl();
    const response = await this.fetchApi.fetch(`${baseUrl}/title`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw await this.toError(response);
    }
    const body = (await response.json()) as { title?: unknown };
    return typeof body.title === 'string' && body.title ? body.title : 'New Chat';
  }

  private async toError(response: Response): Promise<Error> {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error?.message ?? body?.message ?? '';
    } catch {
      // non-JSON body; fall back to status text
    }
    const suffix = detail ? `: ${detail}` : '';
    return new Error(
      `Request failed with ${response.status} ${response.statusText}${suffix}`,
    );
  }
}
