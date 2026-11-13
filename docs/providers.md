# Model providers

## Configure a provider

Model ids are `<providerId>:<model>`, where `providerId` is your key under
`providers`. All four `type`s are built in and their AI SDK packages ship with
this plugin. Several providers can be configured at once; the union of their
`models` is the pool. Every `models` entry is an object with a `name`;
`contextWindow`, `reasoning`, and `maxOutputTokens` are optional. A plain
string list fails validation at startup.

Each example below sits under `assistants.providers`.

OpenAI:

```yaml
openai:
  type: openai
  apiKey: ${OPENAI_API_KEY}
  models:
    - name: gpt-5.5
      contextWindow: 400000
      reasoning: true
# ids: openai:gpt-5.5
```

Anthropic:

```yaml
anthropic:
  type: anthropic
  apiKey: ${ANTHROPIC_API_KEY}
  models:
    - name: claude-opus-5
      contextWindow: 1000000
      reasoning: true
    - name: claude-sonnet-5
      contextWindow: 1000000
      reasoning: true
# ids: anthropic:claude-opus-5, anthropic:claude-sonnet-5
```

Azure OpenAI / AI Foundry: `models` are your deployment names. Point `baseUrl`
at the resource's `/openai` path; requests use the `v1` API. For the older
deployment-based URLs, set `options.useDeploymentBasedUrls: true` and a dated
`options.apiVersion`:

```yaml
azure:
  type: azure
  apiKey: ${AZURE_API_KEY}
  baseUrl: https://<resource>.openai.azure.com/openai
  models:
    - name: my-gpt-5-5-deployment
      contextWindow: 400000
      reasoning: true
# ids: azure:my-gpt-5-5-deployment
```

OpenAI-compatible (OpenRouter, local gateways, and similar) uses the OpenAI SDK
with a `baseUrl`:

```yaml
openrouter:
  type: openai-compatible
  apiKey: ${OPENROUTER_API_KEY}
  baseUrl: https://openrouter.ai/api/v1
  models:
    - name: anthropic/claude-sonnet-5
      contextWindow: 1000000
      reasoning: true
    - name: openai/gpt-5.5
      contextWindow: 400000
      reasoning: true
# ids: openrouter:anthropic/claude-sonnet-5, openrouter:openai/gpt-5.5
```

### Per-model options

`contextWindow` is the model's input limit in tokens and drives the context
gauge in the chat header; omit it to leave the limit unknown.

`reasoning: true` marks a model that reasons. The chat then offers an effort
picker next to the model picker. Config says only whether a model reasons,
never which tiers it has (under `assistants.providers.<id>`):

```yaml
models:
  - name: gpt-5.5
    reasoning: true
  - name: my-small-deployment # no flag: no picker for this model
```

The tiers are fixed and the same for every reasoning model (low, medium, high,
max), translated to the provider's own knob at request time:

| Provider type                          | Sent as                                                         |
| -------------------------------------- | --------------------------------------------------------------- |
| `openai`, `openai-compatible`, `azure` | `reasoningEffort: <tier>` (`max` as `xhigh`)                    |
| `anthropic`                            | `thinking: { type: adaptive }` + `output_config.effort: <tier>` |

Tiers are forwarded by name; nothing here invents token budgets. The picker
starts at Default and sends nothing, so the provider's own default stands;
there is no `off` tier. The tier is remembered per conversation. Reasoning
output renders as a collapsible Reasoning block in the chat, independent of
this setting.

Set `reasoning: true` only on Anthropic models Claude 4.6 or later; older
models reject the request. The `max` tier is sent as `xhigh` to OpenAI-style
providers.

`maxOutputTokens` caps the tokens a model may generate per turn; omit it and
the provider's own default stands. Symptom that calls for it: on an
Anthropic-type provider with a custom deployment name (not a plain `claude-*`
id), tool calls run normally and the turn ends with no reply, because
`@ai-sdk/anthropic` falls back to a 4096-token ceiling for an id it does not
recognize. Fix (under
`assistants.providers.<id>`):

```yaml
models:
  - name: my-foundry-deployment # a bare deployment name, not a Claude id
    reasoning: true
    maxOutputTokens: 128000
```

## Add a provider type from a backend module

A backend module can serve provider types beyond the four built in, for
example a cloud SDK or a company AI gateway, through
`assistantsModelProvidersExtensionPoint`. The module registers a factory for
a `type`; each `assistants.providers.<id>` block with that `type` is handed to
it, with its `models` read as usual:

```ts
import { createBackendModule } from '@backstage/backend-plugin-api';
import { assistantsModelProvidersExtensionPoint } from '@drewswiredin/backstage-plugin-assistants-backend';
import { createGateway } from './gateway';

export default createBackendModule({
  pluginId: 'assistants',
  moduleId: 'gateway-provider',
  register(env) {
    env.registerInit({
      deps: { providers: assistantsModelProvidersExtensionPoint },
      async init({ providers }) {
        providers.addProviderType('gateway', ({ config }) => {
          const gateway = createGateway({ url: config.getString('url') });
          return { languageModel: name => gateway.languageModel(name) };
        });
      },
    });
  },
});
```

```yaml
assistants:
  providers:
    corp:
      type: gateway
      url: https://ai.example.com
      models:
        - name: frontier-large
# ids: corp:frontier-large
```

`languageModel` returns an AI SDK language model. `reasoningOptions(name,
level)` supplies the `providerOptions` for the effort tiers of models marked
`reasoning: true`; omit it and no tier is sent. A built-in type can't be
replaced, and an unknown `type` fails at startup with the list of types
available.

**Providers that run their own tool loop.** An agent SDK or CLI executes
tools itself rather than returning calls for the plugin to run. Such a
provider sets `runsOwnToolLoop: true` and receives the turn's tools in
`languageModel(name, turn)` as `turn.tools`, each with its JSON Schema and an
`execute` that runs the tool as the plugin would: as the user, behind the
approval gate and argument rules. It reports each call and result as
provider-executed tool parts named as in `turn.tools`. The turn runs as
usual otherwise:

- A gated call shows the approval card while the provider waits; Allow runs
  it, Deny returns the denial to the model, and Always allow covers that tool
  for the rest of the turn.
- A client tool's call runs in the browser and its result returns to the
  provider. `render_form` waits for the form; a tool that needs nothing from
  the user (`read_current_page`, `describe_portal`, a read-only contributed
  tool) runs at once; one that would ask first (a write, or Connect) is
  declined with a message the model sees.
- An MCP server's question shows on its call as usual.

A held call waits up to 10 minutes and is answered through
`POST /held-calls/:id`, from any replica. Stop ends the wait.
