# 开发指南

> 面向贡献者的本地开发、安装与验证。用户说明见 `README.md`，使用细节见 `docs/usage.md`，设计取舍见 `docs/design.md`。

## 仓库结构

| 路径 | 职责 |
| --- | --- |
| `src/client.ts` | 客户端 TypeScript 源码：向 `settings.plugin.item` 贡献配置卡片 |
| `src/index.ts` | Host TypeScript 源码：`hashline_read` / `hashline_edit` 工具、设置、提示词、Agent scoped 替换、HMR |
| `src/core.ts` | 锚点/编辑的纯逻辑 TypeScript 核心（拆分、计划、预览） |
| `src/runtime-entry.ts` | TypeScript 运行时兼容入口 |
| `lib/` | `tsc` 与 `tsdown` 生成的可发布 JavaScript、声明和 bundle，不直接编辑 |
| `cordis.patch.yml` | 随包发布的持久 bundle 行 |
| `test/` | 回归测试 |
| `scripts/setup-linked-install.mjs` | `link:` 开发安装的 peer junction 建立 |

## 环境要求

- DeepSeek Harness `0.1.0-rc.7` 或兼容版本
- Node.js `^22.19.0 || >=24.0.0`
- 网页配置卡片要求 DSH 包含 `settings.register(..., { exposeToClients: true })` 支持，以及按 `hashline`
  namespace 注册的 `settings.plugin.item` keyed slot；旧 rc.5 只能运行 Host 工具，不能保证网页配置卡片可用。

## 安装方式

源码仓库不跟踪 `lib/` 构建目录。首次使用 `file:` 或 `link:` 安装时先执行 `npm install`；首次安装和每次源码修改后执行 `npm run build`：

```powershell
npm install
npm run build
```

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

## TypeScript 构建

仓库采用纯 TypeScript 源码构建模式：`src/` 是唯一实现来源，`lib/` 是发布产物。安装开发依赖后执行：

```powershell
npm run build
```

- `build:host`：用 `tsc` 生成 Host、核心和声明文件；
- `build:client`：先用 `tsc` 校验客户端并生成声明，再用 `tsdown` 从 `src/client.ts` 生成 DSH `__ModuleLoader__` bundle；
- `build`：按上述顺序完成两侧构建，避免客户端 bundle 被 Host 编译覆盖。

不要直接修改 `lib/`；源码修改后重新构建，再进行本地安装或测试。

## Host 热重载

插件使用官方 Cordis HMR 服务精确监视构建产物 `lib/index.js` 和 `lib/core.js`。首次组合完成后，Host 源码修改并重新构建后会在线卸载旧 Fiber
并应用新代码，无需重启 DSH。若部署的 HMR root 已覆盖插件目录则不重复注册。

`lib/client.js` 是由 `src/client.ts` 生成的 DSH client module bundle。修改客户端源码后重新执行
`npm run build:client`；从同一 DSH checkout 运行 `pnpm run dev:web` 可自动推送 client HMR，未运行 watcher 时刷新页面即可，同样不需要重启 Host。

插件不提供自定义热安装 CLI，不复制 `dsh-zh` 的热安装监督器；安装统一使用 `dsh plugin`。

## 测试与验证

任何文件改动后执行：

```powershell
npm run test:setup
npm run check
npm test
npm pack --dry-run --json
```

- `check`：先执行完整 TypeScript/客户端构建，再对生成的 `lib/`、`scripts/` 和 `test/` 做语法检查。
- `test`：运行三组回归（core、plugin、client），覆盖 BOM、CRLF/LF、末尾换行、删除、批量顺序、重叠拒绝、
  锚点过期、稳定读取、版本竞争、沙箱策略、一次性审批、文件观察事件、工具架构、设置热切换、
  智能体作用域替换和客户端卡片。
- `test:setup` 只把测试依赖装到 `test/node_modules`，不会在插件根目录生成会遮蔽宿主 peer 的副本。

浏览器端改动需要刷新网页；Host 文件在 HMR 服务可用时自动热重载，否则按日志提示重启。

## 包形态

Host 与 Web 的实现源码均为 `src/` 下的 TypeScript。`npm run build` 将 Host/core 编译为纯 ESM
JavaScript 与声明文件，并将客户端源码打包为按 DSH client module 约定交付的经典 `__ModuleLoader__`
bundle；发布包只消费 `lib/` 产物，不要求安装时再转译。标准安装命令把 `cordis.patch.yml` 作为 profile
bundle 层加入，并从 package manifest 发现 client bundle。
