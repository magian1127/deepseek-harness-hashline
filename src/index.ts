import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadSchemastery } from './profile-modules.js'

import {
  DEFAULT_CONTEXT_LINES,
  DEFAULT_HASH_LENGTH,
  DEFAULT_MAX_LINE_LENGTH,
  DEFAULT_READ_LIMIT,
  HashlineError,
  lineRecord,
  planEdits,
  parseEditEntries,
  previewContent,
  splitTextFile,
  type EditOptions,
  type EditPlan,
  type HashlineErrorDetails,
  type LineRecord,
  type RawEdit,
  type TextLine,
} from './core.js'

import {
  computeHunkDiffs,
  extractReadBody,
  formatReadEnvelope,
  langFromPath,
  narrowDiffsMeta,
  narrowReadMeta,
  type FileDiff,
} from './presentation.js'

export const name = 'dsh-hashline'
export const inject = ['fs', 'tools', 'systemPrompt', 'settings', 'agents'] as const

interface SchemaField {
  default(value: unknown): SchemaField
  step(value: number): SchemaField
  min(value: number): SchemaField
  max(value: number): SchemaField
}

interface SchemaFactory {
  object(shape: Record<string, unknown>): unknown
  boolean(): SchemaField
  number(): SchemaField
}

export function createConfigSchema(z: SchemaFactory): unknown {
  return z.object({
    enabled: z.boolean().default(true),
    replaceBuiltinEdit: z.boolean().default(false),
    hashLength: z.number().step(1).min(3).max(16).default(DEFAULT_HASH_LENGTH),
    readLimit: z.number().step(1).min(1).default(DEFAULT_READ_LIMIT),
    maxLineLength: z.number().step(1).min(1).default(DEFAULT_MAX_LINE_LENGTH),
    contextLines: z.number().step(1).min(0).max(20).default(DEFAULT_CONTEXT_LINES),
    promptGuidance: z.boolean().default(true),
    zhPrompt: z.boolean().default(false),
  })
}

const SETTINGS_NAMESPACE = 'hashline'

function hashlineError(
  code: string,
  message: string,
  details?: HashlineErrorDetails,
  options?: ErrorOptions,
): HashlineError {
  return new HashlineError(code as never, message, details, options)
}

const ESCALATION_TARGETS = ['workspace-write', 'danger-full-access'] as const
const WIDER_MODES: Record<string, readonly string[]> = {
  'read-only': ['workspace-write', 'danger-full-access'],
  'workspace-write': ['danger-full-access'],
}

// ---------------------------------------------------------------------------
// 最小结构化 DSH Host 接口（只覆盖本插件实际使用的契约面）。
// ---------------------------------------------------------------------------

type JsonSchema = Record<string, unknown>

interface SandboxPolicy {
  mode?: string
  workspaceRoot?: string
}

interface FsTarget {
  targetKey?: unknown
  displayPath: string
}

interface FsStat {
  type: string
  version?: unknown
  size?: number
}

interface WriteOutcome {
  operation?: string
  before?: unknown
  after?: unknown
  version?: unknown
}

interface WriteIntent {
  kind: string
  version?: unknown
}

interface FsService {
  sandboxMode?: string
  resolve(path: string, options: Record<string, unknown>): Promise<FsTarget>
  stat(target: FsTarget, signal?: AbortSignal): Promise<FsStat | undefined>
  readText(target: FsTarget, signal?: AbortSignal): Promise<string>
  writeText(
    target: FsTarget,
    content: string,
    intent: WriteIntent | undefined,
    signal: AbortSignal | undefined,
    policy: SandboxPolicy | undefined,
  ): Promise<WriteOutcome>
}

interface ToolOutputDefinition {
  schema: JsonSchema
  render(args: unknown, value: unknown): unknown[]
  /** 纯、可回放的展示投影；只对顶层调用计算，结果随 tool/result 持久化。 */
  presentationMeta?(args: unknown, value: unknown): unknown
}

/** 结果呈现可用的已持久化 outcome 投影（与 DSH `ToolResult` 同构）。 */
interface ToolResult {
  content: Array<{ type?: string; text?: string }>
  isError: boolean
  meta?: unknown
}

interface ToolDefinition {
  name?: string
  source?: string
  description?: string
  parameters?: JsonSchema
  output?: ToolOutputDefinition
  isConcurrencySafe?: () => boolean
  execute?: (rawArgs: unknown, exec: ToolExec) => unknown
  presentCall?: (args: Record<string, unknown>) => unknown
  presentResult?: (args: Record<string, unknown>, result: ToolResult) => unknown
}

interface ToolRegistration {
  register(definition: ToolDefinition): () => void
  get(name: string, scope?: unknown): ToolDefinition | undefined
  restrict?(filter: { deny?: string[] }): () => void
}

interface PromptSection {
  name?: string
  order?: number
  text?: string
}

interface SystemPromptService {
    section(section: { name: string; order: number; text: string }): () => void
    assemble?(context?: { scope?: unknown }): Promise<{ sections?: Array<{ name?: string; text?: string | ((context?: unknown) => string) }> }>
}

interface SettingsScope {
  get(): Record<string, unknown>
  watch(callback: (next: Record<string, unknown>, previous?: Record<string, unknown>) => void): () => void
}

interface SettingsService {
  register(
    namespace: string,
    schema: unknown,
    options: { base: Record<string, unknown>; applies: string; exposeToClients: boolean },
  ): SettingsScope
}

interface Agent {
  id?: unknown
  session?: { header?: { cwd?: string; id?: unknown } }
  ctx?: {
    tools?: ToolRegistration
    get?: (name: string) => unknown
  }
}

interface AgentsService {
  list(): Agent[]
}

interface HmrConfig {
  root?: unknown
}

interface HmrService {
  config?: HmrConfig
  baseDir?: string
  stashed?: Set<string>
  registerConfig?(filename: string, callback: () => void): Promise<() => void | Promise<void>>
  partialReload?(): Promise<void>
}

interface ApprovalRequest {
  agent: Agent
  toolName: string
  callId: unknown
  reason: string
  signal: AbortSignal
}

interface ApprovalService {
  request(request: ApprovalRequest): Promise<string>
}

interface SandboxPolicyService {
  resolve(request: { session?: unknown }): SandboxPolicy
}

interface ToolExec {
  agent?: Agent
  callId?: unknown
  signal?: AbortSignal
}

interface DshContext {
  fs: FsService
  tools: ToolRegistration
  settings: SettingsService
  systemPrompt: SystemPromptService
  agents: AgentsService
  logger?: { warn?: (message: string) => void }
  get(name: string): unknown
  inject(deps: string[], callback: (ctx: unknown) => void): unknown
  effect(setup: () => unknown, label?: string): unknown
  on(name: string, handler: (payload: unknown) => void): unknown
  emit(name: string, ...args: unknown[]): void
  waterfall(name: string, ...args: unknown[]): Promise<unknown>
}

// ---------------------------------------------------------------------------
// 配置解析与参数校验（行为与 lib/index.js 保持一致）。
// ---------------------------------------------------------------------------

interface ResolvedConfig {
  enabled: boolean
  replaceBuiltinEdit: boolean
  hashLength: number
  readLimit: number
  maxLineLength: number
  contextLines: number
    promptGuidance: boolean
    zhPrompt: boolean
}

const CONFIG_KEYS = [
  'enabled',
  'replaceBuiltinEdit',
  'hashLength',
  'readLimit',
  'maxLineLength',
  'contextLines',
  'promptGuidance',
  'zhPrompt',
] as const

function invalidArgument(message: string): never {
  throw new HashlineError('HASHLINE_INVALID_ARGUMENT', message)
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) invalidArgument(`${label} must be a positive integer`)
  return value as number
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalidArgument(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requirePath(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalidArgument('file_path must be a non-empty string')
  }
  return value
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key))
  if (extras.length > 0) invalidArgument(`${label} contains unsupported field(s): ${extras.join(', ')}`)
}

function resolveConfig(config: Record<string, unknown> = {}): ResolvedConfig {
  requireObject(config, 'config')
  assertOnlyKeys(config, CONFIG_KEYS, 'config')

  const enabled = config.enabled ?? true
  const replaceBuiltinEdit = config.replaceBuiltinEdit ?? false

  const hashLength = config.hashLength ?? DEFAULT_HASH_LENGTH
  const readLimit = config.readLimit ?? DEFAULT_READ_LIMIT
  const maxLineLength = config.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH
  const contextLines = config.contextLines ?? DEFAULT_CONTEXT_LINES
  const promptGuidance = config.promptGuidance ?? true
  const zhPrompt = config.zhPrompt ?? false

  if (typeof enabled !== 'boolean') {
    throw new HashlineError('HASHLINE_INVALID_CONFIG', 'enabled must be a boolean')
  }
  if (typeof replaceBuiltinEdit !== 'boolean') {
    throw new HashlineError('HASHLINE_INVALID_CONFIG', 'replaceBuiltinEdit must be a boolean')
  }

  if (!Number.isInteger(hashLength) || (hashLength as number) < 3 || (hashLength as number) > 16) {
    throw new HashlineError('HASHLINE_INVALID_CONFIG', 'hashLength must be an integer between 3 and 16')
  }
  positiveInteger(readLimit, 'readLimit')
  positiveInteger(maxLineLength, 'maxLineLength')
  if (!Number.isInteger(contextLines) || (contextLines as number) < 0 || (contextLines as number) > 20) {
    throw new HashlineError('HASHLINE_INVALID_CONFIG', 'contextLines must be an integer between 0 and 20')
  }
  if (typeof promptGuidance !== 'boolean') {
    throw new HashlineError('HASHLINE_INVALID_CONFIG', 'promptGuidance must be a boolean')
  }
  if (typeof zhPrompt !== 'boolean') {
    throw new HashlineError('HASHLINE_INVALID_CONFIG', 'zhPrompt must be a boolean')
  }

  return {
    enabled,
    replaceBuiltinEdit,
    hashLength: hashLength as number,
    readLimit: readLimit as number,
    maxLineLength: maxLineLength as number,
    contextLines: contextLines as number,
    promptGuidance,
    zhPrompt,
  }
}

function sessionCwd(exec: ToolExec): string | undefined {
  return exec.agent?.session?.header?.cwd
}

function resolveOptions(exec: ToolExec, workspaceRoot?: string): Record<string, unknown> {
  const cwd = workspaceRoot ?? sessionCwd(exec)
  return {
    ...(cwd === undefined ? {} : { cwd }),
    signal: exec.signal,
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function remapFileError(error: unknown, policy: SandboxPolicy | undefined, escalationAvailable: boolean): unknown {
  const code = errorCode(error)
  if (code === 'FS_SANDBOX_DENIED') {
    const mode = policy?.mode ?? 'unknown'
    const hint = escalationAvailable
      ? '\n[sandbox: escalation available — retry this exact operation once with sandbox_permissions (the narrowest wider mode that suffices) + justification; the approval prompt asks the user]'
      : ''
    return hashlineError(
      'FS_SANDBOX_DENIED',
      `[sandbox: file access denied under ${mode} mode]${hint}`,
      { mode },
      { cause: error },
    )
  }
  if (code === 'FS_STALE_VERSION') {
    return hashlineError(
      'FS_STALE_VERSION',
      `${errorMessage(error)} — run hashline_read again, then retry`,
      undefined,
      { cause: error },
    )
  }
  if (code === 'FS_NOT_OBSERVED') {
    return hashlineError(
      'FS_NOT_OBSERVED',
      `${errorMessage(error)} — run hashline_read first, then retry`,
      undefined,
      { cause: error },
    )
  }
  return error
}

function validateEscalationArgs(permissions: unknown, justification: unknown): void {
  if (permissions !== undefined && justification === undefined) {
    invalidArgument('sandbox_permissions requires justification')
  }
  if (justification !== undefined && permissions === undefined) {
    invalidArgument('justification is only valid together with sandbox_permissions')
  }
  if (justification !== undefined && (typeof justification !== 'string' || justification.trim().length === 0)) {
    invalidArgument('justification must be a non-empty sentence')
  }
}

interface SandboxController {
  confining: boolean
  schemaFields: Record<string, JsonSchema>
  resolve(args: Record<string, unknown>, exec: ToolExec, toolName?: string): Promise<SandboxPolicy | undefined>
}

function createSandboxController(ctx: DshContext): SandboxController {
  const confining = ctx.fs.sandboxMode !== undefined
  const policyService = confining ? (ctx.get('sandboxPolicy') as SandboxPolicyService | undefined) : undefined
  if (confining && policyService === undefined) {
    throw new Error('dsh-hashline: the mounted filesystem confines but sandboxPolicy is unavailable')
  }

  return {
    confining,
    schemaFields: confining
      ? {
          sandbox_permissions: {
            type: 'string',
            enum: [...ESCALATION_TARGETS],
            description:
              'A wider sandbox mode for a one-shot retry after a policy denial. Requires justification and user approval.',
          },
          justification: {
            type: 'string',
            description:
              'Required with sandbox_permissions: one sentence explaining why this exact operation needs wider access.',
          },
        }
      : {},
    async resolve(args, exec, toolName = 'hashline_edit') {
      const permissions = args.sandbox_permissions
      const justification = args.justification
      validateEscalationArgs(permissions, justification)
      const policy = policyService?.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })
      if (permissions === undefined) return policy
      if (!confining) invalidArgument('sandbox_permissions is unavailable because this filesystem is not sandboxed')
      if (!(ESCALATION_TARGETS as readonly string[]).includes(permissions as string)) {
        invalidArgument(`sandbox_permissions must be one of: ${ESCALATION_TARGETS.join(', ')}`)
      }
      if (!(WIDER_MODES[policy?.mode ?? ''] ?? []).includes(permissions as string)) {
        throw new Error(
          `sandbox escalation to "${permissions as string}" is not strictly wider than the current "${policy?.mode}" mode`,
        )
      }

      const approval = ctx.get('approval') as ApprovalService | undefined
      if (approval === undefined) {
        throw new Error(`sandbox escalation to "${permissions as string}" requires approval, but no approval service is composed`)
      }
      if (exec.agent === undefined) {
        throw new Error(`sandbox escalation to "${permissions as string}" requires approval, but this call has no agent`)
      }
      const outcome = await approval.request({
        agent: exec.agent,
        toolName,
        callId: exec.callId,
        reason: `escalate sandbox to ${permissions as string}: ${justification as string}`,
        signal: exec.signal as AbortSignal,
      })
      if (outcome === 'allowed-once') return { ...policy, mode: permissions as string }
      if (outcome === 'rejected') throw new Error(`the user rejected escalating this operation to "${permissions as string}"`)
      if (outcome === 'cancelled') throw new Error(`approval for escalating to "${permissions as string}" was cancelled`)
      throw new Error(`sandbox escalation to "${permissions as string}" requires approval, but no approval channel is available`)
    },
  }
}

interface StableFile {
  target: FsTarget
  info: FsStat
  content: string
}

async function loadStableFile(
  ctx: DshContext,
  exec: ToolExec,
  filePath: string,
  workspaceRoot?: string,
): Promise<StableFile> {
  const target = await ctx.fs.resolve(filePath, resolveOptions(exec, workspaceRoot))
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await ctx.fs.stat(target, exec.signal)
    if (before === undefined) {
      ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
      throw hashlineError('HASHLINE_FILE_NOT_FOUND', `file not found: ${target.displayPath}`)
    }
    if (before.type !== 'file') {
      throw hashlineError('HASHLINE_NOT_A_FILE', `not a regular file: ${target.displayPath}`)
    }

    const content = await ctx.fs.readText(target, exec.signal)
    const after = await ctx.fs.stat(target, exec.signal)
    if (after !== undefined && after.type === 'file' && after.version === before.version) {
      return { target, info: after, content }
    }
  }

  throw hashlineError(
    'HASHLINE_FILE_CHANGED_DURING_READ',
    `file changed while hashline was reading ${target.displayPath}; retry the operation`,
  )
}

function formatLine(record: LineRecord): string {
  return `${record.anchor}|${record.text}`
}

function renderRead(value: {
  path: string
  totalLines: number
  offset: number
  lines: LineRecord[]
  eol: string
  bom: boolean
}): unknown[] {
  // 模型-facing envelope 使用 `LINE|HASH  内容`；UI 由 presentationMeta 保留独立
  // number/hash/text，客户端把 `LINE|HASH` 作为 gutter chrome 渲染。
  const displayLines = value.lines.map(line => ({
    number: line.number,
    hash: line.hash,
    text: line.text,
  }))
  return [{ type: 'text', text: formatReadEnvelope(value.path, value.offset, displayLines, value.totalLines, {
    eol: value.eol,
    bom: value.bom,
  }) }]
}

interface EditResultValue {
  path: string
  changed: boolean
  editsApplied: number
  removedLines: number
  addedLines: number
  firstChangedLine: number | null
  eol: string
  bom: boolean
  preview: LineRecord[]
  /** 内部展示投影：写入成功后立即计算的紧凑 hunks；不保存完整 before/after。 */
  presentation?: { diffs: FileDiff[] }
}

function renderEdit(value: EditResultValue, toolName = 'hashline_edit'): unknown[] {
  const summary = value.changed
    ? `${toolName}: applied ${value.editsApplied} edit(s) to ${value.path}; lines removed=${value.removedLines}, lines added=${value.addedLines}`
    : `${toolName}: no change was needed for ${value.path}`
  if (value.preview.length === 0) return [{ type: 'text', text: summary }]
  return [{ type: 'text', text: `${summary}\nUpdated anchors:\n${value.preview.map(formatLine).join('\n')}` }]
}

// 工具参数根节点必须保持 type: object；数组项可以使用 DSH 已支持的嵌套 oneOf。
// 把每种操作放进独立分支，令模型在生成参数时就看到"一项一个操作"的结构；
// parseEditEntries 仍在执行前做同样校验，防御旧回放和绕过 schema 的直接调用。
function editItemSchema(zhPrompt: boolean, readToolName: string): JsonSchema {
  const anchorDesc = zhPrompt
    ? `从 ${readToolName} 复制的最新 LINE:HASH 锚点，例如 "42:f7a9"。`
    : `Fresh LINE:HASH anchor copied from ${readToolName}, for example "42:f7a9".`
  const setLineNewText = zhPrompt ? '替换内容；空字符串删除该行。' : 'Replacement content; an empty string deletes the anchored line.'
  const startAnchor = zhPrompt ? '包含范围内首行的最新锚点。' : 'Fresh anchor for the first line in the inclusive range.'
  const endAnchor = zhPrompt ? '包含范围内末行的最新锚点。' : 'Fresh anchor for the last line in the inclusive range.'
  const rangeNewText = zhPrompt ? '替换内容；空字符串删除该范围。' : 'Replacement content; an empty string deletes the range.'
  const insertAnchor = zhPrompt ? '在其后插入内容的那一行的最新锚点。' : 'Fresh anchor of the line after which content is inserted.'
  const insertNewText = zhPrompt ? '要插入的内容。不能为空。' : 'Content to insert. It must not be empty.'
  const variants: JsonSchema[] = [
    {
      type: 'object', additionalProperties: false, required: ['set_line'],
      properties: {
        set_line: {
          type: 'object', additionalProperties: false, required: ['anchor', 'new_text'],
          properties: { anchor: { type: 'string', description: anchorDesc }, new_text: { type: 'string', description: setLineNewText } },
        },
      },
    },
    {
      type: 'object', additionalProperties: false, required: ['replace_lines'],
      properties: {
        replace_lines: {
          type: 'object', additionalProperties: false, required: ['start_anchor', 'end_anchor', 'new_text'],
          properties: { start_anchor: { type: 'string', description: startAnchor }, end_anchor: { type: 'string', description: endAnchor }, new_text: { type: 'string', description: rangeNewText } },
        },
      },
    },
    {
      type: 'object', additionalProperties: false, required: ['insert_after'],
      properties: {
        insert_after: {
          type: 'object', additionalProperties: false, required: ['anchor', 'new_text'],
          properties: { anchor: { type: 'string', description: insertAnchor }, new_text: { type: 'string', description: insertNewText } },
        },
      },
    },
  ]
  return { oneOf: variants }
}

const LINE_OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['number', 'hash', 'anchor', 'text', 'truncated'],
  properties: {
    number: { type: 'integer' },
    hash: { type: 'string' },
    anchor: { type: 'string' },
    text: { type: 'string' },
    truncated: { type: 'boolean' },
  },
}

const READ_OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'offset', 'totalLines', 'eol', 'bom', 'lines'],
  properties: {
    path: { type: 'string' },
    offset: { type: 'integer' },
    totalLines: { type: 'integer' },
    eol: { type: 'string', enum: ['crlf', 'lf', 'mixed', 'unknown'] },
    bom: { type: 'boolean' },
    lines: { type: 'array', items: LINE_OUTPUT_SCHEMA },
  },
}

const DIFF_OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'oldText', 'newText'],
  properties: {
    path: { type: 'string' },
    oldText: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    newText: { type: 'string' },
    oldHashes: { type: 'array', items: { type: 'string' } },
    newHashes: { type: 'array', items: { type: 'string' } },
  },
}

const EDIT_OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'path',
    'changed',
    'editsApplied',
    'removedLines',
    'addedLines',
    'firstChangedLine',
    'eol',
    'bom',
    'preview',
  ],
  properties: {
    path: { type: 'string' },
    changed: { type: 'boolean' },
    editsApplied: { type: 'integer' },
    removedLines: { type: 'integer' },
    addedLines: { type: 'integer' },
    firstChangedLine: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    eol: { type: 'string', enum: ['crlf', 'lf', 'mixed', 'unknown'] },
    bom: { type: 'boolean' },
    preview: { type: 'array', items: LINE_OUTPUT_SCHEMA },
    presentation: {
      type: 'object',
      additionalProperties: false,
      required: ['diffs'],
      properties: {
        diffs: { type: 'array', items: DIFF_OUTPUT_SCHEMA },
      },
    },
  },
}

/**
 * 解析编辑请求为统一的内部形式：只接受非空锚定 edits。旧 hybrid 入口
 * （old_string/new_string/replace_all 与 edits[].replace 变体）已在 0.2.0
 * 移除——字面替换属于内置 edit 的职责；传入即在 sandbox、审批与文件 I/O
 * 之前被拒绝，并明确引导改用内置 edit 或锚定操作。
 */
interface NormalizedEditRequest {
  filePath: string
  rawEdits: RawEdit[]
}

function normalizeEditRequest(args: Record<string, unknown>): NormalizedEditRequest {
  const filePath = requirePath(args.file_path)
  // 空哨兵（'' / false / undefined）是某些适配器对 schema 可选字段的物化，
  // 忽略；任何非空 native 值都被拒绝并引导使用内置 edit。
  const hasNativePayload =
    (args.old_string !== undefined && args.old_string !== '') ||
    (args.new_string !== undefined && args.new_string !== '') ||
    (args.replace_all !== undefined && args.replace_all !== false)
  if (hasNativePayload) {
    invalidArgument(
      'this tool only accepts LINE:HASH-anchored edits; use the built-in edit for old_string/new_string literal replacement',
    )
  }
  if (!Array.isArray(args.edits)) {
    invalidArgument('edits must be a non-empty array of LINE:HASH-anchored operations')
  }
  // 某些 Tool 适配器会把 schema 中未选用的可选字段物化为空默认值（含把
  // union 内未选中的编辑变体物化成空对象）。只忽略这些精确空哨兵；错误
  // 类型或非空值仍进入 parseEditEntries 的严格校验。
  const onlyEmptyVariant = (value: unknown): boolean => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    return Object.values(value).every((field) => field === '' || field === false || field === undefined)
  }
  const rawEdits: RawEdit[] = []
  for (let index = 0; index < args.edits.length; index += 1) {
    const entry = args.edits[index]
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      invalidArgument(`edits[${index}] must be an object with exactly one anchored variant`)
    }
    const record = entry as Record<string, unknown>
    if (record.replace !== undefined && !onlyEmptyVariant(record.replace)) {
      invalidArgument(`edits[${index}].replace is not accepted; use the built-in edit for literal replacement`)
    }
    const owned: Record<string, unknown> = {}
    for (const key of ['set_line', 'replace_lines', 'insert_after'] as const) {
      const value = record[key]
      if (value !== undefined && !onlyEmptyVariant(value)) owned[key] = value
    }
    if (Object.keys(owned).length === 0) continue
    rawEdits.push(owned as RawEdit)
  }
  if (rawEdits.length === 0) {
    invalidArgument('edits must be a non-empty array of LINE:HASH-anchored operations')
  }
  return { filePath, rawEdits }
}

function editParameters(
  sandbox: SandboxController,
  zhPrompt: boolean,
  readToolName: string,
): JsonSchema {
  const filePathField = { type: 'string', description: zhPrompt ? '要编辑的路径，由 DSH 文件系统后端解析。' : 'Path to edit, resolved by the DSH filesystem backend.' }
  // 模型路由要求函数参数根节点为 type: object；嵌套 oneOf 是 DSH 模型输入
  // 工具支持的形状，让 edits 的每个数组项在 schema 层就只能选择一个操作分支。
  return {
    type: 'object',
    additionalProperties: false,
    required: ['file_path', 'edits'],
    properties: {
      file_path: filePathField,
      edits: {
        type: 'array',
        description: zhPrompt
          ? '必填的非空锚定编辑列表。每个数组项必须是只含 set_line、replace_lines 或 insert_after 之一的独立对象。'
          : 'Required non-empty anchored edit list. Every array element must be a separate object containing exactly one of set_line, replace_lines, or insert_after.',
        items: editItemSchema(zhPrompt, readToolName),
      },
      ...sandbox.schemaFields,
    },
  }
}

function resultFromContent(
  path: string,
  content: string,
  plan: EditPlan,
  options: EditOptions,
): EditResultValue {
  const file = splitTextFile(content)
  return {
    path,
    changed: plan.changed,
    editsApplied: plan.editsApplied,
    removedLines: plan.changed ? plan.removedLines : 0,
    addedLines: plan.changed ? plan.addedLines : 0,
    firstChangedLine: plan.changed ? plan.firstChangedLine : null,
    eol: file.eol,
    bom: file.bom,
    preview: previewContent(content, plan.firstChangedLine, options),
  }
}

interface ResolvedOptions extends EditOptions {
  hashLength: number
  readLimit: number
  maxLineLength: number
  contextLines: number
  zhPrompt: boolean
}

function toEditOptions(options: ResolvedConfig): ResolvedOptions {
  return {
    hashLength: options.hashLength,
    maxLineLength: options.maxLineLength,
    contextLines: options.contextLines,
      readLimit: options.readLimit,
      zhPrompt: options.zhPrompt,
  }
}

function createReadTool(
  ctx: DshContext,
  options: ResolvedOptions,
  editToolName: string,
  toolName = 'hashline_read',
): ToolDefinition {
  return {
      name: toolName,
      description: options.zhPrompt
        ? `用 LINE:HASH 锚点读取 UTF-8 文本文件供 ${editToolName} 使用。哈希使用 ${options.hashLength} 个十六进制字符并包含每个完整行尾。长行仅显示截断；其锚点仍覆盖完整行。结果报告所接受快照的 BOM 和行尾风格。` +
          (toolName === 'read' ? ' 这是绑定到内置 read 名的 hashline 读取工具。' : '')
        : `Read a UTF-8 text file with LINE:HASH anchors for ${editToolName}. Hashes use ${options.hashLength} hexadecimal characters and include each complete line ending. ` +
          'Long lines are display-truncated only; their anchors still cover the complete line. The result reports BOM and line-ending style for the accepted snapshot.' +
          (toolName === 'read' ? ' This is the hashline read tool bound to the built-in read name.' : ''),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['file_path'],
        properties: {
          file_path: { type: 'string', description: options.zhPrompt ? '要读取的路径，相对于调用会话工作区解析。' : 'Path to read, resolved relative to the calling session workspace.' },
          offset: { type: 'integer', description: options.zhPrompt ? '从 1 开始的首行。默认 1。' : 'One-based first line. Defaults to 1.' },
          limit: {
            type: 'integer',
            description: options.zhPrompt ? `最多返回的行数。默认为且不超过 ${options.readLimit}。` : `Maximum lines to return. Defaults to and cannot exceed ${options.readLimit}.`,
          },
        },
      },
    output: {
      schema: READ_OUTPUT_SCHEMA,
      render: (_args: unknown, value: Record<string, unknown>) => renderRead(value as never),
      // UI 投影保留 number/hash/text 三个叶字段；客户端专用 toolview 把 number/hash
      // 合并为灰色且不可选的 gutter，text 仍是可选择、可语法高亮的文件正文。
      presentationMeta: (_args: unknown, value: Record<string, unknown>) => {
        const v = value as { path: string; offset: number; totalLines: number; lines: LineRecord[] }
        const lang = langFromPath(v.path)
        return {
          path: v.path,
          offset: v.offset,
          lines: v.lines.map(({ number, hash, text }) => ({ number, hash, text })),
          totalLines: v.totalLines,
          ...(lang === undefined ? {} : { lang }),
        }
      },
    },
    isConcurrencySafe: () => true,
    async execute(rawArgs: unknown, exec: ToolExec) {
      const args = requireObject(rawArgs, 'arguments')
      assertOnlyKeys(args, ['file_path', 'offset', 'limit'], 'arguments')
      const filePath = requirePath(args.file_path)
      const offset = args.offset === undefined ? 1 : positiveInteger(args.offset, 'offset')
      const limit = args.limit === undefined ? options.readLimit : positiveInteger(args.limit, 'limit')
      if (limit > options.readLimit) invalidArgument(`limit must not exceed ${options.readLimit}`)

      const loaded = await loadStableFile(ctx, exec, filePath)
      const file = splitTextFile(loaded.content)
      if (file.lines.length > 0 && offset > file.lines.length) {
        throw hashlineError(
          'HASHLINE_OFFSET_OUT_OF_RANGE',
          `offset ${offset} is outside ${loaded.target.displayPath} (${file.lines.length} line(s))`,
        )
      }

      const end = Math.min(file.lines.length, offset + limit - 1)
      const lines: LineRecord[] = []
      for (let index = offset - 1; index < end; index += 1) {
        lines.push(lineRecord(file.lines, index, options))
      }
      ctx.emit('fs/observed', loaded.target, { kind: 'present', version: loaded.info.version }, exec)
      return {
        path: loaded.target.displayPath,
        offset,
        totalLines: file.lines.length,
        eol: file.eol,
        bom: file.bom,
        lines,
      }
    },
    presentCall(args: Record<string, unknown>) {
      return {
        card: 'generic',
        title: `Read ${args.file_path}`,
        kind: 'read',
        locations: [{ path: args.file_path, line: args.offset ?? 1 }],
      }
    },
    // 成功且 meta/envelope 均合法时返回原生读取卡；错误、旧回放或畸形数据
    // 一律返回 undefined 回退 generic，不抛错、不影响模型结果。
    presentResult(_args: Record<string, unknown>, result: ToolResult) {
      if (result.isError) return undefined
      const meta = narrowReadMeta(result.meta)
      if (meta === undefined) return undefined
      const only = result.content.length === 1 ? result.content[0] : undefined
      const text = only?.type === 'text' ? only.text : undefined
      if (text === undefined) return undefined
      const body = extractReadBody(text)
      if (body === undefined) return undefined
      return {
        card: 'read',
        path: meta.path,
        offset: meta.offset,
        lines: meta.lines,
        totalLines: meta.totalLines,
        ...(meta.lang === undefined ? {} : { lang: meta.lang }),
        content: [{ type: 'text', text: body }],
      }
    },
  }
}

function createEditTool(
  ctx: DshContext,
  options: ResolvedOptions,
  sandbox: SandboxController,
  toolName: string,
  readToolName: string,
): ToolDefinition {
  return {
    name: toolName,
    description: options.zhPrompt
      ? `用 ${readToolName} 最新输出中的 LINE:HASH 锚点编辑现有 UTF-8 文本文件。edits 必须非空，每个数组项只包含 set_line、replace_lines 或 insert_after 中的一个操作。此入口不接受 old_string/new_string 字面替换；简单字面替换请用内置 edit。所有锚点在写入前针对同一稳定快照统一校验。`
      : `Edit an existing UTF-8 text file with fresh LINE:HASH anchors from ${readToolName}. edits is required and non-empty; every array element must contain exactly one set_line, replace_lines, or insert_after operation. This surface does not accept old_string/new_string literal replacement; use the built-in edit for that. All anchors are verified against one stable snapshot before writing.`,
    parameters: editParameters(sandbox, options.zhPrompt, readToolName),
    output: {
      schema: EDIT_OUTPUT_SCHEMA,
      render: (_args: unknown, value: Record<string, unknown>) => renderEdit(value as unknown as EditResultValue, toolName),
      // 始终返回 lossless JSON：无变化时用空 diffs，让 presentResult 回退 generic；
      // 不能返回 undefined，否则真实 DSH ToolRuntime 会把成功结果转成 INVALID_TOOL_OUTPUT。
      presentationMeta: (_args: unknown, value: Record<string, unknown>) => {
        const presentation = (value as unknown as EditResultValue).presentation
        return { diffs: presentation?.diffs ?? [] }
      },
    },
    async execute(rawArgs: unknown, exec: ToolExec) {
      const args = requireObject(rawArgs, 'arguments')
      // 键集合仍列 old_string/new_string/replace_all：normalizeEditRequest 会
      // 对它们给出指向内置 edit 的清晰拒绝，而不是笼统的未知字段错误。
      assertOnlyKeys(
        args,
        sandbox.confining
          ? ['file_path', 'old_string', 'new_string', 'replace_all', 'edits', 'sandbox_permissions', 'justification']
          : ['file_path', 'old_string', 'new_string', 'replace_all', 'edits'],
        'arguments',
      )
      const { filePath, rawEdits } = normalizeEditRequest(args)
      // 编辑结构在 sandbox、审批和文件 I/O 前失败；旧回放或直接调用传入的
      // 无锚点 replace 由 normalizeEditRequest 与 parseEditEntries 在此拒绝。
      parseEditEntries(rawEdits)
      if (exec.agent === undefined) {
        throw hashlineError('HASHLINE_AGENT_REQUIRED', `${toolName} requires an agent-backed tool execution`)
      }
      const policy = await sandbox.resolve(args, exec, toolName)
      const loaded = await loadStableFile(ctx, exec, filePath, policy?.workspaceRoot)

      // Recording the stable snapshot before planning lets fs-observation-policy
      // contribute the same current version to the write-intent waterfall.
      ctx.emit('fs/observed', loaded.target, { kind: 'present', version: loaded.info.version }, exec)
      // 替换模式下错误消息使用 scoped 工具名（edit/read），默认模式为 hashline_edit/hashline_read。
      const editOptions: EditOptions = { ...options, toolName, readToolName }
      const plan = planEdits(loaded.content, rawEdits, editOptions)
      if (!plan.changed) {
        return resultFromContent(loaded.target.displayPath, loaded.content, plan, options)
      }

      const localIntent: WriteIntent = { kind: 'replaceIfVersion', version: loaded.info.version }
      const intent = (await ctx.waterfall('fs/write-intent', loaded.target, exec, () => localIntent)) as
        | WriteIntent
        | undefined
      let outcome: WriteOutcome
      try {
        outcome = await ctx.fs.writeText(
          loaded.target,
          plan.after,
          intent ?? localIntent,
          exec.signal,
          policy,
        )
      } catch (error) {
        throw remapFileError(error, policy, sandbox.confining)
      }
      ctx.emit('fs/observed', loaded.target, { kind: 'present', version: outcome.version }, exec)
      const value = resultFromContent(loaded.target.displayPath, plan.after, plan, options)
      // 展示层 diff 只由实际写入的前后文本计算；失败路径不产生 presentation。
      value.presentation = { diffs: computeHunkDiffs(filePath, loaded.content, plan.after, options.hashLength) }
      return value
    },
    presentCall(args: Record<string, unknown>) {
      const filePath = args.file_path
      if (typeof filePath !== 'string') return undefined
      // 锚点编辑没有旧文本可展示；保持简洁的 edit intent，不伪造 diff。
      return {
        card: 'generic',
        title: `Edit ${filePath}`,
        kind: 'edit',
        locations: [{ path: filePath }],
      }
    },
    // 成功且 meta 含合法 hunks 时用真实 before/after 替换 pending 内容；
    // 错误、无变化、stale version 与畸形回放一律 undefined，回退普通文本。
    presentResult(args: Record<string, unknown>, result: ToolResult) {
      if (result.isError) return undefined
      const diffs = narrowDiffsMeta(result.meta)
      if (diffs === undefined) return undefined
      const filePath = typeof args.file_path === 'string' ? args.file_path : diffs[0]?.path
      if (filePath === undefined) return undefined
      return { card: 'diff', title: `Edit ${filePath}`, diffs }
    },
  }
}

function guidanceText(options: ResolvedConfig): string {
  if (options.zhPrompt) {
    return (
      '用 hashline_read 后再 hashline_edit（edits）做对同一文件的多次编辑、多处原子编辑，或在字面替换因空白或行尾而脆弱时使用。edits 数组的每一项只放一个操作。' +
      '从最新输出中精确复制 LINE:HASH 锚点。哈希不匹配意味着未写入；使用错误中给出的更新锚点或重新读取。' +
      '新建文件用 write，简单唯一字面替换用内置 edit。'
    )
  }
  return (
    'Use hashline_read followed by hashline_edit with edits for repeated edits to the same file, multi-location atomic edits, or when literal replacement is fragile because of whitespace or line endings. Put exactly one operation in each edits array element. ' +
    'Copy LINE:HASH anchors exactly from the newest output. A hash mismatch means nothing was written; use the updated anchor in the error or read again. ' +
    'Use write for new files and the built-in edit for a simple unique literal replacement.'
  )
}

/**
 * 替换模式下 tool:read 的阴影文本：只讲 Hashline 读取，不重复编辑说明。
 * 原版 tool-fs 的 read/edit 提示词各司其职，这里同样拆分，避免合并文本在
 * tool:read 与 tool:edit 两个 section 里重复出现。
 */
function readGuidanceText(options: ResolvedConfig): string {
  const readToolName = options.replaceBuiltinEdit ? 'read' : 'hashline_read'
  if (options.zhPrompt) {
    return (
      `使用 ${readToolName} 工具——而不是 cat 之类的 shell 命令——检查 UTF-8 文本文件。` +
      '结果包含 LINE:HASH 锚点，对每个完整行尾进行哈希。' +
      '从最新输出中精确复制 LINE:HASH 锚点。使用 offset 和 limit 继续读取大文件。'
    )
  }
  return (
    `Use the ${readToolName} tool — not shell commands like cat — to inspect UTF-8 text files. ` +
    'Results include LINE:HASH anchors that hash each complete line ending. ' +
    'Copy LINE:HASH anchors exactly from the newest output. Use offset and limit to continue reading large files.'
  )
}

/**
 * 替换模式下 tool:edit 的阴影文本：只讲哈希锚定编辑（此函数仅在
 * replaceBuiltinEdit 开启、工具名为 edit/read 时被注入）。
 */
function editGuidanceText(options: ResolvedConfig): string {
  const editToolName = 'edit'
  const readToolName = 'read'
  if (options.zhPrompt) {
    return (
      `使用 ${editToolName} 工具对现有 UTF-8 文本文件做严格的哈希锚定修改。` +
      `先用 ${readToolName} 读取，再从最新输出精确复制 LINE:HASH。edits 数组的每一项只放一个 set_line、replace_lines 或 insert_after 操作；多处修改拆成多个数组项。` +
      '此入口不接受 old_string/new_string 字面替换。哈希不匹配意味着未写入；使用错误中的新锚点或重新读取。新建文件用 write。'
    )
  }
  return (
    `Use the ${editToolName} tool for strictly hash-anchored changes to existing UTF-8 text files. ` +
    `Call ${readToolName} first and copy fresh LINE:HASH anchors exactly. Put exactly one set_line, replace_lines, or insert_after operation in each edits array element; use separate elements for separate changes. ` +
    'This surface does not accept old_string/new_string literal replacement. A hash mismatch means nothing was written; use the updated anchor in the error or read again. Use write for new files.'
  )
}

function disposeAll(disposers: Array<() => void>): void {
  while (disposers.length > 0) disposers.pop()?.()
}

const HOST_MODULES: URL[] = [
  new URL(import.meta.url),
  new URL('./core.js', import.meta.url),
  new URL('./presentation.js', import.meta.url),
  new URL('./runtime-entry.js', import.meta.url),
]

function pathInside(filePath: string, directory: string): boolean {
  const child = relative(directory, filePath)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

function hmrRootCoversHostModules(hmr: HmrService | undefined): boolean {
  if (hmr === undefined) return false
  const roots = hmr?.config?.root
  if (!Array.isArray(roots) || roots.length === 0) return false
  const baseDir = typeof hmr.baseDir === 'string' ? hmr.baseDir : ''
  return roots.some((root) => {
    const directory = resolve(baseDir, root as string)
    return HOST_MODULES.some((moduleUrl) => pathInside(fileURLToPath(moduleUrl), directory))
  })
}

/**
 * 是否以 profile bundle 形态安装（模块位于 node_modules 下）。官方 HMR 的
 * 依赖收集会跳过 node_modules（vendor/hmr `loadDependencies`），所以这种
 * 形态下官方 HMR 永远不会跟踪本插件的模块，即使其 `root` 覆盖了本目录。
 */
function hostModulesAreBundled(): boolean {
  return HOST_MODULES.some((moduleUrl) => fileURLToPath(moduleUrl).split(/[\\/]/).includes('node_modules'))
}

function installHostHotReload(ctx: DshContext): void {
  const hmr = ctx.get('hmr') as HmrService | undefined
  if (hmr === undefined || hmr === null) return
  if (typeof hmr.registerConfig !== 'function' || typeof hmr.partialReload !== 'function') return
  // 只有 workspace 形态（非 node_modules）且官方 HMR 的 root 已覆盖本目录时才
  // 交给官方 HMR；profile bundle 形态（node_modules）官方 HMR 不会跟踪，必须
  // 始终自注册精确监视，否则改 lib 后永远无法热重载（只能重启）。
  if (!hostModulesAreBundled() && hmrRootCoversHostModules(hmr)) return

  const disposers: Array<() => void | Promise<void>> = []
  let closed = false
  let reloadTimer: ReturnType<typeof setTimeout> | undefined
  const scheduleReload = () => {
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      reloadTimer = undefined
      void Promise.resolve(hmr.partialReload!()).catch((error) => {
        ctx.logger?.warn?.(`dsh-hashline: Host hot reload failed: ${errorMessage(error)}`)
      })
    }, 120)
  }

  for (const moduleUrl of HOST_MODULES) {
    let ready = false
    Promise.resolve(hmr.registerConfig!(fileURLToPath(moduleUrl), () => {
      if (!ready || closed) return
      try {
        hmr.stashed?.add(moduleUrl.href)
      } catch (error) {
        ctx.logger?.warn?.(`dsh-hashline: could not stage ${fileURLToPath(moduleUrl)}: ${errorMessage(error)}`)
        return
      }
      scheduleReload()
    })).then(
      (dispose) => {
        if (closed) return void dispose()
        ready = true
        disposers.push(dispose)
      },
      (error) => {
        ctx.logger?.warn?.(`dsh-hashline: could not watch ${fileURLToPath(moduleUrl)}: ${errorMessage(error)}`)
      },
    )
  }

  ctx.effect(
    () => async () => {
      closed = true
      clearTimeout(reloadTimer)
      await Promise.allSettled(disposers.map((dispose) => dispose()))
    },
    'dsh-hashline: Host hot reload',
  )
}

export function apply(ctx: DshContext, config: Record<string, unknown> = {}): void {
  // Keep tools live immediately; only source watching waits for the post-boot HMR service.
  ctx.inject(['hmr'], (hotContext) => installHostHotReload(hotContext as DshContext))
  const baseConfig = resolveConfig(config)
  const sandbox = createSandboxController(ctx)

  // Config schema 从 profile 解析 schemastery 构造（与主进程同一实例）。
  // profile 不可用时降级：不注册 settings UI，工具按传入配置工作。
  const schemaFactory = loadSchemastery() as SchemaFactory | null
  const Config = schemaFactory === null ? undefined : createConfigSchema(schemaFactory)
  let settings: SettingsScope | undefined
  if (Config !== undefined) {
    settings = ctx.settings.register(SETTINGS_NAMESPACE, Config, {
      base: baseConfig as unknown as Record<string, unknown>,
      applies: 'live',
      exposeToClients: true,
    })
  } else {
    ctx.logger?.warn?.('dsh-hashline: schemastery unavailable from the profile; settings UI disabled')
  }

  const globalDisposers: Array<() => void> = []
  const replacementDisposers = new Map<Agent, () => void>()
  let current: ResolvedConfig = baseConfig
  let stopped = false

  function clearReplacements(): void {
    const disposers = [...replacementDisposers.values()]
    replacementDisposers.clear()
    disposeAll(disposers)
  }

  function warnReplacement(agent: Agent, error: unknown): void {
    const agentId = agent?.id ?? agent?.session?.header?.id ?? 'unknown'
    ctx.logger?.warn?.(`dsh-hashline: could not replace built-in read/edit for agent ${String(agentId)}: ${errorMessage(error)}`)
  }

  function installReplacement(agent: Agent): void {
    if (replacementDisposers.has(agent)) return
    const scopedTools = agent?.ctx?.tools ?? (agent?.ctx?.get?.('tools') as ToolRegistration | undefined)
    if (scopedTools === undefined) {
      warnReplacement(agent, new Error('agent context has no tools service'))
      return
    }
    // Preserve preset policy: an own-layer tool must not revive a built-in
    // read/edit or a hashline capability that the agent's inherited view hid.
    if (
      ctx.tools.get('read', agent) === undefined ||
      ctx.tools.get('edit', agent) === undefined ||
      ctx.tools.get('hashline_read', agent) === undefined ||
      ctx.tools.get('hashline_edit', agent) === undefined
    )
      return

    let disposeRead: (() => void) | undefined
    let disposeEdit: (() => void) | undefined
    let disposePromptShadow: (() => void) | undefined
    try {
      disposeRead = scopedTools.register(createReadTool(ctx, current, 'edit', 'read'))
      disposeEdit = scopedTools.register(createEditTool(ctx, current, sandbox, 'edit', 'read'))
      const disposeRestriction = scopedTools.restrict?.({ deny: ['hashline_read', 'hashline_edit'] })
      // 替换开启时同样替换提示词：在 Agent 自身作用域用同名 tool:read/tool:edit
      // section 阴影内置原文（DSH system-prompt 支持 scope 层同名阴影全局层），
      // 避免“原文 + hashline 说明”重复出现。未开启提示词注入或 service 缺失时跳过。
      if (current.promptGuidance) {
        const scopedPrompt = (agent?.ctx?.get?.('systemPrompt') as SystemPromptService | undefined)
          ?? (agent?.ctx as unknown as { systemPrompt?: SystemPromptService } | undefined)?.systemPrompt
        if (typeof scopedPrompt?.section === 'function') {
          const promptDisposers: Array<() => void> = []
          try {
              promptDisposers.push(scopedPrompt.section({ name: 'tool:read', order: 100, text: readGuidanceText(current) }))
              promptDisposers.push(scopedPrompt.section({ name: 'tool:edit', order: 102, text: editGuidanceText(current) }))
          } catch (error) {
            disposeAll(promptDisposers)
            throw error
          }
          disposePromptShadow = () => disposeAll(promptDisposers)
        }
      }
      let active = true
      replacementDisposers.set(agent, () => {
        if (!active) return
        active = false
        disposeRestriction?.()
        disposePromptShadow?.()
        disposeRead?.()
        disposeEdit?.()
      })
    } catch (error) {
      disposeRead?.()
      disposeEdit?.()
      disposePromptShadow?.()
      warnReplacement(agent, error)
    }
  }

  function registerGlobalSurface(options: ResolvedConfig): Array<() => void> {
    const added: Array<() => void> = []
    try {
      // 全局读取入口始终配对全局 hashline_edit。只有替换确实安装成功的
      // Agent scoped read 才在 installReplacement 中配对严格 edit。
      added.push(ctx.tools.register(createReadTool(ctx, toEditOptions(options), 'hashline_edit')))
      added.push(ctx.tools.register(createEditTool(ctx, toEditOptions(options), sandbox, 'hashline_edit', 'hashline_read')))
      if (options.promptGuidance && !options.replaceBuiltinEdit) {
        added.push(ctx.systemPrompt.section({ name: 'tool:hashline', order: 103, text: guidanceText(options) }))
      }
      return added
    } catch (error) {
      disposeAll(added)
      throw error
    }
  }

  function refresh(next: Record<string, unknown>): void {
    const resolved = resolveConfig(next)
    clearReplacements()
    disposeAll(globalDisposers)
    current = resolved
    if (!resolved.enabled) return
    globalDisposers.push(...registerGlobalSurface(resolved))
    if (resolved.replaceBuiltinEdit) {
      for (const agent of ctx.agents.list()) installReplacement(agent)
    }
  }

  ctx.effect(
    () => () => {
      stopped = true
      clearReplacements()
      disposeAll(globalDisposers)
    },
    'dsh-hashline: dynamic tool surface',
  )
  ctx.effect(
    () =>
      settings === undefined
        ? undefined
        : settings.watch((next) => {
            if (!stopped) refresh(next)
          }),
    'dsh-hashline: settings watch',
  )
  ctx.on('agent/created', (payload: unknown) => {
    const { agent } = payload as { agent: Agent }
    if (!stopped && current.enabled && current.replaceBuiltinEdit) installReplacement(agent)
  })
  ctx.on('agent/disposed', (payload: unknown) => {
    const { agent } = payload as { agent: Agent }
    // Scoped tool effects have already unwound before this event.
    replacementDisposers.delete(agent)
  })

  refresh((settings === undefined ? baseConfig : settings.get()) as Record<string, unknown>)
}
