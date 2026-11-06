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
