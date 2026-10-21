import { useEffect, useMemo, useState } from 'react';
import { useApiHolder } from '@backstage/core-plugin-api';
import {
  useAssistantTool,
  type AssistantToolProps,
  type Tool,
} from '@assistant-ui/react';
import { ClientToolCall } from './ClientToolCall';
import { runClientTool } from './runClientTool';
import { useClientTools } from './ClientToolsProvider';
import type { AssistantClientTool } from './types';

/**
 * Registers every contributed client tool with assistant-ui, inside the
 * runtime provider. assistant-ui then sends each tool's schema with every
 * `/chat` request, runs its `execute` in the browser when the model calls it,
 * and renders its card in the conversation.
 */
export function ClientToolRegistrations() {
  const { tools } = useClientTools();
  return (
    <>
      {tools.map(tool => (
        <ClientToolRegistration key={tool.name} tool={tool} />
      ))}
    </>
  );
}

function ClientToolRegistration({
  tool,
}: {
  tool: AssistantClientTool<any, any>;
}) {
  const apis = useApiHolder();
  const { requireApproval } = useClientTools();
  // Availability is resolved once per page load; an unavailable tool stays
  // registered but disabled, so it is neither sent to the model nor run.
  const [available, setAvailable] = useState<boolean>(!tool.isAvailable);
  useEffect(() => {
    if (!tool.isAvailable) return undefined;
    let active = true;
    Promise.resolve()
      .then(() => tool.isAvailable!({ apis }))
      .then(
        ok => active && setAvailable(ok),
        () => active && setAvailable(false),
      );
    return () => {
      active = false;
    };
  }, [tool, apis]);

  const definition = useMemo<AssistantToolProps<any, any>>(() => {
    const render = (props: any) => <ClientToolCall tool={tool} {...props} />;
    const base = {
      toolName: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as NonNullable<Tool['parameters']>,
      disabled: !available,
      render,
    };
    // A tool without `execute` is answered by its card through `addResult`.
    if (!tool.execute) {
      return { ...base, type: 'human' };
    }
    return {
      ...base,
      type: 'frontend',
      execute: (args: unknown, context) =>
        runClientTool(tool, args, {
          apis,
          human: context.human,
          signal: context.abortSignal,
          requireApproval,
        }),
    };
  }, [tool, available, apis, requireApproval]);

  useAssistantTool(definition);
  return null;
}
