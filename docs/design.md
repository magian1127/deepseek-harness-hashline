# 设计说明

## 目标

本插件只解决文件编辑的机械可靠性：用内容哈希把模型的编辑意图绑定到最近读取的具体行，检测
stale read，并把多处修改作为一个原子请求处理。它不判断代码修改是否在语义上正确。

插件是独立的 Host + Web client bundle，不并入 `dsh-zh`，原因是后者的职责和行为契约明确
限定为中文界面增强且不注册模型工具。Hashline 的客户端只向现有 `settings.plugin.item` Slot
贡献配置卡片，工具、文件访问和设置所有权仍在 Host。

## 工具边界

- 始终注册全局 `hashline_read` / `hashline_edit`，默认不覆盖内置工具；
- `replaceBuiltinEdit` 显式开启时，只在具体智能体的自身作用域注册哈希锚点 `read` 与 `edit`，可逆遮蔽其继承的原工具；
- 替换前确认该智能体的 `read`、`edit`、`hashline_read`、`hashline_edit` 均可见，避免绕过配置限制；同层重名时保留已有定义并回滚整组替换；
- 不修改或卸载 `tool-fs`；
- V1 不做 symbol、AST、fuzzy matching、grep 锚点或上下文卫生跟踪；
- `replace` 是严格精确匹配，不做近似匹配；仅对 CRLF↔LF 做可逆归一（见「精确替换」），不做空白折叠。
- 新建文件和全量重写不属于本插件。

## 锚点

锚点格式为 `LINE:HASH`。哈希是该行文本与真实行尾连接后的 SHA-256 前缀，默认 4 hex。
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
- 编辑从高行号向低行号应用，避免低位修改改变高位索引；
- 锚定编辑和精确 `replace` 不能混用，避免两套定位语义相互依赖。

## 精确替换

`replace` 变体对 `old_text` 做严格精确匹配，但仅做一项可逆归一：当文件为 CRLF 时，把
`old_text` / `new_text` 与文件正文统一归一到 LF 后再匹配替换，替换完成后整体还原为 CRLF。
它不做行尾空白裁剪、连续空白折叠或任何模糊匹配，因为那些操作会使匹配坐标不可逆，
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

读文件时执行 `stat → readText → stat`，仅在版本前后一致时接受快照；若第一次不稳定会重试
一次。这个检查不能阻止检查完成后的变化，因此写入仍必须带版本 CAS。

全局工具、prompt section、settings watcher 和 Agent scoped 覆盖均保存 exact disposer，并由 Cordis
调用作用域持有；设置切换会先释放旧表面，bundle 卸载时再统一清理。`agent/disposed` 发生在 Agent
scoped effect 已展开之后，因此这里只移除生命周期索引，不重复拥有 Agent Fiber。

Host 源码热更新使用官方 HMR 服务的 `registerConfig()` 精确监视 `lib/index.js` / `lib/core.js`，变化时
把模块 URL 加入 HMR stash 并调用 `partialReload()`。watcher、debounce timer 和异步 disposer 全部归插件
Fiber；若部署的 HMR root 已覆盖插件目录则不重复注册。它只负责源码重载，不实现或复制 profile 热安装监督器。

Web client 通过 `settingsScope.bind({ namespace: 'hashline' })` 读写同一 Host namespace，并向
`settings.plugin.item` keyed slot 以 `key: 'hashline'` 注册卡片。它不直接访问文件、不使用
`localStorage`，也不定义自有网络协议。

`HashlineError` 继承宿主的 `HarnessError`，让 `HASHLINE_*` 和映射后的 `FS_*` code 进入结构化 ToolResult，供模型重试、UI 和自动化按 code 分支。`HarnessError` 经 `src/profile-modules.ts` 从 profile 解析加载，与主进程使用同一实例；profile 不可用时降级为普通 `Error`，避免加载第二份 `dsh-llm`。

## 包形态

实现源码全部位于 `src/`，采用纯 TypeScript 构建：`tsc` 将 Host/core 生成纯 ESM JavaScript
与声明文件，`tsdown` 将 `src/client.ts` 生成按 DSH client module 约定交付的经典
`__ModuleLoader__` bundle。发布包消费 `lib/` 产物，不要求安装时再转译。运行时 peer
`@deepseek-ai/dsh-llm` 和 `@deepseek-ai/schemastery` 由 `src/profile-modules.ts` 从当前 profile 解析加载，`file:` 与
`link:` 安装同路径，不再需要 junction。标准安装命令把 `cordis.patch.yml` 作为 profile
bundle 层加入，并从 package manifest 发现 client bundle；不提供自定义热安装 CLI，避免复制与核心编辑
能力无关的 profile 监督逻辑。

## 后续候选

只有 V1 的真实使用数据证明有价值后，再考虑：

- `grep` 输出可编辑锚点；
- symbol 级替换；
- 结构化 diff 和专用 Tool card；
- 大文件流式锚定读取；
- context hygiene 元数据；
- 专用的 Hashline Tool 结果卡片。
