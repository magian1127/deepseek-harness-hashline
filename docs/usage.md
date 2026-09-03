# 使用指南

> 面向使用者的操作说明。设计取舍与实现边界见 `docs/design.md`，本地开发与验证见 `docs/development.md`。

## 工具概览

插件提供两个工具：

| 工具 | 作用 |
| --- | --- |
| `hashline_read` | 读取 UTF-8 文本文件，返回带 `LINE:HASH` 锚点的行 |
| `hashline_edit` | 锚定-only 编辑：`edits` 必填，只接受 `set_line` / `replace_lines` / `insert_after`；简单字面替换用内置 `edit` |

开启“替换内置读写”后，工具以 `read` / `edit` 名称出现，`edit` 与全局 `hashline_edit` 是同一锚定-only 契约。

## 读取

先读取文件并复制锚点：

```json
{
  "file_path": "src/example.js",
  "offset": 1,
  "limit": 200
}
```

- `file_path`：相对调用会话 workspace 的路径。
- `offset`：起始行号，从 1 开始，默认 1。
- `limit`：最多返回的行数，默认和上限为配置 `readLimit`（默认 2000）。

输出为与内置 `read` 相同的 envelope，但内容行使用 `LINE|HASH  内容` 格式：

```text
<path>src/example.js</path>
<type>file</type>
<content>
1|f0c1  function test() {
2|91aa    const value = 123
3|7b02    return value
4|002d  }

(End of file - total 4 lines)
</content>
```

读取展示格式为 `LINE|HASH  内容`；编辑参数中的锚点仍是 `LINE:HASH`。哈希是该行文本与真实行尾连接后的 SHA-256 前缀，覆盖完整行和真实行尾；
长行仅截断显示，不截断哈希输入。会话中读取成功会复用原生 `ReadBlock` 的布局、折叠、复制和语法高亮；完整
`LINE|HASH` 位于同一个灰色、不可选中的 gutter 中，正文位于独立且可选择的 content 区域。将显示分隔符 `|` 换为 `:` 即得到编辑所需的 `LINE:HASH` 锚点。模型-facing envelope 还会报告 `eol` 与 `bom`。

## 编辑

`hashline_edit` 是锚定-only 入口（参数根 schema 保持 `type: object`）：`edits` 必填且非空，
每项是扁平对象——`op` 取 `set_line`、`replace_lines`、`insert_after` 之一，配齐对应锚点字段
与 `new_text`（op 与字段的匹配在执行层校验）。简单唯一文本替换是内置 `edit`
（`old_string` / `new_string`）的职责——传入 `old_string` / `new_string` / `replace_all` 或
`edits[].replace` 会在任何文件操作前以 `HASHLINE_INVALID_ARGUMENT` 拒绝，并指引改用内置 `edit`。

所有输入都经过相同的稳定读取、版本 CAS 与写前验证。历史嵌套变体形状
（`{"set_line": {"anchor": ...}}`）仍被接受用于旧回放，但 schema 主形状是扁平 `op` 判别形式：
嵌套从四层降到两层（根 → 数组 → 平铺键值），消灭模型生成深层嵌套 JSON 时频繁出现的
字段提升、数组项物化到顶层等结构损坏。

替换内置工具后的 `edit` 与全局 `hashline_edit` 是同一契约：`edits` 必填且非空，只允许锚定的
`set_line`、`replace_lines`、`insert_after`；旧回放和绕过 schema 的直接调用传入字面替换参数时同样在文件操作前被拒绝。

### 修改单行（set_line）

```json
{
  "file_path": "src/example.js",
  "edits": [
    { "op": "set_line", "anchor": "2:91aa", "new_text": "  const value = 456" }
  ]
}
```

### 一次执行多个互不重叠的编辑

```json
{
  "file_path": "src/example.js",
  "edits": [
    { "op": "replace_lines", "start_anchor": "2:91aa", "end_anchor": "3:7b02", "new_text": "  const value = 456\n  return value" },
    { "op": "insert_after", "anchor": "4:002d", "new_text": "\nexport { test }" }
  ]
}
```

### 方言回收（宽容但可观测）

模型路由/适配器有时会把工具参数结构破坏——字段被提升到参数根（`anchor` / `new_text`
散落在顶层）、数组项被物化为根级数字键（`"0"` / `"1"`）、变体对象只剩空壳。只要这些
形状能**无歧义**地恢复出锚定操作，`hashline_edit` 会自动回收并在结果里注明
`normalizedFrom`（`hoisted-fields` / `numeric-keys` / `deduped` / `top-level`），同一操作
的多份全等影子折叠为一次写入；字段值冲突或无法归属时拒绝且不写入，错误附带收到的
结构指纹与可直接复制的正确形状模板。回收不改变安全模型：恢复出的操作仍走同一稳定
快照校验、重叠拒绝与版本 CAS。

## 注意事项

- `old_string` / `new_string` / `replace_all` 与 `edits[].replace` 已在 0.2.0 移除；传给 `hashline_edit` 会被拒绝并指引使用内置 `edit` 做简单字面替换。适配器为未选变体物化的空哨兵（`''` / `false` / 空对象）仍被容忍忽略。
- `edits` 的每个数组项是一个扁平对象：`op` 选择操作，`set_line`/`insert_after` 只允许 `op`、`anchor`、`new_text`，`replace_lines` 只允许 `op`、`start_anchor`、`end_anchor`、`new_text`；传入另一操作的锚点字段会以 `HASHLINE_INVALID_ARGUMENT` 拒绝。多个位置的修改拆成多个数组项。历史嵌套变体形状（`{"set_line": {...}}`）仍被接受用于旧回放。
- 锚点分隔符推荐 `:`，直接从读取输出抄来的 `|` 也被接受并等价处理。
- `set_line` / `replace_lines` 的空 `new_text` 表示删除；要写入一个有行尾的空白行，使用 `"\n"`。
- `insert_after.new_text` 不允许为空。
- 开启“替换内置读写”后，`read` 保持 Hashline 读取参数；`edit` 与全局 `hashline_edit` 是同一锚定-only 契约。
- 读取与编辑均限制为最多 50 KiB 的 UTF-8 字节：超过限制的文件会在读取正文前拒绝；单个 `new_text`/`content` 参数也不得超过此上限。大文件请拆分读取或使用内置 `read` 工具。
- 复制锚点必须来自**最新一次**读取输出。哈希不匹配时，若全文件恰有一行与锚点哈希一致则自动重定位到该行，否则表示未写入，应使用报错里给出的新锚点或重新读取。

## 会话呈现

- `hashline_read` 成功结果复用 DSH 原生 `ReadBlock`（复制、折叠、语言高亮、`showing N of M`）；完整 `LINE|HASH` 是灰色且不可选的 gutter，正文独立可选，模型-facing 文本保留同一锚点。
- `hashline_edit` 成功结果显示为原生风格 diff 卡，diff 由实际写入前后的真实文本计算：删除行以灰色不可选 gutter `-|旧HASH` 开头，新增行以 `+|新HASH` 开头，正文与 gutter 分离且可单独选择；红/绿语义、折叠、统计与复制语义和原生卡一致，复制内容不含哈希 gutter（展示层把 CRLF 归一到 LF 并忽略 BOM，实际写入保真不变）。
- 锚定编辑没有旧文本可展示，运行前保持通用编辑卡，不伪造 diff；成功后的 diff 卡由实际写入前后的真实文本计算。
- 错误、无变化、过期锚点或畸形回放数据一律回退普通文本结果；无变化 metadata 使用空 `diffs`（合法 JSON），不会把成功调用转成输出错误。

## 安全模型

一次编辑（全局 `hashline_edit` 或替换内置后的 `edit`）按以下顺序执行：

1. 根据调用会话的 workspace 解析路径和 sandbox policy；
2. 读取文件，并在前后两次 `stat` 版本一致时接受该快照；
3. 发布 `fs/observed`，让 DSH 文件观察策略记录当前版本；
4. 针对同一快照校验全部锚点和编辑范围；
5. 通过 `fs/write-intent` 组合其它策略；
6. 使用 `replaceIfVersion` 原子写入；
7. 写入成功后发布新版本的 `fs/observed`。

因此锚点过期、范围冲突或版本竞争都在写入前失败。短哈希仍有理论碰撞概率（默认 4 hex 相当于 16 位校验），
与行号和文件级版本 CAS 联合使用；高风险部署可在配置中提高 `hashLength`。

## 配置

bundle 默认配置位于 `cordis.patch.yml`：

下表严格按照“设置 → 插件 → 插件配置 → 哈希锚点编辑”卡片从上到下排列：

| 字段 | 默认值 | 说明 |
| --- | ---: | --- |
| `enabled` | true | 全局启停两个 Hashline 工具及提示词；设置卡片保持可用 |
| `replaceBuiltinEdit` | false | 在允许编辑的智能体作用域替换内置 `read` / `edit`；替换后的 `edit` 强制使用最新 `LINE:HASH`，不公开文本替换或 `replace`。**极简模式（minimal 预设）下不替换**：仅在 Agent 作用域隐藏全局 `hashline_read` / `hashline_edit` |
| `promptGuidance` | true | 是否注册简短工具选用提示；替换内置读写开启时，提示以同名 section 阴影在 Agent 作用域替换内置 `read` / `edit` 原提示 |
| `zhPrompt` | false | 提示词中文化：注入的提示词与工具说明改为中文，工具名保持英文 |
| `hashLength` | 4 | 3–16 位十六进制哈希；改变后旧锚点全部失效 |
| `readLimit` | 2000 | 单次读取最大行数 |
| `maxLineLength` | 500 | 单行显示截断阈值，哈希仍覆盖完整行 |
| `contextLines` | 2 | 首个变更点前后的上下文行数，范围 0–20；编辑成功文本会标注窗口范围（如 `lines 2-6 of 6`）并指引重读全文件，避免把局部预览误读为缺行 |

`cordis.patch.yml` 中的值是部署组合基线。在自然下一次启动或已验证的安装通道生效后，可在“设置 → 插件 → 插件配置 → 哈希锚点编辑”中
保存用户覆盖；“恢复默认值”会清除用户层字段并重新继承组合基线。设置实时生效。

替换模式只在智能体原本能看到 `read`、`edit`、`hashline_read`、`hashline_edit` 时安装，避免绕过配置的
工具限制；若同一智能体已有其它作用域的 `read` 或 `edit`，插件保留该定义并回滚整组替换、记录告警。
新建的子智能体同样遵循此规则。也可在 profile 的 `cordis.patch.yml` 中按 id `tool-hashline` 覆盖整行配置
（DSH patch 会替换完整 `config`，不会深度合并，覆盖时应重述所有需要保留的字段）。
