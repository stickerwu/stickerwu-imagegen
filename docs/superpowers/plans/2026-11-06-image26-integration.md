# Image 2.6 integration, version 1.4

The user approved completing the parameter integration and testing it. Preserve
the existing Cowart style, on-demand local canvas, explicit one-submit/one-call
contract, separate source/transparent markup, and credential isolation.

1. Add shared browser/CLI/server validation for models, quality, complexity,
   bounded dimensions, output format, compression, streaming and GIF settings.
   Test invalid combinations before any network call.
2. Add native SVG generation, JPEG/WebP metadata, fragmented SSE parsing,
   durable partial previews, and final-result verification. Never substitute a
   preview for a missing final event or retry a paid request.
3. Expose per-frame controls in a compact composer panel. Persist settings,
   support 1K/2K/4K/custom sizing, show actual output dimensions and preview state,
   and retain annotation/IME/history behavior.
4. Test HTTP integration, old-session resume, parameter serialization and
   browser flows. Make exactly one live request per 2.6 model; report actual
   gateway behavior separately from local/mock coverage.
5. Update skill/docs/metadata, install through the native plugin manager,
   synchronize the already-authorized GitHub/Gitee repositories, and package.

Official sources checked 2026-11-06:
- https://developers.openai.com/api/docs/guides/image-prompting
- https://developers.openai.com/api/docs/guides/image-generation
- https://developers.openai.com/api/reference/resources/images/methods/generate
- https://developers.openai.com/api/reference/resources/images/methods/edit

Rulings:
- Continue in a feature branch of the established checkout; native plugin
  installation uses this local marketplace source. No unrelated files changed.
- The guide explicitly restricts SVG to generations while the generic edit
  schema lists SVG. Follow the narrower guide: block SVG edits/references.
- Use the documented still-size envelope as the plugin's conservative envelope:
  16-pixel multiples, ratio 1:3–3:1, edge <=3840, 655360–8294400 pixels.
  GIF skips the still minimum; its model-specific total budget remains upstream.
- Keep optional parameters absent unless selected. Do not claim gateway
  acceptance merely because local validation or mocked transport passed.

Ledger:
- Baseline: 32 tests passed in preceding audit; clean source at b898a1f.
- Shared options, transport/output handling, per-frame controls and docs implemented.
- 48 local tests passed, including complete-setting default removal, quoted SVG gradients,
  namespaced SVG active-content rejection and read-only reference rejection.
- Browser mock flows covered settings, invalid dimensions, preview, refresh and SVG.
- Two live calls completed with no retry: Sunburst SSE final PNG was 1218x1292
  instead of 2048x2048 and provided no partials; Flare JPEG request returned PNG.
- Native install, final installed-browser smoke test and repository release pending.
