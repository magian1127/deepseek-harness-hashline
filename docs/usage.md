# 使用指南

> 面向使用者的操作说明。设计取舍与实现边界见 `docs/design.md`，本地开发与验证见 `docs/development.md`。

## 工具概览

插件提供两个工具：

| 工具 | 作用 |
| --- | --- |
| `hashline_read` | 读取 UTF-8 文本文件，返回带 `LINE:HASH` 锚点的行 |
| `hashline_edit` | 编辑文件：支持原版风格简单替换，也支持锚点原子编辑（`set_line` / `replace_lines` / `insert_after` / `replace`） |

开启“替换内置读写”后，工具以 `read` / `edit` 名称出现，参数结构不变。

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

`hashline_edit` 接受两种互斥输入，一次调用只能选择一种（参数 schema 为平面可选字段，互斥在调用执行前校验；两种都提供或都缺失都会以 `HASHLINE_INVALID_ARGUMENT` 拒绝，且不会触发任何文件操作）：

- **原版风格**：`old_string` / `new_string`（可选 `replace_all`），适合简单且唯一的文本替换；
- **Hashline 风格**：`edits` 数组，适合具体行、范围、插入或多点原子修改。

两种输入都会经过相同的稳定读取、版本 CAS 与写前验证。

### 简单文本替换（原版风格）

```json
{
  "file_path": "src/example.js",
  "old_string": "const value = 123",
  "new_string": "const value = 456"
}
```

- `old_string` 必须非空且与 `new_string` 不同。
- 默认要求全文唯一匹配；有多个匹配时需传 `replace_all: true`，或改用更长的 `old_string`。
- 空 `new_string` 表示删除匹配内容。

### 修改单行（set_line）

```json
{
  "file_path": "src/example.js",
  "edits": [
    {
      "set_line": {
        "anchor": "2:91aa",
        "new_text": "  const value = 456"
      }
    }
  ]
}
```

### 一次执行多个互不重叠的编辑

```json
{
  "file_path": "src/example.js",
  "edits": [
    {
      "replace_lines": {
        "start_anchor": "2:91aa",
        "end_anchor": "3:7b02",
        "new_text": "  const value = 456\n  return value"
      }
    },
    {
      "insert_after": {
        "anchor": "4:002d",
        "new_text": "\nexport { test }"
      }
    }
  ]
}
```

### 精确替换逃生舱（replace）

```json
{
  "file_path": "src/example.js",
  "edits": [
    {
      "replace": {
        "old_text": "oldName",
        "new_text": "newName",
        "all": true
      }
    }
  ]
}
```

## 注意事项

- 原版风格（`old_string` / `new_string`）与 `edits` 数组**不能混用**，也不可同时缺失。
- 锚定编辑（`set_line` / `replace_lines` / `insert_after`）与 `edits` 内的 `replace` **不能在一次调用中混用**。
- `set_line` / `replace_lines` 的空 `new_text` 表示删除；要写入一个有行尾的空白行，使用 `"\n"`。
- `insert_after.new_text` 不允许为空。
- 原版风格与 `edits[].replace` 都是严格字符串匹配；匹配时自动兼容 CRLF↔LF，写回只替换命中区间并保留 mixed EOL 文件中未触及区域的原始行尾；不做空白折叠或模糊匹配。
- 开启“替换内置读写”后参数结构不变，只是工具调用名由 `hashline_read` / `hashline_edit` 变为 `read` / `edit`。
- 复制锚点必须来自**最新一次**读取输出。哈希不匹配时，若全文件恰有一行与锚点哈希一致则自动重定位到该行，否则表示未写入，应使用报错里给出的新锚点或重新读取。

## 会话呈现

- `hashline_read` 成功结果复用 DSH 原生 `ReadBlock`（复制、折叠、语言高亮、`showing N of M`）；完整 `LINE|HASH` 是灰色且不可选的 gutter，正文独立可选，模型-facing 文本保留同一锚点。
- `hashline_edit` 成功结果显示为原生风格 diff 卡，diff 由实际写入前后的真实文本计算：删除行以灰色不可选 gutter `-|旧HASH` 开头，新增行以 `+|新HASH` 开头，正文与 gutter 分离且可单独选择；红/绿语义、折叠、统计与复制语义和原生卡一致，复制内容不含哈希 gutter（展示层把 CRLF 归一到 LF 并忽略 BOM，实际写入保真不变）。
- 原版风格与单条 `edits[].replace` 的调用在运行前就显示 pending diff；锚点编辑没有旧文本，保持通用编辑卡，不伪造 diff。
- 错误、无变化、过期锚点或畸形回放数据一律回退普通文本结果；无变化 metadata 使用空 `diffs`（合法 JSON），不会把成功调用转成输出错误。

## 安全模型

一次编辑（无论是原版风格还是锚点风格）按以下顺序执行：

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

| 字段 | 默认值 | 说明 |
| --- | ---: | --- |
| `enabled` | true | 全局启停两个 Hashline 工具及提示词；设置卡片保持可用 |
| `replaceBuiltinEdit` | false | 在每个允许编辑的智能体作用域以哈希锚点读/写工具替换内置 `read` / `edit` 入口 |
| `hashLength` | 4 | 3–16 位十六进制哈希；改变后旧锚点全部失效 |
| `readLimit` | 2000 | 单次读取最大行数 |
| `maxLineLength` | 500 | 单行显示截断阈值，哈希仍覆盖完整行 |
| `contextLines` | 2 | 失败与成功预览两侧的上下文行数，范围 0–20 |
| `promptGuidance` | true | 是否注册简短工具选用提示 |

`cordis.patch.yml` 中的值是部署组合基线。安装并重启后，可在“设置 → 插件 → 插件配置 → 哈希锚点编辑”中
保存用户覆盖；“恢复默认值”会清除用户层字段并重新继承组合基线。设置实时生效。

替换模式只在智能体原本能看到 `read`、`edit`、`hashline_read`、`hashline_edit` 时安装，避免绕过配置的
工具限制；若同一智能体已有其它作用域的 `read` 或 `edit`，插件保留该定义并回滚整组替换、记录告警。
新建的子智能体同样遵循此规则。也可在 profile 的 `cordis.patch.yml` 中按 id `tool-hashline` 覆盖整行配置
（DSH patch 会替换完整 `config`，不会深度合并，覆盖时应重述所有需要保留的字段）。
