# Client-local conversations, stateless backend

Conversations (thread list + message bodies) persist in the browser via assistant-ui's local thread-list runtime; the backend holds no conversation state. Every `/chat` request carries `assistantId`, `modelId`, and the full message history, and `/title` is a stateless messages-in→title-out call.

We chose this over server-stored conversations to keep installation trivial — no database, migrations, server-side PII, retention policy, or auth-scoped row access. The accepted cost: no cross-device sync, and clearing browser storage loses history. Revisiting means adding a `DatabaseService`-backed store and swapping the frontend runtime, so it is recorded here.

This supersedes the POC's use of `useRemoteThreadListRuntime`, which implied server-side thread state.
