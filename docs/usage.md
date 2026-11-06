# 安装、配置与排错

适用版本：stickerwu imagegen 1.6.0。三端安装命令见 [README](../README.md#安装)。
插件独立维护，使用公开的宿主插件接口；不代表 OpenAI、Anthropic、DeepSeek 或图片服务商官方出品。

## 三端分别提供什么

| 宿主 | 安装身份 | 入口 | 运行要求 |
| --- | --- | --- | --- |
| Codex | `stickerwu-imagegen@vvvcode-plugins` | `stickerwu-imagegen` 技能 | 本地执行环境、Node.js >=22 |
| Claude Code | `stickerwu-imagegen@stickerwu-plugins` | `/stickerwu-imagegen:stickerwu-imagegen` | Claude Code、Node.js >=22 |
| DeepSeek Harness | `dsh-stickerwu-imagegen` | 四个原生工具及附件预览 | Harness >=0.2.2-rc.1 <0.3.0，桌面版自带运行时 |

Codex 和 Claude 的市场名不同，这是各自的命名空间；显示名都为 **stickerwu imagegen**。
只需安装所使用宿主的入口。两种技能入口不会自动把本机路径上传成 Harness 附件；Harness 适配器通过宿主附件服务实现图片显示。
本版面向 Codex 本地执行和 Claude Code，没有验证 Claude 云端其他产品的运行兼容性。

## 首次配置图片 API

图片密钥与 DeepSeek/Claude/Codex 的聊天模型密钥是两件事。插件默认使用兼容 Images API 的图片服务地址；更换服务商后应提供该服务商自己的密钥。

最方便的方式是在请求中说明“打开 stickerwu imagegen 画布”，进入右上角 **API 设置**：

1. 添加命名连接，填写基础地址，例如 `https://api.example.com/v1`。
2. 填写该地址对应的图片 API 密钥，保存。
3. 切换到该连接，再明确点击生图或提交修改。

保存、切换连接和单纯打开画布不发起图片请求。连接各自保存密钥，变更地址时不继承旧地址的密钥。
一旦开始生成，本次请求使用启动时的连接快照，不能通过中途切换把密钥发送到另一个服务商。

也可通过 CLI 的 `--key-stdin` 配置，完整命令见 [README](../README.md#api-地址与密钥)。不要把密钥放进提示词、命令行参数、截图或 Issue。

默认沿用 `~/.config/vvvcode-image-gen/config.json`，支持通过 `--config`、`STICKERWU_IMAGEGEN_CONFIG` 或旧版配置覆盖路径。
同一电脑上的三端可共享该文件；没有从其他聊天应用或模型配置自动提取密钥的逻辑。
新旧环境变量前缀分别为 `STICKERWU_IMAGEGEN_*` 和 `VVVCODE_*`，具体优先级见 [API 配置说明](../plugins/stickerwu-imagegen/skills/stickerwu-imagegen/references/api-profiles.md)。

## Harness 设置与使用

Harness 原生入口和配置 schema 随包提供，不需要额外安装第二份宿主 SDK。

| 插件配置 | 默认/含义 |
| --- | --- |
| `configPath` | 留空沿用共享配置路径 |
| `profile` | 留空使用图片配置中的当前连接 |
| `outputDir` | 留空写入用户图片目录下的 `stickerwu-imagegen` |
| `timeoutMs` | 单次图片请求超时，默认 300000，范围 1000–1800000 |
| `canvasIdleMs` | 画布空闲关闭，默认 3600000，范围 1000–86400000 |

可直接对 Harness 说：

- “用 stickerwu imagegen 的 sunburst 生成一张蓝色背景的小猫插画。”
- “用 flare 修改我刚上传的图片，只把帽子改成绿色。”
- “打开这张图片的标注画布，我标完后自己提交修改。”
- “查看 stickerwu imagegen 当前连接状态，不要生成图片。”

原生工具：`stickerwu_imagegen_generate`、`stickerwu_imagegen_edit`、`stickerwu_imagegen_canvas`、`stickerwu_imagegen_status`。
编辑/画布可接收本地绝对路径或 Harness 持久附件引用。PNG/JPEG/WebP 结果交给宿主附件服务保存和预览，同时保留原始输出文件；SVG 返回文件路径。
如果图片生成成功但附件预览保存失败，会返回原文件与警告，不重新请求付费生成。

工具的取消信号传递至 POST、结果下载和 SSE。插件卸载会中止当前请求并关闭其画布。
已打开的画布有独立生命周期，不随打开工具那一轮结束而立即关闭。
取消发生前服务商可能已接收请求，能否计费或退款由服务商决定。

## 模型、挡位和 GIF

| 输入 | 实际请求模型 |
| --- | --- |
| `sunburst` | `gpt-image-2.6-sunburst` |
| `flare` | `gpt-image-2.6-flare` |
| `gpt-image-2.5-sunburst` | 原样传递，不切到 2.6 |
| `gpt-image-2.5-flare` | 原样传递，不切到 2.6 |

质量、复杂度、分辨率、格式、压缩和流式参数由共享校验层处理。字段说明和组合限制见 [参数参考](../plugins/stickerwu-imagegen/skills/stickerwu-imagegen/references/image-2.6.md)。
这些是插件接受/发送的参数，不保证每个第三方端点开放相同模型、权限、尺寸和格式。
请以返回字节和实际尺寸为准，不能仅凭 HTTP 200 判定参数全部生效。

GIF 只向显式支持的 2.6 路径发送请求，需要服务商为该账户开通权限；2.5 请求 GIF 会在联网前拒绝。
本项目历史线上 GIF 测试收到 `GIF output is not enabled for this request.`，没有将静态图片冒充动画。
本版跨宿主测试使用模拟图片服务，没有新增付费图片请求，也不增加对 GIF 线上可用性的承诺。

## 更新和兼容旧版

- 原 `vvvcode-image-gen` 插件/技能 ID、配置目录和脚本路径保留；新安装使用 `stickerwu-imagegen`。
- Codex/Claude 刷新各自的市场后更新插件；新开会话让宿主重新载入技能。
- Harness 使用 `dsh plugin --profile desktop add <新版本Git引用或tarball>`，更新后重新加载 profile/重启应用。
- 桌面 `desktop` profile 由 Electron 应用独占管理，不能用另一进程强行 boot 或 dump；使用官方安装命令，不手改 profile 依赖。
- 源码包已预构建，不要求用户允许安装脚本，不要求执行 `npm install` 下载另一份 SDK。
- 卸载插件保留配置、图片和画布会话。删除个人数据请按 [隐私说明](../PRIVACY.md) 操作。

## 常见问题

| 现象 | 排查 |
| --- | --- |
| Harness 看不到工具 | 确认装到当前 profile，插件已启用；重载后检查版本和宿主范围 |
| 原生入口出现 SDK 找不到 | 用 Harness 加载，不要用普通 `node adapters/deepseek-harness/index.mjs`；共享 CLI 不依赖宿主 SDK |
| Node 版本低 | CLI/画布至少 Node 22；Harness 桌面使用其内置运行时 |
| 401 / 403 | 核对当前连接地址、该连接密钥及图片模型权限；不要把密钥发到 Issue |
| 404 | 核对基础路径是否应包含 `/v1`，以及服务商是否实现 `/images/generations` 和 `/images/edits` |
| 400 或 GIF 未开放 | 阅读脱敏后的服务商错误；未自动重试、切模型或转成其他格式 |
| 输出尺寸/格式不符 | 保留原文件及实际尺寸，报告服务商兼容性；不要只改扩展名 |
| 画布打不开 | 使用宿主返回的完整本地 URL，在运行插件的同一台电脑访问；结束/超时后需重新打开 |
| 成功生成但宿主不显示图 | 使用结果中的原文件路径；附件服务失败不会重发付费请求 |

## 反馈问题

[GitHub Issues](https://github.com/stickerwu/stickerwu-imagegen/issues) 或 [Gitee Issues](https://gitee.com/stickerwu/stickerwu-imagegen/issues)。
请附宿主与插件版本、操作步骤、脱敏错误、请求的模型/格式/尺寸及实际输出类型。
不要上传配置文件、密钥、私人照片或带访问令牌的画布 URL。安全问题先用不含敏感细节的 Issue 联系维护者确认私密渠道。
