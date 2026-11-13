# Client tools

Some systems authenticate in the browser, as the user: a Kubernetes cluster
behind a cloud identity, Azure DevOps or GitHub through the user's own OAuth
session, anything the frontend already calls with a per-user token. A
**client tool** lets an assistant use such a system with the user's own
permissions. A frontend plugin or module contributes the tool through
`AssistantClientToolBlueprint` (see [Contribute a tool](#contribute-a-tool));
the browser declares it on every `/chat` request, the backend offers it to
the model with no `execute`,
and the browser runs it when the model calls it. The result returns as the
tool output; the credential never leaves the browser, and client tools are
never exposed over MCP.

Nothing is configured in the backend. Give an assistant a client tool by adding its
`<namespace>__<tool>` name to the assistant's tools in the editor, which
offers every tool registered in the app, one group per namespace; an
assistant offers the [built-in client tools](tools.md#built-in-client-tools)
plus only the contributed ones it allows, whatever the browser declares.
Built-ins never go in an assistant's tools: the editor leaves them out of its
picker, a save that adds one is refused with an error naming it, and one
saved earlier is flagged in the editor and logged once as a warning. The
backend also drops a declaration whose name is not `<namespace>__<tool>`,
uses the reserved `portal` namespace, collides with a server tool, or
exceeds 4000 description characters or 8 KB of schema, and offers at most 30
per request, built-ins included. Client tool results are capped to `toolResultMaxChars`
like every other tool result.

A client tool that is not read-only, or is destructive, asks the user for
approval on every call, with no "always allow"; a read-only one asks when its
name is in [`requireApproval`](approvals.md). A tool
that needs a credential the user has not granted shows a **Connect** control
in the conversation; dismissing it returns a `not_authorized` result the
model explains instead of retrying.

## Contribute a tool

A client tool runs in the user's browser with the user's own credentials, so
an assistant can use a system the frontend already talks to as the user
(a Kubernetes cluster, Azure DevOps, GitHub, an internal API behind the
user's OAuth session). Any plugin or app module contributes one with
`AssistantClientToolBlueprint`; the assistants plugin sends its declaration
to the backend on every turn, runs its `execute` when the model calls it, and
returns the result to the model. The credential never leaves the browser.

```ts
import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { microsoftAuthApiRef } from '@backstage/core-plugin-api';
import { AssistantClientToolBlueprint } from '@drewswiredin/backstage-plugin-assistants';

const recentBuilds = AssistantClientToolBlueprint.make({
  name: 'recent-builds',
  params: defineParams =>
    defineParams<{ project: string; top?: number }, { builds: unknown[] }>({
      name: 'azure-devops__get_recent_builds',
      title: 'Recent builds',
      description: 'The latest Azure DevOps builds of a project.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          top: { type: 'number', description: 'How many; default 10.' },
        },
        required: ['project'],
      },
      attributes: { readOnly: true },
      auth: {
        kind: 'oauth',
        system: 'Azure DevOps',
        apiRef: microsoftAuthApiRef,
        scopes: ['499b84ac-1321-427f-aa17-267ca6975798/user_impersonation'],
      },
      execute: async ({ project, top = 10 }, { credential, signal }) => {
        const res = await fetch(
          `https://dev.azure.com/my-org/${project}/_apis/build/builds?$top=${top}&api-version=7.1`,
          { headers: { Authorization: `Bearer ${credential}` }, signal },
        );
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const { value } = await res.json();
        return {
          builds: value.map((b: any) => ({
            id: b.id,
            status: b.status,
            result: b.result,
          })),
        };
      },
    }),
});

export const assistantToolsModule = createFrontendModule({
  pluginId: 'assistants',
  extensions: [recentBuilds],
});
```

Add the module to the app's `features`, then give an assistant the tool in
the editor's Tools section, where it appears in a Browser tools group named
after its namespace (`azure-devops` here). A tool contributed by its own
plugin, rather than by a module of the assistants plugin, also names that
plugin in the group's header. The contract:

- `name` is `<namespace>__<tool>`; the namespace keeps a plugin's tools apart
  from Backstage actions and MCP servers, and groups them in the editor.
  `portal` is reserved for the plugin's own tools. `description` (at most 4000
  characters) and `inputSchema` (a JSON Schema object, at most 8 KB) are what
  the model sees.
- `attributes.readOnly` and `destructive` mirror Backstage action attributes.
  A tool that is not read-only, or is destructive, asks the user for approval
  on every call; there is no "always allow". A read-only tool asks when the
  backend's `requireApproval` names it.
- `auth` is optional. `oauth` names a Backstage OAuth API and scopes; `custom`
  supplies an `acquire({ apis, interactive })` for a plugin that manages its
  own credentials (for example Kubernetes' auth-provider API). The runtime
  acquires silently first; when that yields nothing it shows a Connect
  control and acquires on the click, so no popup is blocked. The credential
  reaches only `execute`.
- `execute(input, { apis, credential, signal })` returns a JSON-serializable
  result. `apis` is the app's API holder, so a tool can call any frontend API
  (`catalogApiRef`, a plugin's own API) rather than fetch directly. A thrown
  error, a timeout (`timeoutMs`, default 30 s, at
  most 120 s), a declined approval, or a
  dismissed Connect each become an `{ _error: true, code, message }` result
  the model explains.
- `render` is optional for a tool with `execute` (the call otherwise shows
  its input and output) and required for a tool without one, whose card
  supplies the result with `addResult`; that is how `render_form` works.
- `isAvailable({ apis })` hides a tool that cannot work in this app.

Keep results small and explicit: return the fields the model needs, never a
raw object dump, and never a secret. Everything a tool returns is untrusted
input to the model.

With a model whose provider runs its own tool loop (an agent SDK or CLI a
backend module adds; see
[Model providers](providers.md#add-a-provider-type-from-a-backend-module)),
the turn can't pause for the browser, so it holds the call open instead: a
tool's `execute` runs at once and its result returns to the same turn, and a
card tool such as `render_form` returns its `addResult`. A tool that would
ask first (one that writes, or one that needs Connect) is declined on such a
model, and the model is told why. Approval cards for the backend's gated tools
work as usual.
