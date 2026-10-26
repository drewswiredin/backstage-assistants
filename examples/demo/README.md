# Demo catalog

The Backstage demo entities (the ACME Corp org with its domains, systems,
components, APIs, and resources), copied from
[`packages/catalog-model/examples`](https://github.com/backstage/backstage/tree/master/packages/catalog-model/examples)
in the Backstage repository (Apache-2.0). Loaded from disk so the example app
needs no GitHub token.

Changes from the original:

- No `AiResource` entities, which need a plugin the example app doesn't
  install.
- The petstore and petstore-webhook OpenAPI specs are inlined, because a
  `$text` placeholder can't read a relative file from a `file` location.
- `backstage-mcp-server` points at this backend's MCP actions endpoint in a
  link, with a short definition, instead of the newer `remotes` field.
- `systems/techdocs/` and `components/techdocs/` hold fictional documentation
  for every system and component, wired up with `backstage.io/techdocs-ref`
  annotations, so TechDocs, search, and the assistants' knowledge index have
  something to read. TechDocs only reads a docs folder inside the folder of
  the entity file, hence one `techdocs/` per entity folder.
