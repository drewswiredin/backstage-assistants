# Example assistant operating instructions

Ready-to-use **system prompts** to copy into an assistant and tailor.

- `general-assistant.md` — read-only catalog/TechDocs helper (scope, guardrails,
  search strategy, Markdown/Mermaid formatting rules).
- `devops-assistant.md` — adds write/scaffolding tools with a confirm-before-acting
  policy.

## Use them

Prompts live on the assistant definition in the plugin database, not in
`app-config.yaml`. After install the files are at
`node_modules/@drewswiredin/backstage-plugin-assistants-backend/examples/prompts/`.
Open one, then sign in as a user with `assistant.manage`, open the admin editor
(the gear in the chat sidebar), and paste it into the assistant's prompt field.
Edit it there to make the assistant your own.
