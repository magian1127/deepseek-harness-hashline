# 开发指南

> 面向贡献者的本地开发、安装与验证。用户说明见 `README.md`，使用细节见 `docs/usage.md`，设计取舍见 `docs/design.md`。

## 仓库结构

| 路径 | 职责 |
| --- | --- |
| `lib/client.js` | 浏览器插件：向 `settings.plugin.item` 贡献配置卡片 |
| `lib/index.js` | 主机插件：`hashline_read` / `hashline_edit` 工具、设置、提示词、Agent scoped 替换、HMR |
| `lib/core.js` | 锚点/编辑的纯逻辑核心（拆分、计划、预览） |
| `lib/runtime-entry.js` | 运行时入口 |
| `cordis.patch.yml` | 随包发布的持久 bundle 行 |
| `test/` | 回归测试 |
| `scripts/setup-linked-install.mjs` | `link:` 开发安装的 peer junction 建立 |

## 环境要求

- DeepSeek Harness `0.1.0-rc.7` 或兼容版本
- Node.js `^22.19.0 || >=24.0.0`
- 网页配置卡片要求 DSH 包含 `settings.register(..., { exposeToClients: true })` 支持，以及按 `hashline`
  namespace 注册的 `settings.plugin.item` keyed slot；旧 rc.5 只能运行 Host 工具，不能保证网页配置卡片可用。

## 安装方式

### 普通本地安装（file:）

把可运行快照物化到 profile（把 `<绝对路径>` 换成你本机的实际绝对路径）：

```powershell
dsh plugin --profile web add "file:<绝对路径>/deepseek-harness-hashline"
```

### 持续开发（link:）

让 profile 直接加载当前源码并保留 Host 热重载。链接前先建立本地 DSH peer junction：

```powershell
npm run setup:link -- "<绝对路径到DSH源码>/deepseek-harness"
dsh plugin --profile web add "link:<绝对路径>/deepseek-harness-hashline"
```

**不要在没有执行 `setup:link` 时传裸路径或 `link:`。** Node 会从链接后的源码真实路径解析 DSH peer，
缺少本地 junction 时会以 `ERR_MODULE_NOT_FOUND` 启动失败。

## Peer 解析

运行时 peer `@deepseek-ai/dsh-llm` 和 `@deepseek-ai/schemastery`：

- 在 `file:` 安装中由 DSH profile 模块回退提供；
- 在 `link:` 开发安装中由 `setup:link` 建立的 junction 提供。

`.npmrc` 的 `omit=peer` 让 npm 不自动安装 peer 依赖，避免在 `link:` 开发安装时于插件根目录生成第二份
`dsh-llm`（即第二份 `HarnessError` 类），确保 `HarnessError` 和 settings schema 与宿主使用兼容模块。

## Host 热重载

插件使用官方 Cordis HMR 服务精确监视 `lib/index.js` 和 `lib/core.js`。首次组合完成后，Host 源码修改会
在线卸载旧 Fiber 并应用新代码，无需重启 DSH。若部署的 HMR root 已覆盖插件目录则不重复注册。

修改 `lib/client.js` 时，从同一 DSH checkout 运行 `pnpm run dev:web` 可自动推送 client HMR；未运行
watcher 时刷新页面即可，同样不需要重启 Host。

插件不提供自定义热安装 CLI，不复制 `dsh-zh` 的热安装监督器；安装统一使用 `dsh plugin`。

## 测试与验证

任何文件改动后执行：

```powershell
npm run test:setup
npm run check
npm test
npm pack --dry-run --json
```

- `check`：对 `lib/`、`scripts/` 和 `test/` 做语法检查。
- `test`：运行三组回归（core、plugin、client），覆盖 BOM、CRLF/LF、末尾换行、删除、批量顺序、重叠拒绝、
  锚点过期、稳定读取、版本竞争、沙箱策略、一次性审批、文件观察事件、工具架构、设置热切换、
  智能体作用域替换和客户端卡片。
- `test:setup` 只把测试依赖装到 `test/node_modules`，不会在插件根目录生成会遮蔽宿主 peer 的副本。

浏览器端改动需要刷新网页；Host 文件在 HMR 服务可用时自动热重载，否则按日志提示重启。

## 包形态

Host 使用纯 ESM JavaScript；Web 半侧是按 DSH client module 约定交付的经典 `__ModuleLoader__` bundle，
均不需要发布前转译。标准安装命令把 `cordis.patch.yml` 作为 profile bundle 层加入，并从 package manifest
发现 client bundle。
