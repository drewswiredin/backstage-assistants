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

The module checks the extensions at startup. If either is missing it logs an
error with the `CREATE EXTENSION` statement for each and stays off; the
assistants keep their other tools. Restart the backend once the admin has
enabled them.

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

On Azure OpenAI, deploy an embedding model and name the deployment:
`embeddingModel: azure:<embedding-deployment>`.

### Rank by source

Every source shares one index, so a large one (thousands of tickets that all
mention the same system) can crowd out the one runbook section that answers
the question. Name the search document types to weigh them:

```yaml
assistants:
  semanticSearch:
    embeddingModel: openai:text-embedding-3-small
    maxResults: 8
    types:
      software-catalog: { weight: 1.5 }
      techdocs: { weight: 1.2 }
      confluence: { weight: 1.0 }
      jira:
        weight: 0.5
        maxResults: 2
        description: ticket history, decisions and status
```

The keys are the type names Backstage search uses: `software-catalog`,
`techdocs`, or a collator's own type. Types left out are copied and ranked
with weight 1. Set `default: false` to make a source opt-in: the model then
searches it only when it passes `types: ['jira']`, and the tool description
says so. Set `enabled: false` to stop copying a source; its chunks are
deleted on its next search run.

The index fills as search runs: each document type arrives when its collator
next runs, on the schedule you gave that collator. A source's first run embeds
all of it; later runs embed only new and changed sections and delete removed
ones. Changing `embeddingModel` empties the index, and each type refills on its
next search run.

A type added to `types` takes its name, weight, and metadata on its next run,
keeping the embeddings it already has; 0.2.0 indexes upgrade the same way. To
run a collator now rather than wait for its schedule, trigger its search task
with a user or service token:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://backstage.example.com/api/search/.backstage/scheduler/v1/tasks/search_index_jira/trigger
```

The task id is `search_index_<type>`; the backend logs `Knowledge index
refreshed` with the type and counts when the copy finishes.

## Give an assistant the tool

Add `search-knowledge` to the assistant's tools in the assistant editor. It
pairs with `read-techdocs` (from `builtinActions: true`), which opens the full
page behind a TechDocs result; other results carry a link. Until the first
search run is copied, the tool
answers with an error that points the model at keyword search: Backstage's
`query` action when the assistant has it, otherwise `search-techdocs` and
`search-catalog`.

The tool's description carries the search strategy, so agents that see only
tool descriptions (some MCP clients drop server instructions) still follow it:
`search-knowledge` first, keyword search when the results don't clearly answer
or the question is a bare name or acronym, and nothing reported missing until
both come back empty. The built-in `search-catalog` and `search-techdocs`
descriptions say the same.

The action registers under the `assistants` plugin, so `assistants` must be in
`backend.actions.pluginSources`, as it already is for the built-in tools:

```yaml
backend:
  actions:
    pluginSources:
      - assistants
```

## How it works

**Indexing.** A search decorator sits on every document type's pipeline. It
passes each document on to the search engine unchanged and keeps it; when the
collator finishes, it hands the run's documents to the index. A failed run
hands over nothing, and a run with no documents changes nothing. Runs are
copied one at a time, in the backend that ran the collator.

Each document becomes one or more chunks of up to ~1600 characters, titled
with its heading path (`Site › Page › Section` for TechDocs) and embedded with
that title. The facts collators attach (entity ref, type, owner, lifecycle)
join the text, so a catalog entity with no description is still found. A
document gated by a catalog entity (its `authorization.resourceRef`) keeps that
entity for the permission check; a document gated by any other kind of
resource is skipped, since the index can only check entity read permission.

Search never tells a decorator which document type it is decorating, so the
module adds a pass-through decorator to each type named in `types`. Search
builds a run's pipeline in one pass, so that decorator names the run's type.
A named type's run is stored under its name; a run of any other type joins
the stored collection that already holds most of its locations. Chunks the
run no longer has are deleted. A collection no search run has refreshed in
30 days (a source removed from search, or an unnamed one whose locations all
changed at once) is dropped. Each row stores the embedding, a generated
full-text vector, a trigram index over its text, its type, and the short
fields its collator attached. The table is a rebuildable copy, not migrated
data.

**Retrieval.** `search-knowledge` takes the question, up to three alternative
phrasings (it uses the first three distinct ones and ignores the rest), and optionally the `types` to search (otherwise every type that is
on by default, plus unnamed sources). It builds one semantic list per
phrasing, a keyword list, a rare-word list, and a fuzzy list, each keeping
its best 30 chunks of every type, so a large source cannot fill a list on its
own:

| List      | Matches                                       | Postgres                                                    |
| --------- | --------------------------------------------- | ----------------------------------------------------------- |
| Semantic  | Meaning, per phrasing                         | pgvector cosine distance (HNSW index up to 2000 dimensions) |
| Keyword   | Any query word, ranked by match density       | `tsvector` / `websearch_to_tsquery`                         |
| Rare word | Query words found in three chunks or fewer    | `tsvector` / `websearch_to_tsquery`                         |
| Fuzzy     | Near spellings of words absent from the index | `pg_trgm` word similarity                                   |

Query words include adjacent pairs written as one word, so "tally up" also
matches "TallyUp". Reciprocal rank fusion merges the lists with one vote per
method: the semantic lists share one vote, so extra phrasings broaden recall
without outvoting an exact match. Each chunk's fused score is multiplied by
its type's weight. The rare-word list keeps a name or acronym mentioned once
in a paragraph about something else from being outranked by sections that
are only near the question in meaning. The top candidates' entities are
fetched from the catalog as the user; results for entities the user cannot
read are dropped, results with no entity are kept, and repeated text is shown
once. The ranker then picks the results: by default best first, with at most
`maxResults` of a capped type while other types can fill the slots.

Each result carries its title, location, type, excerpt, the entity ref for
catalog and TechDocs results, and `metadata`: the short fields its collator
attached (strings up to 200 characters, numbers, booleans), such as a
ticket's status or a page's last update.

## Custom ranking

A backend module can replace the ranker, for example to favour recently
updated tickets:

```ts
import { createBackendModule } from '@backstage/backend-plugin-api';
import { knowledgeRankingExtensionPoint } from '@drewswiredin/backstage-plugin-assistants-backend-module-semantic-search/alpha';

export default createBackendModule({
  pluginId: 'assistants',
  moduleId: 'knowledge-recency',
  register(env) {
    env.registerInit({
      deps: { ranking: knowledgeRankingExtensionPoint },
      async init({ ranking }) {
        ranking.setRanker(({ candidates, maxResults }) =>
          candidates
            .map(candidate => {
              const updated = Date.parse(String(candidate.metadata?.updated));
              const ageDays = (Date.now() - updated) / 86_400_000;
              const boost = ageDays < 90 ? 1.2 : 1;
              return { candidate, score: candidate.score * boost };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, maxResults)
            .map(({ candidate }) => candidate),
        );
      },
    });
  },
});
```

The ranker receives the query, its phrasings, the types searched, and up to
60 candidates the caller may read. Each candidate has its fused score after
weights, its rank in each retrieval list, its type, entity ref, and metadata.
It runs after the permission check, so it cannot surface what the caller
cannot read; results it returns that were not candidates are dropped.

## Reference

| Key                                                  | Default    | Meaning                                                                       |
| ---------------------------------------------------- | ---------- | ----------------------------------------------------------------------------- |
| `assistants.semanticSearch.embeddingModel`           | (required) | `<providerId>:<model>` from `assistants.providers`.                           |
| `assistants.semanticSearch.maxResults`               | `8`        | Results per answer unless the model asks for a number (it may ask for 20).    |
| `assistants.semanticSearch.types.<type>.weight`      | `1`        | Multiplies the type's fused score; `0` never returns it.                      |
| `assistants.semanticSearch.types.<type>.default`     | `true`     | Searched when the model names no types; `false` makes the type opt-in.        |
| `assistants.semanticSearch.types.<type>.maxResults`  |            | At most this many of the type's results while other types can fill the slots. |
| `assistants.semanticSearch.types.<type>.enabled`     | `true`     | `false` stops copying the type and deletes its chunks on its next run.        |
| `assistants.semanticSearch.types.<type>.description` |            | What the source holds, shown to the model in the tool description.            |

The index refreshes when search does; set each collator's schedule in its own
config.

## License

Apache-2.0.
