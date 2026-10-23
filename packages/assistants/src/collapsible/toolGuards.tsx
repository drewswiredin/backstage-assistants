import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useApiHolder } from '@backstage/core-plugin-api';
import type {
  ApprovalPreview,
  ApprovalPreviewResponse,
  AssistantId,
  StatusResponse,
  UserCredentialSpec,
} from '@drewswiredin/backstage-plugin-assistants-common';
import type { AssistantsApi } from '../api/AssistantsApi';
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
        await getUserToken(apis, spec, false);
        setConnectedVersion(v => v + 1);
      },
    };
  }, [status, api, apis, connectedVersion]);
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
  const { credentialSpecs, connectedVersion } = useToolGuards();
  const [missing, setMissing] = useState<UserCredentialSpec[]>([]);
  const check = useCallback(async () => {
    const specs = assistantId ? credentialSpecs(assistantId) : [];
    const tokens = await getUserTokens(apis, specs);
    return specs.filter(spec => !tokens[spec.server]);
  }, [apis, assistantId, credentialSpecs]);
  useEffect(() => {
    let active = true;
    check().then(next => {
      if (active) setMissing(next);
    });
    return () => {
      active = false;
    };
  }, [check, connectedVersion]);
  return missing;
}
