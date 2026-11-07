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

## Provider evidence

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
returned. This is not evidence that OpenAI lacks GIF support or that all provider
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

1.4.0 made exactly two further live requests on 2026-11-06, no retries:

| Model / operation | Fields | Observed response |
| --- | --- | --- |
| Sunburst / generation | quality=max, complexity=medium, size=2048x2048, PNG, stream=true, partial_images=2 | HTTP 200 text/event-stream; final PNG 1218x1292; zero partial events |
| Flare / edit | quality=high, complexity=low, size=1536x1024, JPEG, output_compression=80 | HTTP 200 JSON, actual PNG bytes; rejected as format mismatch |

This establishes Sunburst generation/SSE completion and another size mismatch.
HTTP acceptance does not establish that quality/complexity were honored or that
requested JPEG/compression worked. The Flare result was not presented as a
successful JPEG. During this live test, the mismatch failed before output save;
the final 1.4 code additionally preserves unexpected bytes as evidence, verified
by a subsequent local regression test, without making another paid request.

SVG is exposed using the prompting guide's generations-only, n=1 contract even
though the generic edit schema lists it. PNG/JPEG/WebP support compression
(JPEG/WebP only) and stream/partial_images=0–3. SVG/GIF prohibit stream, partials
and compression. Transparent backgrounds also apply to SVG in the guide.
The shared validator uses the documented conservative still-size envelope:
16-pixel multiples, maximum edge 3840, ratio 1:3–3:1, 655360–8294400 total pixels.
The generic size prose describes 2.5; do not claim this envelope proves the 2.6
gateway's exact budget. GIF has no still minimum in this plugin; upstream total
frame/model budgets remain authoritative.

Local tests cover native SVG byte/MIME preservation, JPEG and WebP dimensions,
zero compression serialization, fragmented SSE, error/truncated streams,
independent preview files, per-frame options, resume, preflight rejection and
no retry. Browser testing uses a mock, not provider proof. Flare GIF, Flare
markup edits, SVG live access, WebP/JPEG compliance, actual intermediate preview
delivery, 2.6 transparency and masks remain unverified live.

Historical evidence: 2.5 Sunburst transparent edits were rejected on 2026-09-09
at three resolutions. Do not apply that finding to the 2.6 models.
