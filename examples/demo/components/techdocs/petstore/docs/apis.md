# Working with the APIs

## Generate a client

```sh
npx @openapitools/openapi-generator-cli generate \
  -i https://petstore.example.com/openapi.yaml -g typescript-fetch -o client
```

## Contract tests

The repository runs Schemathesis against the OpenAPI spec in CI; any response
that doesn't match the spec fails the build.

## Streetlights events

Streetlights publishes `light.measured` events with the lumens measured by
each light. Subscribe to `smartylighting/streetlights/1/0/event/+/lighting/measured`.
