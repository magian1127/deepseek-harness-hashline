# deepseek-harness-hashline

[中文](README.md) · [English](README.en.md)

> ⚠️ **测试中（experimental）**
>
> **当前仍处于测试阶段，请勿用于正式项目。** 使用本插件所带来的一切风险由使用者自行承担。
>
> 接口、配置项和工具行为可能随时变更，恕不另行通知；在真实工作区启用前请先在隔离环境充分验证。

<p align="center">
  <img alt="状态 测试中" src="https://img.shields.io/badge/状态-测试中-ff6b6b">
  <img alt="版本 0.3.2" src="https://img.shields.io/badge/版本-0.3.2-5965d8">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-3b7a57">
</p>

**DeepSeek Harness 哈希锚点文件编辑插件**：提供 `hashline_read` 和 `hashline_edit`，用
`LINE:HASH` 联合锚点把编辑绑定到模型最近读取过的具体行内容，解决同一文件多轮修改、多处原子修改、
CRLF/LF 或空白漂移时的机械可靠性问题。

`hashline_edit` 是锚定-only 入口：`edits` 必填，每项是扁平对象——`op` 取 `set_line`、
`replace_lines`、`insert_after` 之一，配 `anchor`（或 `start_anchor`+`end_anchor`）与
`new_text`；`op` 可缺省：只带 `anchor`+`new_text` 时按 `set_line` 解析，只带
`start_anchor`+`end_anchor`+`new_text` 时按 `replace_lines` 解析（忘传 `op` 的高频方言与
显式声明等价）。简单唯一文本替换请使用内置 `edit`（`old_string` / `new_string`），新文件用
`write`。传入 `old_string` / `new_string` / `edits[].replace` 的实际载荷会在任何文件操作前被拒绝并明确
指引改用内置 `edit`（对齐官方 v0.1.2：未使用字段的 `null` 占位按未提供忽略）。模型/适配器常见的畸形传参（字段被提升到参数根、数组项被物化为根级
数字键、变体空壳、忘传 `op`）只要无歧义就会被自动回收并在结果中注明，无法恢复时报错附带结构指纹与
正确形状模板。开启“替换内置读写”后，允许编辑的智能体改用同名严格锚定的
`read` / `edit`，行为与全局工具完全一致。
Open Design（`open-design` profile）与 DSH 一次性 `headless` 默认仍使用原版 `read` / `edit`；只有额外开启默认关闭的“无头模式替换内置读写”后，严格替换才在这些无头会话生效，显式 `hashline_*` 在门控关闭时仍可用。

## 功能

| 能力 | 说明 |
| --- | --- |
| `LINE:HASH` 读取 | `LINE\|HASH  内容` 格式，默认 4 位十六进制 SHA-256 前缀；模型结果同时报告 EOL/BOM |
| 三种锚定编辑 | `set_line`、`replace_lines`、`insert_after`；`edits` 每项为扁平 `{op, anchor…, new_text}` 对象，执行前校验 op 与字段匹配 |
| 方言回收 | 顶层散落字段、数字键影子、变体空壳、忘传 `op`（按字段形状推断：`anchor+new_text`→`set_line`，双锚点→`replace_lines`）等无歧义畸形传参被自动恢复并在结果注明 `normalizedFrom`；冲突即拒绝且不写入 |
| 原子批量编辑 | 一次调用全部锚点先校验、重叠先拒绝，再原子写入 |
| 版本 CAS 保护 | 使用 DSH 文件版本防止校验后到写入前的并发覆盖 |
| 文本保真 | 保留 UTF-8 BOM（字节路径检测：`fs.readBytes` + 保留 BOM 解码，旧 DSH 回退 `readText`）、LF/CRLF、mixed EOL 未触及区域和文件末尾换行状态 |
| 失效恢复 | 唯一哈希匹配自动重定位；否则返回附近当前行，坏锚点报错回显真实锚点 |
| 原生结果卡片 | 读取成功复用 DSH 原生 `ReadBlock`：完整 `LINE|HASH` 为灰色不可选 gutter，正文独立可选并保留语法高亮；编辑成功显示原生风格 diff 卡，删除/新增行以灰色不可选 `-行号|旧HASH` / `+行号|新HASH` gutter 开头（行号为对应旧/新文件中的 1 基行号），正文保持原生红绿语义 |
| 可逆严格替换 | 开启“替换内置读写”后，Agent scoped `edit` 只接受最新 `LINE:HASH`；Open Design/DSH headless 还需开启默认关闭的无头门控；覆盖可逆并随 Cordis Fiber 清理 |
| 提示词中文化 | 开启后注入的提示词、工具说明、错误消息与工具输出文案改为中文，工具名保持英文 |

## 环境要求

- DeepSeek Harness ≥ 0.1.5-rc.1；Web GUI 使用 `web` profile，Open Design stdio 使用 `open-design` profile，DSH 一次性任务使用 `headless` profile
- Node.js `^22.19.0 || >=24.0.0`
- 网页配置卡片还要求 DSH 包含 `settings.register(..., { exposeToClients: true })`；`open-design`/`headless` 只运行 Host 半边

## 安装

DSH 的 bundle 按 profile 隔离，因此 Web、Open Design 与 stock headless 必须分别安装。Web 可使用本插件 CLI；无头 profile 使用官方 `dsh plugin`。首次源码联调先安装依赖并生成运行产物：

```powershell
npm install
npm run build

# Web GUI
node bin/dsh-hashline.mjs install --profile web --link $PWD

# Open Design 的真实 stdio profile
dsh plugin --profile open-design add "link:$PWD"

# 可选：DSH 自带的一次性 headless profile
dsh plugin --profile headless add "link:$PWD"
```

`--link` 必须指向本插件源码目录。三种安装都只写目标 profile 的持久 bundle；`open-design`/`headless` 的下一次短进程自然加载，不依赖 3080 Web 探测或 HMR。

> ⚠️ `link:` 目标目录不存在时，DSH 会把本包判为普通依赖：既不报错，也无法加入 `dsh.profile.bundles`。安装后分别确认：

```powershell
node bin/dsh-hashline.mjs status --profile web
dsh plugin --profile open-design list
dsh --profile open-design --dump-default-config
dsh plugin --profile headless list
```

## 更新

重新执行安装命令即可更新依赖与持久 bundle。浏览器端内容更新后刷新页面；使用本地 `link:` 开发时，
主机文件在 DSH HMR 服务可用时自动热重载；不可用时检查本插件的精确自监视路径并报告，不能以重启代替。

## 卸载

```powershell
node bin/dsh-hashline.mjs remove --profile web
dsh plugin --profile open-design remove deepseek-harness-hashline
dsh plugin --profile headless remove deepseek-harness-hashline
```

卸载按 profile 独立清理持久 bundle 与运行中条目，不会删除 DSH 会话数据。`settings` 命名空间 `hashline` 中已有的用户覆盖值可能保留，重新安装后可继续使用。

## 设置与数据

| 数据 | 存储位置 |
| --- | --- |
| 启用、替换内置读写、无头模式替换门控、工具选择提示、提示词语言及四个哈希/读取参数 | DSH `settings` 命名空间 `hashline`（在“设置 → 插件 → 插件配置”中编辑） |

插件不注册模型工具以外的额外能力、不上传数据、不维护独立数据文件。客户端只向现有
`settings.plugin.item` Slot 贡献配置卡片，通过 DSH `settingsScope` 读写同一 Host 命名空间。
设置卡的准确顺序、默认值和范围只在[使用指南的“配置”章节](docs/usage.md#配置)维护。

## 常见问题

**它和内置 `read` / `edit` 有什么区别？** 内置工具按文本操作；Hashline 把锚定编辑绑定到
“最近读取过的具体行内容”的哈希锚点，能检测过期读取，并把多处修改作为一次原子请求处理。
`hashline_edit` 只接受锚定 `edits`——简单唯一文本替换是内置 `edit` 的职责，两者互补而不重叠。
此外，Hashline 读取接入 DSH 原生读取卡，编辑结果使用原生风格 diff 卡。

**哈希会碰撞吗？** 短哈希有理论碰撞概率：默认 4 hex 相当于 16 位校验，与行号和文件级版本 CAS 联合使用；
高风险部署可在配置中提高 `hashLength`。

**大文件怎么读？** 不带 `offset`/`limit` 的整体读取限制为 50 KiB，超过时工具会提示改用窗口；显式带上
`offset`/`limit` 即可分窗口读取任意大小的文件，窗口读取与编辑均不受整文件大小限制（单条 `new_text`
仍受 50 KiB 上限约束）。

**“替换内置读写”怎么用？** 开启后，允许编辑的智能体看到的是严格锚定的 `read` / `edit`，`hashline_read` / `hashline_edit` 被隐藏。每次修改先用 `read` 获取最新锚点；`edit.edits` 的每项是扁平对象——`op` 取 `set_line`、`replace_lines` 或 `insert_after`，配 `anchor`（或 `start_anchor`+`end_anchor`）与 `new_text`。关闭开关恢复原工具。

Open Design 的 `open-design` stdio profile 与 DSH 的 `headless` profile 都必须同时开启紧随其后的“无头模式替换内置读写”（默认关闭）。门控关闭时保留原版 `read` / `edit`，同时仍可显式调用 `hashline_read` / `hashline_edit`。替换只在四个相关工具原本均可见时安装；**minimal 预设仍不安装替换**，并继续隐藏全局 Hashline 工具。

## 开发文档

- [使用指南](docs/usage.md)：工具参数、锚点格式、编辑变体与安全模型
- [设计说明](docs/design.md)：工具边界、锚点、文本模型、DSH 集成、包形态
- [开发指南](docs/development.md)：本地开发安装、HMR、测试与验证

## License

[MIT](LICENSE)
