# Petstore

**petstore** is the example service used to show off the API docs features.
It provides three APIs:

| API                                               | Kind     |
| ------------------------------------------------- | -------- |
| [petstore](/catalog/default/api/petstore)         | OpenAPI  |
| [streetlights](/catalog/default/api/streetlights) | AsyncAPI |
| [hello-world](/catalog/default/api/hello-world)   | gRPC     |

Owned by **team-c**. Nothing in production depends on it; use it to try out
API tooling, contract tests, and client generation.

## Running it

```sh
docker run -p 8080:8080 acme/petstore:latest
```

Then open `http://localhost:8080/docs` for the interactive API docs.
