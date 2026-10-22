# Images

Assets referenced by absolute raw URL on the `main` ref, so they render on GitHub and npm alike:

`https://raw.githubusercontent.com/drewswiredin/backstage-assistants/main/docs/images/<file>`

| File                  | Used by                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `icon.svg`            | the source of `icon.png`: Remix Icon `robot-2-line` (Apache-2.0) in Backstage teal                                                                           |
| `icon.png`            | 256x256 render of `icon.svg`; the backstage.io directory entry's icon, copied to `microsite/static/img/assistants-logo.png` per `docs/marketplace/README.md` |
| `chat.png`            | project and frontend READMEs: a grounded answer with a Mermaid diagram and a Markdown table                                                                  |
| `scaffolder-form.png` | project README: a scaffolder template's form rendered in the conversation                                                                                    |
| `tool-approval.png`   | project README: the approval card (Allow, Always allow, Deny) for a gated `execute-template` call                                                            |
| `editor.png`          | project and frontend READMEs: the assistant editor (prompt, suggestions, models, access)                                                                     |
| `editor-tools.png`    | project README: tool assignment in the editor, Backstage actions and MCP tools                                                                               |

`chat.png` and `editor.png` keep their names because published package READMEs
link to them.

Shots to take at the next deployment, before the READMEs link to them:

| File                         | Shows                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `panel.png`                  | the panel open beside an entity page, mid-answer, with the page content narrowed, not covered                                         |
| `panel-picker.png`           | the panel header menu listing the accessible assistants with the Default marker                                                       |
| `editor-default.png`         | the editor with the Default chip, the Make default button, and the locked access row                                                  |
| `editor-tools.png`           | retake: tool assignment now has the Backstage client tools group                                                                      |
| `home-composer-variants.png` | the homepage composer's four looks on the dev app's home page: `bar` across the top, `padded` and `full` side by side, `titled` below |

Regenerate the PNG icon after editing the SVG:

```sh
inkscape docs/images/icon.svg --export-type=png --export-filename=docs/images/icon.png -w 256 -h 256
```

Screenshots come from a live portal with organisation-specific names replaced by neutral ones (Acme, Atlas). Chat shots are 2000 px wide; editor shots are the editor dialog at 1281 px.
