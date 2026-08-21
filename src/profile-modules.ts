// DSH 运行时模块的 profile 解析加载（对齐 deepseek-harness-zh_pro 的
// loadSchemastery 模式）：从当前 profile 的 require 上下文解析 DSH 提供的
// 运行时模块，避免本包显式依赖，同时与主进程拿到同一模块实例。
import { createRequire } from 'node:module'
import { join } from 'node:path'

interface ModuleState {
  cache: unknown
  failed: boolean
}

const schemasteryState: ModuleState = { cache: undefined, failed: false }
const dshLlmState: ModuleState = { cache: undefined, failed: false }

export function profileName(): string {
  const flag = process.argv.indexOf('--profile')
  if (flag !== -1 && flag + 1 < process.argv.length && !process.argv[flag + 1].startsWith('-')) {
    return process.argv[flag + 1]
  }
  return 'web'
}

export function profileDir(): string {
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
  return join(home, 'profiles', profileName())
}

function loadFromProfile(name: string, state: ModuleState): unknown {
  if (state.cache !== undefined) return state.cache
  if (state.failed) return null
  try {
    const requireFromProfile = createRequire(join(profileDir(), 'package.json'))
    const mod = requireFromProfile(name)
    state.cache = mod !== null && mod !== undefined && mod.default !== undefined ? mod.default : mod
  } catch {
    state.failed = true
    return null
  }
  return state.cache
}

export function loadSchemastery(): unknown {
  return loadFromProfile('@deepseek-ai/schemastery', schemasteryState)
}

export function loadDshLlm(): unknown {
  return loadFromProfile('@deepseek-ai/dsh-llm', dshLlmState)
}