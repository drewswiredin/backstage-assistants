# makeAssistantToolUI

Render custom UI for tool calls.

## makeAssistantToolUI

Returns a React component that registers the tool UI renderer.

```tsx
import { makeAssistantToolUI } from "@assistant-ui/react";

const WeatherToolUI = makeAssistantToolUI({
  toolName: "get_weather",
  render: ({ args, result, status }) => {
    if (status.type === "running") {
      return <div className="animate-pulse">Loading weather...</div>;
    }

    if (result) {
      return (
        <div className="p-4 bg-blue-50 rounded-lg">
          <h3 className="font-bold">{result.city}</h3>
          <p className="text-2xl">{result.temperature}°</p>
        </div>
      );
    }

    return null;
  },
});

// Register in app
<AssistantRuntimeProvider runtime={runtime}>
  <WeatherToolUI />
  <Thread />
</AssistantRuntimeProvider>
```

## Render Props

`status` is an **object** (`ToolCallMessagePartStatus`), not a string. Branch on
`status.type`. Verified against `@assistant-ui/react@0.14.x`
(`ToolCallMessagePartProps` in `@assistant-ui/core`):

```tsx
interface ToolCallMessagePartProps<TArgs = any, TResult = unknown> {
  // Tool call identification
  toolCallId: string;
  toolName: string;

  // Arguments
  args: TArgs;
  argsText: string;        // Raw JSON string

  // Result (undefined while running)
  result?: TResult;

  // Status — an object, not a string
  status: ToolCallMessagePartStatus;

  // Server-side approval gate (AI SDK v6 needsApproval). Set only when gated.
  approval?: { approved?: boolean; reason?: string };

  // Supply a result from the renderer itself (not from a tool `execute`).
  addResult: (result: TResult | ToolResponse<TResult>) => void;

  // Resume a paused FRONTEND tool waiting on context.human(...)
  resume: (payload: unknown) => void;

  // Respond to a server-side approval gate (only while approval.approved === undefined)
  respondToApproval: (response: { approved: boolean; reason?: string }) => void;
}

// status.type:
//   "running"         — tool executing
//   "complete"        — finished successfully
//   "incomplete"      — stopped early; status.reason ("cancelled" | "error" | ...)
//   "requires-action" — waiting on a frontend interaction (resume) / approval
```

> Migration note: pre-0.11 renderers received a string `status` and a
> `submitResult` callback. Both are removed. Use `status.type` and the
> appropriate callback: `addResult` (renderer-produced result), `resume`
> (frontend human-in-the-loop), or `respondToApproval` (server approval gate).

## useAssistantToolUI

Hook variant for dynamic registration:

```tsx
import { useAssistantToolUI } from "@assistant-ui/react";

function DynamicToolUI({ toolConfig }) {
  useAssistantToolUI({
    toolName: toolConfig.name,
    render: ({ args, result, status }) => (
      <toolConfig.Component args={args} result={result} status={status} />
    ),
  });

  return <Thread />;
}
```

## Status Handling

```tsx
const ComprehensiveToolUI = makeAssistantToolUI({
  toolName: "process_data",
  render: ({ args, result, status }) => {
    switch (status.type) {
      case "running":
        return (
          <div className="flex items-center gap-2">
            <Spinner />
            <span>Processing {args.filename}...</span>
          </div>
        );

      case "complete":
        return (
          <div className="p-4 bg-green-50 rounded">
            <CheckIcon className="text-green-500" />
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </div>
        );

      case "incomplete":
        return (
          <div className="p-4 bg-yellow-50 rounded">
            <WarningIcon className="text-yellow-500" />
            <span>Processing was cancelled</span>
          </div>
        );

      case "requires-action":
        return (
          <div className="p-4 bg-blue-50 rounded">
            <span>Waiting for user input...</span>
          </div>
        );

      default:
        return null;
    }
  },
});
```

## Styled Components

```tsx
const SearchToolUI = makeAssistantToolUI({
  toolName: "search",
  render: ({ args, result, status }) => (
    <div className="my-4 border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2 bg-gray-100 border-b flex items-center gap-2">
        <SearchIcon className="w-4 h-4" />
        <span className="font-medium">Search: {args.query}</span>
      </div>

      {/* Body */}
      <div className="p-4">
        {status.type === "running" && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-gray-100 animate-pulse rounded" />
            ))}
          </div>
        )}

        {status.type === "complete" && result?.results && (
          <div className="space-y-3">
            {result.results.map((item: any) => (
              <a
                key={item.url}
                href={item.url}
                className="block p-3 hover:bg-gray-50 rounded"
                target="_blank"
                rel="noopener noreferrer"
              >
                <div className="font-medium text-blue-600">{item.title}</div>
                <div className="text-sm text-gray-500 truncate">{item.url}</div>
                <div className="text-sm text-gray-700 mt-1">{item.snippet}</div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  ),
});
```

## Generative UI

Dynamic component rendering:

```tsx
import { Chart, Table, Form, Card } from "./components";

const componentMap: Record<string, React.ComponentType<any>> = {
  chart: Chart,
  table: Table,
  form: Form,
  card: Card,
};

const GenerativeUI = makeAssistantToolUI({
  toolName: "render_ui",
  render: ({ args, result }) => {
    const Component = componentMap[args.type];

    if (!Component) {
      return <div>Unknown component: {args.type}</div>;
    }

    return (
      <div className="my-4">
        <Component {...args.props} data={result} />
      </div>
    );
  },
});
```

## With External State

```tsx
function ToolUIWithState() {
  const [favorites, setFavorites] = useState<string[]>([]);

  useAssistantToolUI({
    toolName: "show_products",
    render: ({ result }) => (
      <div className="grid grid-cols-3 gap-4">
        {result?.products?.map((product: any) => (
          <div key={product.id} className="border rounded p-4">
            <img src={product.image} alt={product.name} />
            <h3>{product.name}</h3>
            <button
              onClick={() => setFavorites((f) => [...f, product.id])}
              className={favorites.includes(product.id) ? "text-red-500" : ""}
            >
              ♥
            </button>
          </div>
        ))}
      </div>
    ),
  });

  return <Thread />;
}
```

## Accessing Tool-Part State

There is no `useToolCallContext` export. Read the active message part with
`useAuiState` from inside a component rendered within the tool-call part scope:

```tsx
import { useAuiState } from "@assistant-ui/react";

function ToolCallMetadata() {
  const part = useAuiState((s) => s.part); // the tool-call part
  if (part.type !== "tool-call") return null;

  return (
    <div className="text-xs text-gray-500">
      {part.toolName} ({part.toolCallId.slice(0, 8)}) - {part.status.type}
    </div>
  );
}
```

## Multiple Tools

```tsx
function App() {
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <WeatherToolUI />
      <SearchToolUI />
      <ChartToolUI />
      <TableToolUI />
      <Thread />
    </AssistantRuntimeProvider>
  );
}
```
