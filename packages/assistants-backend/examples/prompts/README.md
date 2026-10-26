# Example assistant operating instructions

System prompts to copy into an assistant and tailor.

- `general-assistant.md`: a read-only technical and architectural
  assistant over the catalog and TechDocs (asking before a vague search, a
  search strategy, citations, and diagram guidance).
- `devops-assistant.md`: adds catalog-change and scaffolder tools with a
  confirm-before-acting policy, for terse operator use.

## Use them

Prompts live on the assistant definition in the plugin database, not in
`app-config.yaml`. After install the files are at
`node_modules/@drewswiredin/backstage-plugin-assistants-backend/examples/prompts/`.
Open one, then sign in as a user with `assistant.manage`, open the admin editor
(the gear in the chat sidebar), and paste it into the assistant's prompt field.
Edit it there to make the assistant your own.

Neither covers rendering, formatting, or the form and file tools: the backend
sends those as platform instructions before every prompt.
