# 使用指南

> 面向使用者的操作说明。设计取舍与实现边界见 `docs/design.md`，本地开发与验证见 `docs/development.md`。

## 工具概览

插件提供两个工具：

| 工具 | 作用 |
| --- | --- |
| `hashline_read` | 读取 UTF-8 文本文件，返回带 `LINE:HASH` 锚点的行 |
| `hashline_edit` | 基于锚点做原子编辑（`set_line` / `replace_lines` / `insert_after` / `replace`） |

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

输出示例：

```text
1:f0c1|function test() {
2:91aa|  const value = 123
3:7b02|  return value
4:002d|}
```

锚点格式为 `LINE:HASH`。哈希是该行文本与真实行尾连接后的 SHA-256 前缀，覆盖完整行和真实行尾；
长行仅截断显示，不截断哈希输入。结果会报告 BOM 和 LF/CRLF 风格。

## 编辑

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

- 锚定编辑（`set_line` / `replace_lines` / `insert_after`）与 `replace` **不能在一次调用中混用**。
- `set_line` / `replace_lines` 的空 `new_text` 表示删除；要写入一个有行尾的空白行，使用 `"\n"`。
- `insert_after.new_text` 不允许为空。
- `replace` 是字节解码后的严格字符串匹配；跨行匹配时 `old_text` 必须使用文件实际的 LF/CRLF，不确定时优先使用锚定变体。
- 开启“替换内置读写”后参数结构不变，只是工具调用名由 `hashline_read` / `hashline_edit` 变为 `read` / `edit`。
- 复制锚点必须来自**最新一次**读取输出；哈希不匹配时表示未写入，应使用报错里给出的新锚点或重新读取。

## 安全模型

一次锚定编辑按以下顺序执行：

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
