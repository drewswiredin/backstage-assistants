# @drewswiredin/backstage-plugin-assistants-common

Shared, browser-safe types for the Backstage AI Assistants plugin — the contract
between the [frontend](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants)
and [backend](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants-backend)
packages: `AssistantDefinition` (the canonical assistant shape used by the admin
editor and `/manage` API), `AssistantSummary` and `StatusResponse` (the
browser-safe `/status` projection, now incl. `canManage`),
`CapabilitiesResponse` (the editor's assignable inventory), plus `ToolSummary`,
`ModelOption`, `AssistantAccess`, `UiOptions`.

You normally don't install this directly — it comes in transitively with the
frontend and backend plugins.

```bash
yarn add @drewswiredin/backstage-plugin-assistants-common
```

## License

Apache-2.0
