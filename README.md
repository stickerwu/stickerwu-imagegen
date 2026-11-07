# stickerwu imagegen

在 **Codex、Claude Code 和 DeepSeek Harness** 中调用可配置的 OpenAI-compatible 图片 API，完成生图、参考图编辑和带透明标注层的改图。需要连续修改时，再打开本地无限画布；用户每次明确提交只发起一次图片请求。

项目原名 **VVVCode Image Gen**，v1.6.0 保留旧安装入口，同时提供 Claude Code 原生插件和 DeepSeek Harness 原生 bundle。

## 适合什么场景

| 需求 | 入口 |
| --- | --- |
| 一次生图或改图 | Codex skill、Claude skill，或 `generate.mjs` |
| 多轮圈画、文字标注、参考图和比较 | `annotate.mjs` 本地无限画布 |
| DeepSeek Harness 工具调用 | `stickerwu_imagegen_generate`、`_edit`、`_canvas`、`_status` |
| 2.5 / 2.6 模型切换 | 每次请求显式指定模型，旧配置继续可用 |

### 支持的模型 ID

| 简写 | 实际模型 |
| --- | --- |
| `sunburst`（默认） | `gpt-image-2.6-sunburst` |
| `flare` | `gpt-image-2.6-flare` |
| 显式 2.5 | `gpt-image-2.5-sunburst` 或 `gpt-image-2.5-flare` |

显式指定 2.5 时不会静默切换到 2.6。质量、复杂度、分辨率、输出格式、压缩和流式预览可以按图片框独立设置。

## 快速开始

先配置一个 OpenAI-compatible API 地址和图片 API 密钥，然后按使用的宿主安装：

```sh
# Codex
codex plugin marketplace add stickerwu/stickerwu-imagegen
codex plugin add stickerwu-imagegen@vvvcode-plugins

# Claude Code
/plugin marketplace add stickerwu/stickerwu-imagegen
/plugin install stickerwu-imagegen@stickerwu-plugins

# DeepSeek Harness
dsh plugin --profile desktop add github:stickerwu/stickerwu-imagegen#v1.6.0
```

安装后可以直接提出“生成一只小猫”或“把这张图里的帽子改成绿色”。需要手工标注时运行：

```sh
node plugins/vvvcode-image-gen/scripts/annotate.mjs --image result.png --open
```

画布支持图片导入、圈选、箭头、文字、橡皮擦、参考图、撤销重做和重新打开；点击“按标注修改”后，插件会把原图和独立透明 PNG 标注层发送到编辑端点。

## 运行要求

- Node.js 22+；普通 CLI 和画布不需要第三方运行时依赖。
- DeepSeek Harness `>=0.2.2-rc.1 <0.3.0`；使用宿主自带 SDK，不安装第二份 Harness SDK。
- API 地址需要兼容图片 generations / edits 端点；地址、密钥和 profile 可在画布设置中配置，也可使用环境变量。
- GIF、透明背景、mask、流式预览和部分输出格式取决于实际服务商权限与中转实现。

这是一份独立实现，画布的浅灰、白、蓝视觉和悬浮布局参考 Cowart；没有复制其代码、品牌资产或密钥。项目不是 VVVCode、OpenAI、Anthropic 或 DeepSeek 官方出品，也不代表任何官方市场审核或服务商能力承诺。

使用文档：[三端配置与排错](docs/usage.md) · [市场收录与官方目录](docs/marketplaces.md) ·
[维护与发布](docs/releases.md) · [更新记录](CHANGELOG.md) · [隐私](PRIVACY.md) · [使用条款](TERMS.md)。

## 两种模式

| 模式 | 默认请求地址 | 请求格式 |
| --- | --- | --- |
| 生图 | `https://apis.vvvcode.com/v1/images/generations` | JSON |
| 改图 | `https://apis.vvvcode.com/v1/images/edits` | multipart/form-data，上传图片文件 |

改图不会降级为 generations。默认 `size=auto`，不继承生图尺寸；
这让服务端决定尺寸，**不保证精确保留原图尺寸或人物**。
有尺寸要求时使用 `--size WIDTHxHEIGHT`；部分渠道可能忽略该值，
必须核验实际返回尺寸，再判断是否满足要求。

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
1.4.0 另外执行了两次真实请求，每种模型一次，没有重试：

| 请求 | 实际结果 |
| --- | --- |
| Sunburst，max / medium，2048×2048 PNG，stream=true，partial_images=2 | HTTP 200 SSE，最终 PNG **1218×1292**；没有返回中间预览事件 |
| Flare 改图，high / low，1536×1024 JPEG，output_compression=80 | HTTP 200，但实际图片字节为 **PNG**，插件报告格式不符，不宣称 JPEG 成功 |

因此已验证 Sunburst 静态生图与 SSE 最终结果接收；尚不能保证尺寸或格式被此渠道遵从。
质量/复杂度字段已发送，但单次图像不能证明各挡位的视觉差异。
SVG、JPEG/WebP 压缩、中间预览和参数组合的本地/模拟测试通过；未声称全部通过线上验收。
Flare GIF、Flare 标注改图、2.6 透明背景和 mask 尚未做线上验证。

2026-09-09 对旧版 2.5 Sunburst 透明改图的三次 400 是历史记录，不适用于推断 2.6。
详细字段与官方来源见 [兼容性说明](plugins/vvvcode-image-gen/skills/vvvcode-image-gen/references/image-2.6.md)。

## 安装

共享图片 CLI / 画布要求 Node.js 22 或以上，无第三方运行时依赖。
DeepSeek Harness 原生适配器使用宿主 SDK，支持 **Harness >=0.2.2-rc.1 <0.3.0**；Harness 自身的 Node 要求以其官方发行包为准，桌面版自带运行时。
不需要安装第二份 Harness SDK，不会把 DeepSeek 聊天模型密钥当作图片 API 密钥。

代码镜像：[GitHub](https://github.com/stickerwu/stickerwu-imagegen) ·
[Gitee](https://gitee.com/stickerwu/stickerwu-imagegen)。

### Codex

克隆或下载本仓库，在仓库根目录运行：

```sh
codex plugin marketplace add .
codex plugin add stickerwu-imagegen@vvvcode-plugins
```

仓库包含 `.agents/plugins/marketplace.json`，新版插件位于
`plugins/stickerwu-imagegen`，技能调用名也是 `stickerwu-imagegen`。
`plugins/vvvcode-image-gen` 继续提供旧 ID 更新入口。本地市场注册和插件安装命令已在开发环境验证。
安装后新建一个 Codex 任务使用插件，也可以直接使用下面的 CLI。

### Claude Code

在 Claude Code 中使用原生插件市场命令：

```text
/plugin marketplace add stickerwu/stickerwu-imagegen
/plugin install stickerwu-imagegen@stickerwu-plugins
```

新会话中调用 `/stickerwu-imagegen:stickerwu-imagegen`，或直接提出生图 / 改图请求。
仓库根目录的 `.claude-plugin/marketplace.json` 指向带有原生 `.claude-plugin/plugin.json` 的同一份插件目录。
Gitee 用户可先克隆镜像，再用 `/plugin marketplace add <本地仓库绝对路径>`。

### DeepSeek Harness

根 npm 包名为 **`dsh-stickerwu-imagegen`**；这是预构建 ESM bundle，不依赖安装时执行构建脚本。
在 Harness CLI 可用的终端中，安装到实际使用的 profile（桌面默认 `desktop`）：

```sh
dsh plugin --profile desktop add github:stickerwu/stickerwu-imagegen#v1.6.0
```

Gitee 镜像：

```sh
dsh plugin --profile desktop add git+https://gitee.com/stickerwu/stickerwu-imagegen.git#v1.6.0
```

也可以在源码目录生成并安装经过检查的离线包；`pack:verify` 打印实际 tarball 绝对路径：

```sh
npm run build
npm run pack:verify
dsh plugin --profile desktop add <打印出的-dsh-stickerwu-imagegen-1.6.0.tgz-绝对路径>
```

安装后重新加载该 profile / 重启 Harness。CLI 负责维护 profile 依赖和 bundle 顺序，无需手工改宿主配置。
需要移除时运行 `dsh plugin --profile desktop remove dsh-stickerwu-imagegen`，已有 API 连接和图片文件保留。
当前没有发布 npm 注册表包，也没有声称已通过官方插件市场审核；Git 仓库和 tarball 均可安装。

| Harness 原生工具 | 用途 |
| --- | --- |
| `stickerwu_imagegen_generate` | 一次明确调用发起一次生图请求 |
| `stickerwu_imagegen_edit` | 本地图片路径或 Harness 图片附件引用改图，可加 mask 或透明 markup |
| `stickerwu_imagegen_canvas` | 按需打开无限画布；支持上传附件、圈画、文字标注和用户提交后的迭代 |
| `stickerwu_imagegen_status` | 只读查看连接与模型，不回传密钥、不调用图片 API |

示例：“用 stickerwu_imagegen_generate，model 设为 gpt-image-2.5-flare，画一只小猫”。
指定 2.5 时保持该模型，只有 `sunburst` / `flare` 简写指向 2.6。GIF / SVG 需要 2.6 和服务商开放权限。
原生工具返回原始图片文件路径及真实尺寸；栅格图片另外保存为 Harness 持久附件，供原生图片预览使用。
预览存储失败时保留成功图片并返回警告，不重试生图。SVG 返回文件路径，不冒充栅格附件。

Harness 插件配置使用 Schemastery：`configPath`（可选配置文件）、`profile`（可选命名连接）、
`outputDir`（默认 `~/Pictures/stickerwu-imagegen`）、`timeoutMs`、`canvasIdleMs`。
API 地址与密钥沿用本插件的独立配置；初次配置可请求打开画布，在 **API 设置** 中本地填写。
打开画布、读取状态、保存 / 切换连接均不产生图片请求。前台请求支持 Harness 取消，下载和 SSE 也会停止。
已打开的画布在工具返回后继续运行，用户 Finish、闲置超时或插件卸载时关闭。

原生格式依据：[Harness 官方插件教程](https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/user/develop/basic)、
[工具契约](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md)、
[Claude Code 插件参考](https://code.claude.com/docs/en/plugins-reference)。

## API 地址与密钥

画布菜单中的 **API 设置** 可新建连接、设置 API 地址和独立密钥，再点击 **保存并使用**；
也可选择已有连接后点击 **切换连接**。设置操作不发起生图，下一次明确提交才调用所选 API。
更换地址不会自动沿用旧密钥。保持 Cowart 风格的浅灰、白色面板和蓝色按钮。

也可在环境中设置 `STICKERWU_IMAGEGEN_API_KEY` / `STICKERWU_IMAGEGEN_BASE_URL`。
旧的 `VVVCODE_API_KEY` / `VVVCODE_BASE_URL` 仍有效，新名称优先。
`.env.example` 仅为变量说明；脚本不会自动读取 `.env`。
不要把真实密钥放进项目、命令参数、Git 或聊天消息。

也可在 PowerShell 中隐藏输入并通过 stdin 保存到项目外：

```powershell
$vvvSecureKey = Read-Host 'stickerwu imagegen API Key' -AsSecureString
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
node plugins/vvvcode-image-gen/scripts/generate.mjs --set-config --profile work --base-url https://api.example.com/v1 --key-stdin
node plugins/vvvcode-image-gen/scripts/generate.mjs --list-profiles
node plugins/vvvcode-image-gen/scripts/generate.mjs --use-profile work
node plugins/vvvcode-image-gen/scripts/annotate.mjs --profile work --output-dir outputs
```

`--profile NAME` 在生图和画布 CLI 中均可使用，显式选择该连接时不读取环境中的地址/密钥。
`--base-url` 仍可临时覆盖地址；换成不同地址时不会沿用已保存的密钥，须同时配置对应密钥或单独保存连接。
API 需兼容 OpenAI 图片端点及所选模型；填写 HTTPS 基础地址即可。
完整优先级与配置格式见 [API 连接说明](plugins/vvvcode-image-gen/skills/vvvcode-image-gen/references/api-profiles.md)。

### 从旧版更新

显示名已改为 `stickerwu imagegen`，**安装 ID 继续保留 `vvvcode-image-gen@vvvcode-plugins`**，
因此原安装可以直接更新。v1.5.1 另提供 `stickerwu-imagegen@vvvcode-plugins` 新安装入口，
希望技能调用名也改为 `stickerwu-imagegen` 时，先卸载旧入口，再安装新入口，避免同时启用两份。
原脚本路径、旧技能 ID 和旧环境变量继续有效。仓库现名为 `stickerwu-imagegen`。
原 `~/.config/vvvcode-image-gen/config.json` 无需移动或重新输入密钥；首次保存时扩展为多连接格式，
并保留旧版能读取的顶层 `apiKey`、`baseUrl`、`model`。旧画布仍可用 `--session` 打开。

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

界面配色、悬浮面板和主要交互参考 [Cowart](https://github.com/zhongerxin/cowart)，
采用本插件独立实现的本地网页，沿用 VVVCode API，无需安装 Cowart。

- 浅灰画布、白色浮层、灰黑图标与蓝色选中态；左上画布菜单，右上样式面板，底部可拖动工具栏。
- 支持单选、Shift 多选、拖框多选、整体拖动、四角等比缩放。空白处点击取消选择；空格 / 抓手 / 中键拖动平移，Ctrl / ⌘＋滚轮缩放。
- **AI 图片框**（快捷键 A）：选择比例，在图片框下方输入描述，点击 **生成图片** 或按 Enter 提交。Shift+Enter 换行，中文输入法确认字词时不提交。
- 无参考图的新图调用 `/v1/images/generations`；主动添加参考图时调用 `/v1/images/edits`，并将结果填回该框。不是失败后的协议降级。
- 选中图片，使用画笔、圈选、矩形、箭头或文字标注。文字直接在图上输入，Enter 完成、Shift+Enter 换行、Esc 取消；橡皮擦移除命中的整条标注。
- 点击图片下方 **按标注修改** 打开输入面板，再发送一次修改请求，调用 `/v1/images/edits`。已有文字标注时可使用默认的按标注修改指令；也可以补充要求。
- 新版本放在原图旁边并连线，原图及其标注保留。可选中任意图片继续下一轮，也可只写文字改图。
- 输入面板支持最多 4 张参考图，从画布选择、电脑导入或直接粘贴。改图时先上传当前原图，再上传参考图；透明标注仅作用于当前原图。
- 顶部撤销 / 重做支持标注、移动、缩放、复制与删除图片框。Ctrl/⌘ D 复制，Delete 删除画布上的框；原始图片文件保留。撤销和重做均不会重新请求 API。
- 支持导入、拖入和粘贴本地图片，下载图片与透明标注层；每张图片单独保存标注、提示词和参考图选择。

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

## 1.4 参数面板与输出

在图片下方展开参数摘要，设置仅应用于当前框，随画布保存/恢复。
质量支持 `auto / low / medium / high / xhigh / max`，复杂度支持 `low / medium / high`，
两者独立；“模型默认”表示不发送该可选字段。

分辨率提供自动、1K、2K、4K 和自定义。预设保留所选比例并取 16 的倍数；
仍图采用保守范围：边长不超过 3840、比例 1:3–3:1、655360–8294400 像素。
4K 方图为 2880×2880，16:9 为 3840×2160；窄比例 1K 为满足最低像素数可能略大于 1024。
这是请求尺寸，结果仍显示文件真实尺寸。GIF 不应用仍图最低像素数，模型总预算由上游校验。

```sh
node plugins/vvvcode-image-gen/scripts/generate.mjs --prompt-file prompt.txt --model flare --quality high --complexity low --resolution 2K --ratio 3:4 --output-format webp --output-compression 80
node plugins/vvvcode-image-gen/scripts/generate.mjs --prompt-file prompt.txt --stream --partial-images 2 --output-dir outputs
node plugins/vvvcode-image-gen/scripts/generate.mjs --prompt-file icon.txt --output-format svg --count 1
```

- JPEG/WebP 支持 `--output-compression 0..100`，0 会原样发送；该字段是编码质量，与渲染质量独立。
- `--stream` 启用 SSE，`--partial-images 0..3` 指定预览数量；0 仍接收最终结果。
  CLI 将预览存入单独文件并向 stderr 输出进度，stdout 仍只有最终 JSON。
  网页将预览放在独立浮窗，最终结果才进入画布。中断/错误流不将预览当成完成。
- SVG 按较严格的官方指南仅开放无参考图的 generations、n=1，不支持流式、压缩、mask。
  保存原始 SVG 字节，使用 `image/svg+xml`；页面通过图片元素查看和下载，
  不隐式栅格化进入标注。主动脚本/外部资源被拒绝。
- PNG/JPEG/WebP 可继续标注改图；SVG/GIF 结果只查看和下载。GIF 权限限制见上文。
- 返回格式不一致时保留 `unexpected-<id>.<实际格式>` 作为证据，报错且不将其当成成功结果，
  不改扩展名、不转码、不自动重试。
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
补充覆盖参考图路由、删除框记录、独立撤销快照、橡皮擦命中与中文输入法提交保护。
1.4.0 浏览器验收使用模拟 API，覆盖参数切换、4K/自定义尺寸、越界拦截、
流式预览、刷新恢复与 SVG 查看。两次真实 API 请求的范围和限制见兼容性状态。
GitHub Actions 配置 Windows / Linux、Node 22 / 24 测试。

线上验收状态见上方兼容性说明。改图应使用可辨认的输入，只修改单一元素，
对比身份、姿势、尺寸和透明通道；检查完成前不要声称精准改图已经可用。

## 隐私与许可

提示词、输入图片和遮罩会发送到所配置的 API 服务商。
只发布代码，不发布用户输入图片、生成结果或密钥。
详细数据流、凭据保存和清理方式见 [PRIVACY.md](PRIVACY.md)；问题反馈见 [使用文档](docs/usage.md#反馈问题)。
MIT，见 [LICENSE](LICENSE)。
