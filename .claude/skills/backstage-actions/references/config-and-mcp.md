# Actions config + MCP exposure

## `backend.actions` (owned by Backstage core)

This is **core** config, not part of our `aiAgents` schema. Document it for operators; do not declare it in `config.d.ts`.

```yaml
backend:
  actions:
    pluginSources: # ONLY plugins listed here may register/surface actions
      - ai-agents  # our core actions (search-catalog, search-techdocs, read-techdocs)
      - catalog
      - search
    filter:        # optional fine-grained include/exclude on action ids (glob)
      include:
        - 'catalog.*'
      exclude:
        - 'scaffolder.internal.*'
```

An action is only resolvable via `actions.list` / `actions.invoke` / MCP if its owning plugin id appears in `pluginSources`. A registered action whose plugin isn't sourced will not appear in `list` results.

## `@backstage/plugin-mcp-actions-backend`

Exposes registered actions as MCP tools over HTTP for **external** MCP clients (Cursor, Claude). Independent of the in-process `tool()` adapter the `/chat` route uses.

```ts
// packages/backend/src/index.ts
backend.add(import('@backstage/plugin-mcp-actions-backend'));
```

```yaml
mcpActions:
  name: 'My Company Backstage'           # default "backstage"
  description: '...what an agent can do...'
  namespacedToolNames: true              # tool names as "pluginId.name" (default true)
  servers:                               # optional: split into multiple MCP endpoints
    catalog:
      name: 'Backstage Catalog'
      filter:
        include: [{ id: 'catalog:*' }]
        exclude: [{ attributes: { destructive: true } }]
```

- Single default server: `/api/mcp-actions/v1` (Streamable HTTP). SSE at `/sse` is deprecated.
- With `mcpActions.servers`, each key becomes `/api/mcp-actions/v1/<key>`.
- Filter rules glob on action `id`; exclude wins over include; attribute matching is supported.

## MCP authentication

Backstage requires auth on all requests. For external MCP clients the simplest path is a static external-access token:

```yaml
backend:
  auth:
    externalAccess:
      - type: static
        options:
          token: ${MCP_TOKEN}
          subject: mcp-clients
        accessRestrictions:
          - plugin: mcp-actions
          - plugin: catalog # the actions' source plugins the token may reach
```

Generate: `node -p 'require("crypto").randomBytes(24).toString("base64")'`. Clients send `Authorization: Bearer <token>`.

Experimental (new-frontend-system + `@backstage/plugin-auth`): CIMD (`auth.experimentalClientIdMetadataDocuments.enabled`) and DCR (`auth.experimentalDynamicClientRegistration.enabled`) let clients obtain a token interactively instead of a pre-shared static one. Both are flagged highly experimental.

## How this differs from the POC's MCP bridge

The POC bridged the agent to Backstage's *own* MCP endpoint using a **single static service token** — global tools, no per-user enforcement. Consuming the Actions service in-process (`actions.list/invoke` with the caller's credentials) removes both the network round-trip and the shared-identity problem. Reserve MCP for genuinely external clients.
