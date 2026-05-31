# Custom Persistence: RemoteThreadListAdapter + ThreadHistoryAdapter

Back the multi-thread runtime with your own storage (custom DB, or localStorage
for this project) instead of AssistantCloud. Verified against
`@assistant-ui/react@0.14.x` + `@assistant-ui/react-ai-sdk@1.3.30` +
`@ai-sdk/react@^3` + `ai@^6`.

## CRITICAL: do NOT use `useChatRuntime` as the inner `runtimeHook`

`useChatRuntime` from `@assistant-ui/react-ai-sdk@1.3.x` is **itself a cloud
thread-list runtime**. In the real 1.3.30 source it is literally:

```ts
const useChatRuntime = ({ cloud, ...options } = {}) =>
  useRemoteThreadListRuntime({
    runtimeHook: function RuntimeHook() { return useChatThreadRuntime(options); },
    adapter: useCloudThreadListAdapter({ cloud }),   // <-- CLOUD adapter
    allowNesting: true,
  });
```

Putting `useChatRuntime` inside your own `useRemoteThreadListRuntime` nests two
thread-list runtimes (and pulls in `useCloudThreadListAdapter`) — wrong for a
custom/localStorage thread list. Instead use the **single-thread** inner runtime
that `useChatRuntime` itself runs per thread:

```tsx
import { useChat } from "@ai-sdk/react";                  // AI SDK v6 chat helpers
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import { useRemoteThreadListRuntime, useAuiState } from "@assistant-ui/react";

const runtime = useRemoteThreadListRuntime({
  adapter: threadListAdapter,                  // your RemoteThreadListAdapter
  runtimeHook: function RuntimeHook() {
    const id = useAuiState((s) => s.threadListItem.id);  // scope chat per thread
    const chat = useChat({ id, transport, onError });
    return useAISDKRuntime(chat);              // single-thread AI SDK runtime
  },
});
```

`useAISDKRuntime(chatHelpers)` is the single-thread runtime. It reads the
injected per-thread `history` adapter from context via `useRuntimeAdapters()`
(`adapters?.history ?? contextAdapters?.history`), so the thread-list adapter's
`unstable_Provider` still supplies persistence — you do NOT pass `history` to
`useAISDKRuntime` when it is injected by the provider.

Two adapters, two responsibilities:

- **`RemoteThreadListAdapter`** — thread *metadata*: `list`, `initialize`,
  `rename`, `archive`, `unarchive`, `delete`, `fetch`, `generateTitle`.
- **`ThreadHistoryAdapter`** — *messages* per thread. Injected per-thread via the
  thread-list adapter's `unstable_Provider`.

## CRITICAL: history adapter must implement `withFormat`

Under the AI SDK runtime (`useAISDKRuntime`, which `useChatRuntime` also runs per
thread), the top-level `load`/`append` on a `ThreadHistoryAdapter` are
**required by the type but never called** — the AI SDK history path
(`useExternalHistory` + the v6 format adapter) always goes through
`withFormat(fmt)`. An adapter without `withFormat` throws at runtime. `fmt`
round-trips messages as AI SDK `UIMessage` rows:
`fmt.format` (e.g. `"ai-sdk/v6"`), `fmt.getId(message)`, `fmt.encode(item)`,
`fmt.decode(row)`.

```tsx
import type { ThreadHistoryAdapter } from "@assistant-ui/react";

const history: ThreadHistoryAdapter = {
  // Required by the type — unused by the AI SDK runtime (it calls withFormat).
  async load() { return { messages: [] }; },
  async append() {},

  withFormat: (fmt) => ({
    async load() {
      const rows = readRowsForThisThread();          // [{ id, parent_id, format, content }]
      return { messages: rows.map(fmt.decode) };
    },
    async append(item) {
      writeRow({
        id: fmt.getId(item.message),
        parent_id: item.parentId,
        format: fmt.format,
        content: fmt.encode(item),
      });
    },
  }),
};
```

A stored row is `{ id, parent_id, format, content }`; `content` is whatever
`fmt.encode` produced (do not hand-craft it — seed via the adapter).

## RemoteThreadListAdapter with injected history (`unstable_Provider`)

```tsx
import {
  RuntimeAdapterProvider,
  useAui,
  type RemoteThreadListAdapter,
  type ThreadHistoryAdapter,
} from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";
import { useMemo } from "react";

export const threadListAdapter: RemoteThreadListAdapter = {
  async list() {
    const rows = listThreadMeta();
    return {
      threads: rows.map((t) => ({
        status: t.status,            // "regular" | "archived"
        remoteId: t.id,
        title: t.title ?? undefined,
      })),
    };
  },
  async initialize() {
    const id = createThreadMeta();   // returns new id
    return { remoteId: id };
  },
  async rename(remoteId, title)   { patchThreadMeta(remoteId, { title }); },
  async archive(remoteId)         { patchThreadMeta(remoteId, { status: "archived" }); },
  async unarchive(remoteId)       { patchThreadMeta(remoteId, { status: "regular" }); },
  async delete(remoteId)          { deleteThreadMeta(remoteId); },
  async fetch(remoteId) {
    const t = getThreadMeta(remoteId);
    return { status: t.status, remoteId: t.id, title: t.title };
  },
  async generateTitle(remoteId, messages) {
    // Stream a generated title (e.g. backend POST /title). Must return an AssistantStream.
    return createAssistantStream(async (controller) => {
      const { title } = await postTitle(remoteId, messages);
      controller.appendText(title);
    });
  },

  // Injects the per-thread history adapter beneath the thread item.
  unstable_Provider({ children }) {
    const aui = useAui();
    const history = useMemo<ThreadHistoryAdapter>(
      () => ({
        async load() { return { messages: [] }; },   // unused (no withFormat call)
        async append() {},
        withFormat: (fmt) => ({
          async load() {
            const { remoteId } = aui.threadListItem().getState();
            if (!remoteId) return { messages: [] };
            const rows = readRowsForThread(remoteId);
            return { messages: rows.map(fmt.decode) };
          },
          async append(item) {
            // First-message race: thread row may not exist yet — initialize first.
            const { remoteId } = await aui.threadListItem().initialize();
            writeRowForThread(remoteId, {
              id: fmt.getId(item.message),
              parent_id: item.parentId,
              format: fmt.format,
              content: fmt.encode(item),
            });
          },
        }),
      }),
      [aui],
    );

    return (
      <RuntimeAdapterProvider adapters={{ history }}>
        {children}
      </RuntimeAdapterProvider>
    );
  },
};
```

## Mount it

```tsx
import {
  AssistantRuntimeProvider,
  useRemoteThreadListRuntime,
  useAuiState,
} from "@assistant-ui/react";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import { useChat } from "@ai-sdk/react";

export function Provider({ children }) {
  const runtime = useRemoteThreadListRuntime({
    adapter: threadListAdapter,                        // RemoteThreadListAdapter
    runtimeHook: function RuntimeHook() {
      const id = useAuiState((s) => s.threadListItem.id);
      const chat = useChat({ id, transport, onError }); // @ai-sdk/react
      return useAISDKRuntime(chat);                     // single-thread runtime
    },
  });
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
```

> Do NOT use `useChatRuntime` as the inner `runtimeHook` (see the CRITICAL
> section above) — it is a cloud thread-list runtime and would nest a second
> thread-list runtime inside your localStorage one. The `history` adapter is
> injected by the thread-list adapter's `unstable_Provider`
> (`RuntimeAdapterProvider adapters={{ history }}`), and `useAISDKRuntime` reads
> it via `useRuntimeAdapters()`, so it is not passed to `useAISDKRuntime`
> directly. Scope `useChat` by `threadListItem.id` so each thread keeps an
> independent message stream (this mirrors what `useChatRuntime` does per thread).

## Gotchas (from docs)

- **First-message race.** `append` can fire before the thread row exists; always
  `await aui.threadListItem().initialize()` before writing the message row.
- **Synchronous children in `unstable_Provider`.** Must render `children` on
  first commit — do not gate behind suspense/loading/effects.
- **Reload after async auth.** If thread metadata loads after `list()`, call
  `aui.threads().reload()` from an effect once the user/session resolves.
