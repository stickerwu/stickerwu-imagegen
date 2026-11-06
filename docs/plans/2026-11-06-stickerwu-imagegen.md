# stickerwu imagegen 1.5

- Rename the visible plugin, CLI and canvas to `stickerwu imagegen`. Retain the installed plugin ID, skill ID, repository URLs and script paths for in-place upgrades.
- Extend the existing local configuration with named API profiles. Mirror the active profile into the legacy top-level fields so older versions can still read and update it. Never copy a key to a new endpoint implicitly.
- Add profile selection to both CLIs and a local canvas settings dialog. Settings are redacted over HTTP; keys stay on the loopback server and in the user configuration, outside canvas exports.
- Preserve the explicit Submit boundary: saving or switching API settings makes no generation request. Lock settings while a request is running.
- Verify migration, credential isolation, server routes, CLI behavior and the actual settings interface; then install through the native plugin manager and publish the tested source.
