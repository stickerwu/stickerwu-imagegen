---
name: vvvcode-image-gen
description: Use when the user invokes stickerwu imagegen or its former name VVVCode Image Gen, wants configurable image API profiles, GPT Image 2.5/2.6 Sunburst or Flare generation, an on-demand infinite canvas, annotated edits, or GIF output with this plugin.
---

# stickerwu imagegen

Formerly VVVCode Image Gen. This is the legacy upgrade entry; new installations
use `stickerwu-imagegen`. Both entries keep the existing API configuration and
saved canvas format; the legacy entry still supports in-place updates.

Resolve `../../scripts/generate.mjs` relative to this SKILL.md. Requires Node.js
22+; no npm install. Use this plugin's API directly for requested GIFs; a GIF
request does not require HyperFrames or another video framework.

## Hosts

Codex and Claude Code load this same skill through their native plugin manifests.
Resolve every script relative to this installed SKILL.md, not the user's workspace.
DeepSeek Harness uses the repository's native `dsh-stickerwu-imagegen` bundle:
when its registered tools are available, use `stickerwu_imagegen_generate`,
`stickerwu_imagegen_edit`, `stickerwu_imagegen_canvas` and
`stickerwu_imagegen_status`. Do not run a second CLI request for the same tool call.
Harness accepts durable image attachment references as edit/canvas inputs and
returns durable raster preview references plus the unchanged original output files.
The canvas is always on demand. Reuse saved API profiles across all three hosts.
Explicit `gpt-image-2.5-sunburst` / `gpt-image-2.5-flare` remain pinned to 2.5;
GIF and SVG require 2.6 and provider access. Never substitute models after failure.

## On-demand infinite image canvas

Use this only when the user asks for a canvas, webpage, annotation or visual
iteration. Ordinary generation/edit requests stay in `generate.mjs`; do not
start a server or open a browser for them. When requested, launch the bundled
local infinite canvas on the selected/latest still image, or without an image
for an empty canvas. Do not make the user create a markup PNG manually. Resolve
`../../scripts/annotate.mjs` relative to this skill and read
[canvas workflow](references/annotation-review.md).

```text
node <annotate-script> --image <latest-image> --output-dir <deliverables> --model sunburst
node <annotate-script> --output-dir <deliverables> --model sunburst
node <annotate-script> --session <saved-review-folder>
```

Start the process in a session/background helper that stays alive, open the
`ready.url` with the available browser tool, and hand control to the user.
`--open` opens the default system browser if no browser tool is used.
Do not hold up opening the page with an additional confirmation.

The canvas follows the user's Cowart reference: light gray background, white
floating panels, gray icons, blue selection, bottom tools and a prompt below
the selected image. Images support single/multiple selection, dragging,
corner resizing, copy/delete and undo/redo. Undo never replays an API request.
Each image retains its own annotations, prompt and up to four references.
Use inline text and the eraser rather than requiring side-panel text entry.
Expand the parameter summary below the prompt for per-frame model, quality,
complexity, auto/1K/2K/4K/custom size, format, compression and streaming controls.
Settings persist with each frame. Partial images appear in a separate preview
panel; only a completed response becomes a new canvas image. PNG/JPEG/WebP
results can be annotated. SVG/GIF results are view/download only.

The user selects an image and draws/writes their edit. The small **按标注修改**
action opens its composer; the composer send button or Enter authorizes one
API edit. Shift+Enter inserts a line and Chinese IME confirmation does not
submit. The backend sends
source bytes, the separate transparent markup PNG and the prompt to
`/images/edits`; a new result appears beside its source and becomes selected.
The source and its markup remain available.

**AI 图片框** (A) creates a blank frame with a ratio and prompt; **生成图片**
sends one `/images/generations` request and fills that frame when no references
are attached. Explicit references use `/images/edits` with those image files;
this is intentional reference-guided generation, never failure fallback.
For image edits, the selected source is first and markup applies only to it.
Users can also
import/drop/paste still images, focus any previous image and continue editing.
Opening/importing/drawing/saving never makes a paid request.
Do not send a second request after a `submitted` or `generated` event.
Further submissions work without another chat instruction. **保存并结束**
stops the service and saves the canvas; `--session` reopens a finished canvas
without replaying requests. Never resume or retry an unfinished paid request.

The backend handles the loop while running; it does not depend on the chat
automatically resuming. If the agent is active, read newline-delimited JSON
events and inspect each actual result. If handing the page to the user, explain
that results appear in the page and its local session folder. Do not promise
that a new chat response will appear automatically.

## Configuration and models

Run `node <script> --get-config` when starting an image request. Capability
questions can be answered from code and the compatibility reference without setup.
Use `STICKERWU_IMAGEGEN_API_KEY` (legacy `VVVCODE_API_KEY` remains supported) or
the plugin's independent local configuration. Never reuse
another provider's credentials or expose a key in output, arguments, Git or chat.
If absent, ask the user to set the key locally; `--key-stdin` supports secure input.

For configuration requests, read [API connections](references/api-profiles.md).
The canvas menu **API 设置** saves and switches named base URLs and per-profile
keys. It works even when no key exists yet. Saving/switching never generates.
Use `--profile NAME` in either CLI to isolate that run from environment overrides.
Preserve the old configuration path `~/.config/vvvcode-image-gen/config.json`;
do not move/delete it or print its contents. The active connection is mirrored
to legacy fields for older versions. Never inherit a key for a different endpoint.

| Selection | Actual model |
| --- | --- |
| `sunburst` (default) | `gpt-image-2.6-sunburst` |
| `flare` | `gpt-image-2.6-flare` |

Sunburst is for detailed work and precise edits; Flare is for fast iteration.
Honor an explicit model choice. Explicit `gpt-image-2.5-sunburst` and
`gpt-image-2.5-flare` remain pinned to 2.5. Never switch models on failure.
OpenAI documents these 2.6 IDs, but VVVCode access and compatibility are separate.

## Generate and edit

Write complex or non-ASCII prompts to a UTF-8 file, then run:

```text
node <script> --prompt-file prompt.txt --model sunburst --output-dir <deliverables>
node <script> --edit --image source.png --prompt-file edit.txt --output-dir <deliverables>
```

Generation uses JSON POST `/v1/images/generations`. Editing uses multipart POST
`/v1/images/edits` with actual source-image bytes. Do not simulate an edit through
an undocumented image field on generations. For follow-up edits, use the latest
result unless the user identifies another source. Several `--image` arguments
are references in one edit request, not independent batch edits.

Still generation defaults to `1024x1024`; editing defaults to `auto`.
`auto` does not guarantee original dimensions. Use `--size WIDTHxHEIGHT` when exact
dimensions matter. Do not silently stretch or change orientation. Custom
dimensions must be multiples of 16; still-image model edge, aspect and pixel
limits apply: the plugin conservatively enforces 655,360–8,294,400 pixels,
an edge <=3840 and a ratio from 1:3 through 3:1. GIF skips the still minimum.
`--resolution 4K` now fits within 3840 pixels per edge and 8,294,400
pixels, preserving aspect approximately; inspect the actual dimensions.

`--quality auto|low|medium|high|xhigh|max` controls rendering detail.
`--complexity low|medium|high` independently controls planning. If omitted, the
2.6 models use high complexity. Do not send `input_fidelity` or `reasoning.summary`.
Use `--count 1..4` only for requested variants; do not infer extra paid images.

## Encoding, SVG and streamed previews

`--output-format png|jpeg|webp|svg|gif` selects the actual output bytes.
`--output-compression 0..100` applies only to JPEG/WebP and is independent of
rendering quality. For SVG use generation without references and `--count 1`;
the prompting guide's narrower generation-only contract takes precedence over
the generic edit schema. SVG allows transparent background but not masks,
streaming, partial images or compression. Passive, self-contained SVG is saved
unchanged; active/external content is rejected. Do not rasterize it implicitly.

`--stream --partial-images 0..3` supports generation and edits with PNG/JPEG/WebP.
Progress events and separate preview paths go to stderr; stdout remains final
JSON. A partial is not a final result. An interrupted stream fails without
promoting previews or replaying the request. The provider may return fewer
previews than requested.

**Live 1.4 verification, 2026-11-06:** Sunburst accepted max quality, medium
complexity, requested 2048x2048 PNG, stream=true and partial_images=2. It returned
an SSE final PNG at 1218x1292 with no partial events. Flare accepted one edit
POST (high quality, low complexity, 1536x1024, JPEG, compression=80) with HTTP
200, but returned PNG bytes; the plugin rejected the format mismatch. Exactly
one request per model, no retries. Do not claim exact sizing, JPEG/compression
support, preview delivery or visible differences between every quality tier.
SVG and intermediate previews have local/mock coverage, not verified live
provider access. See the compatibility reference before promising capabilities.

## Animated GIF through the API

```text
node <script> --prompt-file cat-loop.txt --model sunburst --output-format gif --frame-count 15 --frame-duration-ms 200 --size 512x512 --output-dir <deliverables>
```

Both generations and edits support GIF in the official API; provide still
references with `--edit --image reference.png`. Describe subject, motion,
camera behavior and a return to the starting pose in the prompt.

- `--frame-count`: 2–16, official default 9.
- `--frame-duration-ms`: 20–2000 in this CLI, official guide default 200;
  encoded delays round to 10 ms. Total duration is the sum of encoded delays.
- 15 frames × 200 ms = 3 seconds. `size` describes each frame; GIF defaults to
  `auto`. Per-model limits and the whole request's pixel budget still apply.
- GIF does not support masks, streaming, partial images, custom compression or
  prompt rewriter. Frame options apply only to GIF output.
- Save the API's actual returned GIF bytes. Never rename a PNG into a GIF or
  claim that locally assembling frames was native API output.
- CLI results inspect actual frame count, delay, total duration and loop metadata.
  Infinite-loop metadata does not establish a visually seamless boundary; inspect
  playback or boundary frames before claiming seamless motion.

**VVVCode live status, 2026-11-06:** A direct 2.6 Sunburst GIF generation request
returned HTTP 400, `GIF output is not enabled for this request.` GIF preview
access is required in the official API. Report this access/compatibility failure;
do not claim GIF works on this VVVCode account, automatically retry, switch models,
or substitute another framework. The original request was not retried. Flare GIF
access has not been tested. See [compatibility](references/image-2.6.md).

## Markup-guided API edits

```text
node <script> --edit --image original.png --markup annotations.png --prompt-file edit.txt --model flare --output-dir <deliverables>
```

Keep the original image as the first source. `markup` is a separate transparent
PNG layer containing circles, arrows or sketches; do not flatten it onto the
original. Its dimensions after orientation must match the first image. Each can
contain at most 16,777,216 pixels; the overlay must be under 50 MB and contain
transparent pixels. Additional source images are references.

Describe what to change, what to preserve, and whether to remove the visible
annotations in the finished image. Do not combine `--markup` with `--mask` or
prompt rewriter. The CLI verifies PNG overlay alpha and dimensions against PNG
sources; the provider validates oriented JPEG/WebP source dimensions.

**VVVCode live test, 2026-11-06:** One 2.6 Sunburst multipart edit with a source PNG
and separate markup PNG succeeded in changing the targeted red circle to yellow;
the annotation ring was absent from the result, and the text/layout remained
recognizable. However, requested `1024x1024` returned `1254x1254`, and non-target
colors/shading changed slightly. This verifies an accepted markup edit request
and useful edit behavior, not exact size compliance or pixel-perfect preservation.

## Results and failures

Parse stdout as JSON with Node.js or Python; progress goes to stderr. Read `files`
and `results`, inspect actual results, then display absolute local image paths.
HTTP success proves a response, not edit accuracy, preservation or transparency.
For transparency request `--background transparent --output-format png` or WebP,
then verify real alpha. A September 2026 rejection on 2.5 Sunburst does not prove
that 2.6 rejects transparency; 2.6 VVVCode transparency remains untested.

The timeout is 300 seconds. Poll long-running sessions and keep the user informed.
No automatic paid retries. Report credential-redacted errors. Do not silently
drop rejected fields, fall back from edits to generations, convert output formats,
or change the user's chosen model. Never commit source images or generated assets
unless explicitly asked to publish them.
Format mismatches retain the actual bytes under `unexpected-<id>.<actual-format>`
and report an error; those files are evidence, not successful requested output.
