# 原版工具与 Hashline 对比及实施记录

> 状态：历史研究与实施复盘，不作为行为契约。
>
> 本记录保留本次改造的实施前基线、方案推演、真实环境失败和最终修复经验。文中“当前”“尚未”等措辞仅描述其所在阶段；最终行为以 `README.md`、`docs/usage.md` 和 `docs/design.md` 为准，开发与 GUI 验收方法以 `docs/development.md` 为准。

## 实施前基线总结

以下总结记录改造开始前的状态，用于解释后续方案选择，并非最终现状。原版 `read` / `edit` 在会话呈现和简单调用上更简洁，Hashline 在过期读取保护、具体行定位和多处原子编辑上更强。

两者不是单纯的替代关系：

- 原版工具的核心语义是“按文本做一次精确替换”。
- Hashline 的核心语义是“确认最近读取的具体行仍未改变，再按锚点编辑”。
- 原版工具把人类可读的 diff/read card 作为会话展示的一部分。
- 当前 Hashline 只把安全诊断和锚点文本作为普通工具输出，尚未接入 DSH 的专用展示契约。

因此当前最合理的方向是保留 Hashline 的模型安全语义，同时把模型结果和会话 UI 分成两层处理。

## 对比一：机械行为

### 读取结果

两边都读取调用会话 workspace 中的 UTF-8 文本文件，并支持 `offset` 与 `limit`。

原版 `read`：

- 返回行号和正文。
- 输出较短，适合模型继续阅读。
- 不在结果中提供行内容校验锚点。
- 当前 DSH 的文件观察策略会记录已读取的文件版本，供后续编辑保护使用。

Hashline `hashline_read`：

- 返回 `LINE:HASH|正文`。
- 默认哈希为 4 位十六进制，哈希输入包含完整行尾。
- 额外报告文件总行数、`LF` / `CRLF` / mixed 风格和 BOM 状态。
- 长行可以只截断显示，哈希仍覆盖完整行。

本次相同文件的读取结果示例：

```text
原版 read:
1: alpha
2: beta = 1
3: gamma
4: delta

Hashline:
1|b6a9  alpha
2|d445  beta = 1
3|ae9a  gamma
4|6739  delta
```

### 单次编辑

原版 `edit`：

- 用 `old_string` 和 `new_string` 做严格文本替换。
- 默认要求 `old_string` 只匹配一次。
- `replace_all: true` 时可以把同一字符串的所有匹配一次替换。
- 没有“第几行”的直接定位语义；要避免重复匹配，通常需要把更多上下文放进 `old_string`。

Hashline `hashline_edit`：

- 先校验锚点对应的当前行内容，再写入。
- `set_line` 可以明确修改某一行。
- `replace_lines` 可以替换一个闭区间。
- `insert_after` 可以在某一行后插入。
- `replace` 提供严格文本替换逃生舱，语义接近原版 `edit`。
- 所有锚点和范围先统一验证；过期锚点、重叠范围和版本竞争失败时不写入。

### 过期读取与重复文本

本次会话实测：

1. 原版文件中有两处相同的 `beta = 1`。
2. 原版 `edit` 直接传 `old_string: "beta = 1"` 时，因为匹配两处而失败；传 `replace_all: true` 后两处都会被修改。
3. Hashline 读取后得到第 2 行锚点，例如 `2:8e87`，使用该锚点只修改第 2 行。
4. 修改后再次使用旧的 `2:8e87`，Hashline 返回 `HASHLINE_HASH_MISMATCH`，显示当前锚点，并明确没有写入。
5. Hashline 的两个互不重叠编辑可以一次提交；重叠编辑在生成写入计划前整体拒绝。

## 对比二：DSH 会话呈现

### 原版的呈现

原版 `read` / `edit` 使用 DSH 的专用 presentation 契约：

- `read` 成功后进入读取卡，显示行号、代码内容和适合阅读的展开区域。
- `edit` 成功后进入 diff 卡，显示上下文、删除行、增加行以及统计信息。
- 折叠行使用清晰的工具类型和文件路径摘要。
- 错误时回退到普通错误文本，不显示虚假的成功 diff。

参考 DSH 实现：

- `packages/fs/tool-fs/src/read.ts` 使用 `presentationMeta` 和 `presentResult` 生成 `card: 'read'`。
- `packages/fs/tool-fs/src/edit.ts` 使用 `presentationMeta` 和 `presentResult` 生成 `card: 'diff'`。
- `packages/client/ui-tool/src/client/tool/components/ToolRow.tsx` 将读取卡和 diff 卡交给 `ReadBlock` / `DiffBlock`。

### 当前 Hashline 的呈现

当前 Hashline 的 Host 定义只有普通文本渲染：

- `src/index.ts` 的 `renderRead` 返回 `type: 'text'`。
- `src/index.ts` 的 `renderEdit` 返回 `type: 'text'`。
- `hashline_read` 的 `presentCall` 返回 `card: 'generic'`。
- `hashline_edit` 的 `presentCall` 也返回 `card: 'generic'`。
- 因而会话里看到的是通用工具卡、原始参数 JSON、纯文本结果和 `Updated anchors`，而不是原版的读取卡或 diff 卡。

这解释了截图中的差异：Hashline 的后端结果并非不安全，而是安全信息直接占用了 UI 的主要展示位置。

### 名称带来的额外差异

即使 Hashline 返回 `card: 'read'` 或 `card: 'diff'`，默认工具名仍然是 `hashline_read` / `hashline_edit`。当前 Web 工具行还主要按工具名分类：

- 原生 `read` / `edit` 自动进入原生行、图标和标题。
- 默认模式的 Hashline 名称可能仍显示为通用工具行。
- `replaceBuiltinEdit=true` 时，Hashline 在允许的 Agent scope 中使用 `read` / `edit` 名称，更容易完整复用原生行。

因此“接入专用结果卡”和“折叠行完全像原版”是两个不同层次的问题，不能混为一个改动承诺。

## 对比三：参数结构、调用方式与数量

### 参数结构

以下数量只统计正常文件操作字段；当前会话不是受限 sandbox，因此没有把可选的 `sandbox_permissions` 和 `justification` 算入表格。

| 操作 | 原版参数 | Hashline 参数 | 结构差异 |
| --- | --- | --- | --- |
| 读取 | 必填 `file_path`；可选 `offset`、`limit` | 必填 `file_path`；可选 `offset`、`limit` | 顶层数量相同；Hashline 输出额外带锚点和文本元数据 |
| 单行修改 | 必填 `file_path`、`old_string`、`new_string`；可选 `replace_all` | 必填 `file_path`、`edits`；数组项为 `set_line { anchor, new_text }` | 原版是扁平 3+1 字段；Hashline 是 2 个顶层字段加一层变体嵌套 |
| 多行范围替换 | 仍传一组 `old_string` / `new_string`，范围靠文本表达 | `replace_lines { start_anchor, end_anchor, new_text }` | Hashline 直接表达行范围 |
| 行后插入 | 没有独立的插入变体，通常要通过文本替换表达 | `insert_after { anchor, new_text }` | Hashline 多一种明确操作 |
| 精确文本替换 | `old_string` / `new_string` / `replace_all` | `edits: [{ replace: { old_text, new_text, all } }]` | 语义接近，但 Hashline 多了数组和 `replace` 变体包装 |

单个 Hashline 编辑项的必填叶字段数量为：

- `set_line`：`anchor`、`new_text` 两个。
- `replace_lines`：`start_anchor`、`end_anchor`、`new_text` 三个。
- `insert_after`：`anchor`、`new_text` 两个。
- `replace`：`old_text`、`new_text` 两个，`all` 可选。

原版每次 `edit` 只能表达一组 `old_string` → `new_string`。`replace_all` 可以一次处理同一个字符串的多个匹配，但不能在同一次调用中表达多个不同目标。

### 调用次数

在当前 DSH 会话中，两边的典型单文件流程都需要先读后改：

| 任务 | 原版 | Hashline |
| --- | ---: | ---: |
| 只读取文件 | 1 次 `read` | 1 次 `hashline_read` |
| 读取后修改一处 | 2 次：`read` + `edit` | 2 次：`hashline_read` + `hashline_edit` |
| 读取后修改两处互不相关的目标 | 3 次：`read` + 2 次 `edit` | 2 次：`hashline_read` + 1 次批量 `hashline_edit` |
| 本次完整实测序列：读、改一处、再改两处 | 4 次 | 3 次 |

本次批量实测使用的调用形状如下：

```json
{
  "file_path": "compare-call-hashline.txt",
  "edits": [
    { "set_line": { "anchor": "1:b6a9", "new_text": "ALPHA" } },
    { "set_line": { "anchor": "3:ae9a", "new_text": "GAMMA" } }
  ]
}
```

对应的原版需要两次分别调用：

```json
{
  "file_path": "compare-call-native.txt",
  "old_string": "alpha",
  "new_string": "ALPHA"
}
```

```json
{
  "file_path": "compare-call-native.txt",
  "old_string": "gamma",
  "new_string": "GAMMA"
}
```

### 参数和 Token 数量的取舍

不能只看字段数量判断哪边更省：

- 读取时，Hashline 每行增加哈希、分隔符，并在头部报告 EOL/BOM，模型输入明显更长。
- 单次简单替换时，Hashline 的 JSON 嵌套更深；但 `anchor` 往往比为了消除重复而构造的一大段 `old_string` 更短。
- Hashline 编辑结果会返回新的锚点，便于下一轮继续编辑；原版成功结果通常只返回一句确认。
- 多处编辑时，Hashline 不重复传文件路径和工具调用外壳，通常能减少总调用次数和重复参数。
- Hashline 发生锚点失效时，需要重新读取并重试，额外调用会抵消一部分批量优势；这是安全保护带来的成本。

## 会话经验

### 1. 后端安全性和人类可读性是两个指标

第一次对比只看文件是否正确修改，容易得出“Hashline 更强”的片面结论。截图显示，模型能正确重试并不代表人类能快速确认改动。验收必须同时记录：

- 文件最终内容是否正确。
- 过期或冲突时是否拒绝写入。
- 会话折叠行是否能识别工具和文件。
- 展开后是否能直接看懂实际 diff 或读取内容。

### 2. 模型结果和 UI 结果应该分层

Hashline 的 `LINE:HASH` 对模型和下一次编辑是核心数据，但不适合原样作为人类 UI 的主要内容。理想分层是：

- 模型结果继续保留完整锚点和错误诊断。
- UI 使用私有 presentation metadata 显示普通代码读取卡和真实 diff。
- 锚点仍可在详情或原始输出中查看，但不抢占 diff 的主视觉位置。

### 3. 先固定同一输入，再比较调用成本

后续测试应固定：同一文件内容、同一修改目标、同一读取范围和同一 sandbox 条件，并分别记录：

1. 读取参数。
2. 编辑参数。
3. 工具调用次数。
4. 模型结果文本。
5. 会话卡片类型和展开内容。
6. 文件最终状态。

否则只比较某一次输出，很容易把文件内容差异、重复文本差异和 UI 差异混在一起。

### 4. 默认模式和替换模式要分别验收

`replaceBuiltinEdit=false` 时，用户看到的是独立的 `hashline_read` / `hashline_edit`，工具名本身会影响 Web 行样式。

`replaceBuiltinEdit=true` 时，允许的 Agent 使用 `read` / `edit` 名称，展示层更容易复用原生行为，但仍需要确保卸载和恢复原工具可逆。

两种模式的模型参数契约相同，但会话体验不能用同一张截图代表。

### 5. 错误路径也属于体验

Hashline 的 stale-anchor 错误虽然比原版普通替换失败更长，但它同时给出了当前锚点和“未写入”保证。后续 UI 改造不能为了变得简洁而丢掉：

- 错误码。
- 当前实际锚点。
- 是否已经写入。
- 下一步是直接重试还是先重新读取。

## 暂定后续方向

1. 保持 Hashline 的模型参数和安全语义不变。
2. 为 `hashline_read` 增加 DSH 原生读取卡所需的 presentation metadata。
3. 为 `hashline_edit` 根据真实 `before` / `after` 生成原生 diff metadata；错误时继续回退普通文本。
4. 先在 `replaceBuiltinEdit=true` 模式验证完整原生行体验。
5. 再决定默认 `hashline_*` 工具是否值得增加客户端 keyed row；如果需要，必须单独评估复制宿主 UI 的维护成本。

本草案记录的是当前会话的观察和实测，不代表已经决定要立刻修改实现。

## 后续改进计划（待确认）

> 本节是下一阶段的工作计划，不代表代码已经修改。计划确认后，先保留本文件作为实施记录，再把稳定事实迁移到正式文档。

### 一、目标与验收边界

目标是在不牺牲 Hashline 安全语义的前提下，让它的模型调用方式和 DSH 会话体验尽量接近原版 `read` / `edit`。

必须保留的能力：

- `LINE:HASH` 锚点和过期读取检测。
- 多处编辑一次校验、一次写入的原子性。
- 重叠范围拒绝、文件版本 CAS、sandbox policy 和错误码。
- BOM、LF/CRLF、mixed EOL 和末行无换行的文本保真。
- 全局 `hashline_read` / `hashline_edit` 名称，以及显式 `replaceBuiltinEdit` 才安装 scoped `read` / `edit` 的规则。

优先达到的体验：

- `hashline_read` 成功结果使用 DSH 原生读取卡。
- `hashline_edit` 成功结果使用与 DSH 一致的原生风格 diff 卡；逐行哈希需求超出公开 `DiffBlock` API 时，明确记录最小复刻边界。
- `replaceBuiltinEdit=true` 时，scoped `read` / `edit` 直接使用原生折叠行和图标。
- 默认 `hashline_*` 模式至少复用原生展开卡、文件位置和错误 fallback；工具名造成的折叠行差异单独记录，不伪装成完全一致。

### 二、第一步：文档先行

本文件先记录完整计划和工程实现思路，先复读、检查 Markdown 和工作区，再开始改代码。实施顺序固定为：

1. 维护本节计划和“编码实现思路”。
2. 复核接口、数据流和风险。
3. 先写测试和纯逻辑模块，再改工具注册。
4. 通过构建与单元测试后，再验证当前 DSH 会话卡片。
5. 最后把稳定事实归档到正式文档，并清理本临时草案。

### 三、Host presentation 改造

#### 读取

修改 `src/index.ts` 的本地工具定义类型，使 `output` 支持可选 `presentationMeta`，工具定义支持可选 `presentResult`。不引入 DSH live Service 或运行时实例，只传递可序列化 JSON。

`hashline_read` 的参数保持与原版一致：

- `file_path`：必填。
- `offset`：可选，一基行号。
- `limit`：可选，读取行数上限。

参数名称和说明尽量复用原版 `read`。Hashline 自己的 `readLimit`、`maxLineLength` 和稳定快照校验继续由 Host 执行。

模型-facing 输出改成原版读取 envelope，但内容行仍保留锚点：

```text
<path>...</path>
<type>file</type>
<content>
1|4a31  alpha
2|ff4a  beta

(End of file - total 2 lines)
</content>
```

`presentationMeta` 投影 UI 所需的 `path`、`offset`、`totalLines`、语言提示和独立的 `{ number, hash, text }`；客户端 keyed toolview 把 `number|hash` 传给原生 `ReadBlock` gutter，模型文本也显示完整锚点。`presentResult` 成功时返回原生 `ReadResultView`，错误、旧日志或 metadata 畸形时返回 `undefined`，保留普通文本 fallback。

#### 编辑

为 `hashline_edit` 增加双输入契约：

原版兼容分支：

```json
{
  "file_path": "src/example.ts",
  "old_string": "oldValue",
  "new_string": "newValue",
  "replace_all": false
}
```

Hashline 高级分支继续保留：

```json
{
  "file_path": "src/example.ts",
  "edits": [
    { "set_line": { "anchor": "12:f7a9", "new_text": "newValue" } },
    { "replace_lines": { "start_anchor": "14:abcd", "end_anchor": "16:ef01", "new_text": "block" } },
    { "insert_after": { "anchor": "20:1234", "new_text": "inserted" } }
  ]
}
```

实现取舍：

- 优先用根级 `oneOf` 表达两种互斥输入；用实际 DSH schema 编译验证。
- 如果目标宿主不接受根级 `oneOf`，退回可选字段平面 schema，并在策略、审批和文件 I/O 前做运行时互斥校验。
- 原版分支内部转换成已有的 `replace` 计划，`replace_all` 转为 `all`，不绕过 Hashline 的稳定读取和 CAS。
- 同时提供两种分支、或两种分支都缺失时，统一报 `HASHLINE_INVALID_ARGUMENT`。
- 高级变体继续使用 `anchor`、`start_anchor`、`end_anchor`、`new_text`，不额外增加 `old_string` 等别名，避免模型面对重复字段。
- 工具 description 和 system prompt 把原版分支放在前面：简单唯一文本替换使用原版字段；具体行、范围、插入或多点原子修改使用 `edits`。

### 四、编辑 diff 数据流

新增纯 Host 模块（建议 `src/presentation.ts`），直接使用与 DSH 原生 `tool-fs` 相同的 `diff` 库和三行上下文策略，不复制宿主私有模块。

数据流：

1. `loadStableFile` 得到原始稳定文本。
2. 解析 native 分支或 Hashline 分支，统一成内部 `RawEdit[]`。
3. `planEdits` 验证锚点/范围并生成 `plan.after`。
4. 写入成功后，用原文和最终文本生成紧凑 diff hunks。
5. canonical edit value 只增加可选的内部 `presentation: { diffs }`，不保存完整 before/after。
6. `output.render` 继续生成模型可读的确认文本和更新锚点。
7. `output.presentationMeta` 只返回 `{ diffs }`。
8. `presentResult` 成功时返回 `card: 'diff'`；错误、取消、stale version 和无变化时返回 `undefined`。

diff 只在展示层把 CRLF 统一到 LF、忽略 BOM 影响并去除 unified diff 特殊标记；实际写入仍使用现有文本模型，确保文件保真不变。需要新增 `diff` 运行时依赖并更新 lockfile。

pending 编辑的规则：

- native 分支能从参数直接得到 old/new，因此显示原生 pending diff。
- 锚点分支的 presenter 不允许读文件，无法知道旧文本，显示简洁的 `kind: 'edit'` intent，不伪造 diff。
- 参数中本身有完整 old/new 的嵌套 `replace` 可以显示 pending diff。
- 成功后以真实 before/after hunks 替换 pending 内容。

### 五、前端复用策略

第一优先级是只接入 Host presentation 协议，让 DSH 自己的 `ReadBlock` / `DiffBlock` 渲染卡片。这是真正复用原版 UI 的路径，不复制 CSS 和组件。

`replaceBuiltinEdit=true` 时，工具名已经是 `read` / `edit`，应直接命中宿主原生 keyed row，作为完整体验的主要验收模式。

默认 `hashline_*` 模式的折叠行目前按工具名分类，且原生 `ReadRow` / `FileMutationRow` 不是公开导出。因此不导入 DSH 私有 `src/*` 路径。第一阶段只保证原生展开卡、路径位置、错误 fallback 和结果状态。

若第一阶段截图验收仍认为默认折叠行差异不可接受，再进入客户端适配阶段：

- 使用公开 `tool.call.toolview` Slot 注册 `hashline_read` / `hashline_edit` keyed views。
- 使用公开 UI primitives、owner props 和原生 `ReadBlock` / `DiffBlock`，实现尽量薄的行外壳。
- 对齐标题、图标、路径摘要、展开/折叠、错误状态和文件打开行为。
- 不复制宿主私有源码；若公开 primitives 仍不足以稳定复用，则保留第一阶段结果，并把公开 row component 作为宿主后续接口需求。

### 六、编码实现思路

#### 1. 让核心编辑逻辑和展示逻辑分离

`src/core.ts` 继续只负责文本模型、锚点解析、计划和写入前验证。不要把 React、ToolResult、diff card 或 DSH UI 字段塞进核心编辑算法。

新增的 presentation 模块只接收普通字符串、路径和编辑前后文本，返回自有 JSON diff；这样可以独立测试，也不会污染锚点安全逻辑。

#### 2. 用归一化函数统一两种输入

在 `createEditTool` 前增加一个 `normalizeEditRequest`：

- 识别 native 分支并生成 `[{ replace: { old_text, new_text, all } }]`。
- 识别现有 `edits` 分支并原样交给 `parseEditEntries`。
- 拒绝混合和缺失字段。
- 让后续 `planEdits`、sandbox、write-intent 和 CAS 只有一条执行路径，避免两套安全逻辑产生漂移。

这样新增兼容参数不会复制文件读取和写入流程。

#### 3. 读取结果双通道输出

读取 execute 仍返回带 hash/anchor 的 canonical 行记录。`renderRead` 负责模型文本；`presentationMeta` 和 `presentResult` 负责 UI。UI 使用独立 `{ number, hash, text }` 投影，再把 `LINE|HASH` 传给原生 `ReadBlock` gutter；这不修改 canonical 数据，也不影响下一轮模型调用。

对回放数据做防御性校验：路径、offset、行号递增、totalLines、文本类型和 envelope 不合法时回退 generic，不让旧日志触发渲染异常。

#### 4. 编辑结果只保存最小展示数据

不要把 `loaded.content` 和 `plan.after` 作为 canonical 输出字段长期保存。执行成功后立即计算紧凑 hunks，只把 hunks 放入内部 presentation 字段；模型-facing render 仍只输出确认语句和必要的更新锚点。

这样既能让当前会话显示原生 diff，也避免大文件把结果和日志膨胀。

#### 5. 所有 presentation 都可失败回退

`presentCall` 保持纯函数，不做 I/O；`presentResult` 只读取已经持久化的 metadata。任何 schema 不兼容、旧回放、错误结果或 malformed metadata 都返回 `undefined`，让宿主显示原有文本结果。

presentation 失败不能影响写入结果、CAS、错误码或模型重试路径。

### 七、编码顺序与文件范围

1. 先更新本文件的计划和实现思路，复读并检查工作区。
2. 修改 `package.json` / lockfile，加入 diff 运行时依赖。
3. 新增 `src/presentation.ts` 及其纯逻辑测试。
4. 修改 `src/index.ts` 的结构化工具类型、读取 presentation 和双输入编辑 schema。
5. 修改编辑结果 canonical value、presentation metadata 和结果 presenter。
6. 更新 `test/plugin.test.mjs`，覆盖 schema、presentation、回退和兼容旧调用。
7. 如阶段一验收不足，再修改 `src/client.ts`、client inject 配置和客户端测试，注册 keyed adapter。
8. 更新 `README.md`、`docs/usage.md`、`docs/design.md`、`docs/development.md`，清理草案。

### 八、测试与验收矩阵

必须覆盖：

- native 参数单次替换、删除、`replace_all`、重复匹配和混合字段拒绝。
- 原有四种 Hashline 编辑变体和旧调用格式完全回归。
- 读取锚点同时出现在模型结果和 UI metadata；原生 `ReadBlock` gutter 整体显示灰色不可选的 `LINE|HASH`，正文独立可选且保留高亮。
- read card 的语言、行号、offset、截断和错误 fallback。
- diff card 的单 hunk、多 hunk、插入、删除、CRLF、BOM、末尾无换行、无变化和错误 fallback。
- stale anchor、范围重叠、CAS 竞争和 sandbox 拒绝不产生成功 diff。
- replacement mode 的 scoped `read` / `edit` 注册、回滚、Agent 创建/销毁和原生行显示。
- 若有 keyed adapter，测试 Slot 注册/清理、running/success/error、路径点击和窄窗口布局。

验证命令：

```powershell
npm run check
npm test
npm pack --dry-run --json
```

真实 GUI 验证使用现有 `http://127.0.0.1:3080`，客户端走当前 HMR/刷新路径，Host 走已配置官方 HMR 路径；不重启 DSH、不启动替代服务器。

### 九、正式文档收敛

- `README.md`：更新功能表、FAQ 和原版兼容简单编辑说明。
- `docs/usage.md`：记录双输入 schema、字段说明、选择规则、输出和失败重试。
- `docs/design.md`：记录模型结果/UI presentation 分层、diff metadata、回放 fallback 和工具名限制。
- `docs/development.md`：记录 diff 依赖、测试矩阵和当前 GUI 验证路径。
- 本文件在正式文档稳定后删除或移出发布范围；它当前位于仓库根目录，未列入 package `files`，不会进入发布包。

### 十、风险与回滚

- 宿主不支持 presentation 字段时，继续使用普通 `render`，功能降级但安全逻辑不变。
- 根级 `oneOf` 不兼容时，切换到预先定义的平面可选 schema + 运行时互斥校验。
- pending 锚点编辑没有旧文本是预期限制，宁可 generic，也不显示虚假 diff。
- 默认工具名造成的折叠行差异与 Host 卡片独立；客户端适配器可单独回滚。
- 任一 presentation/客户端错误都必须回退普通工具结果，不得影响 canonical edit、CAS、错误码和模型重试。

---

## 实施记录

> 用户已确认按「后续改进计划」实施。本节记录实施过程中的决定与偏差；稳定事实已经归档到
> `README.md` 与 `docs/*`。本文件作为历史复盘保留，但不进入 npm 发布包。

### 已确认的取舍（对照计划）

- **根级 `oneOf`（已被真实环境否决）**：DSH 的 JSON Schema 验证器支持根级 `oneOf`，但真实模型路由
  在工具列表下发时拒绝无 `type` 的函数参数根节点（`Invalid schema for function 'hashline_edit': schema must
  be a JSON Schema of 'type: "object"', got 'type: null'`），并导致插件工具整体不可用。因此参数根节点保持
  `type: "object"` + `file_path` 必填 + 其余按入口选择。早期同时把 `edits.items` 降为平面 object，后来真实会话
  证明这会诱导模型在一个数组项内填入多个变体并反复失败；现改为 DSH 已支持的嵌套 `items.oneOf` 封闭分支，
  `parseEditEntries` 仍在 sandbox、审批与文件 I/O 前做防御性复验。output schema 可继续使用 oneOf。
- **编辑 canonical value**：不保存完整 `before`/`after`，执行成功后立即计算紧凑 hunks，并利用 hunk 的原始旧/新行范围，从实际行正文加实际行尾计算逐行 `oldHashes/newHashes`，写入可选内部字段 `presentation: { diffs }`；`output.presentationMeta` 只投影 `{ diffs }`，`presentResult` 从持久化 `meta` 还原 diff 卡。schema 同步声明这些可选哈希数组。
- **读取模型文本**：`renderRead` 改为原版读取 envelope（`<path>/<type>/<content>`），内容行保留 `LINE:HASH`；
  `presentationMeta` 投影 `{ number, hash, text }` 行，由客户端映射成原生 `ReadBlock` 的 `LINE|HASH` gutter；`presentResult` 用与原生一致的 envelope 正则提取
  body 作为 `content`。eol/bom 仍留在 canonical value，不进 UI metadata。
- **native 分支**：`old_string`/`new_string`/`replace_all` 在 `normalizeEditRequest` 中转换为内部
  `replace` 计划（`replace_all` → `all`），不绕过 Hashline 的稳定读取、版本 CAS 与写前验证。
- **pending 展示**：native 分支与单条 `edits[].replace` 显示原生 pending diff；锚点分支保持 generic
  `kind: 'edit'` 卡，不伪造 diff。
- **客户端**：为 `hashline_read` / `read` 增加 keyed toolview，直接组合公开的原生 `DisclosureRow`、`StateDot` 与 `ReadBlock`；为 `hashline_edit` / `edit` 增加对应 toolview。公开 `DiffBlock` 无逐行 gutter API，因此编辑卡只复刻原生 diff 的表面/折叠/统计/复制交互，把 `-|旧HASH` / `+|新HASH` 放进灰色、`aria-hidden`、不可选的独立 gutter，正文保持独立可选，复制结果排除哈希 chrome。显式替换内置工具时以 `priority: -100` 阴影 shipped priority `0`；同 priority 注册会冲突且无法覆盖。

### 实施范围

新增 `src/presentation.ts`（envelope / diff / meta 窄化纯逻辑）与 `test/presentation.test.mjs`；修改
`src/index.ts`（ToolDefinition 契约、read/edit presentation、双输入 schema）、`test/plugin.test.mjs`、
`package.json`（新增 `diff` 运行时依赖）、`README.md` 与 `docs/*`。Host HMR 监视列表加入 `lib/presentation.js`。

### 审核修复补记

- 无变化编辑的 `presentationMeta` 改为 `{ diffs: [] }`，保证真实 ToolRuntime 获得 lossless JSON；`presentResult` 再对空 hunks 回退 generic。
- 精确替换改用“归一化匹配视图 + 原文边界映射”，只写回命中区间，保留 mixed EOL 文件未触及区域的原始行尾。
- 读取 envelope footer 恢复模型可见的 `eol` / `bom` 报告；原生读取卡仍复用结构化行投影。
- 成功 diff hunk 使用调用参数 `file_path`，不把解析后的绝对 `displayPath` 暴露给结果卡。
### 最终验证结论

- Host 侧 `presentCall` / `presentResult` 仍返回宿主可理解的 read/diff/generic 视图；成功 edit meta 在基础 `path/oldText/newText` 外附带等长 `oldHashes/newHashes`，畸形或旧回放安全回退 generic。
- 读取 keyed toolview 直接复用公开 `ReadBlock`；编辑 keyed toolview 使用自有 `HashlineDiffBlock`，因为公开 `DiffBlock` 无逐行 gutter API。后者只复刻必要的表面、折叠、统计和复制语义，不宣称直接复用组件。
- 显式替换内置工具必须以 `priority: -100` 阴影 shipped priority `0`。真实 GUI 曾因同 priority/未建立赢家而继续显示 shipped `data-diff`；修正并刷新后，既有 edit 回放命中 `data-hashline-diff`。
- 真实 edit 将 `const beta = 3` 改为 `const beta = 4` 后，DOM 显示灰色不可选 `-|8359` / `+|6ed1` gutter，正文分别保留红/绿；计算样式确认 gutter `user-select: none`、正文 `auto`，跨 gutter Selection 仅返回正文，复制结果排除哈希 chrome。
- GUI 验收还确认 client boot revision 更新且无 `Failed to load plugins` / `waiting for service: styles`。由此形成经验：构建和单元测试只是前置证据，最终必须检查当前进程的 bundle revision、目标 keyed toolview DOM、真实工具结果与选择/复制语义。
- 重启后的最终实机复验已闭环：新 Agent 通过内置 `read` 获取 `1:b6a9` / `3:ae9a`，再只调用一次内置 `edit`，用两个独立 `set_line` 项把三行测试内容改为 `ALPHA` / `beta` / `GAMMA`。当前模型路由接受嵌套 `items.oneOf`，严格 schema 未公开 `old_string` / `new_string` / `replace`，一次调用成功且无重试、审批或文本替换回退；临时文件已清理。
- 由此收敛出可复用排障顺序：先读完整会话结果确认失败参数形状，再检查实际 active profile、工具列表和 schema，最后用新 Agent 做最小真实读写。不能把文件版本 CAS 当作行哈希验证，也不能把构建、单测或 HTTP bundle 可达当作运行态已换新。
