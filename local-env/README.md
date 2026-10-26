# Local environment

A production-shaped setup for testing the plugins the way they run in a real
deployment:

| Piece           | What runs                                                                          |
| --------------- | ---------------------------------------------------------------------------------- |
| Database        | Postgres 16 with `vector` and `pg_trgm` (`pgvector/pgvector:pg16`) on `:5434`      |
| Search engine   | Elasticsearch 8 (single node, no security) on `:9200`                              |
| Replicas        | Two backends on `:7008` and `:7009`, round-robined by nginx on `:7007`             |
| Knowledge index | The semantic search module, embedding with `nomic-embed-text` on Ollama (`:11434`) |
| Frontend        | The example app on `:3000`                                                         |

## Start

```sh
yarn start:env
```

This starts the containers (`compose.yaml`), then the frontend and the two
replicas. Replica B waits until replica A is ready, as in a rolling deploy:
two backends creating fresh databases at the same moment collide on the
migration locks. Ctrl+C stops the backends and the frontend; the containers
keep running, so the next start is quick.

The backends load `app-config.yaml`, then `app-config.local.yaml` if you have
one, then `local-env/app-config.yaml`, so this environment's database, search
engine, and embeddings win.

Embeddings need Ollama on `:11434` with the model pulled:

```sh
ollama pull nomic-embed-text
```

Without a local Ollama, start the one in the compose file and pull the model
into it:

```sh
docker compose -f local-env/compose.yaml --profile ollama up -d ollama
docker compose -f local-env/compose.yaml exec ollama ollama pull nomic-embed-text
```

## What it reproduces

Each request to `:7007` goes to the next replica, so consecutive requests for
one conversation (the chat, its resume, its status checks, Signals) land on
different backends, as behind a load balancer in a cluster. The
`X-Backstage-Replica` response header names the replica that answered (in the
browser's Network tab). Each replica has its own Signals connections and no
shared events backend, so a signal published on one doesn't reach a browser
connected to the other.

## Stop and reset

```sh
docker compose -f local-env/compose.yaml down      # stop, keep the data
docker compose -f local-env/compose.yaml down -v   # stop and delete the data
```
