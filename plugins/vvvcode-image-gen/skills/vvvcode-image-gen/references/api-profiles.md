# API connections and compatibility (1.5)

The visible name is **stickerwu imagegen**. New installations use
`stickerwu-imagegen@vvvcode-plugins` and the `stickerwu-imagegen` skill.
The legacy `vvvcode-image-gen@vvvcode-plugins` identity remains available for
in-place upgrades; old CLI paths and skill references continue to work.
For an explicitly requested migration to the new invocation name, uninstall the
old plugin and install the new entry. Keep the existing API configuration file.

## Canvas

Open the canvas only when requested. Choose **画布菜单 → API 设置**. Select a
saved connection and click **切换连接**, or choose **新建连接**, enter a name,
HTTPS API base URL and that endpoint's key, then **保存并使用**. The next explicit
generation/edit Submit uses that connection. No model call is made for settings.
The address is an OpenAI-compatible base such as `https://api.example.com/v1`;
the plugin appends `/images/generations` or `/images/edits`, not `/responses`.
The server blocks settings while a request runs. Saved canvases contain only
the endpoint/profile name, never the key. Keys are never returned to the browser.
Only the user's entered key is sent by the local settings form to its loopback server.

Names use 1–64 ASCII letters, digits, dots, underscores or hyphens. A blank key
keeps a saved key only if its endpoint is unchanged. New connections and changed
URLs never inherit another key. `--key-stdin` requires a nonempty key.

## CLI

Resolve these scripts relative to the skill root, never paste the key into argv:

```text
node <generate-script> --list-profiles
node <generate-script> --set-config --profile work --base-url https://api.example.com/v1 --key-stdin
node <generate-script> --use-profile work
node <generate-script> --get-config --profile work
node <generate-script> --profile work --prompt-file prompt.txt
node <annotate-script> --profile work --output-dir outputs
```

For secure PowerShell input, pipe a `Read-Host -AsSecureString` credential's
Password to `--key-stdin`, then remove the temporary variables. Do not put secrets
in scripts, Git, shell arguments or chat. `--get-config` and `--list-profiles` are redacted.

Without `--profile`, startup precedence is explicit `--base-url`, then new
`STICKERWU_IMAGEGEN_BASE_URL` / `STICKERWU_IMAGEGEN_API_KEY`, legacy
`VVVCODE_BASE_URL` / `VVVCODE_API_KEY`, then the active saved profile. Explicit
`--profile` ignores both environment connection pairs; an explicit `--base-url`
still overrides its URL. Saving/switching in the canvas deliberately replaces
startup overrides for that running session. A later process still respects its environment.

A URL-only override never reuses the saved profile's key for a different normalized
endpoint. Supply the corresponding key through the environment or save a separate
profile. With explicit `--profile`, save the matching URL/key in that profile first;
environment keys are intentionally ignored. Equivalent root and `/v1` URLs retain
the saved key. Missing keys fail before any network request.

## Storage and upgrade

The default file stays `~/.config/vvvcode-image-gen/config.json`. Version 1.5
reads the old `{apiKey,baseUrl,model}` structure without requiring migration.
On the first settings write it adds `configVersion:2`, `activeProfile` and
`profiles`, preserving unknown existing fields. It mirrors the active profile's
`apiKey`/`baseUrl` into the original top-level fields for older clients. On load,
top-level fields win for the active profile so an old client can update them.
There is no destructive rename or key copy to another endpoint.

Use `STICKERWU_IMAGEGEN_CONFIG` to explicitly choose a different configuration
file (legacy alias `VVVCODE_CONFIG`). Never set it to a Git-tracked project path.
Keys remain local plaintext: writes request POSIX mode 0600; Windows retains
the containing directory's inherited ACL. The plugin reads no other providers' config.
Configured endpoints must support the selected model IDs and parameters; switching
addresses does not probe models, spend a request, retry, or choose a fallback.
