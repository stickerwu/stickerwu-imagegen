# Repository rules

- Use rg for file/text searches; parse JSON with Node.js or Python.
- Move complex quoting into scripts; keep verification commands simple.
- Never commit API keys, tokens, local config, source photos or generated outputs.
- Keep generation and editing endpoints separate; no silent protocol fallback.
- Do not retry paid image requests automatically.
- Run `npm test` and `npm run check` before publishing code changes.
- Document live-provider compatibility honestly; mock tests are not live tests.
- Keep annotation canvases in source-image pixel coordinates and upload the transparent overlay separately.
- Keep the review server on loopback with credentials server-side; each explicit Submit authorizes one edit, with no automatic paid retries.
- Keep the canvas UI aligned with the user's Cowart reference: neutral light-gray canvas, white floating panels, gray icons, blue selection and contextual composer.
- Canvas undo/redo must change local layout/markup only, never replay generation requests; keep deleted image files and persist removed-frame state.
- Respect Chinese IME composition and Shift+Enter in both prompt and inline annotation text.
- Use `stickerwu imagegen` as the visible name; keep the legacy plugin/skill ID, script paths and configuration path for in-place updates.
- API profiles must have separate credentials. New/changed endpoints never inherit a key; public settings and canvas exports must never contain keys.
- Saving/switching API settings makes no image request. Lock settings during generation and snapshot the chosen connection for each explicit Submit.
# Output verification

- Keep model parameters in the shared pure options module; the CLI, local
  server and canvas must apply identical combination and dimension checks.
- Inspect actual image bytes and dimensions. HTTP 200 alone does not establish
  size/format compliance or quality-tier differences.
- Stream previews are separate evidence. Only a completed event is a final
  image; an error or interrupted stream must never promote a preview.
- Preserve unexpected formats as evidence, report the mismatch, and never
  silently convert, relabel, retry, or switch models.
