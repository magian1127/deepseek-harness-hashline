# deepseek-harness-hashline

[中文](README.md) · [English](README.en.md)

> ⚠️ **测试中（experimental）**
>
> **当前仍处于测试阶段，请勿用于正式项目。** 使用本插件所带来的一切风险由使用者自行承担。
>
> 接口、配置项和工具行为可能随时变更，恕不另行通知；在真实工作区启用前请先在隔离环境充分验证。

<p align="center">
  <img alt="状态 测试中" src="https://img.shields.io/badge/状态-测试中-ff6b6b">
  <img alt="版本 0.1.0" src="https://img.shields.io/badge/版本-0.1.0-5965d8">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-3b7a57">
</p>

**DeepSeek Harness 哈希锚点文件编辑插件**：提供 `hashline_read` 和 `hashline_edit`，用
`LINE:HASH` 联合锚点把编辑绑定到模型最近读取过的具体行内容，解决同一文件多轮修改、多处原子修改、
CRLF/LF 或空白漂移时的机械可靠性问题。

`hashline_edit` 同时接受两种输入：简单的唯一文本替换可直接使用原版风格参数
（`old_string` / `new_string` / `replace_all`），需要锚定编辑时再使用 `edits` 列表。默认模式补充
内置 `read` / `edit`：新文件仍用 `write`。也可在配置中开启“替换内置读写”，让允许编辑的智能体直接以
`read` / `edit` 名称使用哈希锚点格式。

## 功能

| 能力 | 说明 |
| --- | --- |
| `LINE:HASH` 读取 | `LINE\|HASH  内容` 格式，默认 4 位十六进制 SHA-256 前缀；模型结果同时报告 EOL/BOM |
| 原版风格编辑 | `old_string` / `new_string` / `replace_all` 简单唯一文本替换，自动转换进安全写入链路 |
| 三种锚定编辑 | `set_line`、`replace_lines`、`insert_after` |
| 精确替换逃生舱 | `edits` 内的 `replace` 严格精确匹配（CRLF↔LF 自动归一），默认要求唯一匹配 |
| 原子批量编辑 | 一次调用全部锚点先校验、重叠先拒绝，再原子写入 |
| 版本 CAS 保护 | 使用 DSH 文件版本防止校验后到写入前的并发覆盖 |
| 文本保真 | 保留 UTF-8 BOM、LF/CRLF、mixed EOL 未触及区域和文件末尾换行状态 |
| 失效恢复 | 唯一哈希匹配自动重定位；否则返回附近当前行，坏锚点报错回显真实锚点 |
| 原生结果卡片 | 读取成功复用 DSH 原生 `ReadBlock`：完整 `LINE|HASH` 为灰色不可选 gutter，正文独立可选并保留语法高亮；编辑成功显示原生风格 diff 卡，删除/新增行以灰色不可选 `-|旧HASH` / `+|新HASH` gutter 开头，正文保持原生红绿语义 |
| 可逆替换 | 开启“替换内置读写”后，Agent scoped 覆盖可逆并随 Cordis Fiber 清理 |

## 环境要求

- DeepSeek Harness `0.1.0-rc.7` 或兼容版本，默认 profile 为 `web`
- Node.js `^22.19.0 || >=24.0.0`
- 网页配置卡片还要求 DSH 包含 `settings.register(..., { exposeToClients: true })` 支持

## 安装

把下面示例里的 `<绝对路径>` 换成你本机实际的绝对路径。源码目录的 `lib/` 是构建产物；首次开发安装执行 `npm install`，首次安装或源码更新后执行 `npm run build`：

```powershell
npm install
npm run build
```

普通本地安装：

```powershell
dsh plugin --profile web add "file:<绝对路径>/deepseek-harness-hashline"
```

持续开发使用 `link:` 直接安装（新版运行时从 profile 解析 DSH peer，无需本地 junction）：

```powershell
dsh plugin --profile web add "link:<绝对路径>/deepseek-harness-hashline"
```

安装后检查组合：

```powershell
dsh --profile web --dump-config
```

## 更新

重新执行安装命令即可更新依赖和持久 bundle。浏览器端内容更新后刷新页面；使用本地 `link:` 开发时，
主机文件在 DSH HMR 服务可用时自动热重载，否则按日志提示重启。

## 卸载

```powershell
dsh plugin --profile web remove deepseek-harness-hashline
```

卸载会清理持久 bundle 与运行中条目，不会删除 DSH 会话数据。`settings` 命名空间 `hashline` 中已有的
用户覆盖值可能保留，重新安装后可继续使用。

## 设置与数据

| 数据 | 存储位置 |
| --- | --- |
| 全局开关、内置读写替换开关、哈希参数 | DSH `settings` 命名空间 `hashline`（在“设置 → 插件 → 插件配置”中编辑） |

插件不注册模型工具以外的额外能力、不上传数据、不维护独立数据文件。客户端只向现有
`settings.plugin.item` Slot 贡献配置卡片，通过 DSH `settingsScope` 读写同一 Host 命名空间。

## 常见问题

**它和内置 `read` / `edit` 有什么区别？** 内置工具按行号和文本操作；Hashline 把锚定编辑绑定到
“最近读取过的具体行内容”的哈希锚点，能检测过期读取，并把多处修改作为一次原子请求处理。
简单且唯一的文本替换也可直接传 `old_string` / `new_string`，会与锚定编辑一样走稳定读取和版本 CAS。
此外 Hashline 的读取结果接入 DSH 原生读取卡，编辑结果使用与宿主一致的原生风格 diff 卡。

**哈希会碰撞吗？** 短哈希有理论碰撞概率：默认 4 hex 相当于 16 位校验，与行号和文件级版本 CAS 联合使用；
高风险部署可在配置中提高 `hashLength`。

**“替换内置读写”怎么用？** 开启后，允许编辑的智能体看到的是 `read` / `edit`（哈希锚点格式），
`hashline_read` / `hashline_edit` 被隐藏；关闭开关恢复原工具。替换只在智能体原本能看到 `read`、`edit`、
`hashline_read`、`hashline_edit` 时安装，避免绕过配置限制。

## 开发文档

- [使用指南](docs/usage.md)：工具参数、锚点格式、编辑变体与安全模型
- [设计说明](docs/design.md)：工具边界、锚点、文本模型、DSH 集成、包形态
- [开发指南](docs/development.md)：本地开发安装、HMR、测试与验证

## License

[MIT](LICENSE)
