# Principles

How we build `backstage-assistants`. We work off these principles plus two living diagrams — [architecture](architecture.html) and [config flow](config-flow.html) — not a spec or a log of decisions. Change the design, change the diagrams in the same commit.

1. **Stitch, don't build.** The plugin is glue between well-supported, standards-based, interoperable packages — assistant-ui, the Vercel AI SDK, and Backstage. It is not a framework of its own.

2. **Never hand-write what the stack already solves.** Conversation and thread management, message history, streaming, tool-calling, persistence adapters — these are solved. Use the library primitive (e.g. assistant-ui's `useRemoteThreadListRuntime` owns thread-list state). If you find yourself writing a store or manager that mirrors a library feature, stop.

3. **Thin glue only.** Glue exists to adapt a package to Backstage — auth, `DatabaseService`, config, the Actions registry — and nothing more. Progress is often measured in lines deleted.

4. **Choose for interoperability and standards.** Prefer packages that bolt together through shared standards (AI SDK ⇄ assistant-ui, Backstage core services) and are actively maintained. Pick for "plays nicely," not for the longest feature list. Research the choice before adopting it.


5. **The diagrams are the spec.** The architecture and config-flow diagrams are the living source of truth. They must always describe what we are building. No ADRs, no meandering specs to drift out of sync.

6. **Delete decisively.** Wrong choices and dead code get removed, not worked around or salvaged. A confident document describing code that doesn't exist is worse than no document.
