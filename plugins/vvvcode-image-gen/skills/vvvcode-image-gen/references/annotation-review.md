# On-demand infinite image canvas

Use this workflow only when the user asks for a canvas, annotation webpage or
visual iteration. Ordinary API image generation and editing stay headless.
The canvas supports both empty-frame generation and markup-guided editing.
The bundled HTML/CSS/JS is served locally; no frontend build, npm install,
HyperFrames or hosted website is required.

## Launch and handoff

```text
node <plugin>/scripts/annotate.mjs --image result.png --output-dir <deliverables> --model sunburst
node <plugin>/scripts/annotate.mjs --output-dir <deliverables> --model sunburst
node <plugin>/scripts/annotate.mjs --session <deliverables>/review-<id>
```

Use an existing image selected by the user, the latest image from the current
task, or an empty canvas when they want to generate there. Reopen a previously
finished canvas with `--session`; its images, positions, camera, drafts, prompts
and vector annotations are restored. Preserve the selected model. Optional
flags: `--size auto|WIDTHxHEIGHT` (edit size),
`--quality VALUE`, `--complexity low|medium|high`, `--background VALUE`,
`--prompt-file edit.txt`, `--timeout 300000`, `--base-url URL`.

The process must remain running. Use a nonblocking command session or hidden
background process. Parse each stdout line as a JSON event:

| Event | Meaning |
| --- | --- |
| `ready` | Contains the local `url` and absolute `sessionDir`; no paid request has run. |
| `submitted` | One user submission has started; do not duplicate it with another CLI call. |
| `generated` | Contains actual output `files`, `width`, `height`. Inspect when the agent is active. |
| `imported` | A local image was added; no paid request ran. |
| `error` | Credential-redacted failure; the page preserves the user's drawing and text. |
| `finished` | User finished, or the inactive session timed out; service exits. |

Open `ready.url` in the available browser and hand control to the user.
Alternatively add `--open` to use the system browser. On Windows, background
helpers should be hidden. No API key is passed to the page, URL or process
arguments. Configuration is the same independent config/env as `generate.mjs`.

## User flow and artifacts

The page is a pan/zoom infinite canvas with movable, resizable image cards.
Use **平移**, Space-drag or middle-drag to pan; Ctrl/Command-wheel or the zoom
buttons to zoom, and **适应画布** to show all cards. Each image has its own
pen/ellipse/rectangle/arrow/text annotations, color, width, undo and clear.

Select an image, draw and enter instructions, then click **按标注修改** for one
edit request. The new result appears beside its source with a connection; the
source and its markup remain available. **＋ AI 图片框** adds an empty frame:
choose its ratio, enter a prompt and click **生成图片** for one generation
request that fills that frame. The actual result dimensions may differ from
the requested size and become the next annotation dimensions.

Import/drop/paste local PNG/JPEG/WebP images, select any previous image from
the board or sidebar, and download images or transparent annotation layers.
Opening, moving, importing, drawing, saving and reloading make no paid request.
Only Submit sends a request; concurrent submissions are disabled.

Each session uses a unique `review-<id>` directory inside `--output-dir`:

```text
original.png                       # Or .jpeg / .webp
session.json                       # Versions, requests, status and file paths
canvas.json                        # Camera, cards, drafts, prompts and vectors
import-<id>.png                     # Imported still images, if any
round-001/
  source.png                       # Only when JPEG/WebP orientation was baked
  markup.png                       # Absent for a text-only edit
  prompt.txt
  <result>.png                      # Edit or generation output
round-002/...
```

The overlay uses actual source pixels even when displayed zoomed or fitted.
For JPEG/WebP, the browser draws the decoded, oriented image to an unmarked
source canvas and exports PNG; the overlay remains a second canvas/file.
For PNG, the original source bytes are uploaded directly. The current studio
outputs PNG and handles still images only. Use the normal CLI for GIF requests.

The service enforces a loopback session URL, same-origin mutations, known
image IDs, matching overlay/source dimensions and transparent PNG markup.
It requests one output image per submission, never retries paid requests
automatically, and deduplicates repeated request IDs. Keep the page and process
running while waiting. A finished canvas can be reopened with `--session`,
preserving completed request IDs without replay. An unfinished/crashed canvas
is deliberately rejected by `--session`; do not restart an uncertain paid
request automatically.

**保存并结束** closes the service after a completed request. An inactive
session closes after one hour (`--idle-timeout` milliseconds); an in-flight
request is allowed to finish. Closing only the tab leaves the service running
until timeout. Saved session files can be read by the agent on the next chat
turn, but a webpage submission does not automatically wake the Codex chat.
The local backend performs the API iteration directly.
