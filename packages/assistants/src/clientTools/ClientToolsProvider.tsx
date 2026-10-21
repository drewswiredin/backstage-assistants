import { createContext, useContext, useMemo, type ReactNode } from 'react';
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
