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

interface ToolDefinition {
  name?: string
  source?: string
  description?: string
  parameters?: JsonSchema
  output?: JsonSchema
  isConcurrencySafe?: () => boolean
  execute?: (rawArgs: unknown, exec: ToolExec) => unknown
  presentCall?: (args: Record<string, unknown>) => unknown
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
}

const CONFIG_KEYS = [
  'enabled',
  'replaceBuiltinEdit',
  'hashLength',
  'readLimit',
  'maxLineLength',
  'contextLines',
  'promptGuidance',
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

  return {
    enabled,
    replaceBuiltinEdit,
    hashLength: hashLength as number,
    readLimit: readLimit as number,
    maxLineLength: maxLineLength as number,
    contextLines: contextLines as number,
    promptGuidance,
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
  const header =
    value.totalLines === 0
      ? `hashline_read: ${value.path} — empty file (eol: ${value.eol}${value.bom ? ', bom' : ''})`
      : `hashline_read: ${value.path} — ${value.totalLines} lines total, showing ${value.offset}-${value.offset + value.lines.length - 1} (eol: ${value.eol}${value.bom ? ', bom' : ''})`
  if (value.lines.length === 0) return [{ type: 'text', text: header }]
  return [{ type: 'text', text: `${header}\n${value.lines.map(formatLine).join('\n')}` }]
}

interface EditResultValue {
  path: string
  changed: boolean
  editsApplied: number
  replacements: number
  removedLines: number
  addedLines: number
  firstChangedLine: number | null
  eol: string
  bom: boolean
  preview: LineRecord[]
}

function renderEdit(value: EditResultValue, toolName = 'hashline_edit'): unknown[] {
  const summary = value.changed
    ? `${toolName}: applied ${value.editsApplied} edit(s) to ${value.path}; replacements=${value.replacements}, lines removed=${value.removedLines}, lines added=${value.addedLines}`
    : `${toolName}: no change was needed for ${value.path}`
  if (value.preview.length === 0) return [{ type: 'text', text: summary }]
  return [{ type: 'text', text: `${summary}\nUpdated anchors:\n${value.preview.map(formatLine).join('\n')}` }]
}

const SET_LINE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['anchor', 'new_text'],
  properties: {
    anchor: { type: 'string', description: 'LINE:HASH anchor copied from hashline_read, for example "42:f7a9".' },
    new_text: { type: 'string', description: 'Replacement content; an empty string deletes the anchored line.' },
  },
}

const REPLACE_LINES_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['start_anchor', 'end_anchor', 'new_text'],
  properties: {
    start_anchor: { type: 'string', description: 'Anchor for the first line in the inclusive range.' },
    end_anchor: { type: 'string', description: 'Anchor for the last line in the inclusive range.' },
    new_text: { type: 'string', description: 'Replacement content; an empty string deletes the range.' },
  },
}

const INSERT_AFTER_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['anchor', 'new_text'],
  properties: {
    anchor: { type: 'string', description: 'Anchor of the line after which content is inserted.' },
    new_text: { type: 'string', description: 'Content to insert. It must not be empty.' },
  },
}

const REPLACE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['old_text', 'new_text'],
  properties: {
    old_text: { type: 'string', description: 'Literal text to replace. It must not be empty.' },
    new_text: { type: 'string', description: 'Literal replacement text.' },
    all: { type: 'boolean', description: 'Replace every occurrence. The default is false, which requires exactly one match.' },
  },
}

const EDIT_ITEM_SCHEMA: JsonSchema = {
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['set_line'], properties: { set_line: SET_LINE_SCHEMA } },
    {
      type: 'object',
      additionalProperties: false,
      required: ['replace_lines'],
      properties: { replace_lines: REPLACE_LINES_SCHEMA },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['insert_after'],
      properties: { insert_after: INSERT_AFTER_SCHEMA },
    },
    { type: 'object', additionalProperties: false, required: ['replace'], properties: { replace: REPLACE_SCHEMA } },
  ],
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

const EDIT_OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'path',
    'changed',
    'editsApplied',
    'replacements',
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
    replacements: { type: 'integer' },
    removedLines: { type: 'integer' },
    addedLines: { type: 'integer' },
    firstChangedLine: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    eol: { type: 'string', enum: ['crlf', 'lf', 'mixed', 'unknown'] },
    bom: { type: 'boolean' },
    preview: { type: 'array', items: LINE_OUTPUT_SCHEMA },
  },
}

function editParameters(sandbox: SandboxController): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['file_path', 'edits'],
    properties: {
      file_path: { type: 'string', description: 'Path to edit, resolved by the DSH filesystem backend.' },
      edits: {
        type: 'array',
        description: 'Non-empty atomic edit list. Each item must contain exactly one edit variant.',
        items: EDIT_ITEM_SCHEMA,
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
    replacements: plan.replacements,
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
}

function toEditOptions(options: ResolvedConfig): ResolvedOptions {
  return {
    hashLength: options.hashLength,
    maxLineLength: options.maxLineLength,
    contextLines: options.contextLines,
    readLimit: options.readLimit,
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
    description:
      `Read a UTF-8 text file with LINE:HASH anchors for ${editToolName}. Hashes use ${options.hashLength} hexadecimal characters and include each complete line ending. ` +
      'Long lines are display-truncated only; their anchors still cover the complete line. The result reports BOM and line-ending style for the accepted snapshot.' +
      (toolName === 'read' ? ' This is the hashline read tool bound to the built-in read name.' : ''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['file_path'],
      properties: {
        file_path: { type: 'string', description: 'Path to read, resolved relative to the calling session workspace.' },
        offset: { type: 'integer', description: 'One-based first line. Defaults to 1.' },
        limit: {
          type: 'integer',
          description: `Maximum lines to return. Defaults to and cannot exceed ${options.readLimit}.`,
        },
      },
    },
    output: {
      schema: READ_OUTPUT_SCHEMA,
      render: (_args: unknown, value: Record<string, unknown>) => renderRead(value as never),
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
        title: `Hashline read ${args.file_path}`,
        kind: 'read',
        locations: [{ path: args.file_path, line: args.offset ?? 1 }],
      }
    },
  }
}

function createEditTool(
  ctx: DshContext,
  options: ResolvedOptions,
  sandbox: SandboxController,
  toolName: string,
): ToolDefinition {
  return {
    name: toolName,
    description:
      'Atomically edit an existing UTF-8 text file with fresh LINE:HASH anchors from hashline_read. ' +
      'All anchors are verified against one stable snapshot before any write; stale anchors and overlapping targets fail without changing the file. ' +
      'Supported variants are set_line, replace_lines, insert_after, and exact replace. Anchored edits cannot be mixed with replace.',
    parameters: editParameters(sandbox),
    output: {
      schema: EDIT_OUTPUT_SCHEMA,
      render: (_args: unknown, value: Record<string, unknown>) => renderEdit(value as unknown as EditResultValue, toolName),
    },
    async execute(rawArgs: unknown, exec: ToolExec) {
      const args = requireObject(rawArgs, 'arguments')
      assertOnlyKeys(
        args,
        sandbox.confining
          ? ['file_path', 'edits', 'sandbox_permissions', 'justification']
          : ['file_path', 'edits'],
        'arguments',
      )
      const filePath = requirePath(args.file_path)
      parseEditEntries(args.edits as RawEdit[])
      if (exec.agent === undefined) {
        throw hashlineError('HASHLINE_AGENT_REQUIRED', `${toolName} requires an agent-backed tool execution`)
      }
      const policy = await sandbox.resolve(args, exec, toolName)
      const loaded = await loadStableFile(ctx, exec, filePath, policy?.workspaceRoot)

      // Recording the stable snapshot before planning lets fs-observation-policy
      // contribute the same current version to the write-intent waterfall.
      ctx.emit('fs/observed', loaded.target, { kind: 'present', version: loaded.info.version }, exec)
      const plan = planEdits(loaded.content, args.edits as RawEdit[], options)
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
      return resultFromContent(loaded.target.displayPath, plan.after, plan, options)
    },
    presentCall(args: Record<string, unknown>) {
      return {
        card: 'generic',
        title: `Hashline edit ${args.file_path}`,
        kind: 'edit',
        locations: [{ path: args.file_path }],
      }
    },
  }
}

function guidanceText(options: ResolvedConfig): string {
  const replaced = options.replaceBuiltinEdit
  const readToolName = replaced ? 'read' : 'hashline_read'
  const editToolName = replaced ? 'edit' : 'hashline_edit'
  const finalGuidance = replaced
    ? 'The read and edit tools are currently the Hashline read/editor; use the edit replace variant for a simple unique literal replacement. Use write for new files.'
    : 'Use write for new files and the built-in edit for a simple unique literal replacement.'
  return (
    `Use ${readToolName} followed by ${editToolName} for repeated edits to the same file, multi-location atomic edits, or when literal replacement is fragile because of whitespace or line endings. ` +
    'Copy LINE:HASH anchors exactly from the newest output. A hash mismatch means nothing was written; use the updated anchor in the error or read again. ' +
    finalGuidance
  )
}

function disposeAll(disposers: Array<() => void>): void {
  while (disposers.length > 0) disposers.pop()?.()
}

const HOST_MODULES: URL[] = [new URL(import.meta.url), new URL('./core.js', import.meta.url)]

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

function installHostHotReload(ctx: DshContext): void {
  const hmr = ctx.get('hmr') as HmrService | undefined
  if (hmr === undefined || hmr === null || hmrRootCoversHostModules(hmr)) return
  if (typeof hmr.registerConfig !== 'function' || typeof hmr.partialReload !== 'function') return

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
    try {
      disposeRead = scopedTools.register(createReadTool(ctx, current, 'edit', 'read'))
      disposeEdit = scopedTools.register(createEditTool(ctx, current, sandbox, 'edit'))
      const disposeRestriction = scopedTools.restrict?.({ deny: ['hashline_read', 'hashline_edit'] })
      let active = true
      replacementDisposers.set(agent, () => {
        if (!active) return
        active = false
        disposeRestriction?.()
        disposeRead?.()
        disposeEdit?.()
      })
    } catch (error) {
      disposeRead?.()
      disposeEdit?.()
      warnReplacement(agent, error)
    }
  }

  function registerGlobalSurface(options: ResolvedConfig): Array<() => void> {
    const editToolName = options.replaceBuiltinEdit ? 'edit' : 'hashline_edit'
    const added: Array<() => void> = []
    try {
      added.push(ctx.tools.register(createReadTool(ctx, toEditOptions(options), editToolName)))
      added.push(ctx.tools.register(createEditTool(ctx, toEditOptions(options), sandbox, 'hashline_edit')))
      if (options.promptGuidance) {
        added.push(
          ctx.systemPrompt.section({
            name: 'tool:hashline',
            order: 103,
            text: guidanceText(options),
          }),
        )
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
