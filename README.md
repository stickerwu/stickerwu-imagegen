# VVVCode Image Gen

用于 Codex 的生图 / 改图插件，已适配 GPT Image 2.6。v1.2.0 新增**按需打开的无限画布**：
图片框生图、导入图片、圈画改图、并排比较、保存后重新打开。
普通生图和改图继续直接调用 API；只有需要画布时才启动本地网页。
同时支持原生 GIF 请求和透明 PNG 标注层改图：

| 参数 | 模型 |
| --- | --- |
| `sunburst`（默认） | `gpt-image-2.6-sunburst` |
| `flare` | `gpt-image-2.6-flare` |

显式指定 `gpt-image-2.5-sunburst` 或 `gpt-image-2.5-flare` 时仍调用 2.5，不静默迁移。

这是一份独立实现，交互思路参考 Niu Image Gen；没有复制其代码、品牌资产或密钥。
不是 VVVCode 或 OpenAI 官方插件。2.6 模型 ID 与 OpenAI 官方文档一致；中转服务权限和参数兼容性仍需分别验证。

## 两种模式

| 模式 | 默认请求地址 | 请求格式 |
| --- | --- | --- |
| 生图 | `https://apis.vvvcode.com/v1/images/generations` | JSON |
| 改图 | `https://apis.vvvcode.com/v1/images/edits` | multipart/form-data，上传图片文件 |

改图不会降级为 generations。默认 `size=auto`，不继承生图尺寸；
这让服务端决定尺寸，**不保证精确保留原图尺寸或人物**。
有精确尺寸要求时使用 `--size WIDTHxHEIGHT`，服务端不支持时会直接报错。

## 兼容性状态

2026-11-06 已实际读取 OpenAI 官方文档，确认 2.6 支持 GIF 和 markup 标注改图。
本地协议测试通过，但这不代表 VVVCode 已开放全部功能。

GIF 线上验收使用 2.6 Sunburst：15 帧、每帧 200 ms、512×512、high quality、medium complexity。
VVVCode 返回 HTTP 400：`GIF output is not enabled for this request.` **没有生成 GIF，也没有重试。**
官方 API 参考注明 GIF 需要对应模型的预览权限；需由服务商核实当前账户/渠道是否开放。
另一次用户授权的线上标注改图使用 2.6 Sunburst：上传原图和独立透明 PNG 标注层，
medium quality、low complexity、请求 1024×1024。结果将目标红圆改为黄色，
标注圈未出现，文字与整体布局保留；但输出为 1254×1254，蓝/绿对照图形有轻微颜色和质感变化。
因此可确认带标注层的改图请求成功返回并完成主要改色，不能承诺尺寸严格遵从或像素级保留。
Flare GIF、Flare 标注改图、2.6 静态生图和透明背景未做线上验证。

2026-09-09 对旧版 2.5 Sunburst 透明改图的三次 400 是历史记录，不适用于推断 2.6。
详细字段与官方来源见 [兼容性说明](plugins/vvvcode-image-gen/skills/vvvcode-image-gen/references/image-2.6.md)。

## 安装

要求 Node.js 22 或以上，无第三方 npm 依赖。

代码镜像：[GitHub](https://github.com/stickerwu/vvvcode-image-gen) ·
[Gitee](https://gitee.com/stickerwu/vvvcode-image-gen)。

克隆或下载本仓库，在仓库根目录运行：

```sh
codex plugin marketplace add .
codex plugin add vvvcode-image-gen@vvvcode-plugins
```

仓库包含 `.agents/plugins/marketplace.json`，插件位于
`plugins/vvvcode-image-gen`。本地市场注册和插件安装命令已在开发环境验证。
安装后新建一个 Codex 任务使用插件，也可以直接使用下面的 CLI。

## 密钥

推荐在启动 Codex / 运行脚本的环境设置 `VVVCODE_API_KEY`。
`.env.example` 仅为变量说明；脚本不会自动读取 `.env`。
不要把真实密钥放进项目、命令参数、Git 或聊天消息。

也可在 PowerShell 中隐藏输入并通过 stdin 保存到项目外：

```powershell
$vvvSecureKey = Read-Host 'VVVCode API Key' -AsSecureString
$vvvCredential = [System.Net.NetworkCredential]::new('', $vvvSecureKey)
$vvvCredential.Password | node plugins/vvvcode-image-gen/scripts/generate.mjs --key-stdin
Remove-Variable vvvSecureKey, vvvCredential
```

配置位置：`~/.config/vvvcode-image-gen/config.json`。
保存的密钥是本地明文；POSIX 写入权限为 0600，Windows 使用目录继承的 ACL。
插件不读取 Niu 或其他服务商配置。

```sh
node plugins/vvvcode-image-gen/scripts/generate.mjs --get-config
node plugins/vvvcode-image-gen/scripts/generate.mjs --set-config --model flare
```

## 使用

```sh
# 生图
node plugins/vvvcode-image-gen/scripts/generate.mjs --prompt "一只穿宇航服的小猫" --model sunburst --output-dir outputs

# 改图（默认 auto 尺寸）
node plugins/vvvcode-image-gen/scripts/generate.mjs --edit --image source.png --prompt "只把帽子改成绿色" --model flare

# 遮罩编辑，需服务端支持
node plugins/vvvcode-image-gen/scripts/generate.mjs --edit --image source.png --mask mask.png --prompt "修改遮罩区域"

# 多参考图：同一编辑请求，非批量逐张改图
node plugins/vvvcode-image-gen/scripts/generate.mjs --edit --image first.png --image second.png --prompt "参考两张图片的配色"

# 复杂提示词：UTF-8 文件，避免多层 shell 引号
node plugins/vvvcode-image-gen/scripts/generate.mjs --edit --image source.png --prompt-file prompt.txt --size 1024x1536

# 原生 3 秒 GIF：15 帧 × 200 ms，需服务商开放 GIF 权限
node plugins/vvvcode-image-gen/scripts/generate.mjs --prompt-file cat-loop.txt --output-format gif --frame-count 15 --frame-duration-ms 200 --size 512x512

# 标注改图：原图和同尺寸的透明 PNG 标注层分别上传
node plugins/vvvcode-image-gen/scripts/generate.mjs --edit --image original.png --markup annotations.png --prompt-file edit.txt --model flare
```

## 按需无限画布：生图、标注与连续改图

需要画布时再运行；普通 `generate.mjs` 不启动网页：

```sh
# 从已有图片开始
node plugins/vvvcode-image-gen/scripts/annotate.mjs --image result.png --output-dir outputs --model sunburst --open

# 空白画布：创建 AI 图片框后再生图
node plugins/vvvcode-image-gen/scripts/annotate.mjs --output-dir outputs --model sunburst --open

# 重新打开已经“保存并结束”的画布
node plugins/vvvcode-image-gen/scripts/annotate.mjs --session outputs/review-SESSION-ID --open
```

Agent 使用时读取 `ready` JSON 事件中的 URL，自动打开网页并交给用户；
`--open` 可直接打开系统默认浏览器。无需创建项目、搭建网页或安装前端依赖。

交互参考 [Cowart](https://github.com/zhongerxin/cowart) 的图片框与并排迭代方式，
采用本插件独立实现的本地网页，沿用 VVVCode API，无需安装 Cowart。

- 无限画布支持拖动图片、调整大小、平移、缩放与适应全部图片。空格＋拖动平移，Ctrl / ⌘＋滚轮缩放。
- **＋ AI 图片框**：选择比例、填写描述，点击 **生成图片** 调用 `/v1/images/generations`，结果填入该框。
- 选中图片，使用画笔、圈选、矩形、箭头或文字标注，填写要求后点击 **按标注修改**，调用 `/v1/images/edits`。
- 新版本放在原图旁边并连线，原图及其标注保留。可选中任意图片继续下一轮，也可只写文字改图。
- 支持导入、拖入和粘贴本地图片，下载图片与透明标注层；每张图片单独保存标注和提示词。

打开、导入、画图、保存和恢复均不发起付费请求；每次有效提交只请求一张 PNG，
防止重复及并发提交，失败不自动重试。结果使用实际返回尺寸，不假设服务端严格遵守所选比例。

原图与透明标注层分别发送；画布按底图实际尺寸导出标注，不受页面缩放影响。
PNG 使用原文件，JPEG/WebP 在浏览器中校正方向后导出未带标注的 PNG 作为原图。
每个 `review-<id>` 输出目录保存原图、导入图片、每轮标注、修改要求、生成结果与 `session.json`。
`canvas.json` 保存相机位置、缩放、图片框布局、草稿和矢量标注；刷新后可恢复。
网页密钥保留在本地服务端，仅监听 `127.0.0.1`。

本地服务运行期间，用户提交后不需要回聊天再发指令，API 改图由插件服务自动执行。
结果显示在网页和本地目录；聊天本身不会因网页提交自动唤醒或自动发消息。
网页标注目前面向静态 PNG/JPEG/WebP，输出 PNG；GIF 使用常规 CLI。
点击 **保存并结束** 停止服务，之后可通过 `--session` 重新打开并继续；
未正常结束的会话拒绝自动恢复，避免重放状态不明的付费请求。
只关闭标签页不会立即退出，一小时无操作后自动退出。
可用 `--idle-timeout` 调整毫秒数；进行中的 API 请求不会因空闲计时被中断。
更多 CLI 选项见 `annotate.mjs --help`。

## API 参数

GIF 可通过 generations 直接生成，也可通过 edits 上传静态参考图来引导动画。
GIF 默认 `size=auto`，帧数范围 2–16，CLI 帧间隔范围 20–2000 ms，按 10 ms 编码。
脚本保存真实 GIF 返回字节并读取帧数、总时长、帧间隔和循环元数据；不会把 PNG 改后缀冒充 GIF。
GIF 不支持 mask、流式输出、partial images、自定义压缩或 prompt rewriter。

`markup` 是独立透明 PNG，作用于第一张输入图；与其方向校正后的尺寸一致，含透明像素，
两者各不超过 16,777,216 像素，标注层不超过 50 MB。不得同时使用 markup 与 mask。
PNG 原图的标注层透明度与尺寸会在本地检查；JPEG/WebP 原图的方向校正尺寸由服务端验证。

可选参数：`--count 1..4`、`--quality VALUE`、`--timeout 300000`（毫秒）、
`--base-url https://apis.vvvcode.com/`、`--output-dir outputs`。
新增 `--complexity low|medium|high`（规划复杂度，与 quality 独立）。
`--resolution 4K` 遵守 3840 单边和 8,294,400 总像素限制，不再输出超限的 4096 单边。
Base URL 支持根地址或 `/v1` 后缀，不重复拼接。
优先级：命令行 > 环境变量（地址、密钥） > 本地配置 > 默认值。
不设置模型质量默认值，避免为未知服务端强加不兼容参数。

支持静态 PNG/JPEG/WebP 输入、PNG/JPEG/WebP/GIF 输出及 `b64_json` / HTTPS URL 结果。
下载结果时不向 CDN 转发 API Key；拒绝重定向。
每次请求都可能计费；超时后不会自动重试，以免重复扣费。
stdout 输出可直接解析的 JSON，包含绝对文件路径和验证元数据；进度写入 stderr。

## 开发与验收

```sh
npm test
npm run check
```

测试使用模拟响应，不需要密钥、不计费，覆盖 JSON 生图、multipart 改图、
默认尺寸隔离、GIF 字段与真实文件、GIF 时长/循环检查、标注层独立上传、参数互斥、
图片落盘、CDN 密钥隔离和错误处理。
网页会话测试覆盖多轮结果衔接、透明标注独立上传、实际尺寸变化、
重复提交去重、并发限制、失败保留、密钥脱敏、文本编辑、本地路由边界、
空白图片框生图、图片导入、布局保存与已结束画布的恢复。
GitHub Actions 配置 Windows / Linux、Node 22 / 24 测试。

线上验收状态见上方兼容性说明。改图应使用可辨认的输入，只修改单一元素，
对比身份、姿势、尺寸和透明通道；检查完成前不要声称精准改图已经可用。

## 隐私与许可

提示词、输入图片和遮罩会发送到所配置的 API 服务商。
只发布代码，不发布用户输入图片、生成结果或密钥。
MIT，见 [LICENSE](LICENSE)。
