# Generative UI is a standalone library; the plugin owns its surface behind a structural seam

The chat **conversation surface** exists in two places that share a starting point but **not a build-time dependency**: this plugin ships its own surface in-repo, and `@drewswiredin/gen-ui` evolves a richer one independently. Neither imports the other. They stay swappable through a structural seam, so a matured gen-ui can drop in later via one import without the plugin ever being coupled to it.

Three repositories:

1. **`drewswiredin/gen-ui`** (npm `@drewswiredin/gen-ui`) — the standalone, shareable library. Exports a **BYO-runtime** conversation surface (it consumes an assistant-ui runtime from `AssistantRuntimeProvider` context — it owns no transport, auth, model picker, rail, or backend) plus a **minimal batteries-included wrapper** that builds a default runtime against an **OpenAI-compatible / OpenRouter-style** endpoint for its own demo. Agent-agnostic: **no Mastra**. The generative-UI machinery (iframe artifacts, OpenUI, mermaid, trusted-component allowlist) lives and grows here. Ships a demo/playground app. This repo is where the surface is *refined*; it is **not consumed by the plugin**.

2. **`backstage-assistants`** (this repo) — owns **its own** conversation surface, seeded from the same copy-paste base both projects start from (the assistant-ui registry template: thread, composer, markdown-text, reasoning, tool-group, tool-fallback). Provides the Backstage-auth'd runtime + transport (`assistantId`/`modelId`/user token), the chrome (assistant rail, conversation list, header model picker), and the backend (`/status`, `/chat`, `/title`, actions-as-tools). Ships only a generic tool-call fallback for generative UI — the rich generative features stay in gen-ui until they drop in.

3. **`backstage-assistants-app`** — a vanilla `npx @backstage/create-app` instance that installs the plugin; reproducible integration testing + live demo target.

## The surface seam

The two surfaces stay swappable through assistant-ui's own native runtime/surface split — a single React component boundary, not a shared package:

```
HOST (the plugin) owns everything stateful
  Backstage page shell + chrome (assistant rail · conversation list · model picker)
  AssistantRuntimeProvider  — runtime, transport, auth headers, assistantId/modelId in body
  ════════════════ SEAM (one React component) ════════════════
SURFACE (swappable, BYO-runtime) owns only presentation
  <ConversationSurface {...props} />  — Thread · Composer · message parts · tool UIs · (later) generative UI
  reads the ambient runtime from context; owns NO transport/auth/chrome
```

The contract is one component type:

```ts
ConversationSurface: FC<ConversationSurfaceProps>

interface ConversationSurfaceProps {     // thin, presentational, forward-compatible
  composerPlaceholder?: string;          // from the assistant's `ui` config
  suggestions?: string[];                // starter prompts on the empty thread
  welcome?: { title?: string; subtitle?: string };
  className?: string;                    // host layout escape hatch
}
```

Three rules keep the eventual swap to a single import (`./surface` → `@drewswiredin/gen-ui`), routed through a `surface/` indirection module the rest of the plugin imports from:

1. **Runtime stays host-side.** The surface never constructs a runtime/transport — it consumes the ambient one. (gen-ui's batteries-included wrapper, which *does* build a runtime, is the demo's host, not part of the seam.)
2. **Props are a small, stable presentational bag** — nothing that leaks transport/auth/chrome — and each side ignores fields it doesn't render.
3. **The surface fills its container and degrades gracefully.** It renders against *whatever* runtime the host provides (the plugin uses `useRemoteThreadListRuntime`; gen-ui's demo uses a single `useChatRuntime`), so it must never *assume* a runtime capability (branch-picking, attachments, reload) that may be absent.

## Trade-offs

Chosen over making the plugin *depend on* the gen-ui library and mounting its surface directly. That coupling would block the plugin's release on gen-ui's maturity, tie their release cycles together, and make the chat surface — the thing we most want to ship now in proven, working form — hostage to an evolving research project. Decoupling lets the plugin ship its working interface today while preserving a clean, named drop-in point for gen-ui later. Cost: the surface is copy-pasted rather than imported, so improvements don't auto-propagate between repos, and the future swap is only as cheap as the seam's discipline (forward-compatible props, no runtime assumptions).

Chosen over keeping a single parallel UI built inside the plugin only: that abandons the standalone, shareable gen-ui goal entirely.

Make-or-break risk recorded as spike #0 (gen-ui's own concern): the library must ship **prebuilt, scoped CSS** that renders in a Tailwind app (its demo) *and*, if ever dropped into the plugin, in a non-Tailwind Backstage plugin under `@backstage/cli`'s webpack.
