# Contributing

## Setup

Node 22 (22.12 or later) or 24, and Yarn 4 (the repo pins `yarn@4.4.1` via
`packageManager`).

```bash
yarn install
```

The dev app needs a model provider key in `.env` at the repo root:

```bash
OPENROUTER_API_KEY=sk-or-...
```

The dev backend runs on in-memory SQLite; [its README](packages/backend/README.md)
covers the dev users and pointing it at Postgres, which the semantic search
module needs.

`yarn start:env` runs the dev app the way a real deployment does: Postgres with
pgvector and pg_trgm, Elasticsearch, and two backend replicas behind a load
balancer, with the knowledge index on. It needs Docker; see
[local-env/README.md](local-env/README.md).

## Commands

| Command                              | What it does                                        |
| ------------------------------------ | --------------------------------------------------- |
| `yarn start`                         | Dev app (frontend + backend) with `.env` loaded     |
| `yarn start:env`                     | Dev app in the local environment (`local-env/`)     |
| `yarn tsc`                           | Typecheck the whole repo                            |
| `yarn lint:all`                      | Lint every package                                  |
| `yarn prettier:check`                | Formatting check                                    |
| `yarn test`                          | Unit tests                                          |
| `yarn build:all`                     | Build every package                                 |
| `yarn dedupe --check '@backstage/*'` | One copy of every Backstage package in the lockfile |

Run all of them before opening a pull request.

## Branches and pull requests

Two branches: `main` is what is released; `dev` is where work lands. Open pull
requests against `dev`.

Every commit is signed off under the Developer Certificate of Origin:

```bash
git commit -s
```

## Design documents

The design lives in `docs/architecture.md`, `docs/PRINCIPLES.md`, and
`CONTEXT.md`. A change that alters the design updates
them in the same commit as the code. Docs describe the current design in the
present tense; they carry no change narration or migration notes.

## User documentation

The user docs are the pages in `docs/`, built with MkDocs (`mkdocs.yml`) and
published to
[drewswiredin.github.io/backstage-assistants](https://drewswiredin.github.io/backstage-assistants/)
by the `docs` workflow. The package READMEs stay short and link there; a new
feature is documented in `docs/`, not in a README. To preview:

```bash
pip install mkdocs-techdocs-core
mkdocs serve
```

## Frontend dependency versions

The `@assistant-ui/*` set, `assistant-cloud`, and the AI SDK (`ai`,
`@ai-sdk/react`) are declared as caret ranges matching what upstream declares
for itself, so a consumer resolves a single copy of each. Upstream moves the
family in lockstep; bump them as a group.

## Releases

See [docs/RELEASING.md](docs/RELEASING.md).
