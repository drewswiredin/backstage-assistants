# MCP servers

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
[Require approval before a tool runs](approvals.md).

Connections are opened in the background, never on the request path: a task
runs every 2 minutes to connect servers that are not connected yet, refresh
each server's tool inventory, and reconnect dropped connections, each step
bounded by that server's connect timeout. Loading the plugin never blocks on a
slow or unreachable server; its tools fill in on the next cycle. A server that
is not connected when a turn calls it yields a "not connected" tool result for
that turn; a failed refresh keeps the last-known tool list and shows in the
editor as `reachable: false`. See the
[architecture doc](architecture.md#runtime-services) for the pool.

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
database for the editor and shared by every backend replica within two
minutes. The editor marks that list as not checked and offers **Connect
GitHub** to check it; before any user has connected, or after the server's
`url`, `command`, or `args` change, it shows no tools and asks the admin to
connect to discover them. A per-user
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

The form's Submit is enabled once the answer fits it. A question a server sends on the tool call's own response stream (Streamable
HTTP) is shown on that call. One sent outside any call (the standalone stream,
or stdio) goes to the only call running on the connection; with several of the
user's calls running it goes to one of them, without naming the tool. Several
calls can each show a question at once; a second question on the same call
waits for the first. A shared server serves every user over one connection, so
a question outside any call can't be tied to a user while several users' calls
run; that is why it is off by default for shared servers.

A question is cancelled when the user doesn't answer in time or stops the
conversation. One that can't be shown gets an error back, not a cancel, so the
server doesn't report that the user cancelled: no call to tie it to, a browser
that can't show forms, more than three questions in one call, a request to
open a URL, or a form with fields outside MCP's restricted set (text, number,
yes/no, single and multiple choice). The server decides what a decline or cancel
means for its call; the call's row is marked when its question was declined,
cancelled, or expired. A field that looks like it asks for a secret gets a
warning: MCP servers must not ask for passwords or tokens this way. Answers
are checked against the server's form on the backend too; a second answer that
doesn't fit cancels the question.

Each question writes an `assistants.tool.audit` line with
`decision: elicitation`, the action, and the names of the fields answered,
never their values.
