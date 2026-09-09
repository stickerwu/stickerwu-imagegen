# VVVCode Image Gen

用于 Codex 的生图 / 改图插件，支持 VVVCode 的两个模型：

| 参数 | 模型 |
| --- | --- |
| `sunburst`（默认） | `gpt-image-2.5-sunburst` |
| `flare` | `gpt-image-2.5-flare` |

这是一份独立实现，交互思路参考 Niu Image Gen；没有复制其代码、品牌资产或密钥。
不是 VVVCode 或 OpenAI 官方插件。模型名称是服务商标识。

## 两种模式

| 模式 | 默认请求地址 | 请求格式 |
| --- | --- | --- |
| 生图 | `https://apis.vvvcode.com/v1/images/generations` | JSON |
| 改图 | `https://apis.vvvcode.com/v1/images/edits` | multipart/form-data，上传图片文件 |

改图不会降级为 generations。默认 `size=auto`，不继承生图尺寸；
这让服务端决定尺寸，**不保证精确保留原图尺寸或人物**。
有精确尺寸要求时使用 `--size WIDTHxHEIGHT`，服务端不支持时会直接报错。

## 兼容性状态

截至 2026-09-09：本地协议/文件测试通过；已用 VVVCode 密钥对 sunburst 改图进行线上测试。
服务商模型页的示例显示聊天接口，同时列出图片参数，信息不一致。
本插件按独立 Images 接口实现，但不能据此断言这两个模型都已支持透明 edits。
线上结果：sunburst 在 1K、2K、4K 三次请求中均返回 HTTP 400：
`Transparent background is not supported for this model.` 因此 sunburst 目前不支持透明背景；
该限制与分辨率无关。`auto`、自定义尺寸、quality、遮罩和多参考图是否可用，仍取决于服务端。
收到 400/404/不支持参数时请保留脱敏错误，不要把 HTTP 成功等同于编辑质量达标。

## 安装

要求 Node.js 22 或以上，无第三方 npm 依赖。

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
```

可选参数：`--count 1..4`、`--quality VALUE`、`--timeout 300000`（毫秒）、
`--base-url https://apis.vvvcode.com/`、`--output-dir outputs`。
Base URL 支持根地址或 `/v1` 后缀，不重复拼接。
优先级：命令行 > 环境变量（地址、密钥） > 本地配置 > 默认值。
不设置模型质量默认值，避免为未知服务端强加不兼容参数。

支持 PNG/JPEG/WebP 输入及 `b64_json` / HTTPS URL 结果。
下载结果时不向 CDN 转发 API Key；拒绝重定向。
每次请求都可能计费；超时后不会自动重试，以免重复扣费。
输出 JSON 包含绝对文件路径，Codex 可直接展示图片。

## 开发与验收

```sh
npm test
npm run check
```

测试使用模拟响应，不需要密钥、不计费，覆盖 JSON 生图、multipart 改图、
默认尺寸隔离、图片落盘、CDN 密钥隔离和错误处理。
GitHub Actions 配置 Windows / Linux、Node 22 / 24 测试。

线上验收：本次已用 sunburst 改图分别测试 1K、2K、4K；三次均因透明背景参数被服务端拒绝，
未产生可供尺寸和透明通道检查的结果。flare 尚未进行同样的线上测试。
改图使用可辨认的输入，只修改单一元素，对比身份、姿势、尺寸和透明通道；
这些检查未完成前不要声称精准改图已经可用。

## 隐私与许可

提示词、输入图片和遮罩会发送到所配置的 API 服务商。
只发布代码，不发布用户输入图片、生成结果或密钥。
MIT，见 [LICENSE](LICENSE)。
