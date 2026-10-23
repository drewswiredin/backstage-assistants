# @drewswiredin/backstage-plugin-assistants-backend

Backend for AI Assistants for Backstage. It serves assistant metadata, streams
replies, and runs Backstage actions as tools with the calling user's
credentials. Assistant definitions live in the plugin database and are edited
in-app; `app-config.yaml` holds providers, MCP servers, the approval gate, and
runtime limits.

Pairs with the frontend plugin
[`@drewswiredin/backstage-plugin-assistants`](https://www.npmjs.com/package/@drewswiredin/backstage-plugin-assistants).

## Contents

- [Requirements](#requirements)
- [Install](#install)
- [Minimal configuration](#minimal-configuration)
- [Configure a provider](#configure-a-provider)
- [Give an assistant Backstage actions](#give-an-assistant-backstage-actions)
- [Add an MCP server](#add-an-mcp-server)
- [Connect an MCP server per user](#connect-an-mcp-server-per-user)
- [Connect a server that runs its own OAuth](#connect-a-server-that-runs-its-own-oauth)
- [Let a server ask the user for input](#let-a-server-ask-the-user-for-input)
- [Require approval before a tool runs](#require-approval-before-a-tool-runs)
- [Built-in client tools](#built-in-client-tools)
- [Client tools: run in the browser as the user](#client-tools-run-in-the-browser-as-the-user)
- [Platform instructions](#platform-instructions)
- [Run a scaffolder template from the conversation](#run-a-scaffolder-template-from-the-conversation)
- [Grant assistant.use and assistant.manage](#grant-assistantuse-and-assistantmanage)
- [Run in production](#run-in-production)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Reference](#reference)
- [License](#license)

## Requirements

- Backstage 1.56 or later on the new backend system
  (`@backstage/backend-defaults`).
- Node 22.12 or later.
- A plugin database: SQLite, Postgres, or MySQL.
- Recommended: `@backstage/plugin-signals-backend`, so working and unread
  status reaches the browser as Signals rather than by polling.

## Install

```bash
yarn --cwd packages/backend add @drewswiredin/backstage-plugin-assistants-backend
```

```ts
// packages/backend/src/index.ts
backend.add(import('@drewswiredin/backstage-plugin-assistants-backend'));
```

The backend refuses to start until `assistants.defaultModel` and at least one
provider with one model are configured; the exact messages are under
[Startup errors](#startup-errors).

## Minimal configuration

All plugin options live under `assistants` in `app-config.yaml`. The
`backend.actions.pluginSources` entry exposes this plugin's tools to
assistants; without it an assistant's tools resolve to an empty list.

```yaml
assistants:
  defaultModel: openrouter:anthropic/claude-sonnet-5
  builtinActions: true # the built-in catalog/TechDocs read tools
  providers:
    openrouter:
      type: openai-compatible
      apiKey: ${OPENROUTER_API_KEY}
      baseUrl: https://openrouter.ai/api/v1
      models:
        - name: anthropic/claude-sonnet-5
          contextWindow: 1000000

backend:
  actions:
    pluginSources:
      - assistants # plus catalog, scaffolder, etc. for their actions
```

Set the key in the backend's environment (never commit it):

```bash
export OPENROUTER_API_KEY=sk-or-...
```

Tables are created by migrations at startup; there is nothing to run. On a
healthy start the log shows `AI Assistants backend plugin initialized` with
the model count, the default model id, the `builtinActions` flag, and the
assistant count.

The first start seeds one assistant, open to every signed-in user, with the
three built-in read tools, and makes it the default assistant; open
`/assistants` and talk to it. Assistants (title, description, prompt, access,
tools, models) are created, edited, and deleted in the editor (the gear in the
chat sidebar), never in `app-config.yaml`. Exactly one assistant is the
default: the one every signed-in user gets and the panel opens first. "Make
default" in the editor designates it and opens its access to any signed-in
user; it cannot be deleted or restricted until another is made the default.
A deployment upgraded from a version without the designation gets its oldest
assistant already open to everyone as the default, or a `no default
assistant` warning in the log until an admin designates one. Under create-app's default allow-all permission policy every
signed-in user can use and manage assistants; see
[Grant assistant.use and assistant.manage](#grant-assistantuse-and-assistantmanage)
to gate either.

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
[semantic search module](../assistants-backend-module-semantic-search).

> **Required:** Backstage's actions service only exposes actions from the plugin
> sources you allow. Add `assistants` (and any other source whose actions you
> use, e.g. `catalog`, `scaffolder`) to `backend.actions.pluginSources`;
> otherwise an assistant's tools resolve to an empty list:
>
> ```yaml
> backend:
>   actions:
>     pluginSources:
>       - catalog
>       - scaffolder
>       - assistants # needed for builtinActions / this plugin's tools
> ```

Any registered action can be given to an assistant: add its id to the
assistant's tool list (`allowedTools` in the API) in the editor. An assistant
only sees the intersection of its `allowedTools` and the actions the calling
user may see and run.

## Add an MCP server

Assistants can also call tools from external MCP (Model Context Protocol)
servers (GitHub, Atlassian, Azure DevOps, internal servers), declared under
`assistants.mcp.servers`. `http` (Streamable HTTP, the default) and `sse` are
remote: `url`, plus optional `headers`. `stdio` spawns a local process:
`command`, plus optional `args`, `env`, and `cwd`.

```yaml
assistants:
  mcp:
    servers:
      # remote (Streamable HTTP) with a static auth header
      github:
        transport: http # http | sse | stdio
        url: https://api.githubcopilot.com/mcp/
        headers:
          Authorization: Bearer ${GITHUB_MCP_TOKEN}
        requireApproval: [create_pull_request] # gated as github__create_pull_request
      # remote over SSE
      jira:
        transport: sse
        url: https://mcp.example.internal/sse
      # local process over stdio
      filesystem:
        transport: stdio
        command: npx
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/data']
        env:
          SOME_TOKEN: ${SOME_TOKEN}
        # cwd: /optional/working/dir
```

Connecting to a server and listing its tools is bounded by
`assistants.mcp.connectTimeoutMs` (default `8000`), overridable per server with
`servers.<id>.connectTimeoutMs`. Slow-starting stdio servers need more: a
Python server launched via `uvx` can take about 10 s just to start, and a
server that never connects inside the ceiling is retried every cycle without
ever coming up.

```yaml
assistants:
  mcp:
    connectTimeoutMs: 15000 # global default
    servers:
      atlassian:
        transport: stdio
        command: mcp-atlassian
        connectTimeoutMs: 20000 # this server starts slowly
```

A server's tools are assigned to an assistant individually in the editor; each
selected tool becomes an `allowedTools` entry namespaced `<serverId>__<tool>`,
and the detail modal shows only the selected tools. There is no per-assistant
server allowlist in config. When the editor opens it shows each server's reachability and
its last `error`, from a listing no older than 5 minutes. An MCP tool call is
capped at 60 seconds, not counting time the user spends answering the server's
question, and stops with the turn.

With `headers` or `env`, a server runs on one static credential: one shared
identity for every user. Gate access with the assistant's `access` policy, or
connect the server per user so each user's calls carry their own token; see
[Connect an MCP server per user](#connect-an-mcp-server-per-user). To confirm
individual tools before they run, list them in
`mcp.servers.<id>.requireApproval`; see
[Require approval before a tool runs](#require-approval-before-a-tool-runs).

Connections are opened in the background, never on the request path: a task
runs every 2 minutes to connect servers that are not connected yet, refresh
each server's tool inventory, and reconnect dropped connections, each step
bounded by that server's connect timeout. Loading the plugin never blocks on a
slow or unreachable server; its tools fill in on the next cycle. A server that
is not connected when a turn calls it yields a "not connected" tool result for
that turn; a failed refresh keeps the last-known tool list and shows in the
editor as `reachable: false`. See the
[architecture doc](../../docs/architecture.md#runtime-services) for the pool.

## Connect an MCP server per user

A server with `userCredentials` has no shared credential. Each turn calls it
with the signed-in user's own token, which the browser gets from Backstage's
auth APIs and sends in a request header, so the remote system limits every
call to what that user may do and attributes writes to them. The token is
never stored, logged, or put in a message.

```yaml
assistants:
  mcp:
    servers:
      github:
        transport: http
        url: https://api.githubcopilot.com/mcp/
        headers:
          X-MCP-Toolsets: repos,pull_requests
        userCredentials:
          provider: github # a Backstage auth provider
          host: github.com # use SCM auth for this integration's host
          # scopes: [repo]          # OAuth scopes; the provider's defaults otherwise
          # header: Authorization   # http/sse header (default)
          # scheme: Bearer          # prefix before the token (default; '' sends it bare)
        requireApproval:
          [
            create_branch,
            create_or_update_file,
            push_files,
            create_pull_request,
          ]
        approvalPreview:
          create_or_update_file:
            type: file
            fields:
              repo: '{owner}/{repo}'
              branch: branch
              path: path
              content: content
              message: message
            base:
              tool: get_file_contents
              args: { owner: owner, repo: repo, path: path, ref: branch }
          push_files:
            type: files
            fields:
              {
                repo: '{owner}/{repo}',
                branch: branch,
                files: files,
                message: message,
              }
            base:
              tool: get_file_contents
              args: { owner: owner, repo: repo, path: path, ref: branch }
```

The app needs the matching sign-in: the `github` auth provider in
`auth.providers` and, with `host`, a `github.com` entry in `integrations`, so
SCM auth knows which provider serves that host (GitHub Enterprise and
self-hosted GitLab work the same way). Without `host`, the token comes from
the provider's own auth API: `github`, `gitlab`, `microsoft`, `google`,
`atlassian`, `okta`, `onelogin`, `bitbucket`, `bitbucketServer`, `openshift`, or
`vmwareCloud`. The server must accept that token: a GitHub App's user tokens
or an OAuth app's tokens, as the server documents.

What users see: a **Connect GitHub** chip next to the model picker until they
have signed in; it opens the provider's sign-in. Until then the server's tools
are not offered, and the model is told to ask the user to connect. A token
the server rejects (an expired sign-in, no access) reaches the model with the
server's message, so it can say why. Tokens are asked for silently on every
request, so the auth API's refresh keeps a long conversation working.

Each user has their own connection to the server, reused while their token is
the same, closed after 10 minutes idle, with at most 200 per backend replica.
The tools are the same for everyone, so the first listing is kept in the
database for the editor; before any user has connected after a change, the
editor asks the admin to **Connect GitHub** to discover them. A per-user
`stdio` server takes the token in the variable named by
`userCredentials.env` and runs one process per connected user; prefer an
`http` server that takes the token in a header.

`userCredentials` excludes a static credential in the same place: a `headers`
entry for the token's header, or an `env` entry for its variable, fails at
startup.

**Approval, call by call.** A per-user server's gated tools have no **Always
allow**: every call is approved on its own. Set `allowStandingApproval: true`
on the server to offer it.

**Argument rules (optional).** A per-user server already limits every call
to what the user may do, and approval puts each write in front of them, so
most setups need no rules. When a policy should hold whatever the model is
told, `argumentRules` checks a tool's arguments on the server before the call
is offered for approval and again before it runs: `pattern` (the argument must
be a string matching the regular expression) or `equals`. A missing argument
fails. A call that breaks a rule is denied at once with the reason, which the
model and the card both see, so the user never approves a call that would be
refused. Rules work on any server, shared or per user. For example, to keep
pull requests opened from the portal as drafts:

```yaml
argumentRules:
  create_pull_request:
    draft: { equals: true }
```

**Write previews.** `approvalPreview` makes the approval card show a write as
its target (`owner/repo · branch · path`), the commit message, and a diff
instead of JSON. Field values are templates over the call's input:
`{owner}/{repo}` interpolates, a bare name reads that argument. `type: file`
needs `path` and `content`; `type: files` needs `files`, an argument holding
`[{ path, content }]`, and shows one collapsible diff per file. With `base`,
the card fetches the current content through `POST /api/assistants/preview`,
which runs only the read tool configured here, as the same user; for `files`
its arguments are resolved per file, so `path` is that file's. A file the read
tool reports as not found is shown as new. "Show raw input" still shows the
JSON.

**Audit.** Every call to a gated tool, and every rule rejection, writes an
`assistants.tool.audit` log line: the user, assistant, conversation, server,
tool, the decision (`approved`, `denied`, `executed`, `failed`, or
`rejected-by-rule`), and the call's identifying arguments (`owner`, `repo`,
`branch`, `path`, issue and pull request numbers and similar). Never content,
messages, or tokens.

## Connect a server that runs its own OAuth

Many hosted MCP servers implement the MCP authorization spec: they reject a
token from a Backstage sign-in for the same vendor and run their own OAuth.
`provider: oauth` signs each user in to the server itself. The backend runs
the sign-in, keeps the user's tokens encrypted in the plugin database, and
refreshes them; they never reach the browser. The protocol (discovery of the
server's authorization server, client registration, PKCE, the `resource`
indicator, the code exchange, refresh) is `@ai-sdk/mcp`'s `auth()`.

```yaml
assistants:
  mcp:
    oauth:
      encryptionKey: ${ASSISTANTS_MCP_OAUTH_KEY} # openssl rand -base64 32
    servers:
      atlassian:
        transport: http
        url: https://mcp.atlassian.com/v1/mcp/authv2
        userCredentials:
          provider: oauth
          title: Atlassian
          scopes:
            [
              read:me,
              offline_access,
              read:jira-work,
              search:confluence,
              read:page:confluence,
            ]
        requireApproval: [createJiraIssue, editJiraIssue, addCommentToJiraIssue]
```

What users see: a **Connect Atlassian** chip next to the model picker. It
opens the server's sign-in in a popup; once they approve, the chip becomes
**✓ Atlassian**, whose × disconnects (revoking the grant at the server when it
offers revocation, and deleting the stored tokens). A sign-in that lapsed and
can't be refreshed shows **Reconnect Atlassian**. Each turn uses the user's
current token, refreshed first when it expires within five minutes; a call the
server refuses with 401 refreshes once and retries. A refresh the server
refuses for good deletes the stored sign-in and tells the model to ask the
user to reconnect.

**Scopes.** List the scopes the assistants need, including `offline_access`
where the server needs it for a refresh token. Without `scopes` the sign-in
asks for every scope the server advertises.

**Client identity.** The backend needs a client at the server's authorization
server. By default it registers itself once per server (dynamic client
registration) and keeps the client in the database. If an admin issues one,
set `clientId` (and `clientSecret` for a confidential client). If the
authorization server supports client metadata documents and can reach the
backend, `clientMetadataDocument: true` uses
`<backend>/api/assistants/mcp/oauth/client-metadata/<server id>` as the client
id instead, with nothing to register or store.

**Redirect URL.** The authorization server sends the user back to
`<backend>/api/assistants/mcp/oauth/callback` (logged at startup). Servers that
restrict where sign-ins may return, or an admin allowlist of domains, must
include it. The callback takes no Backstage token: it trusts the sign-in's
`state` (single use, ten minutes, bound to the user who started it) and checks
that the browser's Backstage cookie, issued just before the popup opens,
belongs to that same user.

**The encryption key.** `mcp.oauth.encryptionKey` is required once any server
uses `provider: oauth`; the backend refuses to start without it. To rotate,
move the old key to `previousEncryptionKeys` and set a new `encryptionKey`;
stored tokens move to the new key as they are used. Losing the key only means
every user connects again.

Tokens are used only during the user's own turns, never in the background.

## Let a server ask the user for input

Some MCP servers stop mid-call to ask the user something (MCP elicitation),
such as which project to use when the call left it out. The question appears
on the tool call as a form, under the server's name; the user submits or
declines, and the answer goes back to that server only. The model
never sees the question or the answer, only the tool's result.

```yaml
assistants:
  mcp:
    elicitationTimeoutMs: 300000 # how long a question waits (default 5 minutes)
    servers:
      ado:
        # On by default for a per-user server, off for a shared one.
        elicitation: true
```

The form's Submit is enabled once the answer fits it. A shared server serves every user over one connection, so a question can only
be tied to a user when one call is in flight on it; with several, the question
is cancelled. That is why it is off by default for shared servers.

A question is cancelled when the user doesn't answer in time, when the
conversation is stopped, after three questions in one call, or while another
question is open in the same conversation; a request to open a URL, or a form
with fields outside MCP's restricted set (text, number, yes/no, single and
multiple choice), is declined. The server decides what a decline or cancel
means for its call; the call's row is marked when its question was declined,
cancelled, or expired. A field that looks like it asks for a secret gets a
warning: MCP servers must not ask for passwords or tokens this way. Answers
are checked against the server's form on the backend too; a second answer that
doesn't fit cancels the question.

Each question writes an `assistants.tool.audit` line with
`decision: elicitation`, the action, and the names of the fields answered,
never their values.

## Require approval before a tool runs

The approval gate is global, not per-assistant. List action ids in
`assistants.requireApproval` and a server's tool names in
`mcp.servers.<id>.requireApproval`; a listed tool is paused for an explicit
**Allow / Deny** in the conversation before it ever runs:

```yaml
assistants:
  requireApproval: # confirmed before running, for every assistant allowed them
    - register-entity
    - unregister-entity
    - execute-template
```

The gate is a config floor: the effective set for an assistant is this list
intersected with its `allowedTools`, so a gated tool an assistant is not given
is never hit, and there is no per-assistant approval field that could weaken
it. Names match action ids or namespaced `<server>__<tool>` MCP tools. A gated
name the assistant is not given is ignored; a gated name it is given that does
not resolve this turn (an action the caller cannot see, a server that is not
connected) is logged.

What the user sees: the reply stops at the tool call and shows an approval
card. Allow runs the tool as it would run ungated: a Backstage action with the
user's credentials, an MCP tool with its server's configured credential or the
user's own token. Always allow also skips the prompt for that tool for the rest
of the conversation (not offered for a per-user server's tools unless it sets
`allowStandingApproval`); Deny
returns an `execution-denied` result to the model. Several gated calls of the
same tool in one step collapse into one card. The pause is enforced in code,
not requested of the model. A turn waiting on the user survives navigation and
a page reload.

The gate is a confirmation checkpoint, orthogonal to authorization: Backstage's
per-user permissions still apply when an approved Backstage action invokes.

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
form fields, tables, alerts, and the first lines of long logs, with `find` for
the lines around a term, capped at 12,000 characters. It reads the rendered
page, not app state, so it works on any page with no per-plugin code. When the
frontend's panel sends a turn, `/chat` also carries `page` (the path, the title,
and the catalog entity ref when the page is one); this backend appends one note
naming the page to that turn's instructions, after the assistant's prompt, and
never persists it.

`describe_portal` returns what the Backstage instance offers: its installed
plugins, its pages with their paths, the tabs on a catalog entity's page, and
the client tools the browser can run, read from the frontend's app tree. It
answers "what is in Backstage" and "where do I find X" with links.

An app turns either tool off in its frontend config; nothing is configured
here.

## Client tools: run in the browser as the user

Some systems authenticate in the browser, as the user: a Kubernetes cluster
behind a cloud identity, Azure DevOps or GitHub through the user's own OAuth
session, anything the frontend already calls with a per-user token. A
**client tool** lets an assistant use such a system with the user's own
permissions. A frontend plugin or module contributes the tool through
`AssistantClientToolBlueprint` (see the
[frontend README](../assistants#client-tools)); the browser declares it on
every `/chat` request, this backend offers it to the model with no `execute`,
and the browser runs it when the model calls it. The result returns as the
tool output; the credential never leaves the browser, and client tools are
never exposed over MCP.

Nothing is configured here. Give an assistant a client tool by adding its
`<namespace>__<tool>` name to the assistant's tools in the editor, which
offers every tool registered in the app; an assistant offers only the client
tools it allows, whatever the browser declares. The backend also drops a
declaration whose name is not `<namespace>__<tool>`, collides with a server
tool, or exceeds 4000 description characters or 8 KB of schema, and offers at
most 30 per request. Client tool results are capped to `toolResultMaxChars`
like every other tool result.

A client tool that is not read-only, or is destructive, asks the user for
approval on every call, with no "always allow"; a read-only one asks when its
name is in [`requireApproval`](#require-approval-before-a-tool-runs). A tool
that needs a credential the user has not granted shows a **Connect** control
in the conversation; dismissing it returns a `not_authorized` result the
model explains instead of retrying.

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
[`requireApproval`](#require-approval-before-a-tool-runs) so the run waits for
an Allow after the form.

## Grant assistant.use and assistant.manage

The plugin defines two Backstage permissions in
`@drewswiredin/backstage-plugin-assistants-common` (exported as
`assistantUsePermission`, `assistantManagePermission`, and the
`assistantsPermissions` array):

| Permission                  | `name`             | `action` | Gates                                                                                 |
| --------------------------- | ------------------ | -------- | ------------------------------------------------------------------------------------- |
| `assistantUsePermission`    | `assistant.use`    | `read`   | the user-facing routes (`GET /status`, `POST /chat`, `/threads`) and the chat surface |
| `assistantManagePermission` | `assistant.manage` | `update` | `/manage/*` + `/capabilities` and the admin editor (the gear)                         |

Both are enforced server-side (403 when denied) and gated client-side with
`usePermission`. They are registered with `coreServices.permissionsRegistry`,
so they are published on
`GET /api/assistants/.well-known/backstage/permissions/metadata` and show up in
permission UIs that discover permissions through that endpoint (the RBAC role
editor, for one). Which assistants an `assistant.use` holder then sees is the
per-assistant access policy stored on each definition, orthogonal to these
permissions.

Default-allow, like every plugin: a create-app backend ships
`permission.enabled: true` with
`@backstage/plugin-permission-backend-module-allow-all-policy`, under which
every signed-in user holds both permissions; with `permission.enabled` unset or
`false` Backstage skips policy evaluation, with the same effect. Gating takes
effect once permissions are enabled and a policy like one of the two below is
installed.

To gate with your own
[`PermissionPolicy`](https://backstage.io/docs/permissions/writing-a-policy),
authorize the two permissions for the right users (here, by group membership):

```ts
// packages/backend/src/permissionPolicy.ts
import { createBackendModule } from '@backstage/backend-plugin-api';
import { policyExtensionPoint } from '@backstage/plugin-permission-node/alpha';
import {
  PermissionPolicy,
  PolicyQuery,
  PolicyQueryUser,
} from '@backstage/plugin-permission-node';
import {
  AuthorizeResult,
  PolicyDecision,
} from '@backstage/plugin-permission-common';

class AssistantsPolicy implements PermissionPolicy {
  async handle(
    req: PolicyQuery,
    user?: PolicyQueryUser,
  ): Promise<PolicyDecision> {
    const name = req.permission.name;
    if (name === 'assistant.use' || name === 'assistant.manage') {
      // Group memberships arrive as ownership entity refs on the caller.
      const groups = user?.info.ownershipEntityRefs ?? [];
      const isAdmin = groups.includes('group:default/assistants-admins');
      const isUser = groups.includes('group:default/assistants-users');
      const allowed = name === 'assistant.manage' ? isAdmin : isUser || isAdmin;
      return { result: allowed ? AuthorizeResult.ALLOW : AuthorizeResult.DENY };
    }
    // Leave every other plugin's permissions to your wider policy.
    return { result: AuthorizeResult.ALLOW };
  }
}

export default createBackendModule({
  pluginId: 'permission',
  moduleId: 'assistants-policy',
  register(reg) {
    reg.registerInit({
      deps: { policy: policyExtensionPoint },
      async init({ policy }) {
        policy.setPolicy(new AssistantsPolicy());
      },
    });
  },
});
```

Then wire it into the backend and drop the allow-all module (the policy
extension point accepts exactly one policy):

```ts
// packages/backend/src/index.ts
backend.add(import('@backstage/plugin-permission-backend'));
// backend.add(import('@backstage/plugin-permission-backend-module-allow-all-policy')); // remove
backend.add(import('./permissionPolicy'));
```

Grant `assistant.use` to anyone who may chat, and `assistant.manage` to admins
who may run the editor. Group membership comes from the caller's
`ownershipEntityRefs`, resolved by your auth provider from the catalog, so the
groups referenced above must exist and the users be members.

With
[`@backstage-community/plugin-rbac-backend`](https://github.com/backstage/community-plugins/tree/main/workspaces/rbac)
in place of a hand-written policy, list the plugin so its permissions are
discoverable, then bind them to roles from the RBAC UI or a policy file:

```yaml
# app-config.yaml
permission:
  enabled: true
  rbac:
    pluginsWithPermission: [assistants]
```

```csv
# rbac-policy.csv
p, role:default/assistants-users, assistant.use, read, allow
p, role:default/assistants-admins, assistant.manage, update, allow
g, group:default/assistants-users, role:default/assistants-users
g, group:default/assistants-admins, role:default/assistants-admins
```

## Run in production

### Replicas

The plugin runs on several backend replicas with no session affinity. Running
turns and their streams are recorded in the database, so the working
indicator, the Stop button, and reopening a conversation mid-reply behave the
same on every replica. A reopened conversation replays the reply so far,
including reasoning and tool calls, and follows it about half a second behind
live. Stream rows are deleted 60 seconds after a turn completes.

Assistant definitions are cached per replica: updated immediately on the
replica that edited them and within 60 seconds on the others. The MCP
connection pool is per process, with its own maintenance task on each replica.

Signals reach only clients connected to the replica that emitted them unless
your events service is configured for cross-instance delivery; see the
Backstage signals documentation. While a turn runs the browser also polls its
status every 5 seconds, so indicators clear without that delivery.

### Upgrading and backups

Migrations are forward-only and run at startup. Upgrade the backend before or
with the database; a backend older than the database's newest migration fails
at startup with knex's "migration directory is corrupt". Back up the four
durable tables (`assistants`, `assistants_meta`, `threads`, `messages`)
together before upgrading; `stream_chunks` holds only in-flight replies and
needs no backup.

### Logs

- Healthy start: `AI Assistants backend plugin initialized`, with `models`,
  `defaultModel`, `builtinActions`, and `assistants` counts. Before it, on an
  upgrade from a version without the designation, `default assistant
designated: the oldest assistant open to every signed-in user`, or the
  warning `no default assistant` when none is open to everyone; designate one
  in the editor.
- At info, per designation: `default assistant designated` with the id and
  the acting admin.
- Per turn, at info: `chat turn started`, then `chat turn finished` or
  `chat turn aborted (stop)`; a failure logs `chat turn errored` at error with
  the provider's message and, for a provider error, the response body.
- Warnings to expect: `Assistant action '<name>' is not available; skipping`
  (an `allowedTools` entry the actions service does not expose),
  `MCP server '<id>' tool listing failed: ...` (the last-known tool list stays
  in place), `requireApproval lists tool(s) not available to assistant '<id>':
...` (a gated tool the assistant has that did not resolve this turn),
  `MCP server '<id>' not connected; '<tool>' skipped this turn`,
  `client tool '<name>' dropped: <reason>` (a browser declaration the backend
  will not offer: not in the allowlist, a bad name, a server-tool collision,
  or over a size limit), and `auto-title failed` (the conversation keeps its
  current title).
- At info, per turn with a gate: `Approval gate active for assistant '<id>'`.
- At info, per gated MCP call and per argument-rule rejection:
  `assistants.tool.audit` with `user`, `assistantId`, `threadId`, `server`,
  `tool`, `decision`, and `target`.
- `MCP server '<id>' asked for input: <action> (<reason>)` when a question is
  declined or cancelled before it reaches the user.
- Servers that run their own OAuth: `MCP server '<id>' connected` and
  `... disconnected` (with `user`), `MCP server '<id>' sign-in failed for <user>: ...`,
  `MCP server '<id>' token refresh failed for <user>: ...`, and
  `MCP server '<id>' sign-in expired; the user must connect again`. No token,
  code, or verifier is logged.
- Per-user servers: `MCP server '<id>' connect failed for <user>: ...` (the
  user's token was rejected or the server is down; the model is told),
  `MCP server '<id>' does not list tool(s) named in its config: ...` (a
  `requireApproval`, `argumentRules`, or `approvalPreview` key that matches no
  tool: a typo there leaves a write unguarded), and at startup
  `MCP server '<id>' is per-user over stdio`.
- A provider failure reaches the conversation as `The assistant couldn't finish
this turn: <reason>` and logs `chat stream error surfaced to client`.

## Troubleshooting

| Symptom                                                                                                            | Cause                                                                                                   | Fix                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| An assistant shows no tools; the log says `Assistant action '<name>' is not available; skipping`                   | `assistants` is missing from `backend.actions.pluginSources`, or `builtinActions` is `false`            | Add the source; set `builtinActions: true` for the built-in read tools                                         |
| Backend exits with `assistants.defaultModel '<id>' is not one of the configured models`                            | `defaultModel` does not name a configured `<providerId>:<model>`                                        | Fix `defaultModel`                                                                                             |
| Provider 401 or 403 under `chat turn errored`                                                                      | Wrong key, `baseUrl`, or Azure `apiVersion`; or the env var is not reaching the backend                 | Check the key and URL; confirm the variable is set in the backend's environment                                |
| A turn ends with tool calls and no reply on an Anthropic-type provider with a custom deployment name               | The SDK falls back to a 4096 output-token ceiling for an id it does not recognise                       | Set `maxOutputTokens` on the model                                                                             |
| An MCP server is never reachable; the log shows `MCP server '<id>' tool listing failed: ... timed out after <n>ms` | The server takes longer than `connectTimeoutMs` to start                                                | Raise `connectTimeoutMs` (uvx/npx servers often need 15000 to 20000)                                           |
| "You are not permitted to use assistants"                                                                          | The permission policy denies `assistant.use`                                                            | Grant `assistant.use`; see [Grant assistant.use and assistant.manage](#grant-assistantuse-and-assistantmanage) |
| The gear is missing from the sidebar                                                                               | The permission policy denies `assistant.manage`                                                         | Grant `assistant.manage`                                                                                       |
| "Connect GitHub" stays after signing in, or the sign-in popup fails                                                | The app has no `github` auth provider, or no `integrations` entry for the server's `host`               | Configure the auth provider and the integration; the provider id in `userCredentials` must match               |
| An OAuth sign-in popup shows the server's error about the redirect                                                 | The authorization server does not allow the backend's callback URL                                      | Allow `<backend>/api/assistants/mcp/oauth/callback` at the server, or have an admin issue a `clientId` for it  |
| The popup says "started by a different Backstage user, or your Backstage session could not be confirmed"           | The browser sent no Backstage cookie to the callback (blocked third-party cookies, or a different host) | Serve the backend on the app's site, or allow its cookies; the cookie is issued on the backend's own domain    |

## Security

Prompts and access policies never reach the chat surface; only the
`assistant.manage` routes return them.
`providers.*.apiKey` and every value under `mcp.servers.*.env` and
`mcp.servers.*.headers` are secret: redacted in logs, API responses, and the
DevTools config view. The browser receives only a projection over
`GET /status`: titles, descriptions, the model pool and defaults, the resolved
tool list (name and description), the approval floor's tool names, and `ui`.

What leaves the cluster: per turn the backend sends the configured model
provider the platform instructions and the assistant's system prompt, the full conversation history
(including attachments as base64 and prior tool results), and the results of
tools called in that turn: catalog entities, TechDocs pages, MCP results.
Auto-title makes one extra model call on a conversation's first turn. The
caller's identity (user entity ref, groups, credentials) is not sent to the
provider. MCP servers receive only the tool arguments the model produces,
under the server's configured static credential or, for a per-user server, the
user's own token. A server that runs its own OAuth also gets, through its
authorization server, the sign-in requests, code exchanges, and refreshes.

What is stored: the tables in the plugin database: `assistants`
(`definition_json`, including the prompt and access policy), `assistants_meta`
(the seed-once marker), `threads`, `messages`, `stream_chunks`, which
holds a running reply's stream for 60 seconds after the turn completes, and
`mcp_tool_cache`, each per-user MCP server's tool list. A per-user MCP token
from a Backstage sign-in is never stored: it travels in the
`x-assistants-credentials` request header and lives only in that user's open
connection. For a server that runs its own OAuth the backend does store
tokens: `mcp_oauth_tokens` holds each connected user's access and refresh
token, AES-256-GCM encrypted with `mcp.oauth.encryptionKey`, until they
disconnect or the server refuses a refresh; `mcp_oauth_clients` the client the
backend registered (its secret encrypted); and `mcp_oauth_state` a sign-in in
progress (its PKCE verifier encrypted), deleted when the callback consumes it
or after ten minutes. `mcp_elicitations` holds an MCP server's open question; the
user's answer is in it only until the replica running the call picks it up,
after which the row keeps just the action until it expires. Every message (user text,
attachments, assistant output, and tool results truncated at
`toolResultMaxChars`, default 30000) persists in `messages.content_json` until
the user deletes the conversation, which is a hard delete; nothing is retained
after that. Deleting an assistant leaves its users' conversations in `threads`
and `messages`; they no longer appear in the UI. Provider API keys and MCP secrets live only in config.

Untrusted content and prompt injection: everything a tool returns (TechDocs
pages, catalog entity fields, MCP results, client tool results) is untrusted input to the model,
and a page an assistant reads can carry instructions the model may follow. The
approval gate (`requireApproval` and `mcp.servers.<id>.requireApproval`) is
the enforced checkpoint: a listed tool never runs without an explicit Allow in
the conversation, whatever the model was told. The gate defaults to empty, so
list every write-capable action (`register-entity`, `unregister-entity`,
`execute-template`, and any MCP tool that mutates) there. Backstage permissions
still apply to each approved Backstage action, since it runs as the calling
user. An approved MCP tool runs with its server's configured credential, so
Backstage permissions do not limit it; on a per-user server it runs with the
user's own token, so the remote system limits it to what the user may do, and
`argumentRules` hold whatever the model was told. A client tool runs in the user's browser
with the user's own credential for that system, so it can do only what the
user can; one that writes always asks first.

The browser declares client tools on each `/chat` request and the backend
offers only the ones in the assistant's allowlist, so a user cannot attach
tools an admin did not assign. A forged declaration could only make the model
call code in that user's own browser with that user's own credentials.

## Reference

### Configuration keys

All keys sit under `assistants`. `assistants.semanticSearch` belongs to the
[semantic search module](../assistants-backend-module-semantic-search#reference).

| Key                                       | Default                           | Description                                                                                                                                                                                                                                                             |
| ----------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defaultModel`                            | required                          | Initial `<providerId>:<model>`; must exist in a provider.                                                                                                                                                                                                               |
| `maxSteps`                                | `10`                              | Max tool-call steps per turn.                                                                                                                                                                                                                                           |
| `builtinActions`                          | `false`                           | Register built-in catalog/TechDocs read tools.                                                                                                                                                                                                                          |
| `toolResultMaxChars`                      | `30000`                           | Max chars of a single tool result (head+tail truncation; `0` disables).                                                                                                                                                                                                 |
| `requireApproval`                         | `[]`                              | Action ids, MCP tool names, and client tool names gated by Allow / Deny in the conversation.                                                                                                                                                                            |
| `requestBodyLimit`                        | `10mb`                            | JSON body limit for every plugin request, sized for `/chat` attachments.                                                                                                                                                                                                |
| `providers.<id>.type`                     | required                          | `openai` \| `anthropic` \| `azure` \| `openai-compatible`.                                                                                                                                                                                                              |
| `providers.<id>.apiKey`                   | required                          | Provider key (secret).                                                                                                                                                                                                                                                  |
| `providers.<id>.baseUrl`                  |                                   | Base URL override.                                                                                                                                                                                                                                                      |
| `providers.<id>.options`                  |                                   | Untyped passthrough object spread into the `@ai-sdk/*` factory (e.g. Azure `useDeploymentBasedUrls`). Not schema-validated; keep credentials out of it and use `apiKey`.                                                                                                |
| `providers.<id>.models`                   | required                          | Object list; each `{ name, contextWindow?, reasoning?, maxOutputTokens? }`. A plain string list is rejected at startup.                                                                                                                                                 |
| `providers.<id>.models[].contextWindow`   |                                   | Max input tokens; drives the context gauge.                                                                                                                                                                                                                             |
| `providers.<id>.models[].reasoning`       | `false`                           | `true` if the model reasons; adds the effort picker (see Per-model options).                                                                                                                                                                                            |
| `providers.<id>.models[].maxOutputTokens` |                                   | Output-token ceiling; must be > 0. Only needed when the provider misjudges an unrecognized model id.                                                                                                                                                                    |
| `mcp.connectTimeoutMs`                    | `8000`                            | Global MCP connect/list-tools timeout ceiling in ms; must be > 0.                                                                                                                                                                                                       |
| `mcp.servers.<id>`                        |                                   | External MCP server connections (see Add an MCP server).                                                                                                                                                                                                                |
| `mcp.servers.<id>.transport`              | `http`                            | `http` \| `sse` \| `stdio`.                                                                                                                                                                                                                                             |
| `mcp.servers.<id>.url`                    | http/sse                          | Endpoint URL; required for `http` and `sse`.                                                                                                                                                                                                                            |
| `mcp.servers.<id>.headers`                |                                   | Headers sent on every request (`http`/`sse`); values are secret.                                                                                                                                                                                                        |
| `mcp.servers.<id>.command`                | stdio                             | Executable to spawn; required for `stdio`.                                                                                                                                                                                                                              |
| `mcp.servers.<id>.args`                   |                                   | Arguments for `command` (`stdio`).                                                                                                                                                                                                                                      |
| `mcp.servers.<id>.env`                    |                                   | Extra environment for the child process, merged over a safe default (`stdio`); values are secret.                                                                                                                                                                       |
| `mcp.servers.<id>.cwd`                    |                                   | Working directory for the child process (`stdio`).                                                                                                                                                                                                                      |
| `mcp.servers.<id>.connectTimeoutMs`       | the global                        | Per-server connect/list-tools ceiling; must be > 0.                                                                                                                                                                                                                     |
| `mcp.servers.<id>.requireApproval`        | `[]`                              | Tool names of this server gated by Allow / Deny.                                                                                                                                                                                                                        |
| `mcp.servers.<id>.userCredentials`        |                                   | Connect per user: `{ provider, host?, scopes?, title?, header?, scheme?, env? }` (see Connect an MCP server per user); with `provider: oauth`, `{ scopes?, title?, clientId?, clientSecret?, clientMetadataDocument? }` (see Connect a server that runs its own OAuth). |
| `mcp.elicitationTimeoutMs`                | `300000`                          | How long an MCP server's question waits for the user, in ms; must be > 0.                                                                                                                                                                                               |
| `mcp.servers.<id>.elicitation`            | per user: `true`; shared: `false` | Let the server ask the user for input mid-call (see Let a server ask the user for input).                                                                                                                                                                               |
| `mcp.oauth.encryptionKey`                 | oauth                             | 32 bytes, base64; encrypts stored OAuth tokens. Secret. Required when a server uses `provider: oauth`.                                                                                                                                                                  |
| `mcp.oauth.previousEncryptionKeys`        |                                   | Earlier keys, still read after a rotation. Secret.                                                                                                                                                                                                                      |
| `mcp.servers.<id>.allowStandingApproval`  | `false`                           | Offer Always allow for a per-user server's gated tools.                                                                                                                                                                                                                 |
| `mcp.servers.<id>.argumentRules`          |                                   | `<tool>.<argument>: { pattern?, equals? }`, enforced before approval and before the call.                                                                                                                                                                               |
| `mcp.servers.<id>.approvalPreview`        |                                   | `<tool>: { type: file \| files, fields, base? }`: the approval card's write preview and diff.                                                                                                                                                                           |

### Startup errors

Each of these is an `InputError` raised while reading config; the backend
exits with the message. A missing `assistants` block, `defaultModel`,
`providers.<id>.apiKey`, or `providers.<id>.models` fails earlier with
Backstage's own missing-config error naming the key.

- `Unsupported provider type '<type>' for provider '<id>'`: `type` is not one
  of `openai`, `anthropic`, `azure`, `openai-compatible`.
- `assistants config must declare at least one model`: no provider has a
  `models` entry.
- `assistants.defaultModel '<id>' is not one of the configured models`:
  `defaultModel` is not `<providerId>:<model>` for a model in the pool.
- `assistants.mcp.servers.<id>.transport must be one of 'http', 'sse', 'stdio'`.
- `assistants.mcp.servers.<id>: stdio transport requires 'command'`.
- `assistants.mcp.servers.<id>: '<transport>' transport requires 'url'`: an
  `http` or `sse` server without `url`.
- `assistants.mcp.connectTimeoutMs must be a positive number of milliseconds`
  (or the per-server `assistants.mcp.servers.<id>.connectTimeoutMs`).
- `assistants model '<id>': maxOutputTokens must be a positive number of tokens`.
- `assistants.mcp.servers.<id>: headers.<name> is the per-user token; remove the static value`
  (or `env.<name>` for stdio): a static credential where `userCredentials` puts the token.
- `assistants.mcp.servers.<id>.userCredentials: a stdio server takes the token in an environment variable; set 'env'`.
- `assistants.mcp.servers.<id>.userCredentials: provider 'oauth' needs a remote (http or sse) server`,
  `... clientSecret needs clientId`, or `... set clientId or clientMetadataDocument, not both`.
- `assistants.mcp.oauth.encryptionKey is required: ...`, or `... must be 32 bytes, base64`.
- `assistants.mcp.elicitationTimeoutMs must be a positive number of milliseconds`.
- `assistants.mcp.servers.<id>.argumentRules.<tool>.<argument>.pattern is not a valid regular expression: ...`,
  or `... needs 'pattern' or 'equals'`.
- `assistants.mcp.servers.<id>.approvalPreview.<tool>.type must be 'file' or 'files'`, or
  `....fields.<field> is required for type '<type>'`.

### HTTP routes

All routes are under `/api/assistants`. `/status`, `/chat`, and the thread
list, create, and status routes also apply the per-assistant access policy;
every conversation route is scoped to the owning user.

| Route                                      | Permission                         | Purpose                                                                                                     |
| ------------------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /status`                              | `assistant.use`                    | Accessible assistants (the default first), model pool and defaults, tool lists, the approval floor's names. |
| `POST /chat`                               | `assistant.use`                    | Run a turn; streams the reply. `tools` carries client tool declarations; `page` the panel's page context.   |
| `GET /chat/resume/:threadId`               | `assistant.use`                    | Rejoin an in-flight reply's stream.                                                                         |
| `POST /chat/cancel/:threadId`              | `assistant.use`                    | Stop an in-flight reply.                                                                                    |
| `GET /threads`                             | `assistant.use`                    | List the caller's conversations; `?assistantId=` filters.                                                   |
| `POST /threads`                            | `assistant.use`                    | Create a conversation.                                                                                      |
| `GET /threads/status`                      | `assistant.use`                    | Working, unread, and token count per conversation.                                                          |
| `GET /threads/:id`                         | `assistant.use`                    | One conversation.                                                                                           |
| `PATCH /threads/:id`                       | `assistant.use`                    | Rename, pin, archive, or change model or reasoning level.                                                   |
| `DELETE /threads/:id`                      | `assistant.use`                    | Delete a conversation and its messages.                                                                     |
| `POST /threads/:id/read`                   | `assistant.use`                    | Mark a conversation read.                                                                                   |
| `GET /threads/:id/messages`                | `assistant.use`                    | A conversation's messages.                                                                                  |
| `POST /preview`                            | `assistant.use`                    | The current content behind a pending write, for the approval card's diff.                                   |
| `POST /elicitations/:id`                   | `assistant.use`                    | Answer an MCP server's question; only the user whose call it interrupts.                                    |
| `GET /mcp/oauth/status`                    | `assistant.use`                    | The caller's connection to each server that runs its own OAuth.                                             |
| `POST /mcp/:serverId/oauth/start`          | `assistant.use`                    | Start a sign-in; returns the authorization URL.                                                             |
| `DELETE /mcp/:serverId/oauth`              | `assistant.use`                    | Disconnect: revoke, and delete the stored tokens.                                                           |
| `GET /mcp/oauth/callback`                  | none (`state` and the user cookie) | Where the authorization server returns the user; posts the outcome to the app window.                       |
| `GET /mcp/oauth/client-metadata/:serverId` | none                               | The client metadata document of a server with `clientMetadataDocument`.                                     |
| `GET /capabilities`                        | `assistant.manage`                 | Assignable inventory for the editor.                                                                        |
| `GET /manage/assistants`                   | `assistant.manage`                 | All assistant definitions.                                                                                  |
| `POST /manage/assistants`                  | `assistant.manage`                 | Create an assistant.                                                                                        |
| `PUT /manage/assistants/:id`               | `assistant.manage`                 | Replace an assistant definition.                                                                            |
| `DELETE /manage/assistants/:id`            | `assistant.manage`                 | Delete an assistant (not the default).                                                                      |
| `PUT /manage/assistants/:id/default`       | `assistant.manage`                 | Make an assistant the default; opens it to every signed-in user.                                            |

### Admin API

The editor is backed by `GET /capabilities` and the `/manage/assistants`
endpoints (`GET` and `POST` on the collection, `PUT` and `DELETE` by id, and
`PUT .../:id/default`) under `/api/assistants`, all gated by
`assistant.manage` (403 for callers who lack it). `GET /capabilities` returns
the live, assignable inventory (Backstage actions, the model pool, each MCP
server's reachability and tools, and the approval gate) that feeds the
editor's pickers. `/manage/assistants` reads and mutates the full definitions,
including the prompt, access policy, and audit fields (creator, editor, and
timestamps).

### Example system prompts

This package ships system prompts you can copy and tailor; after install they
are at
`node_modules/@drewswiredin/backstage-plugin-assistants-backend/examples/prompts/`:

- `general-assistant.md`: read-only catalog/TechDocs helper (scope,
  guardrails, search strategy).
- `devops-assistant.md`: adds write/scaffolding tools with a
  confirm-before-acting policy.

Open one and paste it into an assistant's prompt field in the editor; prompts
live in the database definition, not `app-config.yaml`.

## License

Apache-2.0
