import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { alertApiRef, useApiHolder } from '@backstage/core-plugin-api';
import type {
  ApprovalPreview,
  ApprovalPreviewResponse,
  AssistantId,
  ElicitationResponseRequest,
  McpOAuthConnection,
  StatusResponse,
  UserCredentialSpec,
} from '@drewswiredin/backstage-plugin-assistants-common';
import type { AssistantsApi } from '../api/AssistantsApi';
import { isOAuthSpec, signInWithPopup } from '../api/mcpOAuth';
import {
  credentialsHeader,
  getUserToken,
  getUserTokens,
} from '../api/userCredentials';

/**
 * What the chat surfaces need for per-user MCP servers and guarded writes:
 * the credentials header for an assistant's turns, the approval previews,
 * and which gated tools are approved call by call. Provided once per surface
 * from `/status`.
 */
export interface ToolGuardsValue {
  /** Gated tools with no "Always allow". */
  approveEachCall: ReadonlySet<string>;
  /** Approval-card previews by namespaced tool name. */
  approvalPreviews: Readonly<Record<string, ApprovalPreview>>;
  /** The sign-ins an assistant's per-user servers need. */
  credentialSpecs: (assistantId: AssistantId) => UserCredentialSpec[];
  /** The credentials header for an assistant's turns (silent: no popup). */
  credentialsHeader: (
    assistantId: AssistantId,
  ) => Promise<Record<string, string>>;
  /** The current content behind a pending write, read as the user. */
  previewApproval: (
    assistantId: AssistantId,
    tool: string,
    input: Record<string, unknown>,
  ) => Promise<ApprovalPreviewResponse>;
  /** The first assistant offering a tool: the preview's assistant when the thread has none yet. */
  assistantForTool: (toolName: string) => AssistantId | undefined;
  /** Bumped after a Connect, so surfaces re-check who is connected. */
  connectedVersion: number;
  /** Open the provider's sign-in for a server, then re-check. */
  connect: (spec: UserCredentialSpec) => Promise<void>;
  /**
   * The user's connection to each server that runs its own OAuth (the
   * backend holds those tokens), by server id.
   */
  oauthConnections: Readonly<Record<string, McpOAuthConnection>>;
  /** Disconnect from a server that runs its own OAuth. */
  disconnect: (spec: UserCredentialSpec) => Promise<void>;
  /** Answer an MCP server's question (elicitation). */
  respondElicitation: (
    id: string,
    answer: ElicitationResponseRequest,
  ) => Promise<void>;
}

const EMPTY: ToolGuardsValue = {
  approveEachCall: new Set(),
  approvalPreviews: {},
  credentialSpecs: () => [],
  credentialsHeader: async () => ({}),
  previewApproval: async () => ({ files: [] }),
  assistantForTool: () => undefined,
  connectedVersion: 0,
  connect: async () => {},
  oauthConnections: {},
  disconnect: async () => {},
  respondElicitation: async () => {
    throw new Error('Answers are not available here');
  },
};

const ToolGuardsContext = createContext<ToolGuardsValue>(EMPTY);

export function ToolGuardsProvider({
  status,
  api,
  children,
}: {
  status: StatusResponse;
  api: AssistantsApi;
  children: ReactNode;
}) {
  const apis = useApiHolder();
  const [connectedVersion, setConnectedVersion] = useState(0);
  const [oauthConnections, setOAuthConnections] = useState<
    Record<string, McpOAuthConnection>
  >({});
  // Servers that run their own OAuth report their connection from the
  // backend: checked once, and again after each Connect or Disconnect.
  const hasOAuth = status.assistants.some(a =>
    a.userCredentials?.some(isOAuthSpec),
  );
  useEffect(() => {
    if (!hasOAuth) return undefined;
    let active = true;
    api
      .getMcpOAuthStatus()
      .then(next => {
        if (active) setOAuthConnections(next);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api, hasOAuth, connectedVersion]);
  const value = useMemo<ToolGuardsValue>(() => {
    const specsFor = (assistantId: AssistantId) =>
      status.assistants.find(a => a.id === assistantId)?.userCredentials ?? [];
    const headerFor = async (assistantId: AssistantId) =>
      credentialsHeader(await getUserTokens(apis, specsFor(assistantId)));
    return {
      approveEachCall: new Set(status.approveEachCall ?? []),
      approvalPreviews: status.approvalPreviews ?? {},
      credentialSpecs: specsFor,
      credentialsHeader: headerFor,
      previewApproval: async (assistantId, tool, input) =>
        api.previewApproval(
          { assistantId, tool, input },
          await headerFor(assistantId),
        ),
      assistantForTool: toolName =>
        status.assistants.find(a => a.tools?.some(t => t.name === toolName))
          ?.id,
      connectedVersion,
      connect: async spec => {
        if (isOAuthSpec(spec)) {
          const outcome = await signInWithPopup(api, spec);
          if (outcome.ok === false) {
            apis.get(alertApiRef)?.post({
              message: `Couldn't connect ${spec.title}: ${
                outcome.error ?? 'the sign-in failed'
              }`,
              severity: 'error',
              display: 'transient',
            });
          }
        } else {
          await getUserToken(apis, spec, false);
        }
        setConnectedVersion(v => v + 1);
      },
      oauthConnections,
      respondElicitation: (id, answer) => api.respondElicitation(id, answer),
      disconnect: async spec => {
        await api.disconnectMcpOAuth(spec.server).catch(error =>
          apis.get(alertApiRef)?.post({
            message: `Couldn't disconnect ${spec.title}: ${
              error instanceof Error ? error.message : String(error)
            }`,
            severity: 'error',
            display: 'transient',
          }),
        );
        setConnectedVersion(v => v + 1);
      },
    };
  }, [status, api, apis, connectedVersion, oauthConnections]);
  return (
    <ToolGuardsContext.Provider value={value}>
      {children}
    </ToolGuardsContext.Provider>
  );
}

export function useToolGuards(): ToolGuardsValue {
  return useContext(ToolGuardsContext);
}

/**
 * The per-user servers of an assistant the user hasn't connected yet, checked
 * silently when the assistant changes and after each Connect.
 */
export function useUnconnectedServers(
  assistantId: AssistantId | undefined,
): UserCredentialSpec[] {
  const apis = useApiHolder();
  const { credentialSpecs, connectedVersion, oauthConnections } =
    useToolGuards();
  const [missingTokens, setMissingTokens] = useState<UserCredentialSpec[]>([]);
  const check = useCallback(async () => {
    const specs = (assistantId ? credentialSpecs(assistantId) : []).filter(
      spec => !isOAuthSpec(spec),
    );
    const tokens = await getUserTokens(apis, specs);
    return specs.filter(spec => !tokens[spec.server]);
  }, [apis, assistantId, credentialSpecs]);
  useEffect(() => {
    let active = true;
    check().then(next => {
      if (active) setMissingTokens(next);
    });
    return () => {
      active = false;
    };
  }, [check, connectedVersion]);
  // Servers that run their own OAuth follow the backend's status as it
  // arrives; one it hasn't reported yet isn't offered.
  return useMemo(() => {
    const specs = assistantId ? credentialSpecs(assistantId) : [];
    const missingOAuth = new Set(
      specs
        .filter(spec => {
          const connection = oauthConnections[spec.server];
          return isOAuthSpec(spec) && connection && connection !== 'connected';
        })
        .map(spec => spec.server),
    );
    const missingToken = new Set(missingTokens.map(spec => spec.server));
    return specs.filter(
      spec => missingOAuth.has(spec.server) || missingToken.has(spec.server),
    );
  }, [assistantId, credentialSpecs, oauthConnections, missingTokens]);
}

/**
 * The servers of an assistant that run their own OAuth and the user is
 * connected to: each gets a chip to disconnect from.
 */
export function useConnectedOAuthServers(
  assistantId: AssistantId | undefined,
): UserCredentialSpec[] {
  const { credentialSpecs, oauthConnections } = useToolGuards();
  return useMemo(
    () =>
      (assistantId ? credentialSpecs(assistantId) : []).filter(
        spec =>
          isOAuthSpec(spec) && oauthConnections[spec.server] === 'connected',
      ),
    [assistantId, credentialSpecs, oauthConnections],
  );
}
