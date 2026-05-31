# MessagePrimitive

Individual message display.

## Parts

| Part | Description |
|------|-------------|
| `.Root` | Message container |
| `.Parts` | Message body with parts (canonical) |
| `.Content` | Message body with parts |
| `.If` | Conditional rendering (deprecated; prefer `AuiIf`) |
| `.Error` | Render fallback when message has an error |
| `.PartByIndex` | Render a single part by index |
| `.Attachments` | Render message attachments |
| `.AttachmentByIndex` | Render one attachment by index |

## Basic Structure

```tsx
<MessagePrimitive.Root>
  <Avatar src="/user-avatar.png" />
  <MessagePrimitive.Content />
</MessagePrimitive.Root>
```

## MessagePrimitive.Root

Container for a single message.

```tsx
<MessagePrimitive.Root
  className="flex gap-2 mb-4"
  data-role="user"  // or "assistant"
>
  {children}
</MessagePrimitive.Root>
```

## MessagePrimitive.Parts (canonical) / .Content

Renders message content parts. `.Parts` is canonical; `.Content` is an alias.
Pass EITHER a `components` prop OR a `children` render function (mutually
exclusive). Each component receives the **enriched part directly as props**
(e.g. `({ text })`), not `({ part })`.

```tsx
// Simple usage - uses default rendering
<MessagePrimitive.Parts />

// Custom part rendering (components prop)
<MessagePrimitive.Parts
  components={{
    Text: ({ text }) => <p className="whitespace-pre-wrap">{text}</p>,
    Image: ({ image }) => <img src={image} alt="" className="max-w-full rounded" />,
    Reasoning: ({ text }) => (
      <details className="text-gray-500">
        <summary>Thinking...</summary>
        <p>{text}</p>
      </details>
    ),
    Source: ({ url, title }) => <a href={url}>{title}</a>,
    File: ({ mimeType, data, filename }) => (
      <a href={`data:${mimeType};base64,${data}`} download={filename ?? "file"}>
        📄 {filename ?? "file"}
      </a>
    ),
    Empty: ({ status }) => null,         // shown when message has zero parts
    // Tools are NOT a "ToolCall" slot — they go under `tools`:
    tools: { Fallback: ToolFallback },   // or { by_name: { get_weather: WeatherToolUI } }
    //       or { Override: MyToolRenderer }
  }}
/>
```

### Part component slots

| Slot | Description | Props |
|------|-------------|-------|
| `Text` | Plain text | `text` |
| `Image` | Image | `image` (URL) |
| `Reasoning` | Chain-of-thought (default `() => null`; register to show thinking) | `text` |
| `Source` | Citation/reference | `url`, `title` |
| `File` | File attachment | `filename?`, `data`, `mimeType` |
| `Empty` | Rendered when the message has **zero** parts | `status` (MessageStatus) — NOT an error channel |
| `tools` | Tool-call rendering config | `{ by_name?, Fallback? }` or `{ Override }` |
| `data` | Data-part rendering config | `{ by_name?, Fallback? }` |

Tool-call render props (`ToolCallMessagePartProps`): `toolName`, `args`,
`argsText`, `result?`, `status` (object — branch on `status.type`), `approval?`,
`addResult`, `resume`, `respondToApproval`. There is no `submitResult`, and `isError`
is not a prop — failure is on `status` (`{ type: "incomplete"; reason; error }`).

## Errors: MessagePrimitive.Error / ErrorPrimitive

Render an error block below a message when the message failed
(`status.type === "incomplete" && status.reason === "error"`):

```tsx
import { ErrorPrimitive, MessagePrimitive } from "@assistant-ui/react";

<MessagePrimitive.Root>
  <MessagePrimitive.Parts />
  <ErrorPrimitive.Root className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
    <ErrorPrimitive.Message />   {/* auto-extracts error text; renders null when no error */}
  </ErrorPrimitive.Root>
</MessagePrimitive.Root>
```

- `ErrorPrimitive.Root` always renders its `role="alert"` container; `.Message`
  auto-reads the error text and returns `null` when there is no error.
- `MessagePrimitive.Error` is the simpler variant: renders children only when the
  message has an error, but no `role="alert"` and no auto text extraction.
- The **`Empty` content-part is NOT an error channel.** It renders only when a
  message has zero parts; its `status` prop is the message status, defaulting to
  `{ type: "complete" }`. Surface real failures via `useChatRuntime({ onError })`
  plus `ErrorPrimitive`/`MessagePrimitive.Error`, and the generating indicator via
  thread running-state (`useAuiState((s) => s.thread.isRunning)`).

## MessagePrimitive.If / AuiIf

`MessagePrimitive.If` still exists but is deprecated. Prefer `AuiIf` for the most flexible state checks.

```tsx
<MessagePrimitive.If user>User message content</MessagePrimitive.If>
<MessagePrimitive.If assistant>Assistant message content</MessagePrimitive.If>
<MessagePrimitive.If system>System message content</MessagePrimitive.If>
<MessagePrimitive.If hasBranches>
  <BranchPickerPrimitive.Root>...</BranchPickerPrimitive.Root>
</MessagePrimitive.If>

<MessagePrimitive.If copied>Copied</MessagePrimitive.If>
<MessagePrimitive.If speaking>Playing speech</MessagePrimitive.If>
<MessagePrimitive.If submittedFeedback="positive">Positive feedback</MessagePrimitive.If>
```

When you need custom conditions (for example branch metadata), use `AuiIf`:

```tsx
<AuiIf condition={({ message }) => message.branchCount > 1}>
  <BranchPickerPrimitive.Root>...</BranchPickerPrimitive.Root>
</AuiIf>

<AuiIf condition={({ message }) => message.isCopied}>
  <CheckIcon />
</AuiIf>
```

## Complete Example

```tsx
function CustomUserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end mb-4">
      <Avatar
        fallback="U"
        className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center ml-2"
      />
      <div className="max-w-[80%]">
        <div className="bg-blue-500 text-white rounded-2xl rounded-tr-sm px-4 py-2">
          <MessagePrimitive.Content />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function CustomAssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex mb-4">
      <Avatar
        src="/ai-avatar.png"
        fallback="AI"
        className="w-8 h-8 rounded-full mr-2 shrink-0"
      />

      <div className="max-w-[80%]">
        <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-2">
          <MessagePrimitive.Content />
        </div>
      </div>

      <ActionBarPrimitive.Root className="flex gap-2 mt-1 opacity-0 hover:opacity-100 transition-opacity">
        <ActionBarPrimitive.Copy className="text-xs text-gray-500 hover:text-gray-700">
          Copy
        </ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Reload className="text-xs text-gray-500 hover:text-gray-700">
          Regenerate
        </ActionBarPrimitive.Reload>
        <ActionBarPrimitive.Speak className="text-xs text-gray-500 hover:text-gray-700">
          🔊
        </ActionBarPrimitive.Speak>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}
```

## Error and branching support

Use `MessagePrimitive.Error` to render a fallback UI only when the message has an error:

```tsx
<MessagePrimitive.Error>
  <ErrorPrimitive.Root>
    <ErrorPrimitive.Message />
  </ErrorPrimitive.Root>
</MessagePrimitive.Error>
```

## Accessing Message State

```tsx
import { useMessage, useMessageRuntime } from "@assistant-ui/react";

function MessageInfo() {
  // Reactive state
  const { role, content, status, createdAt } = useMessage();

  // Runtime API
  const runtime = useMessageRuntime();
  const handleEdit = () => runtime.edit({
    role: "user",
    content: [{ type: "text", text: "New content" }],
  });

  return (
    <div>
      <p>Role: {role}</p>
      <p>Status: {status}</p>
    </div>
  );
}
```
