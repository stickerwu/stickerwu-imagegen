---
name: vvvcode-image-gen
description: Generate or edit images through VVVCode using gpt-image-2.5-flare or gpt-image-2.5-sunburst. Use when the user invokes VVVCode image generation, requests these models, or asks to edit an existing image with this plugin.
---

# VVVCode Image Gen

Resolve `../../scripts/generate.mjs` relative to this SKILL.md, not relative to
the user's home or working directory. Requires Node.js 22+; no npm install.

## Configuration

Run `node <script> --get-config` when starting an image request.
For capability questions, answer directly from code without starting setup.
Use `VVVCODE_API_KEY` or the plugin's independent local configuration.
Never reuse another provider's credentials or expose a key in tool output,
chat, command-line arguments, Git, prompts, or generated files.
If no key exists, ask the user to configure VVVCODE_API_KEY locally.
`--key-stdin` is available for local secure input; config is outside the repo.
Do not ask users to paste secrets into chat.

## Model and modes

- Default model: `sunburst` = `gpt-image-2.5-sunburst`.
- Alternative: `flare` = `gpt-image-2.5-flare`.
- Honor explicit model choice. Do not switch models silently on failure.
- Generation: JSON POST `/v1/images/generations`.
- Editing: multipart POST `/v1/images/edits`, including actual image bytes.
- Never simulate editing by sending an undocumented image field to generations.
- Never promise pixel-perfect preservation, official logo fidelity or transparency.
- API/model names are provider identifiers; do not infer official OpenAI availability.

## Generate

Write a UTF-8 prompt file when quoting is complex, then run:

```text
node <script> --prompt-file <prompt.txt> --model sunburst --output-dir <deliverables>
```

Use `--size WIDTHxHEIGHT` for requested dimensions. Default generation is 1024x1024.
Use `--count 1..4` for requested variants. Do not infer additional paid images.

## Edit

Identify the user's source image, or the latest edited result if they request
another change. Ask which image only if genuinely ambiguous.

```text
node <script> --edit --image <source.png> --prompt-file <prompt.txt> --output-dir <deliverables>
```

Edits default to `size=auto` independently of generation settings.
`auto` asks the provider to choose a size; it does not guarantee exact original
dimensions. Never stretch or silently change a vertical source to landscape.
If the user requires exact dimensions, explicitly pass `--size WIDTHxHEIGHT`;
report a provider rejection instead of silently changing dimensions.
Use `--mask <mask.png>` if supplied. Multiple `--image` arguments are reference
images in ONE edit request; they do not mean independent batch edits.
For independent batch edits, make separate requests only when requested.

## Results and failures

Read JSON `files` from stdout and show local images with absolute Markdown paths.
Inspect the actual result before reporting whether the requested edit succeeded.
An HTTP success proves a response, not that the model preserved the source.
Distinguish local protocol tests from live provider verification.
On errors, report the status without credentials. No automatic paid retries.
If edits, mask, multi-image, size or quality are rejected, explain the provider
compatibility limit; do not fall back to generations without user authorization.
The API timeout is 300 seconds by default. Poll long-running tool sessions and
keep the user informed. Never commit input photos or generated images unless
the user explicitly asks to publish those assets.
