# Images and videos

Assets referenced by absolute URL, so they render on GitHub and npm alike.
Images load from
`https://raw.githubusercontent.com/drewswiredin/backstage-assistants/main/docs/images/<file>`.

GitHub plays only videos uploaded through its web editor, not ones committed to
the repo, so each video in `docs/media/` is also uploaded as a
`https://github.com/user-attachments/assets/<id>` attachment (drag it into a
comment box and copy the URL it inserts). The project README puts that URL on a
line of its own, which GitHub renders as a player. npm doesn't play video, so
the frontend README shows the still and links it to the attachment.

| File                 | Used by                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `icon.svg`           | the source of `icon.png`: Remix Icon `robot-2-line` (Apache-2.0) in Backstage teal                                                                           |
| `icon.png`           | 256x256 render of `icon.svg`; the backstage.io directory entry's icon, copied to `microsite/static/img/assistants-logo.png` per `docs/marketplace/README.md` |
| `explain-system.png` | frontend README: still of `explain-system.mp4`, the panel's answer with an architecture diagram                                                              |
| `create-project.png` | frontend README: still of `create-project.mp4`, a scaffolder form with the owner picker open                                                                 |
| `home-composer.png`  | frontend README: the homepage composer's four looks, from `ui-tour.mp4`                                                                                      |

| Video (`docs/media/`) | Attachment id                          | Shows                                                                                                              |
| --------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `explain-system.mp4`  | `5891c498-5181-42d7-81bb-1af57e4d465c` | asking the panel to explain a system: searches, docs reads, and an answer with tables and a Mermaid diagram (42 s) |
| `create-project.mp4`  | `b0d3c659-8f9a-481c-b951-83532c3c0e12` | the DevOps assistant rendering a template's form with owner and system pickers, then asking for approval (60 s)    |
| `ui-tour.mp4`         | `15649e1a-a80c-44c1-810e-fbe44fd18478` | the homepage composers, the hand-off to the panel, the chat page, and the assistant editor (70 s)                  |

Regenerate the PNG icon after editing the SVG:

```sh
inkscape docs/images/icon.svg --export-type=png --export-filename=docs/images/icon.png -w 256 -h 256
```

Recordings come from the local environment (`yarn start:env`) with the demo
catalog. Crop the browser's tab, address, and bookmarks bars, drop the audio,
and encode for the web:

```sh
ffmpeg -i in.mp4 -an -vf "crop=2560:1288:0:152,scale=1920:-2" \
  -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -movflags +faststart out.mp4
```

The crop assumes a 2560x1440 recording with the browser's bars in the top 152
px; drop it for a fullscreen recording.
