# 开发指南

> 面向贡献者的本插件开发、安装与验证。用户说明见 `README.md`，使用细节见 `docs/usage.md`，设计取舍见 `docs/design.md`。

## 仓库结构

| 路径 | 职责 |
| --- | --- |
| `src/client.ts` | 客户端 TypeScript 源码：向 `settings.plugin.item` 贡献配置卡片 |
| `src/index.ts` | Host TypeScript 源码：`hashline_read` / `hashline_edit` 工具、设置、提示词、Agent scoped 替换、HMR |
| `src/core.ts` | 锚点/编辑的纯逻辑 TypeScript 核心（拆分、计划、预览） |
| `src/presentation.ts` | 展示层纯逻辑：读取 envelope、紧凑 diff hunks、回放 meta 窄化（依赖 `diff`） |
| `src/runtime-entry.ts` | TypeScript 运行时兼容入口 |
| `src/bin/dsh-hashline.mts` | 安装 CLI 源码（`install` / `remove` / `status`），`tsc -p tsconfig.cli.json` 编译到 `bin/` |
| `lib/` | `tsc` 与 `tsdown` 生成的可发布 JavaScript、声明和 bundle，不直接编辑 |
| `bin/` | 安装 CLI 发布产物（`dsh-hashline.mjs`），随包发布，不直接编辑 |
| `cordis.patch.yml` | 随包发布的持久 bundle 行 |
| `test/` | 回归测试（core / presentation / plugin / client） |
| `src/profile-modules.ts` | 运行时从 profile 解析 DSH peer（schemastery / dsh-llm），失败时降级 |

## 环境要求

- DeepSeek Harness ≥ 0.1.2-rc.1
- Node.js `^22.19.0 || >=24.0.0`
- 网页配置卡片要求 DSH 包含 `settings.register(..., { exposeToClients: true })` 支持，以及按 `hashline`
  namespace 注册的 `settings.plugin.item` keyed slot；更旧的 rc 版本只能运行 Host 工具，不能保证网页配置卡片可用。

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

让 profile 直接加载当前源码并保留 Host 热重载：

```powershell
dsh plugin --profile web add "link:<绝对路径>/deepseek-harness-hashline"
```

新版运行时经 `src/profile-modules.ts` 从 profile 解析 DSH peer，`file:` 与 `link:` 安装都不再需要本地 junction 或 `setup:link`。

`file:` 与 `link:` 的物理形态不同：`file:` 由 pnpm 把包**复制**到 profile `node_modules`（普通目录），改工作区
`src/`、`lib/` 不会反映到运行副本，需要重新 `dsh plugin add` 或手动同步；`link:` 在 `node_modules` 里建**符号链接**
指向工作区（`LinkType=SymbolicLink`，与 dsh-zh 同形态），改 `lib/` 后运行副本即见新文件。持续开发一律用 `link:`，
避免“改完源码但运行进程仍用旧副本”的混淆。注意：无论 `file:` 还是 `link:`，模块 URL 仍含 node_modules，因此
都受上一条 node_modules HMR 失效的约束——link 本身不等于热生效，仍靠插件的 HMR 自监视或一次冷加载。

## Peer 解析

运行时 peer `@deepseek-ai/dsh-llm` 和 `@deepseek-ai/schemastery` 不写入本包依赖：`src/profile-modules.ts`
在运行时用 `createRequire` 从当前 profile 的解析上下文加载它们，因此与主进程拿到同一模块实例
（同一份 `HarnessError` 与 schemastery），`file:` 与 `link:` 安装走同一条回退路径；加载失败时降级为
普通 `Error` 并关闭 settings UI，而不是启动失败。

展示层依赖 `diff`（^9.0.0，与 DSH 原生 tool-fs 同库同上下文策略）写入本包 `dependencies`；它是纯运行时
依赖，`npm install` 后由 Node 从本包目录解析，不依赖 profile 提供。

## TypeScript 构建

仓库采用纯 TypeScript 源码构建模式：`src/` 是唯一实现来源，`lib/` 是发布产物。安装开发依赖后执行：

```powershell
npm run build
```

- `build:host`：用 `tsc` 生成 Host、核心和声明文件；
- `build:client`：先用 `tsc` 校验客户端并生成声明，再用 `tsdown` 从 `src/client.ts` 生成 DSH `__ModuleLoader__` bundle；
- `build:cli`：用 `tsc -p tsconfig.cli.json` 从 `src/bin/dsh-hashline.mts` 生成 `bin/dsh-hashline.mjs`；
- `build`：按上述顺序完成全部构建，避免客户端 bundle 被 Host 编译覆盖。

不要直接修改 `lib/`；源码修改后重新构建，再进行本地安装或测试。

## Host 热重载

本插件的专属 Host 监视目标是 `lib/index.js`、`lib/core.js`、`lib/presentation.js` 与 `lib/runtime-entry.js`；构建后须观察旧 Fiber 卸载、新 Fiber 激活及工具契约变化。

`lib/client.js` 由 `src/client.ts` 生成。安装通过 `node bin/dsh-hashline.mjs install --profile web --link <目录>`（内部封装 `dsh plugin add`，只走持久 bundle 通道，不部署热行；安装后需重启一次 `dsh web` 生效）；本插件不复制 dsh-zh 的热安装监督器。

## 运行环境验证与热更新经验

以下结论以**当前进程的实际能力**为准，不把旧 rev 或 checkout 源码当成运行事实。

- 官方 HMR 在 profile bundle 形态（`file:` 或 `link:`，模块 URL 含 `node_modules`）中可能被默认 ignore 排除；此时必须让本插件以 `hmr.registerConfig`（`ignored: undefined`）精确自监视真实构建产物，不能误判为官方 root 已覆盖。
- 端到端复验至少覆盖三类历史失败：①过期锚点唯一重定位；②坏锚点回显附近真实锚点；③`old_string` / `edits[].replace` 输入被清晰拒绝（0.2.0 移除后的回归防御）。测试文件放隔离位置，验收样例若保留在仓库，需明确其用途后再提交。
- 验证提示词注入：系统提示词不持久化进会话日志正文，但会随每个请求写入 `request/header` 的 `system` 字段。完整读取会话导出文件（`.jsonl` 或 `.jsonl.zstd`）后检索 `request/header`，即可看到当次真实组装结果；这是确认“提示词是否重复/缺失”的最直接证据，不要只靠 build/test 通过。

## 测试与验证

任何文件改动后执行：

```powershell
npm run check
npm test
npm pack --dry-run --json
```

- `check`：先执行完整 TypeScript/客户端构建，再对生成的 `lib/` 和 `test/` 做语法检查。
- `test`：运行四组回归（core、presentation、plugin、client），覆盖 BOM、CRLF/LF、末尾换行、删除、批量顺序、重叠拒绝、
  锚点过期、稳定读取、版本竞争、沙箱策略、一次性审批、文件观察事件、根级 object + 扁平 `op` 判别 items schema、
  方言回收（顶层散落/数字键影子/项内提升/根级单操作/冲突拒绝/指纹模板）、锚点 `|` 分隔符容忍、
  严格替换入口拒绝无锚点调用、读取 envelope、diff meta 与回放回退、设置热切换、智能体作用域替换和客户端卡片。测试用 `test/fixtures/dsh-home` 假 profile
  隔离 DSH 运行时 peer，不依赖真实安装。
- `pack --dry-run`：`prepack` 会自动重跑 `check` 与 `test`；发布清单包含 `lib/`（含 `presentation.js`）、
  `docs/`、`cordis.patch.yml` 与 README/LICENSE。

## 当前 GUI 验证路径

Hashline 的 Host 验收必须以真实 `hashline_read` / `hashline_edit` 调用确认新工具契约；Client 验收必须确认实际 profile 已提供新 bundle，并在现有 GUI 中命中对应 keyed toolview。

契约级验证（无需重启即可完成，本改造已通过）：

- Host 侧 `presentResult` / `presentCall` 返回的视图形状与 `@deepseek-ai/dsh-tools` 的
  `ReadResultView` / `DiffResultView` / `DiffCallView` / `GenericCallView` 逐字段对齐；
- 客户端消费方确认：`readCardModel` 消费 `card: 'read'` 的 `lines`/`totalLines`/`lang`/`path`，原生 fallback 的 `diffCardModel` 消费 `card: 'diff'` 的 `diffs[{path,oldText,newText}]`；Hashline keyed edit toolview 另外窄化并消费逐行 `oldHashes/newHashes`；
- Client 为 `hashline_read` / `hashline_edit` 注册 keyed toolview；显式替换时以 priority `-100` 阴影 shipped priority `0` 的 `read` / `edit`，因为 keyed Slot 只渲染最低 live priority。禁止同 priority 注册（会直接冲突），卸载低优先级贡献后必须立即恢复 shipped toolview；
- 读取主体直接调用平台外部模块 `@deepseek-ai/dsh-client-ui-primitives` 的 `ReadBlock`，测试桩验证传入的行为参数，不复制高亮或折叠实现。公开 `DiffBlock` 无逐行 gutter API，因此编辑卡仅复刻其表面、折叠、统计与复制语义，正文和哈希 chrome 必须保持两个 DOM span；
- `ReadBlock` / `DisclosureRow` 的 props 契约以宿主当前源码为准（0.1.2-alpha.1 实测）：`ReadBlock` 的
  `labels` 必需、定位只接受 `className`；`DisclosureRow` 无 `style` prop。测试桩应断言 `labels` 七个字段
  齐全、`t` 座位注入时优先采用注入翻译，防止再次出现"折叠行正常、展开即崩"的静默回归。
- Client 导出的硬依赖只包含当前平台实际提供的 `slots`、`locale`、`connection`、`remote`、`settingsScope`。
  动态插件沙箱里的 `styles.insert()` 是 Builtin 而非静态 client module Service，不得写入 `inject`。测试应断言
  bundle 的 `inject` 精确列表，防止插件以 pending Fiber（`waiting for service: styles`）阻断 Web boot。

呈现验收点（需 Host 新代码进入运行进程后执行）：

1. `hashline_read` 成功结果使用原生 `ReadBlock`：gutter 文本严格为 `LINE|HASH`，整体继承灰色、`aria-hidden` 和 `user-select: none`；正文另存于 content span，保持可选择、可复制与语法高亮。
2. 显式 `hashline_edit` 的兼容文本替换在运行前显示 pending diff；成功后显示基于真实前后文本的原生风格 diff 卡。
3. 锚点 `edits` 调用及替换内置工具后的严格 `edit` 保持通用编辑卡；成功后同样显示真实 diff 卡。
4. 编辑删除/新增行的 gutter 严格为 `-|旧HASH` / `+|新HASH`，计算样式为灰色、`user-select: none` 且 `aria-hidden`；正文 span 保持 `user-select: auto` 和红/绿语义。跨 gutter 建立 Selection 时，`selection.toString()` 必须只包含正文。
5. 编辑卡复制按钮序列化路径、`- `/`+ ` 与正文，不包含 Hashline gutter；这是内容复制，不是屏幕文本转储。
6. 错误路径（stale 锚点、sandbox 拒绝）回退普通文本，不出现虚假的成功 diff。
7. `hashline_read` 与替换后的 `read` 命中同一 keyed 读取行；`hashline_edit` 与替换后的 `edit` 命中同一 keyed 编辑行。真实 DOM 出现 shipped `data-diff` 而没有 `data-hashline-diff`，通常说明 priority 阴影未生效，而不是 Host metadata 缺失。

排障时不要把“构建通过”“测试通过”“HTTP 已供应新 bundle”当作 GUI 验收。最低证据链是：boot entry revision 已更新、页面无插件启动错误、真实工具写入成功、展开后的 DOM 命中目标 keyed toolview、计算样式和 Selection/复制结果符合契约。

真实环境 schema 约束（实测发现）：模型路由要求工具参数 schema **根节点**必须是 `type: "object"`；
无 `type` 的根级 `oneOf` 会在工具列表下发时被模型 API 拒绝（`Invalid schema for function ... got
'type: null'`），并导致插件工具整体不可用。嵌套 `items.oneOf` 虽然可被路由接受（0.2.x 实测），但
它是结构化输出的薄弱形状：真实会话中模型反复出现「edits 数组项只剩空壳、anchor/new_text 被提升到
参数根、数组项被物化为根级数字键」的层级损坏，请求在到达插件前即失败。0.3.0 起 `edits.items` 改用
扁平 `op` 判别形状（根 → 数组 → 平铺键值，无嵌套对象、无 oneOf），从形态上消灭这类错误；op 与字段
匹配在执行层校验，历史嵌套形状仍被接受用于旧回放，`normalizeEditRequest` 同时回收常见畸形包装（见
`design.md` 工具边界）。output schema 不进模型请求，可继续使用 oneOf。

### 严格替换的真实运行态复验

重启 DSH 后，以 active profile 和实际新建 Agent 的工具契约为准，确认 `hashline.enabled=true`、`replaceBuiltinEdit=true`，并确认 profile 中的 Hashline 包指向当前构建产物。真实验收只使用内置名称 `read` / `edit` 操作隔离测试文件：

- `read` 输出最新 `LINE:HASH` 锚点；`edit` 的参数根为 `type: "object"`，必填 `file_path` / `edits`，`edits.items` 是扁平 `op` 判别对象（`op` + 锚点字段 + `new_text`），且不公开 `old_string` / `new_string` / `replace`。
- 一次 `edit` 可以携带两个独立的 `set_line` 数组项，并在同一稳定快照上成功写入；本次实机结果为 `ALPHA`、`beta`、`GAMMA`，没有重试，也没有退回文本替换。
- 0.2.x 实机复验曾证明模型路由可接受嵌套 `items.oneOf`（根级 `oneOf` 至今仍不可用），但真实会话暴露其为结构化输出薄弱形状，0.3.0 已改用扁平 `op` 判别。静态构建、单测和 HTTP bundle 响应都不能替代真实工具 schema、真实调用和真实文件结果的 Host 验收。
- 原始失败的关键经验是：同一 `edits[i]` 塞入多个变体会连续失败，模型随后转用 `old_string/new_string` 虽可通过文件版本 CAS，却没有绑定最近读取的 `LINE:HASH`。严格替换因此必须同时收紧 schema、工具说明、scoped prompt 和执行层；0.2.0 起全局 `hashline_edit` 与严格替换同形，不再保留兼容文本替换。

测试文件验收后立即删除，避免把临时路径和用户数据带入仓库或发布包。

## 包形态

Host 与 Web 的实现源码均为 `src/` 下的 TypeScript。`npm run build` 将 Host/core 编译为纯 ESM
JavaScript 与声明文件，并将客户端源码打包为按 DSH client module 约定交付的经典 `__ModuleLoader__`
bundle；发布包只消费 `lib/` 产物，不要求安装时再转译。标准安装命令把 `cordis.patch.yml` 作为 profile
bundle 层加入，并从 package manifest 发现 client bundle。

## 安全审计（2026-09）

项目专属要点（完整清单见工作区根 `docs/audit-2026-09.md`，勿在此复制）：

- 高危两项均已在 0.3.0 修复：`loadStableFile` 增加 50KiB 三层字节防护（stat 前置 / 读后校验 / 编辑参数递归，超限抛 `HASHLINE_FILE_TOO_LARGE`）；scoped 注册部分失败改为 `added[]` 统一可逆清理（回归覆盖第二段失败时释放 deny restriction）。
- 中危两项均已在 0.3.0 修复：CLI `--profile` 增加 `validateProfileName` 穿越校验；扁平 op 按 `EDIT_KINDS` 逐操作校验锚点字段，多余锚点字段拒绝而非静默忽略。
- 升级策略：全局工具名冲突时直接抛错会炸整个 composition，应先探测再注册；`client.ts` 已完整构造 ReadBlock 7 字段 labels（正面范例，升版仍需复核）；`runtime-entry.ts` 的 query-string 缓存 shim 仅限开发链路，勿扩大依赖。
