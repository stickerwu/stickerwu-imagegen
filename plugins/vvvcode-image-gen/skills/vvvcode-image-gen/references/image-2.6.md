# GPT Image 2.6 capability and compatibility notes

Checked against the actual official pages on 2026-11-06:

- [Image generation](https://developers.openai.com/api/docs/guides/image-generation)
- [GPT Image 2.6 prompting](https://developers.openai.com/api/docs/guides/image-prompting)
- [Image edit API reference](https://developers.openai.com/api/reference/resources/images/methods/edit)

## Verified official contract

`gpt-image-2.6-flare` and `gpt-image-2.6-sunburst` support generation and edits.
Complexity is low/medium/high and defaults to high. Quality is independent and
accepts auto/low/medium/high/xhigh/max. Both document transparent backgrounds;
actual alpha and provider access require separate checks.

For GIF, send `output_format=gif` to generations or edits. The result is a finished
GIF in `data[].b64_json`. `frame_count` is 2–16 (default 9); the guide lists
`frame_duration_ms` as 20–2000 (default 200), rounded to 10 ms. The API reference
also documents longer delays up to the encoded 655,350 ms cap, so this plugin
intentionally exposes the narrower guide range. `size` is per frame, accepts auto
or positive multiples of 16, and must fit model and total request pixel limits.
The edit API explicitly says GIF preview access is required. GIF excludes masks,
streaming, partial images and custom compression; the guide also excludes prompt
rewriter. There is no documented request field for loop count; request a seamless
loop in the prompt and inspect returned animation metadata and visuals.

For markup, upload a separate transparent PNG as `markup` in multipart edits.
The overlay applies only to the first source, matches its dimensions after
orientation, contains transparent pixels, and has a 50 MB/16,777,216 pixel limit.
The first source has the same pixel limit. Do not combine markup with mask or
prompt rewriter. Both the 2.6 guide and prompting page demonstrate markup, although
some generic API reference prose still mentions only 2.5.

Some examples and introductory prose on the main guide still use 2.5. Use the
explicit 2.6 section, 2.6 prompting page and listed model IDs when migrating.

## VVVCode evidence

2026-11-06, one live request:

```json
{
  "endpoint": "POST /v1/images/generations",
  "model": "gpt-image-2.6-sunburst",
  "output_format": "gif",
  "frame_count": 15,
  "frame_duration_ms": 200,
  "size": "512x512",
  "quality": "high",
  "complexity": "medium",
  "n": 1
}
```

Returned HTTP 400: `GIF output is not enabled for this request.` No animation was
returned. This is not evidence that OpenAI lacks GIF support or that all VVVCode
accounts/models lack it. It establishes failure for this request. No retry or
alternate paid model request was made.

One additional live request on 2026-11-06 tested markup-guided edits after the user
explicitly requested an edit test. It used `POST /v1/images/edits`,
`gpt-image-2.6-sunburst`, `quality=medium`, `complexity=low`, `output_format=png`,
and `size=1024x1024`. A 1024-square source graphic and separate transparent PNG
ring overlay were uploaded as actual multipart files. The prompt requested only
recoloring circle A from red to yellow, preserving square B, triangle C and text.

The request returned an actual PNG. Visual inspection confirmed the yellow circle,
absence of the annotation ring, and retained title, labels and overall layout.
The output was 1254x1254 despite the explicit 1024x1024 request. Blue/green control
shapes also changed color and gained slight shading. At corresponding normalized
sample locations, square B changed RGB (49,134,213) to (50,140,226), and triangle C
changed (73,168,121) to (78,183,135). Do not claim exact dimensions or pixel-identical
preservation. One live markup edit was made; no retry or alternate model was used.

GIF fields, GIF file detection and encoded GIF inspection also have local tests
with synthetic API responses. Flare GIF, Flare markup edits, 2.6 still generation,
2.6 transparency and masks remain unverified live.

Historical evidence: 2.5 Sunburst transparent edits were rejected on 2026-09-09
at three resolutions. Do not apply that finding to the 2.6 models.
