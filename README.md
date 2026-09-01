# deepseek-harness-hashline

[中文](README.md) · [English](README.en.md)

> ⚠️ **测试中（experimental）**
>
> **当前仍处于测试阶段，请勿用于正式项目。** 使用本插件所带来的一切风险由使用者自行承担。
>
> 接口、配置项和工具行为可能随时变更，恕不另行通知；在真实工作区启用前请先在隔离环境充分验证。

<p align="center">
  <img alt="状态 测试中" src="https://img.shields.io/badge/状态-测试中-ff6b6b">
  <img alt="版本 0.2.0" src="https://img.shields.io/badge/版本-0.2.0-5965d8">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-3b7a57">
</p>

**DeepSeek Harness 哈希锚点文件编辑插件**：提供 `hashline_read` 和 `hashline_edit`，用
`LINE:HASH` 联合锚点把编辑绑定到模型最近读取过的具体行内容，解决同一文件多轮修改、多处原子修改、
CRLF/LF 或空白漂移时的机械可靠性问题。

`hashline_edit` 是锚定-only 入口：`edits` 必填，只接受 `set_line`、`replace_lines`、
`insert_after` 三种操作；简单唯一文本替换请使用内置 `edit`（`old_string` / `new_string`），
新文件用 `write`。传入 `old_string` / `new_string` / `edits[].replace` 会在任何文件操作前被
拒绝并明确指引改用内置 `edit`。开启“替换内置读写”后，允许编辑的智能体改用同名严格锚定的
`read` / `edit`，行为与全局工具完全一致。

## 功能

| 能力 | 说明 |
| --- | --- |
| `LINE:HASH` 读取 | `LINE\|HASH  内容` 格式，默认 4 位十六进制 SHA-256 前缀；模型结果同时报告 EOL/BOM |
| 三种锚定编辑 | `set_line`、`replace_lines`、`insert_after`；`edits` 必填且每个数组项只能包含一个操作 |
| 原子批量编辑 | 一次调用全部锚点先校验、重叠先拒绝，再原子写入 |
| 版本 CAS 保护 | 使用 DSH 文件版本防止校验后到写入前的并发覆盖 |
| 文本保真 | 保留 UTF-8 BOM、LF/CRLF、mixed EOL 未触及区域和文件末尾换行状态 |
| 失效恢复 | 唯一哈希匹配自动重定位；否则返回附近当前行，坏锚点报错回显真实锚点 |
| 原生结果卡片 | 读取成功复用 DSH 原生 `ReadBlock`：完整 `LINE|HASH` 为灰色不可选 gutter，正文独立可选并保留语法高亮；编辑成功显示原生风格 diff 卡，删除/新增行以灰色不可选 `-|旧HASH` / `+|新HASH` gutter 开头，正文保持原生红绿语义 |
| 可逆严格替换 | 开启“替换内置读写”后，Agent scoped `edit` 只接受最新 `LINE:HASH` 锚点；覆盖可逆并随 Cordis Fiber 清理 |
| 提示词中文化 | 开启后注入的提示词与工具说明改为中文，工具名保持英文 |

## 环境要求

- DeepSeek Harness ≥ 0.1.2-alpha.1，默认 profile 为 `web`
- Node.js `^22.19.0 || >=24.0.0`
- 网页配置卡片还要求 DSH 包含 `settings.register(..., { exposeToClients: true })` 支持

## 安装

推荐使用本插件的统一安装 CLI（与 `deepseek-harness-zh_pro`、`deepseek-harness-zhipu_plan_tools` 的
`node bin/dsh-*.mjs install` 风格一致）。首次源码联调先安装依赖并生成运行产物（`npm install` 会执行
`prepare` 自动构建；源码更新后重新构建）：

```powershell
npm install
npm run build

node bin/dsh-hashline.mjs install --profile web --link $PWD
```

`--link` 必须指向本插件源码目录；它等价于 `dsh plugin --profile web add "link:<绝对路径>/deepseek-harness-hashline"`。
DSH 依据包的 `dsh.bundle` 声明把本包装进 profile 的 `dsh.profile.bundles`，重启一次 `dsh web` 后自动挂载
（本插件不做热行部署，也不复制 dsh-zh 的热安装监督器）。

> ⚠️ `link:` 目标目录不存在时，DSH 会把本包判为普通依赖：既不报错，也无法挂载（`dsh.profile.bundles`
> 不会包含它）。安装后用 `status` 确认通道就绪：

```powershell
node bin/dsh-hashline.mjs status --profile web
#  依赖:      link:.../deepseek-harness-hashline
#  bundle 通道: 已就绪（重启自动挂载）   ← 此行应为“已就绪”
```

也可以手动使用底层命令并检查组合：

```powershell
dsh plugin --profile web add "link:<绝对路径>/deepseek-harness-hashline"
dsh --profile web --dump-config
```

## 更新

重新执行安装命令即可更新依赖与持久 bundle。浏览器端内容更新后刷新页面；使用本地 `link:` 开发时，
主机文件在 DSH HMR 服务可用时自动热重载；不可用时检查本插件的精确自监视路径并报告，不能以重启代替。

## 卸载

```powershell
node bin/dsh-hashline.mjs remove --profile web
# 等价于：dsh plugin --profile web remove deepseek-harness-hashline
```

卸载会清理持久 bundle 与运行中条目，不会删除 DSH 会话数据。`settings` 命名空间 `hashline` 中已有的
用户覆盖值可能保留，重新安装后可继续使用。

## 设置与数据

| 数据 | 存储位置 |
| --- | --- |
| 启用、替换内置读写、工具选择提示、提示词语言及四个哈希/读取参数 | DSH `settings` 命名空间 `hashline`（在“设置 → 插件 → 插件配置”中编辑） |

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

**“替换内置读写”怎么用？** 开启后，允许编辑的智能体看到的是严格锚定的 `read` / `edit`，
`hashline_read` / `hashline_edit` 被隐藏。每次修改先用 `read` 获取最新锚点；`edit.edits` 的每个数组项只能包含
  一个 `set_line`、`replace_lines` 或 `insert_after`。关闭开关恢复原工具。
替换只在智能体原本能看到四个相关工具时安装，避免绕过配置限制；系统提示也在该智能体作用域内同步替换，关闭后恢复。**极简模式（minimal 预设）下不安装替换**：插件只在该智能体作用域隐藏全局 `hashline_read` / `hashline_edit`，保持“仅持久 shell + str_replace_editor”的双工具组合不被第三方能力突破；该隐藏**不依赖“替换原版工具”开关**，关闭替换后对极简 agent 同样生效。

## 开发文档

- [使用指南](docs/usage.md)：工具参数、锚点格式、编辑变体与安全模型
- [设计说明](docs/design.md)：工具边界、锚点、文本模型、DSH 集成、包形态
- [开发指南](docs/development.md)：本地开发安装、HMR、测试与验证

## License

[MIT](LICENSE)
