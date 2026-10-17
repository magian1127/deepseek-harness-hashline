// DSH 运行时模块的 profile 解析加载（对齐 deepseek-harness-zh_pro 的
// loadSchemastery 模式）：从当前 profile 的模块解析上下文加载 DSH 提供的
// 运行时模块，避免本包显式依赖，同时与主进程拿到同一模块实例。
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

interface ModuleState {
  cache: unknown
  failed: boolean
}

// 各模块**必须**能从 profile 拿到的具名导出（见 mergeNamedExports 的说明）。
// 空数组 = 该模块的 default 就是完整聚合面，不做补齐。
const SCHEMASTERY_EXPORTS: readonly string[] = []
const DSH_LLM_EXPORTS: readonly string[] = ['HarnessError']

const schemasteryState: ModuleState = { cache: undefined, failed: false }
const dshLlmState: ModuleState = { cache: undefined, failed: false }

/** 桌面版 Host（Electron RunAsNode）argv 不带 --profile，profile 固定为 desktop
 * （apps/desktop/src/paths.ts）；此时不能落回 web 默认，否则 createRequire 会
 * 锚到 web profile，拿不到与桌面运行时（asar 内）同实例的 DSH 模块。 */
export function profileNameFrom(argv: readonly string[], electronVersion: string | undefined): string {
  const flag = argv.indexOf('--profile')
  if (flag !== -1 && flag + 1 < argv.length && !argv[flag + 1].startsWith('-')) {
    return argv[flag + 1]
  }
  if (electronVersion !== undefined) return 'desktop'
  return 'web'
}

export function profileName(): string {
  return profileNameFrom(process.argv, process.versions.electron)
}

export function profileDir(): string {
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
  return join(home, 'profiles', profileName())
}

// DSH 0.1.7-rc 的组合批次经模块 hooks 管线并行动态 import 官方插件的 ESM；
// 同步 require(esm)（包括目标包 CJS 入口内部的 require）会撞 Node 的
// 「not yet fully loaded」：管线被当前同步栈阻塞，重试永远等不到加载完成。
// 因此用 require.resolve 系只做解析（不求值、无竞态），并优先取 exports 的
// import 条目做异步 import：整条依赖链都排进同一条管线串行交付，天然无竞态；
// 顶层 await 保证调用方模块求值前就绪。
function profileEntryPath(requireFromProfile: NodeRequire, name: string): string {
  const requireEntry: string = requireFromProfile.resolve(name)
  try {
    const manifestPath: string = requireFromProfile.resolve(`${name}/package.json`)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      exports?: Record<string, unknown>
      main?: unknown
    }
    const selfExport: unknown = manifest?.exports?.['.']
    const entry = typeof selfExport === 'string'
      ? selfExport
      : typeof selfExport === 'object' && selfExport !== null
        ? (selfExport as { import?: unknown; default?: unknown }).import ?? (selfExport as { default?: unknown }).default
        : undefined
    if (typeof entry === 'string') return resolve(dirname(manifestPath), entry)
    if (typeof manifest?.main === 'string') return resolve(dirname(manifestPath), manifest.main)
  } catch {
    // exports 不可读时退回 require 条目。
  }
  return requireEntry
}

/**
 * 把 ESM 命名空间折算成调用方要用的形状。
 *
 * 默认取 `mod.default`：DSH 的运行时包多数把聚合面放在 default 上，且调用方
 * 会直接在返回值上调用成员（例如 `loadSchemastery()` 的返回值当 `z` 用，
 * `z.object(...)`），因此**不能**改包成 `{ default }`。
 *
 * 但 `@deepseek-ai/dsh-llm` 恰恰不是这种形状：它的末尾是
 * `export { … HarnessError … }; export default LlmRuntime`——default 是**一个类**，
 * `HarnessError` 只存在于具名导出（`packages/llm/llm/src/index.ts:1218`）。
 * 只取 default 会静默丢掉 `HarnessError`，本插件就退化成普通 `Error`，丢失与
 * 宿主同一实例的错误身份与结构化 `{ name, code }`
 * （宿主 `packages/core/tools/src/index.ts` 的 `errorInfo()` 用
 * `error instanceof HarnessError` 判定）。
 *
 * 因此：该模块需要具名导出时，返回**整个命名空间**（它同时含 `default` 与
 * 各具名导出），调用方按需取成员即可；不修改任何已加载模块对象，无副作用。
 * 不需要具名导出的模块保持原样（`default` 优先），行为与旧版逐字一致。
 */
function shapeModule(
  mod: { default?: unknown } | null | undefined,
  namedExports: readonly string[],
): unknown {
  if (mod === null || mod === undefined) return undefined
  if (namedExports.length > 0) return mod
  return mod.default !== undefined ? mod.default : mod
}

async function importFromProfile(
  name: string,
  state: ModuleState,
  namedExports: readonly string[],
): Promise<void> {
  try {
    const requireFromProfile = createRequire(join(profileDir(), 'package.json'))
    const entry = profileEntryPath(requireFromProfile, name)
    const mod = (await import(pathToFileURL(entry).href)) as { default?: unknown } | null | undefined
    state.cache = shapeModule(mod, namedExports)
  } catch {
    state.cache = undefined
  }
}

// 串行预载：失败保持 cache undefined，由 loadFromProfile 的同步兜底兜住。
await importFromProfile('@deepseek-ai/schemastery', schemasteryState, SCHEMASTERY_EXPORTS)
await importFromProfile('@deepseek-ai/dsh-llm', dshLlmState, DSH_LLM_EXPORTS)

function loadFromProfile(name: string, state: ModuleState, namedExports: readonly string[]): unknown {
  if (state.cache !== undefined) return state.cache
  if (state.failed) return null
  // 同步兜底：仅预载失败后（如脱离 profile 的测试/CLI 环境）首次调用时尝试；
  // 引擎环境再次拒绝即永久标记，避免每次调用都抛错。
  try {
    const mod = createRequire(join(profileDir(), 'package.json'))(name)
    // 与 importFromProfile 同一折算规则：CJS 的 default 往往被 interop 成本身，
    // 但具名导出仍必须可见（dsh-llm 的 HarnessError）。
    state.cache = shapeModule(mod, namedExports)
  } catch {
    state.failed = true
    return null
  }
  return state.cache
}

export function loadSchemastery(): unknown {
  return loadFromProfile('@deepseek-ai/schemastery', schemasteryState, SCHEMASTERY_EXPORTS)
}

export function loadDshLlm(): unknown {
  return loadFromProfile('@deepseek-ai/dsh-llm', dshLlmState, DSH_LLM_EXPORTS)
}
