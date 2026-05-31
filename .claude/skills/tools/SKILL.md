---
name: tools
description: Guide for tool registration and tool UI in assistant-ui. Use when implementing LLM tools, tool call rendering, or human-in-the-loop patterns.
---

# assistant-ui Tools

**Always consult [assistant-ui.com/llms.txt](https://assistant-ui.com/llms.txt) for latest API.**

Tools let LLMs trigger actions with custom UI rendering.

## References

- [./references/make-tool.md](./references/make-tool.md) -- makeAssistantTool/useAssistantTool
- [./references/tool-ui.md](./references/tool-ui.md) -- makeAssistantToolUI rendering
- [./references/human-in-loop.md](./references/human-in-loop.md) -- Confirmation patterns

## Tool Types

```
Where does the tool execute?
├─ Backend (LLM calls API) → AI SDK tool()
│  └─ Want custom UI? → makeAssistantToolUI
└─ Frontend (browser-only) → makeAssistantTool
   └─ Want custom UI? → makeAssistantToolUI
```

## Backend Tool with UI

```ts
// Backend (app/api/chat/route.ts)
import { tool, stepCountIs } from "ai";
import { z } from "zod";

const tools = {
  get_weather: tool({
    description: "Get weather for a city",
    inputSchema: z.object({ city: z.string() }),
    execute: async ({ city }) => ({ temp: 22, city }),
  }),
};

const result = streamText({
  model: openai("gpt-4o"),
  messages,
  tools,
  stopWhen: stepCountIs(5),
});
```

```tsx
// Frontend
import { makeAssistantToolUI } from "@assistant-ui/react";

const WeatherToolUI = makeAssistantToolUI({
  toolName: "get_weather",
  render: ({ args, result, status }) => {
    if (status.type === "running") return <div>Loading weather...</div>;
    return <div>{result?.city}: {result?.temp}°C</div>;
  },
});

// Register in app
<AssistantRuntimeProvider runtime={runtime}>
  <WeatherToolUI />
  <Thread />
</AssistantRuntimeProvider>
```

## Frontend-Only Tool

```tsx
import { makeAssistantTool } from "@assistant-ui/react";
import { z } from "zod";

const CopyTool = makeAssistantTool({
  toolName: "copy_to_clipboard",
  parameters: z.object({ text: z.string() }),
  execute: async ({ text }) => {
    await navigator.clipboard.writeText(text);
    return { success: true };
  },
});

<AssistantRuntimeProvider runtime={runtime}>
  <CopyTool />
  <Thread />
</AssistantRuntimeProvider>
```

## API Reference

```tsx
// makeAssistantToolUI render props (ToolCallMessagePartProps) — @assistant-ui/react 0.14.x
interface ToolUIProps<TArgs = any, TResult = unknown> {
  toolCallId: string;
  toolName: string;
  args: TArgs;
  argsText: string;
  result?: TResult;
  status: ToolCallMessagePartStatus;              // OBJECT — branch on status.type
  approval?: { approved?: boolean; reason?: string };
  addResult: (result: TResult | ToolResponse<TResult>) => void; // renderer-produced result
  resume: (payload: unknown) => void;             // frontend tool paused on context.human(...)
  respondToApproval: (r: { approved: boolean; reason?: string }) => void; // server approval gate
}
// status.type: "running" | "complete" | "incomplete" | "requires-action"
// NOTE: pre-0.11 `submitResult` and string `status` are removed.
```

## Human-in-the-Loop

Server-side approval gate (AI SDK v6 `needsApproval` → `respondToApproval`):

```tsx
const DeleteToolUI = makeAssistantToolUI({
  toolName: "delete_file",
  render: ({ args, approval, respondToApproval, result }) => {
    if (approval?.approved === undefined) {
      return (
        <div>
          <p>Delete {args.path}?</p>
          <button onClick={() => respondToApproval({ approved: true })}>Confirm</button>
          <button onClick={() => respondToApproval({ approved: false })}>Cancel</button>
        </div>
      );
    }
    if (approval.approved === false) return <div>Cancelled</div>;
    return <div>File deleted</div>;
  },
});
```

See [./references/human-in-loop.md](./references/human-in-loop.md) for the three
callbacks (`addResult` / `resume` / `respondToApproval`) and when to use each.

## Common Gotchas

**Tool UI not rendering**
- `toolName` must match exactly (case-sensitive)
- Register UI inside `AssistantRuntimeProvider`

**Tool not being called**
- Check tool description is clear
- Use `stopWhen: stepCountIs(n)` to allow multi-step

**Result not showing**
- Tool must return a value
- Check `status.type === "complete"` before accessing result
