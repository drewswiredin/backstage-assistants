# Require approval before a tool runs

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
