# 投稿记录

目标仓库：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>

建议标题：`Add stickerwu/stickerwu-imagegen`

已提交：[#12880](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/12880)（2026-11-07）。

将同目录 YAML 复制为目标仓库的 `data/plugins/stickerwu__stickerwu-imagegen.yml`，只提交该数据文件，不手改自动生成的 README。本文件本身不应复制到目标仓库。
提交前已确认插件仓库具有 `dsh-plugin` topic，且 README 指向的 `v1.6.1` 标签已发布。

---

Add **stickerwu imagegen**, an MIT-licensed image generation and editing plugin with a native DeepSeek Harness adapter.

- Repository: https://github.com/stickerwu/stickerwu-imagegen
- Category: `vision`
- Native entry: prebuilt ESM package `dsh-stickerwu-imagegen`, Cordis bundle, host tools and attachment services.
- Features: configurable image API connections, Image 2.5/2.6 model selection, reference-image editing, and an on-demand infinite canvas for annotation and iterative edits.
- Installation: versioned Git repository or local tarball; no install-time build scripts. An npm registry release is not required for these installation methods and has not been published.
- Documentation: installation, configuration, privacy, limitations, and troubleshooting are linked from the README. The same repository also contains Codex and Claude Code entries.

Opening a canvas or changing API settings does not generate an image. Paid requests require an explicit action and are never automatically retried. Model, GIF, and output-format availability depend on the configured provider.

The repository was created on 2026-09-09. This submission requests community indexing and does not claim official DeepSeek endorsement.
