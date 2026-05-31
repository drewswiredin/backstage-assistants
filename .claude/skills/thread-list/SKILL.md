---
name: thread-list
description: Guide for multi-thread management in assistant-ui. Use when implementing thread lists, switching threads, or managing conversation history.
---

# assistant-ui Thread List

**Always consult [assistant-ui.com/llms.txt](https://assistant-ui.com/llms.txt) for latest API.**

Manage multiple chat threads with built-in or custom UI.

## References

- [./references/management.md](./references/management.md) -- Thread CRUD operations
- [./references/custom-ui.md](./references/custom-ui.md) -- Custom thread list UI
- [./references/custom-persistence.md](./references/custom-persistence.md) -- RemoteThreadListAdapter + ThreadHistoryAdapter (custom DB / localStorage)

## Export names (0.14.x)

In `@assistant-ui/react@0.14.x` the runtime hook and in-memory adapter are
exported **without** the `unstable_` prefix: `useRemoteThreadListRuntime` and
`InMemoryThreadListAdapter`. The `unstable_`-prefixed aliases existed in 0.12/0.13
and are gone in 0.14 — importing `unstable_useRemoteThreadListRuntime` from
`@assistant-ui/react@0.14` fails. (Docs still reference the old name in places.)

## Quick Start

Thread list is available with `useChatRuntime` + cloud:

```tsx
import { AssistantCloud } from "assistant-cloud";
import { useChatRuntime, AssistantChatTransport } from "@assistant-ui/react-ai-sdk";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { ThreadList } from "@/components/assistant-ui/thread-list";
import { Thread } from "@/components/assistant-ui/thread";

const cloud = new AssistantCloud({
  baseUrl: process.env.NEXT_PUBLIC_ASSISTANT_BASE_URL,
  authToken: async () => getAuthToken(),
});

function Chat() {
  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({ api: "/api/chat" }),
    cloud,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-screen">
        <ThreadList className="w-64 border-r" />
        <Thread className="flex-1" />
      </div>
    </AssistantRuntimeProvider>
  );
}
```

## Thread Operations

```tsx
import { useAui, useAuiState } from "@assistant-ui/react";

const api = useAui();
const { threadIds, mainThreadId } = useAuiState((s) => ({
  threadIds: s.threads.threadIds,
  mainThreadId: s.threads.mainThreadId,
}));

// Switch to thread
api.threads().switchToThread(threadId);

// Create new thread
api.threads().switchToNewThread();

// Thread item operations
const item = api.threads().item({ id: threadId });
await item.rename("New Title");
await item.archive();
await item.delete();
```

## Custom Thread List

```tsx
import { ThreadListPrimitive, ThreadListItemPrimitive } from "@assistant-ui/react";

function CustomThreadList() {
  return (
    <ThreadListPrimitive.Root className="w-64">
      <ThreadListPrimitive.New className="w-full p-2 bg-blue-500 text-white">
        + New Chat
      </ThreadListPrimitive.New>

      <ThreadListPrimitive.Items>
        <ThreadListItemPrimitive.Root className="flex p-2 hover:bg-gray-100">
          <ThreadListItemPrimitive.Trigger className="flex-1">
            <ThreadListItemPrimitive.Title />
          </ThreadListItemPrimitive.Trigger>
          <ThreadListItemPrimitive.Archive>Archive</ThreadListItemPrimitive.Archive>
          <ThreadListItemPrimitive.Delete>Delete</ThreadListItemPrimitive.Delete>
        </ThreadListItemPrimitive.Root>
      </ThreadListPrimitive.Items>
    </ThreadListPrimitive.Root>
  );
}
```

## Without Cloud — in-memory (no persistence)

```tsx
import {
  useRemoteThreadListRuntime,
  InMemoryThreadListAdapter,
  useLocalRuntime,
} from "@assistant-ui/react";

const runtime = useRemoteThreadListRuntime({
  adapter: new InMemoryThreadListAdapter(),
  runtimeHook: () => useLocalRuntime({ model: myModel }),
});
```

## Without Cloud — custom persistence (localStorage / your DB)

For a real thread list backed by your own storage, supply a custom
`RemoteThreadListAdapter` (list/initialize/rename/archive/delete/generateTitle)
and inject a per-thread `ThreadHistoryAdapter` through its `unstable_Provider`.
With `useChatRuntime`, the history adapter **must** implement `withFormat`.
Full worked example in [./references/custom-persistence.md](./references/custom-persistence.md).

```tsx
import {
  useRemoteThreadListRuntime,
  type RemoteThreadListAdapter,
} from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";

const runtime = useRemoteThreadListRuntime({
  adapter: threadListAdapter,                 // RemoteThreadListAdapter
  runtimeHook: () =>
    useChatRuntime({
      transport,
      adapters: { history },                  // ThreadHistoryAdapter (withFormat required)
      onError,
    }),
});
```

## Common Gotchas

**ThreadList not showing**
- Pass `cloud` to the runtime, OR mount a `useRemoteThreadListRuntime` with a
  `RemoteThreadListAdapter` — a bare `useChatRuntime` has a single thread only.

**Threads not persisting**
- Cloud: verify connection / auth tokens.
- Custom: confirm the `RemoteThreadListAdapter` writes metadata AND the
  per-thread `ThreadHistoryAdapter` (with `withFormat`) writes messages.

**`history` adapter throws at runtime under `useChatRuntime`**
- The AI SDK path only uses `withFormat(fmt)`. An adapter that implements only
  top-level `load`/`append` (no `withFormat`) throws. Implement `withFormat`.
