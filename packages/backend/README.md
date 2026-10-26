# backend

The dev backend for this repo: a Backstage backend that loads the assistants
plugin, the semantic search module, and the plugins they call. It is not
published.

Run it from the repo root with `yarn start`, which loads `.env` (for
`OPENROUTER_API_KEY`) and starts the app on port 3000 and this backend on port 7007.

## What it wires

| File                         | Role                                                                                                                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`               | Catalog, scaffolder, TechDocs, search (Elasticsearch when `search.elasticsearch` is configured, as in `local-env/`, else Postgres; catalog and TechDocs collators), permissions, signals, MCP actions, the assistants backend, and the semantic search module |
| `src/devUserPickProvider.ts` | The `dev-userpick` sign-in provider: pick one of the `DEV_USERS` and sign in with that user's ownership refs                                                                                                                                                  |
| `src/permissionPolicy.ts`    | Grants `assistant.use` to `group:development/assistants-users` or `-admins`, `assistant.manage` to `-admins`, and allows every other permission                                                                                                               |

The three dev users are `guest-user` (no assistant access),
`guest-assistants-user`, and `guest-assistants-admin`, all in the `development`
namespace.

## Database

`app-config.yaml` uses in-memory SQLite, so assistants and conversations reset
on restart. To keep them, or to run the semantic search module, point
`backend.database` at Postgres in a gitignored `app-config.local.yaml`; the
module also needs the `vector` and `pg_trgm` extensions and
`assistants.semanticSearch.embeddingModel`.
