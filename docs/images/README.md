# Images

Assets referenced by absolute raw URL on the `main` ref, so they render on GitHub, npm, and in-product catalogs alike:

`https://raw.githubusercontent.com/drewswiredin/backstage-assistants/main/docs/images/<file>`

| File                  | Used by                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `icon.svg`            | the plugin's nav icon, Remix Icon `robot-2-line` (Apache-2.0), in Backstage teal; base64-inlined as `spec.icon` in `docs/marketplace/extensions-plugin-entity.yaml` |
| `icon.png`            | 256x256 render of `icon.svg`; committed as `microsite/static/img/assistants-logo.png` in the backstage.io directory PR                                              |
| `chat.png`            | project and frontend READMEs: a grounded answer with a Mermaid diagram and a Markdown table                                                                         |
| `scaffolder-form.png` | project README: a scaffolder template's form rendered in the conversation                                                                                           |
| `tool-approval.png`   | project README: the Allow / Deny card for a gated `execute-template` call                                                                                           |
| `editor.png`          | project and frontend READMEs: the assistant editor (prompt, suggestions, models, access)                                                                            |
| `editor-tools.png`    | project README: tool assignment in the editor, Backstage actions and MCP tools                                                                                      |

`chat.png` and `editor.png` keep their names because published package READMEs
link to them.

Regenerate the PNG icon after editing the SVG:

```sh
inkscape docs/images/icon.svg --export-type=png --export-filename=docs/images/icon.png -w 256 -h 256
```

Screenshots come from a live portal with organisation-specific names replaced by neutral ones (Acme, Atlas). Chat shots are 2000 px wide; editor shots are the editor dialog at 1281 px.
