# 设计说明

## 目标

本插件只解决文件编辑的机械可靠性：用内容哈希把模型的编辑意图绑定到最近读取的具体行，检测
stale read，并把多处修改作为一个原子请求处理。它不判断代码修改是否在语义上正确。

插件是独立的 Host + Web client bundle，不并入 `dsh-zh`，原因是后者的职责和行为契约明确
限定为中文界面增强且不注册模型工具。Hashline 的客户端只向现有 `settings.plugin.item` Slot
贡献配置卡片，工具、文件访问和设置所有权仍在 Host。

## 工具边界

- 始终注册全局 `hashline_read` / `hashline_edit`，默认不覆盖内置工具；
- `hashline_edit` 是锚定-only 入口（0.2.0 起）：`edits` 必填且非空，只含 `set_line` / `replace_lines` /
  `insert_after`。简单唯一字面替换是内置 `edit` 的职责；`old_string` / `new_string` / `replace_all`
  与 `edits[].replace` 在 execute 内（sandbox、审批与文件 I/O 之前）被拒绝并指引内置 `edit`，仅容忍
  适配器物化的精确空哨兵。参数根 schema 保持 `type: "object"`（真实模型路由会拒绝无 `type` 的根级
  oneOf）。0.3.0 起 `edits.items` 改为**扁平 op 判别形状**（`{op, anchor?, start_anchor?, end_anchor?,
  new_text}`，嵌套四层降为两层、无 oneOf 分支）——深层嵌套/oneOf 是模型结构化输出的已知弱点，
  实测失败样本均为「字段提升到参数根、数组项物化为根级数字键、变体空壳」等层级损坏，扁平形状
  在形态上消灭这类错误。op 与字段的匹配在执行层校验；历史嵌套变体形状仍被 `parseEditEntries`
  接受（旧回放与方言回收）。`normalizeEditRequest` 在此之上做**方言回收**：顶层散落字段、
  根级数字键影子、项内字段提升、丢失信封的根级单操作，只要能无歧义恢复出锚定操作就接受，
  结果注明 `normalizedFrom`（宽容可观测），全等影子去重；字段冲突或无法归属即拒绝，错误附带
  收到参数的结构指纹（仅键名与形状，不含内容）与 canonical 形状模板。原始
  `ctx.tools.register` 路径不会自动校验输入值，真正的执行时强制仍由 `parseEditEntries` 完成，
  并防御旧回放和直接调用；
- `replaceBuiltinEdit` 显式开启时，只在具体智能体的自身作用域注册严格哈希锚定的 `read` 与 `edit`，可逆遮蔽其继承的原工具。
  该 `edit` 与全局 `hashline_edit` 是同一锚定-only 契约：`edits` 必填且非空，只含
  `set_line` / `replace_lines` / `insert_after`；执行层同样拒绝 `old_string` / `new_string` /
  `replace_all` 和无锚点 `replace`，确保替换模式不能绕开行哈希；
- 全局 `hashline_read` 的说明始终配对全局 `hashline_edit`；只有替换整组安装成功的 Agent scoped `read` 才配对严格 `edit`。
  因可见性限制而跳过替换时，不得让全局读取说明把模型导向内置文本 `edit`；
- 替换前确认该智能体的 `read`、`edit`、`hashline_read`、`hashline_edit` 均可见，避免绕过配置限制；同层重名时保留已有定义并回滚整组替换；
- **极简模式（minimal 预设）不替换**：经 `agentPresets.composedPreset(agent.ctx) === 'minimal'` 判定后，仅在该智能体作用域以 `restrict` deny 全局 `hashline_read` / `hashline_edit`，不注册 own-scope `read` / `edit` 与提示词阴影，维持该预设的双工具组合；该 deny **与 `replaceBuiltinEdit` 开关无关**，只要插件 `enabled` 即对极简 agent 生效（曾因 deny 被放在替换分支内，关闭替换后极简 agent 重新看到全局 hashline 工具——回归测试已锁定）；
- 会话**中途切换预设**(如 cordis → minimal,DSH `recompose`)时,监听官方 `agent-preset/selected` 对目标 Agent 重新评估:撤销已装的替换、改挂 deny,避免残留注入;不得再监听 `tools/change` 兜底——工具注册/注销会同步触发它,重装表面又触发它,形成无限递归卡死会话创建;
- 不修改或卸载 `tool-fs`；
- V1 不做 symbol、AST、fuzzy matching、grep 锚点或上下文卫生跟踪；
- 新建文件和全量重写不属于本插件。

## 锚点

锚点格式为 `LINE:HASH`（编辑参数里从读取输出直接抄来的 `LINE|HASH` 也被接受并等价处理）。
哈希是该行文本与真实行尾连接后的 SHA-256 前缀，默认 4 hex。
BOM 作为文件元数据单独保存，不进入首行哈希。这样首行显示内容、锚点输入和编辑语义一致，
而文件级版本 CAS 仍会捕获并发 BOM 变化。

行号和短哈希联合定位。短哈希不是全局标识，也不能消除碰撞；它主要用于低成本 stale-read
检测。需要降低碰撞概率时可提高 `hashLength`，代价是每行输出增加 token。

当锚点行号因先前编辑而漂移（stale read）时，若全文件里恰有一行内容哈希与锚点哈希一致，
则自动重定位到该行；0 个或 2 个以上候选仍按 stale-read 拒绝并回显上下文。这样把「改完
未重读」的常见失误变成静默自愈，同时保留对多候选歧义的保守拒绝。

## 文本模型

文件被表示为 `{ bom, lines[] }`，每行分别保存 `text` 和 `eol`。这避免把以下状态混为一谈：

- 最后一行没有换行；
- 最后一行有换行；
- 一个有换行的空白行；
- UTF-8 BOM；
- LF、CRLF 和 mixed EOL。

替换文本尾部的换行是该文本最后一行的行尾声明，不会制造额外幽灵空行。空字符串在
`set_line` / `replace_lines` 中专门表示删除；`"\n"` 表示一个有行尾的空白行。

## 批量编辑

所有编辑先基于同一个原始快照解析和验证，然后才构建新内容：

- 两个替换/删除范围相交时拒绝；
- `insert_after` 的边界行落入任何替换范围时拒绝；
- 同一锚点允许多个 `insert_after`，并保持请求数组顺序；
- 编辑从高行号向低行号应用，避免低位修改改变高位索引。

## 精确替换（已移除）

`replace` 变体（含旧 hybrid 入口 `old_string` / `new_string` / `replace_all`）已在 0.2.0 移除：
它与内置 `edit` 职责重叠、稀释锚定定位，且维护双输入路径的互斥校验与空哨兵防御成本高。
锚定编辑本身不做行尾空白裁剪、连续空白折叠或任何模糊匹配——那些操作会使定位不可逆，
破坏「写对位置」的安全前提。

## DSH 集成

插件消费 Host 的 `fs`、`tools`、`systemPrompt`、`settings`、`agents`，并使用：

- `sandboxPolicy.resolve({ session })` 获取调用会话的模式和 workspace root；
- `approval.request(...)` 处理严格更宽的一次性 sandbox 升级；
- `fs/observed` 同步读写版本；
- `fs/write-intent` 保留策略组合点；
- `writeText(..., replaceIfVersion)` 防止校验后到写入前的并发覆盖；
- `settings.register('hashline', Config, { exposeToClients: true })` 注册持久用户覆盖层；
- `settings.watch(...)` 实时重建工具和提示词表面；
- `agents.list()` 与 `agent/created` 为现有及新 Agent 安装可选 scoped `edit`。

提示词注入分两种模式：默认模式全局注册 `tool:hashline`（order 103）；`replaceBuiltinEdit` 开启时改为在
每个 Agent 的自身作用域注册同名的 `tool:read` / `tool:edit` section（order 100 / 102），利用 DSH
system-prompt 的 scope 层同名阴影规则替换内置原文。严格 `tool:edit` 文本要求先读、每个数组项一个锚定操作，
并明确禁用文本替换与 `replace`；关闭替换后 scoped 阴影随整组 disposer 撤除，恢复全局 `tool:hashline`。

阴影文本必须按工具拆分（`readGuidanceText` / `editGuidanceText`），不能把同一段合并说明同时塞进
`tool:read` 与 `tool:edit`：两段完全相同的文本会在组装后的系统提示词里重复出现，重蹈“多出来”的旧。
原版 tool-fs 的 read/edit 提示词各司其职，`tool:read` 只讲读取、`tool:edit` 只讲编辑；非替换模式下的
全局 `tool:hashline` 仍用合并的 `guidanceText`（它是独立补充说明，不阴影任何 section）。

`zhPrompt` 开启时，三个提示词函数（`guidanceText` / `readGuidanceText` / `editGuidanceText`）与工具/参数的
`description` 全部改为中文（工具 description、`file_path`/`edits` 及三种锚定编辑变体的参数 description），
工具名（`read`/`edit`/`hashline_read`/`hashline_edit`）保持英文。编辑变体的
items schema 因此由模块级常量改为 `editItemSchema(zhPrompt)` 工厂，`editParameters` 相应接收 `zhPrompt`。

读文件时执行 `stat → readText → stat`，仅在版本前后一致时接受快照；若第一次不稳定会重试
一次。这个检查不能阻止检查完成后的变化，因此写入仍必须带版本 CAS。

全局工具、prompt section、settings watcher 和 Agent scoped 覆盖均保存 exact disposer，并由 Cordis
调用作用域持有；设置切换会先释放旧表面，bundle 卸载时再统一清理。`agent/disposed` 发生在 Agent
scoped effect 已展开之后，因此这里只移除生命周期索引，不重复拥有 Agent Fiber。

本插件以 profile bundle 形态安装
（模块路径含 node_modules）时永远不会被官方 watcher 跟踪，即使其 root 覆盖本目录；只有 workspace 形态
（非 node_modules）且官方 root 覆盖时才跳过自注册，否则始终用 `registerConfig`（其 `ignored: undefined`）
精确自监视。它只负责源码重载，不实现或复制 profile 热安装监督器。

Web client 通过 `settingsScope.bind({ namespace: 'hashline' })` 读写同一 Host namespace，并向
`settings.plugin.item` keyed slot 以 `key: 'hashline'` 注册卡片。它不直接访问文件、不使用
`localStorage`，也不定义自有网络协议。

`HashlineError` 继承宿主的 `HarnessError`，让 `HASHLINE_*` 和映射后的 `FS_*` code 进入结构化 ToolResult，供模型重试、UI 和自动化按 code 分支。`HarnessError` 经 `src/profile-modules.ts` 从 profile 解析加载，与主进程使用同一实例；profile 不可用时降级为普通 `Error`，避免加载第二份 `dsh-llm`。

## 展示分层

模型结果与 UI 展示分离：`src/core.ts` 只负责文本模型、锚点解析、计划与写前验证；`src/presentation.ts`
是纯展示逻辑（读取 envelope、紧凑 diff hunks、回放 meta 窄化），只接收普通字符串与路径，不接触
React、ToolResult 或 DSH 运行时实例。

- `hashline_read` 的模型文本是 DSH 原生读取 envelope（`<path>/<type>/<content>`），内容行使用
  `LINE|HASH  内容`，并在 footer 报告 `eol` / `bom`；`output.presentationMeta` 投影独立的
  `{ number, hash, text }` 叶字段、路径、窗口与语言提示。`presentResult` 在 meta 与 envelope 均合法时
  返回 `card: 'read'`，并把 envelope-stripped body 作为 fallback content。
- Web Client 只为 `hashline_read`（以及显式替换后的 `read`）注册 keyed toolview。该 toolview 把
  `{ number, hash, text }` 映射为原生 `ReadBlock` 的 `{ number: "LINE|HASH", text }`：完整
  `LINE|HASH` 因而落入官方 gutter span，继承灰色、`aria-hidden` 与 `user-select: none`；纯 `text`
  仍由原生高亮器、复制按钮和折叠逻辑处理。这里利用的是 React children 的运行时能力，不修改 DSH 源码。
- `hashline_edit` 的 canonical value 增加可选内部字段 `presentation: { diffs }`：写入成功后立即用
  实际写入前后的文本计算紧凑 hunks（展示层把 CRLF 归一到 LF、忽略 BOM、丢弃 unified diff 的缺尾换行
  标记），并按 hunk 的原始 `oldStart/newStart` 范围附带逐行 `oldHashes/newHashes`；哈希仍从真实行正文加真实行尾计算，不从 LF 归一后的 diff 文本反推。它不保存完整 before/after；`output.presentationMeta` 只投影 `{ diffs }` 持久化，`presentResult`
  从 meta 还原 `card: 'diff'`。每个 hunk 使用调用方的 `file_path`，不把后端解析后的绝对 `displayPath` 暴露给卡片；diff 计算只影响展示，实际写入仍走 `core.ts` 文本模型。
- 工具调用展示语义：显式 `hashline_edit` 的兼容文本替换与单条 `edits[].replace` 显示 pending diff
  （参数自带 old/new）；锚点编辑及替换内置工具后的严格 `edit` 没有旧文本可读，保持通用编辑卡，不伪造 diff。
- 所有展示都可失败回退：错误、无变化、过期锚点、stale version、畸形回放 meta 或 envelope 不匹配
  最终都由宿主渲染普通文本结果。`presentationMeta` 本身始终返回 lossless JSON（无变化为 `{ diffs: [] }`），
  `presentResult` 再对空/畸形数据返回 `undefined`，避免成功调用被 ToolRuntime 改写为输出错误。
- `hashline_read` 的 keyed toolview 复刻最小折叠行 chrome，并直接嵌入公开导出的原生 `ReadBlock`；不复制
  `ReadBlock` 的私有实现或 CSS。`hashline_edit` / 显式替换后的 `edit` 复用同一折叠行 chrome，并以 React inline style 组合原生 diff 的表面、红绿语义、折叠、统计和复制行为；由于公开 `DiffBlock` 没有逐行 gutter API，编辑行由插件显式拆成不可选且 `aria-hidden` 的 `-|HASH` / `+|HASH` gutter 与可选正文。复制器只序列化路径、原生 `- `/`+ ` 和正文，不把哈希 chrome 写入剪贴板。
- 宿主 `ReadBlock` 契约（DSH 0.1.1-rc 起）：`labels`（`window/copy/copied/collapseAria/expandAria/collapse/expand`）是必需 prop，缺失会在展开渲染时读 `labels.copy` 抛 `TypeError`，读取卡表现为"无法展开"（2026-08-31 升级 0.1.2-alpha.1 后实测）；定位只接受 `className`，不接受 `style`。toolview 注册项声明 `locale: 'settings.hashline'` 后框架注入 `t` 座位（随界面语言切换重渲染），`labels` 由该 `t` 构造：`copy/copied/collapse` 直接用 DSH 共享 common vocabulary，`read.window` / `read.collapseAria` / `read.expandAria` / `read.expandRest` 词条注册在本插件字典。`DisclosureRow` 同样不接受 `style` prop；工具行的宽度布局（`toolRow`）由插件自己的外层 `data-variant` 元素承担，ReadBlock 的外边距由包裹 `div` 承担。
- 折叠行与编辑 diff 的局部样式不把动态 Cordis 环境的 `styles` Builtin 误声明为客户端 Service 硬依赖；否则 loader 会永久等待不存在的 `styles` Service 并阻断 Web boot。
- 注册 `read` / `edit` 键会阴影 shipped toolview，但仅在 `enabled && replaceBuiltinEdit` 时动态注册；DSH keyed Slot 的最低 live priority 胜出，因此 Hashline 使用 `priority: -100` 覆盖 shipped 的默认 `0`，而不是在同一 priority 制造注册冲突。默认只拥有 `hashline_read` / `hashline_edit`，两种命名各自复用同一 Hashline 行组件；注销阴影贡献后 shipped toolview 自动恢复。
- 失败结果的呈现对齐原生 `FileMutationRow`：`read` / `edit` toolview 在 `isError` 时把结果 content 里的 `Error: ...` 文本拉平（`hashlineResultText`，与原生 `toolRowModel.resultText` 同义），折叠摘要显示首行、展开显示完整错误文本，并保持可展开（修复前错误结果因无 diff 而被判为不可展开，会话列表中看不到错误、点缩放无效果）。
- 失败行的结构逐项对齐原生 `ToolRow`：折叠摘要 = 分隔点 + 错误首行（`--dsw-alias-state-error-primary` 红字，错误时不显示文件路径链接）；展开 body 是 `ioCard`（`OUT` 标签 + `ioText[data-error]` 红字完整错误），而不是裸 `<pre>`；`DisclosureRow` 必须传 `keepContentWhenOpen` 让展开态标题行仍保留摘要；根节点带 `data-variant`，并输出 screen-reader 状态文本（英文 `Failed`/`Running`）。
- PTC（`run_code` 程序模式）子调用的展开回退：客户端投影里子调用块（`tool/code-dispatch` 落定）不携带 `block.meta`（meta 只随顶层 `tool/result` 持久化），因此读取/编辑 toolview 在“已结算、无错误、无 meta 投影”时，把结果 content 文本拉平为 `OUT` ioCard 展开（与 shipped 工具行对子调用的展开一致），而不是仅凭 meta/错误判为不可展开；`previewChevron` 跟随 `expandable`，不可展开的行（如运行中）不再显示悬停箭头，避免“有箭头点不开”的死箭头（2026-09-01 实测 PTC 下 hashline read/edit 子调用全部点不开后修复）。
- 工具显示名靠 dsh-zh 的 DOM 文本层“整段精确匹配”改写（`CHAT_LABELS`：`Edit`→编辑、`Read`→读取、`Inspect`→检查、`Failed`→失败等），不是走 DSH locale。因此自写 toolview 里所有用户可见的英文字面量（title、Inspect、ioLabel `OUT`、diff 的复制/展开/footer 文案）必须与原生组件逐字节一致，否则翻译失效或与英文界面不一致；diff 的“复制/收起/footer”原生 `DiffBlock` 本身就是硬编码中文，照抄即可。

## 包形态

实现源码全部位于 `src/`，采用纯 TypeScript 构建：`tsc` 将 Host/core 生成纯 ESM JavaScript
与声明文件，`tsdown` 将 `src/client.ts` 生成按 DSH client module 约定交付的经典
`__ModuleLoader__` bundle；`src/bin/dsh-hashline.mts` 经 `tsc -p tsconfig.cli.json` 编译为
`bin/dsh-hashline.mjs`（`install` / `remove` / `status` CLI）。发布包消费 `lib/` 产物，不要求安装时再转译。运行时 peer
`@deepseek-ai/dsh-llm` 和 `@deepseek-ai/schemastery` 由 `src/profile-modules.ts` 从当前 profile 解析加载，`file:` 与
`link:` 安装同路径，不再需要 junction。标准安装命令把 `cordis.patch.yml` 作为 profile
bundle 层加入，并从 package manifest 发现 client bundle。CLI 是 `dsh plugin` 的轻量封装：只走持久
bundle 通道（校验 `dsh.profile.bundles` 真正就绪），不部署热行，也不复制与核心编辑能力无关的 profile
热安装监督逻辑（AGENTS.md 约束 9）；安装后需重启一次 `dsh web` 生效。

## 后续候选

只有 V1 的真实使用数据证明有价值后，再考虑：

- `grep` 输出可编辑锚点；
- symbol 级替换；
- 大文件流式锚定读取；
- context hygiene 元数据；
- 默认 `hashline_*` 名称的客户端 keyed 折叠行（当前只复用原生展开卡与结果状态；若公开 UI
  primitives 足以稳定复用原生行，再单独评估维护成本）。
