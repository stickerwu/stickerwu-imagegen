# Cross-platform stickerwu imagegen

Implement the requested Codex, Claude Code and DeepSeek Harness distribution from
the existing shared image runtime. Keep the current Codex install and legacy
update identities, API profiles, saved canvases and explicit-submit behavior.

- Codex keeps its native marketplace/skill metadata.
- Claude Code gets its native `.claude-plugin` plugin and marketplace manifests,
  with the existing self-contained skill/runtime payload.
- DeepSeek Harness gets a prebuilt ESM Cordis plugin and installable bundle,
  using the official `dsh.bundle` patch, injected tools service and tool schemas.
  Include explicit generation/edit tools and on-demand canvas access. Do not
  claim official marketplace approval or publish to npm without authorization.
- Reuse the shared configuration and byte-inspecting request client, preserving
  explicit Image 2.5/2.6 model IDs. Never switch a model or retry a paid request.
- Verify package contents, host manifests, real Harness service registration,
  mock HTTP generation/edit requests for both model versions, cancellation,
  credential redaction and unchanged Codex behavior. Keep live-provider limits
  separate from local tests. Install in the user's Harness through its supported
  mechanism after inspecting the installed runtime and profile.

Architecture choice: thin native adapters over one maintained runtime, rather
than three divergent implementations or an MCP-only compatibility wrapper.
