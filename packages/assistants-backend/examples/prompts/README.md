# Example assistant operating instructions

Ready-to-use **system prompts** you can copy into your Backstage app and tailor.

- `general-assistant.md` — read-only catalog/TechDocs helper (scope, guardrails,
  search strategy, Markdown/Mermaid formatting rules).
- `devops-assistant.md` — adds write/scaffolding tools with a confirm-before-acting
  policy.

## Use them

Installing this plugin does **not** copy files into your repo (npm only populates
`node_modules`). Copy an example into your app and reference it with Backstage's
built-in `$file`:

```bash
mkdir -p packages/backend/prompts
cp node_modules/@drewswiredin/backstage-plugin-assistants-backend/examples/prompts/general-assistant.md \
   packages/backend/prompts/general-assistant.md
```

```yaml
# app-config.yaml
assistants:
  profiles:
    general:
      title: General Assistant
      prompt:
        $file: ./packages/backend/prompts/general-assistant.md
      # ...access / actions / models
```

`$file` is read at backend startup, relative to the config file. Edit the copied
`.md` to make the assistant your own — it's yours to modify or swap.
