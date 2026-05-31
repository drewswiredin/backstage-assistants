# Human-in-the-Loop Tools

Tools that require user confirmation or input.

Verified against `@assistant-ui/react@0.14.x` / `ai@^6`. There is **no
`submitResult`** prop — that was the pre-0.11 API. There are now three distinct
callbacks on the tool-UI render props; pick the one that matches the mechanism:

| Callback | When | Triggered by |
| --- | --- | --- |
| `addResult(result)` | The renderer itself produces the result (no `execute` ran). | Pure frontend tool UI. |
| `resume(payload)` | A **frontend** tool paused on `context.human(...)`. | `makeAssistantTool` execute calling `context.human`. |
| `respondToApproval({ approved, reason })` | A **backend** tool is gated by AI SDK v6 `needsApproval`. | `tool({ needsApproval })` on the server. |

Branch on `status.type` (an object), never `status === "..."`.

## Server-Side Approval Gate (AI SDK v6)

The idiomatic v6 confirmation flow. The backend marks the tool with
`needsApproval`; the server pauses, emits an `approval-requested` part, and the
client acknowledges via `respondToApproval`.

```ts
// Backend route
import { streamText, convertToModelMessages, tool } from "ai";
import { z } from "zod";

const tools = {
  delete_file: tool({
    description: "Delete a file",
    inputSchema: z.object({ path: z.string() }),
    needsApproval: true, // or ({ input }) => input.path.startsWith("/prod"),
    execute: async ({ path }) => ({ deleted: path }),
  }),
};
```

```tsx
// Client: opt into resubmitting once the user decides
import { lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";

const runtime = useChatRuntime({
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
});
```

```tsx
// Tool UI: gate on `approval`, respond with `respondToApproval`
const DeleteToolUI = makeAssistantToolUI<{ path: string }, { deleted: string }>({
  toolName: "delete_file",
  render: ({ args, approval, respondToApproval, result }) => {
    if (approval?.approved === undefined) {
      return (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="mb-4">Delete <code>{args.path}</code>?</p>
          <div className="flex gap-2">
            <button onClick={() => respondToApproval({ approved: true })}>
              Delete
            </button>
            <button
              onClick={() =>
                respondToApproval({ approved: false, reason: "user denied" })
              }
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }
    if (approval.approved === false) return <div>Deletion cancelled</div>;
    if (result === undefined) return <div>Approved, deleting…</div>;
    return <div>File deleted: {result.deleted}</div>;
  },
});
```

## Frontend Tool Waiting on Human Input (`resume`)

When a **frontend** tool (`makeAssistantTool`) calls `context.human(...)` inside
its `execute`, the part enters `status.type === "requires-action"`. Supply the
requested payload with `resume`:

```tsx
const ConfirmToolUI = makeAssistantToolUI({
  toolName: "confirm_action",
  render: ({ args, status, resume }) => {
    if (status.type !== "requires-action") return <div>Done</div>;
    return (
      <div className="p-4 bg-blue-50 rounded-lg">
        <p className="mb-3">{args.prompt}</p>
        <button onClick={() => resume({ confirmed: true })}>Confirm</button>
        <button onClick={() => resume({ confirmed: false })}>Cancel</button>
      </div>
    );
  },
});
```

## Selection Pattern

Let user choose from options:

```tsx
const SelectToolUI = makeAssistantToolUI({
  toolName: "select_option",
  render: ({ args, result, status, addResult }) => {
    if (status.type !== "complete") {
      return (
        <div className="p-4 bg-blue-50 rounded-lg">
          <p className="mb-3">{args.prompt}</p>
          <div className="flex flex-wrap gap-2">
            {args.options.map((option: any) => (
              <button
                key={option.id}
                onClick={() => addResult({ selected: option.id })}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="p-4 bg-gray-50 rounded-lg">
        Selected: {args.options.find((o: any) => o.id === result?.selected)?.label}
      </div>
    );
  },
});
```

## Form Input Pattern

Collect structured data from user:

```tsx
const FormToolUI = makeAssistantToolUI({
  toolName: "collect_info",
  render: ({ args, status, addResult }) => {
    const [formData, setFormData] = useState({});

    if (status.type !== "complete") {
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addResult(formData);
          }}
          className="p-4 bg-gray-50 rounded-lg space-y-4"
        >
          <h3 className="font-medium">{args.title}</h3>

          {args.fields.map((field: any) => (
            <div key={field.name}>
              <label className="block text-sm font-medium mb-1">
                {field.label}
              </label>
              <input
                type={field.type || "text"}
                required={field.required}
                onChange={(e) =>
                  setFormData((d) => ({ ...d, [field.name]: e.target.value }))
                }
                className="w-full border rounded px-3 py-2"
              />
            </div>
          ))}

          <button
            type="submit"
            className="px-4 py-2 bg-blue-500 text-white rounded"
          >
            Submit
          </button>
        </form>
      );
    }

    return <div>Information collected</div>;
  },
});
```

## Multi-Step Workflow

Chain multiple interactions:

```tsx
const WizardToolUI = makeAssistantToolUI({
  toolName: "setup_wizard",
  render: ({ args, result, status, addResult }) => {
    const [step, setStep] = useState(0);
    const [data, setData] = useState({});

    const steps = args.steps || [];
    const currentStep = steps[step];

    if (status.type === "complete") {
      return <div>Setup complete!</div>;
    }

    return (
      <div className="p-4 bg-gray-50 rounded-lg">
        <div className="mb-4">
          <div className="text-sm text-gray-500">
            Step {step + 1} of {steps.length}
          </div>
          <h3 className="font-medium">{currentStep.title}</h3>
        </div>

        <div className="mb-4">
          {currentStep.type === "select" && (
            <div className="space-y-2">
              {currentStep.options.map((opt: any) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    const newData = { ...data, [currentStep.name]: opt.value };
                    setData(newData);

                    if (step < steps.length - 1) {
                      setStep(step + 1);
                    } else {
                      addResult(newData);
                    }
                  }}
                  className="w-full p-3 text-left border rounded hover:bg-gray-100"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {step > 0 && (
          <button
            onClick={() => setStep(step - 1)}
            className="text-blue-500"
          >
            ← Back
          </button>
        )}
      </div>
    );
  },
});
```

## Rating/Feedback Pattern

```tsx
const RatingToolUI = makeAssistantToolUI({
  toolName: "request_rating",
  render: ({ args, status, addResult }) => {
    const [rating, setRating] = useState(0);
    const [comment, setComment] = useState("");

    if (status.type === "complete") {
      return <div>Thank you for your feedback!</div>;
    }

    return (
      <div className="p-4 bg-gray-50 rounded-lg">
        <p className="mb-3">{args.prompt}</p>

        <div className="flex gap-1 mb-3">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onClick={() => setRating(star)}
              className={`text-2xl ${
                star <= rating ? "text-yellow-400" : "text-gray-300"
              }`}
            >
              ★
            </button>
          ))}
        </div>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Additional comments (optional)"
          className="w-full border rounded p-2 mb-3"
        />

        <button
          onClick={() => addResult({ rating, comment })}
          disabled={rating === 0}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
        >
          Submit
        </button>
      </div>
    );
  },
});
```

## Timeout/Auto-Cancel

```tsx
const TimedToolUI = makeAssistantToolUI({
  toolName: "timed_action",
  render: ({ args, status, resume }) => {
    const [timeLeft, setTimeLeft] = useState(args.timeout || 30);

    useEffect(() => {
      if (status.type !== "requires-action") return;

      const timer = setInterval(() => {
        setTimeLeft((t) => {
          if (t <= 1) {
            resume({ timeout: true });
            return 0;
          }
          return t - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }, [status.type, resume]);

    if (status.type !== "requires-action") {
      return <div>Action completed</div>;
    }

    return (
      <div className="p-4 bg-yellow-50 rounded-lg">
        <p>{args.message}</p>
        <p className="text-sm text-gray-500">
          Auto-cancelling in {timeLeft}s
        </p>
        <button
          onClick={() => resume({ confirmed: true })}
          className="mt-2 px-4 py-2 bg-blue-500 text-white rounded"
        >
          Confirm
        </button>
      </div>
    );
  },
});
```
