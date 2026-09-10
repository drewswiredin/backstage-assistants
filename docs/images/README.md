# Images

Assets referenced by absolute raw URL on the `main` ref, so they render on GitHub, npm, and in-product catalogs alike:

`https://raw.githubusercontent.com/drewswiredin/backstage-assistants/main/docs/images/<file>`

| File         | Used by                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `icon.svg`   | the plugin's nav icon, Remix Icon `robot-2-line` (Apache-2.0), in Backstage teal; base64-inlined as `spec.icon` in `docs/marketplace/extensions-plugin-entity.yaml` |
| `icon.png`   | 256x256 render of `icon.svg`; committed as `microsite/static/img/assistants-logo.png` in the backstage.io directory PR                                              |
| `chat.png`   | project README: the chat side panel                                                                                                                                 |
| `editor.png` | project README: the assistant editor                                                                                                                                |

Regenerate the PNG icon after editing the SVG:

```sh
inkscape docs/images/icon.svg --export-type=png --export-filename=docs/images/icon.png -w 256 -h 256
```

Screenshot spec: 2560x1264, neutral display name. `chat.png` shows a real exchange with a tool call, an Allow/Deny approval, and rendered Markdown and Mermaid. `editor.png` shows a full assistant definition with nothing redacted.
