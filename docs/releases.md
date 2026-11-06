# 维护、验证与发布

本仓库同时维护三个宿主入口。稳定的仓库规则见 [AGENTS.md](../AGENTS.md)。

## 源文件与生成文件

- 共享 CLI/画布的维护源为 `plugins/vvvcode-image-gen`；它同时保留旧 ID 升级入口。
- `npm run build` 生成 `plugins/stickerwu-imagegen`，包括 Codex 与 Claude 的原生 manifest。不要手改生成目录或已安装缓存。
- Harness 适配器维护在 `adapters/deepseek-harness`，根包的 `main` 与 `dsh.bundle.patch` 指向原生入口和 Cordis patch。
- Codex marketplace 保持 `vvvcode-plugins` 命名空间；Claude marketplace 为 `stickerwu-plugins`；Harness 包名为 `dsh-stickerwu-imagegen`。
- 图片配置仍沿用旧路径和环境变量，版本升级不能迁移/覆盖用户的密钥、图片、会话或其他 Harness 插件。
- 原创几何图标以 `npm run icon:build` 生成 SVG/512px PNG，零额外依赖；安装包使用已生成文件。分发构建对二进制资源按字节复制和校验。

## 发版检查

更新根 package、维护源 manifest、Claude 根 marketplace 的版本，然后运行：

```sh
npm run build
npm test
npm run check
npm run pack:verify
git diff --check
```

`pack:verify` 检查实际 npm tarball 的文件白名单、必需运行时和元数据，拒绝将个人配置/输出混入发行包。
安装端使用已构建文件，不要求 `prepare`、额外 build hook 或安装另一份宿主 SDK。

Claude 官方 CLI 可校验两层结构：

```sh
claude plugin validate plugins/stickerwu-imagegen --strict
claude plugin validate . --strict
```

未安装 Claude CLI 时可通过其官方 npm 包临时运行同一校验；不能把校验通过当作 Claude 实际图片 API 调用成功。

Harness 的发布检查应使用受支持的实际发行版：

1. 使用宿主真实 `defineTool`、Schemastery 和工具服务验证四个工具的参数/输出，不能只测伪 registry。
2. 把 `pack:verify` 产生的实际 tarball 装进隔离 profile，检查组合配置并启动，确认四个工具被注册。
3. 状态检查应使用空图片密钥配置，不产生付费请求。真实服务验收只有用户明确授权后才做。
4. 安装到用户 profile 后确认已有依赖/bundle 顺序保留、API 配置未变、已装文件匹配发行包。
5. 桌面 profile 由 Electron 独占管理，使用官方 CLI 安装并重载应用；需要 boot 验证时使用隔离 profile，不绕过桌面锁。

当前版本的可重复单元测试包括 JSON 生图、multipart 改图、四个显式模型、附件预览、成功后预览失败、无重试、取消及卸载时的生命周期。
普通 Node 不能访问 Electron `app.asar` 内模块，不应因此在发行包中捆绑或伪造另一套 SDK。

## 仓库与分发

验证后提交源码与生成目录；推送 GitHub 和 Gitee，按相同提交建立 `v版本号` 标签。不要强推已发布标签。
README 的固定版本安装地址必须在对应远端确实存在。

Git/tarball 是可用的 Harness 分发路径；没有执行 `npm publish` 就不能写“npm 已发布”。
自建 Codex/Claude marketplace、社区索引 PR 与官方目录提交分别记录状态，具体见 [市场说明](marketplaces.md)。
不得把模拟 API 测试、插件清单校验或包安装成功写成真实服务商全部能力已验证。
