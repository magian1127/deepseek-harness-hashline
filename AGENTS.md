# AGENTS.md

本仓库是 DeepSeek Harness 的独立 Hashline Host + Web client 插件。用户说明见 `README.md` / `README.en.md`，设计事实见 `docs/design.md`。

## 不可破坏的约束

1. 全局工具名固定为 `hashline_read` 和 `hashline_edit`，默认不覆盖内置 `read` / `edit`；只有用户显式开启 `replaceBuiltinEdit` 时，才可在原 `read` / `edit` 均可见的 Agent own scope 可逆注册 Hashline `read` 与 `edit`。
2. `LINE:HASH` 的哈希输入必须包含完整行尾；显示截断不能改变哈希。
3. BOM、LF/CRLF 和文件末尾换行状态必须在锚定编辑后保留。
4. 所有锚点和范围必须在写入前针对同一稳定快照统一校验。
5. 写入必须经过 `fs/write-intent` 并带 `replaceIfVersion` 版本保护。
6. 相对路径与 sandbox policy 必须使用调用会话，不得退回插件进程 cwd。
7. 共享的 Fiber、副作用、scope、schema、Client/Host HMR、Git 与用户改动保护规则见 [`../docs/`](../docs/README.md)。
8. 客户端只向 `settings.plugin.item` 贡献配置卡片并使用官方 `settingsScope`；不得添加自定义网络请求、遥测或独立持久数据。
9. 不复制 `dsh-zh` 的热安装监督器，不部署热行；安装使用本插件的 `node bin/dsh-hashline.mjs install --profile web --link <目录>` CLI（内部封装 `dsh plugin add`，只走持久 bundle 通道，安装后需重启一次 `dsh web` 生效），或直接使用 `dsh plugin`。

## 修改与验证

共享的 Inspect、验收分层、Git 与用户改动保护规则见 [`../docs/`](../docs/README.md)。任何行为变更都应同步测试与双语 README；本项目提交前执行：

```powershell
npm run check
npm test
npm pack --dry-run --json
```

旧研究材料和临时运行记录不属于发布包。

## 文档职责

同一事实只保留一个权威位置，其它文档只做摘要并链接，不复制大段内容：

| 文档 | 职责 |
| --- | --- |
| [`README.md`](README.md) / [`README.en.md`](README.en.md) | 面向用户：功能、环境要求、安装、卸载、设置和数据边界 |
| [`docs/usage.md`](docs/usage.md) | 使用指南：工具参数、锚点格式、编辑变体、安全模型、配置 |
| [`docs/design.md`](docs/design.md) | 设计事实：工具边界、锚点、文本模型、DSH 集成、包形态 |
| [`docs/development.md`](docs/development.md) | 开发与验证：本地安装、peer 解析、HMR、测试 |
| [`../docs/`](../docs/README.md) | 四项目共享的流程、运行时/HMR、Cordis 安全、集成冲突与通用验收 |

修改用户可见行为时同步双语 README；修改使用细节时更新 `docs/usage.md`；修改实现规则时更新
`docs/design.md`；修改开发流程或验证时更新 `docs/development.md`。跨项目共性规则以 [`../docs/`](../docs/README.md) 为准，项目文档不复制长篇共享经验。

## Git 纪律

提交审批、中文标题、工作树检查和受管配置规则统一见 [`../docs/workflow.md`](../docs/workflow.md)。本项目打版本标签时必须与 `package.json` 版本一致。
