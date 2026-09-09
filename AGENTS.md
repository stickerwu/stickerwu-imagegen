# Repository rules

- Use rg for file/text searches; parse JSON with Node.js or Python.
- Move complex quoting into scripts; keep verification commands simple.
- Never commit API keys, tokens, local config, source photos or generated outputs.
- Keep generation and editing endpoints separate; no silent protocol fallback.
- Do not retry paid image requests automatically.
- Run `npm test` and `npm run check` before publishing code changes.
- Document live-provider compatibility honestly; mock tests are not live tests.
