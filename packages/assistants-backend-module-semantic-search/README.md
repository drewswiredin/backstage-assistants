# @drewswiredin/backstage-plugin-assistants-backend-module-semantic-search

Knowledge index for AI Assistants for Backstage. It embeds every TechDocs
section and catalog entity into the assistants plugin's Postgres database and
gives assistants a `search-knowledge` tool that finds them by meaning, by near
spelling, and by exact words:

- "how do I fix errored-out messages" finds _Dead-letter handling › Replaying
  dead-lettered messages_.
- "Nexis deployment" finds the _Nexus Gateway › Deployment runbook_.
- "dlq-replay" finds the page that names the job.

Results are filtered to entities the user can read in the catalog.

Adds to the backend plugin
[`@drewswiredin/backstage-plugin-assistants-backend`](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants-backend).

## Requirements

- The assistants backend plugin, with its database on Postgres 13 or later.
- The `vector` ([pgvector](https://github.com/pgvector/pgvector)) and
  `pg_trgm` extensions in the assistants plugin's database.
- An embedding model from an `openai`, `azure`, or `openai-compatible`
  provider in `assistants.providers`: for example OpenAI
  `text-embedding-3-small`, an Azure embedding deployment, or Ollama
  `nomic-embed-text`.

## Install

```sh
yarn --cwd packages/backend add @drewswiredin/backstage-plugin-assistants-backend-module-semantic-search
```

```ts
// packages/backend/src/index.ts
backend.add(import('@drewswiredin/backstage-plugin-assistants-backend'));
backend.add(
  import(
    '@drewswiredin/backstage-plugin-assistants-backend-module-semantic-search'
  ),
);
```

## Enable the extensions

The module enables both extensions itself when its database role may. `pg_trgm`
is a trusted extension, so the role that owns the database can enable it.
`vector` needs a database admin. Ask one to run this in the assistants plugin's
database (`backstage_plugin_assistants` by default):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

| Postgres                               | What the admin does                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| AWS RDS / Aurora                       | Run the SQL as the master user.                                                     |
| Google Cloud SQL / AlloyDB             | Run the SQL as a `cloudsqlsuperuser` user.                                          |
| Azure Database for PostgreSQL Flexible | Add `VECTOR` and `PG_TRGM` to the `azure.extensions` server parameter, then run it. |
| Self-hosted                            | Install pgvector (e.g. `postgresql-16-pgvector`), then run the SQL as a superuser.  |

Until both extensions exist, the module logs the SQL above and stays off; the
assistants keep their other tools.

## Configure

```yaml
assistants:
  providers:
    openai:
      type: openai
      apiKey: ${OPENAI_API_KEY}
      models:
        - name: gpt-5.5
  semanticSearch:
    embeddingModel: openai:text-embedding-3-small
```

The first run embeds everything; later runs embed only new and changed
sections and delete removed ones. Changing `embeddingModel` rebuilds the index.

## Give an assistant the tool

Add `search-knowledge` to the assistant's tools in the assistant editor. It
pairs with `read-techdocs`, which opens the full page behind a TechDocs result.

The action registers under the `assistants` plugin, so `assistants` must be in
`backend.actions.pluginSources`, as it already is for the built-in tools:

```yaml
backend:
  actions:
    pluginSources:
      - assistants
```

## How it works

**Indexing.** A scheduled task (one replica at a time) reads each published
TechDocs site's MkDocs search index (the same source Backstage's TechDocs
search uses) and every catalog entity except `Location`. Each TechDocs section
becomes one or more chunks of up to ~1600 characters, titled with its heading
path (`Site › Page › Section`) and embedded with that title. Each row stores
the embedding, a generated full-text vector, and a trigram index over its text.
The table is a rebuildable cache, not migrated data.

**Retrieval.** `search-knowledge` takes the question and up to three alternative
phrasings and builds three ranked lists:

| List     | Matches                                       | Postgres                              |
| -------- | --------------------------------------------- | ------------------------------------- |
| Semantic | Meaning, per phrasing                         | pgvector cosine distance (HNSW index) |
| Keyword  | Any query word, ranked by match density       | `tsvector` / `websearch_to_tsquery`   |
| Fuzzy    | Near spellings of words absent from the index | `pg_trgm` word similarity             |

Reciprocal rank fusion merges the lists. The top candidates' entities are
fetched from the catalog as the user; results for entities the user cannot
read are dropped.

## Reference

| Key                                        | Default                          | Meaning                                             |
| ------------------------------------------ | -------------------------------- | --------------------------------------------------- |
| `assistants.semanticSearch.embeddingModel` | (required)                       | `<providerId>:<model>` from `assistants.providers`. |
| `assistants.semanticSearch.schedule`       | every 30 minutes, 1 hour timeout | Backstage task schedule for refreshing the index.   |

## License

Apache-2.0.
