# Contributing

## Setup

Node 22.12 or later and Yarn 4 (the repo pins `yarn@4.4.1` via
`packageManager`).

```bash
yarn install
```

The dev app needs a model provider key in `.env` at the repo root:

```bash
OPENROUTER_API_KEY=sk-or-...
```

## Commands

| Command               | What it does                                    |
| --------------------- | ----------------------------------------------- |
| `yarn start`          | Dev app (frontend + backend) with `.env` loaded |
| `yarn tsc`            | Typecheck the whole repo                        |
| `yarn lint:all`       | Lint every package                              |
| `yarn prettier:check` | Formatting check                                |
| `yarn test`           | Unit tests                                      |
| `yarn build:all`      | Build every package                             |

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

## Releases

See [docs/RELEASING.md](docs/RELEASING.md).
