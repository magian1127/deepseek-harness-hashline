#!/usr/bin/env node
/**
 * deepseek-harness-hashline —— 一键安装/卸载/检查 CLI。
 *
 * 与 deepseek-harness-zh_pro / deepseek-harness-zhipu_plan_tools 的
 * `node bin/dsh-*.mjs install --profile web --link <目录>` 风格保持一致，
 * 命令统一为：
 *
 *   node bin/dsh-hashline.mjs install [--profile web] [--link <目录>]
 *   node bin/dsh-hashline.mjs remove  [--profile web]
 *   node bin/dsh-hashline.mjs status  [--profile web]
 *
 * 只走「持久 bundle 通道」：把本包以 `link:` 写进 profile 的
 * `dsh.profile.bundles`（DSH 的 dsh plugin add 会依据 dsh.bundle 声明自动
 * reconcile），下次启动 dsh web 时自动挂载。本插件不复制 dsh-zh 的热安装
 * 监督器（AGENTS.md 约束 9），因此不写临时热行；运行中实例需要一次重启
 * 或刷新页面使 bundle 层生效。
 *
 * install 必须指定存在的源码目录：profile 里错误的 `link:` 目标（目录不
 * 存在）会让 DSH 的 reconcile 把本包判为「普通依赖」，导致既不报错也无法
 * 挂载——本 CLI 会在安装后校验 bundle 通道是否真的就绪。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isAbsolute, join, resolve } from 'node:path'

const PKG = 'deepseek-harness-hashline'

/** DSH 家目录（与 dsh-home-paths 默认规则一致：DSH_HOME 优先，否则 ~/.dsh）。 */
function dshHome(): string {
  return process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
}

/** Reject profile names that could escape DSH_HOME/profiles. */
function validateProfileName(name: string): string {
  if (name === '' || name.includes('/') || name.includes('\\') || name === '.' || name === '..' || name === 'node_modules') {
    throw new Error(`invalid profile name ${JSON.stringify(name)}; use a non-empty profile name without path separators, dots, or "node_modules"`)
  }
  return name
}

/** profile 目录（默认 web，对应 `dsh web`）。 */
function profileDir(name: string = 'web'): string {
  return join(dshHome(), 'profiles', validateProfileName(name))
}

function manifestPath(name: string = 'web'): string {
  return join(profileDir(name), 'package.json')
}

function patchPath(name: string = 'web'): string {
  return join(profileDir(name), 'cordis.patch.yml')
}

function spawnCommand(command: string, args: readonly string[], options: { cwd?: string; stdio?: 'inherit' | 'ignore' } = {}): ReturnType<typeof spawnSync> {
  return spawnSync(command, args as string[], { ...options, shell: process.platform === 'win32' })
}

/**
 * 找到可用的 dsh CLI：优先 profile store 自带的 bundled 入口（node 直接跑，
 * 版本与当前运行时一致），否则使用 PATH 里的 `dsh`。
 */
function resolveDshInvocation(): { file: string; viaNode: boolean } | null {
  const bundled = join(dshHome(), 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (existsSync(bundled)) {
    return { file: bundled, viaNode: true }
  }
  const probe = spawnCommand('dsh', ['--version'], { stdio: 'ignore' })
  if (probe.status === 0) {
    return { file: 'dsh', viaNode: false }
  }
  return null
}

/** 转发给 dsh plugin 子命令；失败时若 profile 已存在则退回 profile 目录里的 pnpm。 */
function runDshPlugin(profileName: string, pluginArgs: readonly string[]): number {
  // desktop profile 由桌面应用独占管理：dsh CLI 按名拒绝，且绝不能落入下面的
  // pnpm 兜底（那会绕过 dsh 的保护、改动 Electron 持有的 profile 状态）。
  if (profileName.toLowerCase() === 'desktop') {
    console.error(`[${PKG}] desktop profile 由桌面应用独占管理，CLI 不能改动：请在桌面应用侧栏「插件」页安装/启停本插件`)
    return 1
  }
  const cli = resolveDshInvocation()
  let dshError: Error | null = null
  if (cli !== null) {
    const args = ['plugin', '--profile', profileName, ...pluginArgs]
    const res = cli.viaNode
      ? spawnSync(process.execPath, [cli.file, ...args], { stdio: 'inherit' })
      : spawnCommand(cli.file, args, { stdio: 'inherit' })
    if (res.error === undefined) return res.status ?? 1
    dshError = res.error
  }
  const dir = profileDir(profileName)
  if (!existsSync(join(dir, 'package.json'))) {
    if (dshError !== null) console.error(`[${PKG}] 无法启动 dsh CLI: ${dshError.message}`)
    console.error(`[${PKG}] profile "${profileName}" 不存在，且找不到 dsh CLI 来初始化它`)
    return 1
  }
  const res = spawnCommand('pnpm', pluginArgs, { cwd: dir, stdio: 'inherit' })
  if (res.error !== undefined) {
    console.error(`[${PKG}] 无法启动 pnpm: ${res.error.message}`)
    return (res.error as NodeJS.ErrnoException).code === 'ENOENT' ? 127 : 1
  }
  return res.status ?? 1
}

/** 运行中的 dsh web 是否可达（默认 3080）。 */
function serverAlive(port = 3080): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, 2500)
    return fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => { clearTimeout(timer) })
  } catch {
    return Promise.resolve(false)
  }
}

/** 运行中的 dsh web（默认 3080）启动图里是否已挂着本插件。 */
function liveGraphHasPlugin(port = 3080): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, 2500)
    return fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal })
      .then((res) => (res.ok ? res.text() : ''))
      .then((html) => html.includes(`"id":"${PKG}"`))
      .catch(() => false)
      .finally(() => { clearTimeout(timer) })
  } catch {
    return Promise.resolve(false)
  }
}

/** profile 的 bundles 列表是否已包含本插件（持久 bundle 通道就绪）。 */
function bundlesHasPlugin(name = 'web'): boolean {
  const path = manifestPath(name)
  if (!existsSync(path)) return false
  try {
    const manifest: { dsh?: { profile?: { bundles?: string[] } } } = JSON.parse(readFileSync(path, 'utf8'))
    return (manifest.dsh?.profile?.bundles ?? []).includes(PKG)
  } catch {
    return false
  }
}

function parseArgs(argv: readonly string[]): { profile: string; link: string | null; port: number; rest: string[] } {
  let profile = 'web'
  let link: string | null = null
  let port = 3080
  let portExplicit = false
  const rest: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--profile' && argv[i + 1] !== undefined) {
      profile = argv[i + 1]
      i += 1
    } else if (arg === '--port' && argv[i + 1] !== undefined) {
      port = parseInt(argv[i + 1], 10)
      if (!Number.isInteger(port) || port < 1 || port > 65535) port = 3080
      else portExplicit = true
      i += 1
    } else if (arg === '--link' && argv[i + 1] !== undefined) {
      link = isAbsolute(argv[i + 1]) ? argv[i + 1] : resolve(process.cwd(), argv[i + 1])
      i += 1
    } else {
      rest.push(arg)
    }
  }
  // 桌面版 Host 固定监听 19387：对 desktop profile 探测运行态时未显式给端口
  // 则用桌面端口，避免拿 web 的 3080 误判「服务未运行」。
  if (profile.toLowerCase() === 'desktop' && !portExplicit) port = 19387
  return { profile, link, port, rest }
}

async function main(): Promise<void> {
  const [cmd, ...argv] = process.argv.slice(2)
  if (cmd === 'install') {
    const { profile, link, port, rest: extra } = parseArgs(argv)
    const spec = link !== null ? `link:${link}` : (extra[0] ?? PKG)
    console.log(`[${PKG}] install ${spec} -> profile "${profile}"`)
    if (link !== null && !existsSync(join(link, 'package.json'))) {
      console.error(`[${PKG}] --link 目录不存在：${link}`)
      console.error(`[${PKG}] 请指向本插件的源码根目录（含 package.json 与 lib/ 构建产物，通常是克隆下来的仓库目录），`)
      console.error(`[${PKG}] 如在仓库目录内可省略 --link：node bin/dsh-hashline.mjs install --profile web --link .`)
      process.exitCode = 1
      return
    }
    const code = runDshPlugin(profile, ['add', spec])
    if (code !== 0) {
      console.error(`[${PKG}] 依赖安装失败（退出码 ${code}）`)
      process.exitCode = code
      return
    }
    if (!bundlesHasPlugin(profile)) {
      console.warn(`[${PKG}] 警告：profile bundles 未包含本插件。`)
      console.warn(`[${PKG}] 常见原因：add 的 link 目标目录不存在（DSH 会把解析失败的包装成普通依赖）。`)
      console.warn(`[${PKG}] 请确认目录存在后重试：dsh plugin --profile ${profile} remove ${PKG} 后再 install。`)
      process.exitCode = 1
      return
    }
    if (await liveGraphHasPlugin(port)) {
      console.log(`[${PKG}] 运行中的 dsh web 已挂载本插件；无需重启。`)
    } else if (await serverAlive(port)) {
      console.log(`[${PKG}] bundle 通道已就绪；运行中的 dsh web 需要重启一次后生效（本插件不部署热行）。`)
    } else {
      console.log(`[${PKG}] bundle 通道已就绪；下次启动 dsh web 时自动挂载。`)
    }
    console.log(`[${PKG}] 完成。状态检查：node bin/dsh-hashline.mjs status --profile ${profile}`)
    return
  }
  if (cmd === 'remove') {
    const { profile } = parseArgs(argv)
    console.log(`[${PKG}] remove from profile "${profile}"`)
    const code = runDshPlugin(profile, ['remove', PKG])
    if (code !== 0) {
      console.error(`[${PKG}] 依赖清理失败（退出码 ${code}）`)
      process.exitCode = code
      return
    }
    console.log(`[${PKG}] 卸载完成；运行中的 dsh web 仍保留本插件直到重启。`)
    return
  }
  if (cmd === 'status') {
    const { profile, port } = parseArgs(argv)
    const file = manifestPath(profile)
    let dep: unknown
    if (existsSync(file)) {
      try {
        const manifest: { dependencies?: Record<string, unknown> } = JSON.parse(readFileSync(file, 'utf8'))
        dep = manifest.dependencies?.[PKG]
      } catch (error) {
        console.error(`[${PKG}] 无法读取 profile manifest: ${error instanceof Error ? error.message : String(error)}`)
        process.exitCode = 1
        return
      }
    }
    const live = await liveGraphHasPlugin(port)
    console.log(`[${PKG}] status (profile "${profile}")`)
    console.log(`  依赖:      ${dep ?? '(未安装)'}`)
    console.log(`  bundle 通道: ${bundlesHasPlugin(profile) ? '已就绪（重启自动挂载）' : '未就绪'}`)
    console.log(`  运行中:    ${live ? '已挂载' : '未挂载'}`)
    console.log(`  patch 文件: ${patchPath(profile)}`)
    return
  }
  console.log(`[${PKG}] 用法:`)
  console.log(`  node bin/dsh-hashline.mjs install [--profile web] [--link <目录>]`)
  console.log(`  node bin/dsh-hashline.mjs remove  [--profile web]`)
  console.log(`  node bin/dsh-hashline.mjs status  [--profile web]`)
  process.exitCode = 2
}

// 被其它模块 import 时不执行 CLI（只保留导出面）。
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(`[${PKG}] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    process.exitCode = 1
  })
}
