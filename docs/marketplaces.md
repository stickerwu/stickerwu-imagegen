# 市场收录与官方目录

核对日期：2026-11-07。市场规则可能变化，正式提交前重新打开下面的一手来源。
**符合插件格式、能安装、自建市场可分发、进入官方目录，是不同状态。** 本文不代表任何平台的收录承诺。

## 当前状态

| 平台/渠道 | 本项目提供的内容 | 尚需处理 |
| --- | --- | --- |
| DeepSeek Harness | 原生工具、Config schema、Cordis bundle、预构建包、Git/tarball 安装 | 社区索引需要维护者审核收录 PR |
| Codex 自建市场 | `.agents/plugins/marketplace.json` 和独立插件目录，保留旧 ID | 用户添加本项目市场即可安装；不等于官方目录上架 |
| Claude Code 自建市场 | `.claude-plugin/marketplace.json` 和原生插件清单 | 用户添加 `stickerwu/stickerwu-imagegen` 后安装；不等于官方目录上架 |
| Codex 官方精选 | 可检查的源代码、隐私/条款/支持文档、原生清单 | 官方 README 未给出自动收录入口；不能把自建市场安装当作官方收录 |
| Claude 官方市场 | 公开源码、自建市场、原生清单及说明文档 | 官方收录表单与质量/安全审核；未提交、未获批 |

根包 `dsh-stickerwu-imagegen` 未发布 npm registry。Harness 的官方包安装机制支持 Git 与本地 tarball，因此不应把一个尚未发布的 npm 名称当作可用安装命令。

## awesome-dsh-plugin 收录

用户指定的贡献规则：[contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)。
这是一个以 PR 维护的插件收录仓库；收录不应表述为 DeepSeek 官方安全认证或官方背书。

规则中与本项目有关的要求：

1. 仓库公开，且创建至少一天。
2. 根包或子包声明真实的 `dsh.bundle`，提供可工作代码并保持维护；向仓库添加 `dsh-plugin` topic。
3. 在索引的 `data/plugins/` 新增 `owner__repo.yml`，填写 `url`、`name`、有效 `category` 与 `description.en`；中文描述可选。
4. 描述简洁客观；分类使用允许值。按其贡献规范发起 PR，由维护者审核。

本仓库创建于 **2026-09-09**，已超过一天，许可 MIT。当前功能选择有效分类 `vision`。
2026-11-07 检查时尚未在索引中收录；已为本仓库添加并核验 `dsh-plugin` topic。
准备好的条目为 [stickerwu__stickerwu-imagegen.yml](submissions/awesome-dsh-plugin/stickerwu__stickerwu-imagegen.yml)，
投稿正文为 [PR 说明](submissions/awesome-dsh-plugin/PR.md)。
投稿时只把 YAML 放到目标仓库的 `data/plugins/stickerwu__stickerwu-imagegen.yml`，不要手改其自动生成的 README，也不要复制本项目的全部源码。

本项目有原生 Harness 入口，不是让 Harness 执行 Codex 专用技能。目标索引的 YAML 只描述项目，不是 Harness 运行时插件清单。
Git 标签及镜像存在后，条目中的安装说明可直接使用 README 中的固定版本引用。
贡献指南明确 npm 发布可选，未发布 npm 不影响收录；本项目源码已预构建，可从 Git 安装。
官方 `@deepseek-ai/*` 依赖保持为宿主 peer，不捆绑第二套 SDK；兼容范围显式包含已测试的预发布版本。

## Codex：自己的市场与官方目录

自己的市场可供用户安装：保留市场 JSON、可访问的插件源码和稳定版本，通过市场注册/安装流程分发。
本地 Node CLI 和画布需要本地执行环境，不声称支持没有本地执行环境的宿主。

本次实际读取 OpenAI 官方 GitHub 组织的 `openai/plugins` README：该仓库明确称为策划精选的 Codex 插件示例集合，
规定 `.codex-plugin/plugin.json` 及 `.agents/plugins/marketplace.json` 等结构，但该 README 没有给出“创建自己的市场后自动进入官方目录”的规则，
也没有提供可在本次确认的统一自助收录表单。因此官方精选入口标记为待进一步核实，不编造申请门户、账户条件或审核承诺。

访问 OpenAI 的 Codex 插件文档站点时，本次环境返回 HTTP 403；未把无法读取的页面当作已核验资料，
也没有用 ChatGPT 其他产品的插件发布流程代替 Codex 的收录流程。
目前可以确认的是本项目有独立的 Codex 市场与本地安装入口；官方精选需要其维护方实际接受，不能由本项目自行宣称。

一手来源：

- [Codex 插件文档](https://developers.openai.com/codex/plugins/)
- [OpenAI 官方插件示例仓库](https://github.com/openai/plugins)

## Claude：自己的市场与官方目录

Claude Code 的自建市场可直接从 GitHub 仓库添加。本项目的根 marketplace 指向同一份共享插件，
原生 Claude manifest 只包含 Claude 支持的字段，不透传 Codex 的 `interface` 或本地执行声明。

官方 `anthropics/claude-plugins-official` README 明确提供第三方收录通道：
使用其链接的 [plugin directory submission form](https://clau.de/plugin-directory-submission)，并接受质量与安全审核。
表单要求的联系信息和其他资料按实际页面填写；本次没有代填个人信息或提交申请。
把项目放进自己命名的 marketplace，并不会自动加入 Anthropic 官方目录或 `claude-plugins-official` 仓库。
宿主 CLI 校验通过说明目录和清单有效，不代表人工审核通过，也不能推断 Claude 所有产品均可执行本地 Node 功能。

一手来源：

- [Claude 插件市场参考](https://code.claude.com/docs/en/plugins/marketplace-reference)
- [Claude 插件参考与校验](https://code.claude.com/docs/en/plugins-reference)
- [Anthropic 官方市场与投稿说明](https://github.com/anthropics/claude-plugins-official#external-plugins)
- [官方 README 指向的投稿表单](https://clau.de/plugin-directory-submission)

## 提交前检查

- 公开仓库和固定版本安装地址实际可访问，三个入口版本一致，GitHub/Gitee 镜像一致。
- README、安装、API 配置、隐私、条款、支持和限制可直接访问；不夹带真实配置、图片或密钥。
- 按 [发布流程](releases.md) 完成构建一致性、测试、真实 SDK/安装包检查。
- DSH 投稿核对 topic 与索引条目字段；官方精选/目录以实际接受的入口、材料和当时规则为准。
- 记录提交/审核状态；没有拿到结果前，不把“材料已准备”写成“已上架”。
