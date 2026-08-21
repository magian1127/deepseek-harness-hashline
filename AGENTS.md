# AGENTS.md

本仓库是 DeepSeek Harness 的独立 Hashline Host + Web client 插件。用户说明见 `README.md`，设计事实见
`docs/design.md`。

## 不可破坏的约束

1. 全局工具名固定为 `hashline_read` 和 `hashline_edit`，默认不覆盖内置 `read` / `edit`；只有用户显式开启 `replaceBuiltinEdit` 时，才可在原 `read` / `edit` 均可见的 Agent own scope 可逆注册 Hashline `read` 与 `edit`。
2. `LINE:HASH` 的哈希输入必须包含完整行尾；显示截断不能改变哈希。
3. BOM、LF/CRLF 和文件末尾换行状态必须在锚定编辑后保留。
4. 所有锚点和范围必须在写入前针对同一稳定快照统一校验。
5. 写入必须经过 `fs/write-intent` 并带 `replaceIfVersion` 版本保护。
6. 相对路径与 sandbox policy 必须使用调用会话，不得退回插件进程 cwd。
7. 每个工具、提示词和其它副作用必须随当前 Cordis Fiber 清理。
8. 客户端只向 `settings.plugin.item` 贡献配置卡片并使用官方 `settingsScope`；不得添加自定义网络请求、遥测或独立持久数据。
9. 不复制 `dsh-zh` 的热安装监督器；安装统一使用 `dsh plugin`。
10. Host 源码热更新只使用官方 HMR 的精确路径注册与 `partialReload`，watcher 和 timer 必须随当前 Fiber 清理。
11. 不主动执行 `git commit` 或 `git push`；提交规范见下方「Git 纪律」。

## 修改与验证

任何行为变更都应同步测试与 README。提交前执行：

```powershell
npm run check
npm test
npm pack --dry-run --json
```

涉及工具 Schema、服务或事件时，以当前 DSH Inspect/源码契约为准，不根据名称猜测。旧研究材料和
临时运行记录不属于发布包。

## 文档职责

同一事实只保留一个权威位置，其它文档只做摘要并链接，不复制大段内容：

| 文档 | 职责 |
| --- | --- |
| [`README.md`](README.md) | 面向用户：功能、环境要求、安装、卸载、设置和数据边界 |
| [`docs/usage.md`](docs/usage.md) | 使用指南：工具参数、锚点格式、编辑变体、安全模型、配置 |
| [`docs/design.md`](docs/design.md) | 设计事实：工具边界、锚点、文本模型、DSH 集成、包形态 |
| [`docs/development.md`](docs/development.md) | 开发与验证：本地安装、peer 解析、HMR、测试 |

修改用户可见行为时更新 `README.md`；修改使用细节时更新 `docs/usage.md`；修改实现规则时更新
`docs/design.md`；修改开发流程或验证时更新 `docs/development.md`。

## Git 纪律

- 不允许主动执行 `git commit` 或 `git push`；必须先由用户审核并明确批准。
- commit message 必须全中文且以中文开头，英文专业术语只能放在中文后的括号内。
- 提交信息标题要简短，一句话说清主旨；详细说明（背景、影响、原因等）换行写在提交信息的详情（正文）里。
- 正确示例：`默认展开思考（thinking）输出`；错误示例：`feat: 默认展开思考`。
- 提交前用 `git status --short` 和 `git diff --check` 核对工作区，确保没有意外生成物、无关改动
  或未按预期跟踪的文件；用户已有改动不得被覆盖。
- 打版本标签时必须与 `package.json` 的版本号一致。
- 不顺手重构无关代码，不覆盖用户已有改动；部署或安装操作统一走项目命令，不直接编辑 DSH
  shipped preset 或 profile 配置。
