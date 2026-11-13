# Actions and tools

## Give an assistant Backstage actions

Assistants call Backstage actions as tools, executed with the caller's
credentials. `builtinActions: true` provides `search-catalog`,
`search-techdocs`, and `read-techdocs`. Additional actions (e.g.
`query-catalog-entities`, `get-catalog-entity`, `register-entity`,
`unregister-entity`, `execute-template`) come from the action-providing
plugins (catalog, scaffolder, and TechDocs action modules). The built-in tools
query the search backend (`software-catalog` and `techdocs` documents) and read
TechDocs pages, so they need `@backstage/plugin-search-backend` with the
catalog and TechDocs collators, and `@backstage/plugin-techdocs-backend`.
`search-knowledge`, which finds anything Backstage search indexes by meaning
and near spelling, comes from the
[semantic search module](semantic-search.md).

> **Required:** Backstage's actions service only exposes actions from the plugin
> sources you allow. Add `assistants` (and any other source whose actions you
> use, e.g. `catalog`, `scaffolder`) to `backend.actions.pluginSources`;
> otherwise those actions are not offered (MCP and client tools are
> unaffected):
>
> ```yaml
> backend:
>   actions:
>     pluginSources:
>       - catalog
>       - scaffolder
>       - search # the `query` keyword search
>       - assistants # needed for builtinActions / this plugin's tools
> ```

Any registered action can be given to an assistant: add its id to the
assistant's tool list (`allowedTools` in the API) in the editor. An assistant
only sees the intersection of its `allowedTools` and the actions the calling
user may see and run.

## Built-in client tools

Four built-in client tools are always available and need no config.
`render_form` renders an inline RJSF form for structured, multi-field, or
multiple-choice input; the user fills and submits, and the values flow back as
the tool result. Forms render Backstage scaffolder field extensions (owner,
entity, and repo pickers, plus any custom field the host app has registered),
so the model can reuse a scaffolder template's parameter block verbatim.
`download_file` hands a generated text file (CSV, JSON, Markdown, code, SVG)
back as a download chip in the conversation. `render_form` pauses the turn the
way the approval gate does until the user submits or dismisses, and a pending
form survives a page reload.

`read_current_page` returns the page the user is looking at as an outline:
open dialogs first, then the content's headings, text, buttons, links, tabs,
form fields, tables, alerts, graph labels, TechDocs content, and the first
lines of long logs, with `find` for
the lines around a term, capped at 12,000 characters. It reads the rendered
page, not app state, so it works on any page with no per-plugin code. When the
frontend's panel sends a turn, `/chat` also carries `page` (the path, the title,
and the catalog entity ref when the page is one); the backend appends one note
naming the page to that turn's instructions, after the assistant's prompt, and
never persists it.

`describe_portal` returns what the Backstage instance offers: its installed
plugins, its pages with their paths, the tabs on a catalog entity's page, and
the client tools the browser can run, read from the frontend's app tree. It
answers "what is in Backstage" and "where do I find X" with links.

An app can turn off `read_current_page` or `describe_portal` in its frontend
config (see [Panel](frontend.md#panel)); `render_form` and `download_file` are
always on. Nothing is configured in the backend.

## Recommended starter setup

A setup that gives assistants a good catalog, docs, and scaffolding experience
from the first conversation.

**Backend plugins and modules:**

| Package                                                                          | Gives assistants                                                                                                                                                     |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@backstage/plugin-search-backend` with the catalog and TechDocs collators       | The index behind the built-in `search-catalog` and `search-techdocs`, and its own `query` (keyword search across both)                                               |
| `@backstage/plugin-techdocs-backend`                                             | The pages the built-in `read-techdocs` reads, and its own `get-techdocs-metadata`                                                                                    |
| `@backstage/plugin-auth-backend`                                                 | `who-am-i`: the signed-in user and their groups                                                                                                                      |
| `@backstage/plugin-catalog-backend`                                              | `get-catalog-entity`, `query-catalog-entities`, `get-catalog-model-description`, `validate-entity`, `register-entity`, `unregister-entity`, `refresh-catalog-entity` |
| `@backstage/plugin-scaffolder-backend`                                           | `execute-template`, `dry-run-template`, `list-scaffolder-tasks`, `get-scaffolder-task-logs`, `list-scaffolder-actions`                                               |
| [Semantic search module](semantic-search.md)                                     | `search-knowledge`: search by meaning, the best first search for questions in the user's words                                                                       |
| `@backstage/plugin-signals-backend` (and `@backstage/plugin-signals` in the app) | Live working and unread status instead of polling                                                                                                                    |

Allow each plugin whose actions you use in `backend.actions.pluginSources`:

```yaml
backend:
  actions:
    pluginSources:
      - auth # who-am-i
      - catalog
      - scaffolder
      - search
      - techdocs
      - assistants
assistants:
  builtinActions: true
  requireApproval:
    - register-entity
    - unregister-entity
    - execute-template
```

**Starter assistants.** Pair each with its
[example prompt](#example-system-prompts):

| Assistant                        | Tools                                                                                                                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| General (read-only, open to all) | `who-am-i`, `get-catalog-model-description`, `search-knowledge`, `query`, `search-catalog`, `search-techdocs`, `read-techdocs`, `get-catalog-entity`, `query-catalog-entities`                                                     |
| DevOps (platform engineers)      | Everything above, plus `validate-entity`, `register-entity`, `unregister-entity`, `refresh-catalog-entity`, `execute-template`, `dry-run-template`, `list-scaffolder-tasks`, `get-scaffolder-task-logs`, `list-scaffolder-actions` |

The [built-in client tools](#built-in-client-tools) (forms, the current page,
the portal map) need no configuration.

**Optional extras.** Red Hat Developer Hub's MCP tool plugins, in the
[`rhdh-plugins` repository](https://github.com/redhat-developer/rhdh-plugins/tree/main/workspaces/mcp-integrations/plugins),
register more actions any assistant can use, installed as backend plugins per
each plugin's README:

- `techdocs-mcp-extras`: `fetch-techdocs` (TechDocs-enabled entities and
  their build metadata), `retrieve-techdocs-content` (an entity's docs by
  entity and page, without a search result first), and
  `analyze-techdocs-coverage`.
- `software-catalog-mcp-extras`, `scaffolder-mcp-extras`, and
  `kubernetes-mcp-extras`: more catalog, scaffolder, and Kubernetes actions.

These packages are not published to the public npm registry: their READMEs
show `yarn add @red-hat-developer-hub/backstage-plugin-<name>`, which fails
against npmjs.com. They ship with Red Hat Developer Hub; outside it, build
them from the repository.

## Run a scaffolder template from the conversation

Give an assistant `get-catalog-entity` and `execute-template` (with `catalog`
and `scaffolder` in `backend.actions.pluginSources`) and it can run your
templates end to end:

1. `get-catalog-entity` reads the template entity, whose `spec.parameters` is
   the template's form.
2. `render_form` shows each parameter step in the conversation, with the
   template's own pickers and validation.
3. `execute-template` runs the template with the submitted values, as the
   user, and returns the task id.

`dry-run-template` and `list-scaffolder-tasks` are available from the same
module for a preview or a status check. Put `execute-template` in
[`requireApproval`](approvals.md) so the run waits for
an Allow after the form.

## Platform instructions

Every turn, the backend sends the model a fixed set of platform instructions
before the assistant's prompt: what the chat renders (Markdown and Mermaid; not
raw HTML or LaTeX), formatting, a monotone symbol set, Mermaid syntax that
parses, when to use `render_form` and `download_file`, when to read the
user's page with `read_current_page`, and when to call `describe_portal`. They are the same
for every assistant, so a prompt only needs the assistant's role; where the two
differ, the assistant's prompt takes precedence. The editor shows them
read-only under the prompt field. The text is `PLATFORM_INSTRUCTIONS` in
`@drewswiredin/backstage-plugin-assistants-common`.

## Example system prompts

The backend package ships system prompts you can copy and tailor; after install they
are at
`node_modules/@drewswiredin/backstage-plugin-assistants-backend/examples/prompts/`:

- `general-assistant.md`: a read-only technical and architectural
  assistant over the catalog and TechDocs (asking before a vague search, a
  search strategy, citations, and diagram guidance).
- `devops-assistant.md`: adds catalog-change and scaffolder tools with a
  confirm-before-acting policy, for terse operator use.

Open one and paste it into an assistant's prompt field in the editor; prompts
live in the database definition, not `app-config.yaml`.
