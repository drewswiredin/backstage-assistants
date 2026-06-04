# Client-local conversations, stateless backend

Conversations (thread list + message bodies) persist in the browser; the backend holds no conversation state. Every `/chat` request carries `assistantId`, `modelId`, and the full message history, and `/title` is a stateless messages-in→title-out call.

Mechanically, browser persistence is implemented with assistant-ui's `useRemoteThreadListRuntime` backed by a **localStorage adapter** (thread metadata + per-thread message rows, namespaced per `assistantId`). In `@assistant-ui/react` 0.14 there is no separate "local thread-list runtime" hook — the remote runtime *is* the local one when its adapter writes to localStorage and never calls a server. The only thread-list runtime to avoid is the **Cloud** adapter (`useCloudThreadListAdapter`), which implies server-side state.

We chose this over server-stored conversations to keep installation trivial — no database, migrations, server-side PII, retention policy, or auth-scoped row access. The accepted cost: no cross-device sync, and clearing browser storage loses history. Revisiting means swapping the localStorage adapter for a `DatabaseService`-backed (or Cloud) adapter, so it is recorded here.

(Supersedes an earlier framing that treated `useRemoteThreadListRuntime` itself as server-coupled; the coupling is the *adapter*, not the runtime — see above.)
