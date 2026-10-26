import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useApiHolder } from '@backstage/core-plugin-api';
import type { HeldClientToolRunner } from '../collapsible/heldCalls';
import { runClientTool } from './runClientTool';
import type { AssistantClientTool } from './types';

/**
 * The client tools contributed to the page and the global approval floor,
 * shared by the registrations, the tool cards, the editor, and the detail
 * dialog.
 */
export interface ClientToolsValue {
  tools: ReadonlyArray<AssistantClientTool<any, any>>;
  /** Tool names in `assistants.requireApproval` (from `/status`). */
  requireApproval: ReadonlySet<string>;
}

const EMPTY: ClientToolsValue = { tools: [], requireApproval: new Set() };

const ClientToolsContext = createContext<ClientToolsValue>(EMPTY);

export function ClientToolsProvider({
  tools,
  requireApproval,
  children,
}: {
  tools: ReadonlyArray<AssistantClientTool<any, any>>;
  requireApproval: ReadonlyArray<string>;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ tools, requireApproval: new Set(requireApproval) }),
    [tools, requireApproval],
  );
  return (
    <ClientToolsContext.Provider value={value}>
      {children}
    </ClientToolsContext.Provider>
  );
}

export function useClientTools(): ClientToolsValue {
  return useContext(ClientToolsContext);
}

/**
 * A stable runner for client tool calls a provider holds inside its own tool
 * loop (see collapsible/heldCalls.ts), reading the latest tools. It runs a
 * tool that needs nothing from the user; a call that would ask (approval, or
 * Connect) is declined, since the held call has no card to ask on.
 */
export function useHeldClientToolRunner(): HeldClientToolRunner {
  const apis = useApiHolder();
  const value = useClientTools();
  const latest = useRef({ apis, value });
  latest.current = { apis, value };
  return useCallback<HeldClientToolRunner>(name => {
    const { apis: holder, value: current } = latest.current;
    const tool = current.tools.find(t => t.name === name);
    if (!tool?.execute) return undefined;
    return (input, signal) =>
      runClientTool(tool, input, {
        apis: holder,
        human: async () => undefined,
        signal,
        requireApproval: current.requireApproval,
      });
  }, []);
}
