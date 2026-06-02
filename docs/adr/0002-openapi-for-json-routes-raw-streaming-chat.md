# OpenAPI for JSON routes, hand-written streaming /chat

`GET /status` and `POST /title` are defined in `openapi.yaml` and served through Backstage's OpenAPI router, giving validated requests/responses and generated types + a client published from the common package. `POST /chat` is deliberately NOT in the spec: it is a hand-written Express route that validates the request body, then streams via the AI SDK's `pipeUIMessageStreamToResponse`.

OpenAPI request/response validation assumes a buffered JSON body; a token stream doesn't fit that model. Forcing `/chat` into the spec would make the spec misdescribe the response and add codegen friction for no benefit. The accepted cost is two route styles in one router. This is recorded so the streaming route isn't later "corrected" into the spec.
