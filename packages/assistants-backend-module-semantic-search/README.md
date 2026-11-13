# @drewswiredin/backstage-plugin-assistants-backend-module-semantic-search

Knowledge index for AI Assistants for Backstage. It copies everything your
Backstage search indexes (TechDocs, the catalog, and any other source a
collator brings in, such as Confluence or a wiki), embeds it into the
assistants plugin's Postgres database, and gives assistants a
`search-knowledge` tool that finds it by meaning, by near spelling, and by
exact words:

- "how do I fix errored-out messages" finds _Dead-letter handling › Replaying
  dead-lettered messages_.
- "Pilon deployment" finds the _Pylon Gateway › Deployment runbook_.
- "dlq-replay" finds the page that names the job.

It reads no source itself. Each time a search collator finishes a run, the
module copies that run's documents, so the index follows your search schedule
and a rate-limited source such as Confluence is read once, by search.

Catalog and TechDocs results are filtered to entities the user can read in the
catalog. Results from other sources are visible to every assistant user, as
they are in Backstage search.

Adds to the backend plugin
[`@drewswiredin/backstage-plugin-assistants-backend`](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants-backend).

## Requirements

- The assistants backend plugin, with its database on Postgres 13 or later.
- Backstage search (`@backstage/plugin-search-backend`) in the same backend,
  with the collators for the sources you want: any search engine works.
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
backend.add(import('@backstage/plugin-search-backend'));
backend.add(
  import(
    '@drewswiredin/backstage-plugin-assistants-backend-module-semantic-search'
  ),
);
```

The one `backend.add` installs two modules: the index and `search-knowledge`
under the `assistants` plugin, and a document decorator under the `search`
plugin that copies what each search run collected. To add them separately,
import `assistantsModuleSemanticSearch` and `searchModuleAssistantsKnowledge`
by name. Without the search plugin the module logs a warning at startup and
the index stays empty.

## Documentation

[Semantic search](https://drewswiredin.github.io/backstage-assistants/semantic-search/)
covers the rest: enabling the Postgres extensions, configuration and ranking
by source, giving an assistant the tool, how the index works, custom ranking,
and the configuration reference.

## License

Apache-2.0.
