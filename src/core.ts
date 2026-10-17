import { createHash } from 'node:crypto'
import { loadDshLlm } from './profile-modules.js'

type HarnessErrorConstructor = new (message: string, code: string, options?: ErrorOptions) => Error

// 优先从 profile 解析 DSH 的 HarnessError（与主进程同一实例，保留错误身份
// 与结构化 { name, code } 序列化）；profile 不可用时降级为普通 Error。
//
// DSH 0.2.1 起 @deepseek-ai/dsh-llm 的 default 导出是 LlmRuntime 类本身，
// HarnessError 只在具名导出里（packages/llm/llm/src/index.ts 末尾
// `export default LlmRuntime`）。loadDshLlm() 因此返回整个命名空间，这里两种
// 形状都取：既兼容「default 即聚合面」的旧包，也覆盖当前 DSH。
const dshLlmModule = loadDshLlm() as
  | { HarnessError?: HarnessErrorConstructor; default?: { HarnessError?: HarnessErrorConstructor } }
  | null
const HarnessErrorBase: HarnessErrorConstructor =
  dshLlmModule?.HarnessError ??
  dshLlmModule?.default?.HarnessError ??
  (Error as unknown as HarnessErrorConstructor)


export const DEFAULT_HASH_LENGTH = 4
export const DEFAULT_MAX_LINE_LENGTH = 500
export const DEFAULT_READ_LIMIT = 2000
export const DEFAULT_CONTEXT_LINES = 2
/** Maximum UTF-8 bytes loaded or supplied by one Hashline operation.
 * Mirrors the host `tool-fs` read renderer's default `READ_MAX_BYTES` (50 KiB).
 */
export const MAX_FILE_BYTES = 50 * 1024

/** 锚定编辑的三种变体名称；精确文本替换（replace）已在 0.2.0 移除。0.3.0 起供扁平 op 形状复用。 */
export type EditKind = 'set_line' | 'replace_lines' | 'insert_after'
export const EDIT_KINDS: readonly EditKind[] = ['set_line', 'replace_lines', 'insert_after']

/** Hashline 编辑错误码（稳定、可机器路由）。`FS_*` 为 DSH fs 后端产生、经 remapFileError 代理透出的同名词。 */
export type HashlineErrorCode =
  | 'HASHLINE_INVALID_ARGUMENT'
  | 'HASHLINE_INVALID_CONFIG'
  | 'HASHLINE_INVALID_ANCHOR'
  | 'HASHLINE_ANCHOR_OUT_OF_RANGE'
  | 'HASHLINE_HASH_MISMATCH'
  | 'HASHLINE_INVALID_RANGE'
    | 'HASHLINE_OVERLAPPING_EDIT'
    | 'HASHLINE_MULTIPLE_ANCHOR_ERRORS'
  | 'HASHLINE_FILE_TOO_LARGE'
  | 'HASHLINE_FILE_NOT_FOUND'
  | 'HASHLINE_NOT_A_FILE'
  | 'HASHLINE_FILE_CHANGED_DURING_READ'
  | 'HASHLINE_OFFSET_OUT_OF_RANGE'
  | 'HASHLINE_AGENT_REQUIRED'
  | 'FS_SANDBOX_DENIED'
  | 'FS_STALE_VERSION'
  | 'FS_NOT_OBSERVED'

/** 附加到 HashlineError 上的结构化诊断信息（`details`）。 */
export type HashlineErrorDetails = Record<string, unknown>

/**
 * Hashline 插件专用错误，继承 DSH 的 `HarnessError`（经 profile 解析加载）。
 * 除继承的稳定 `code` 外，可携带结构化 `details`。
 */
export class HashlineError extends HarnessErrorBase {
  readonly code: HashlineErrorCode
  details?: HashlineErrorDetails

  constructor(
    code: HashlineErrorCode,
    message: string,
    details?: HashlineErrorDetails,
    options?: ErrorOptions,
  ) {
    super(message, code, options)
    this.code = code
    this.name = 'HashlineError'
    if (details !== undefined) this.details = details
  }
}

function fail(
  code: HashlineErrorCode,
  message: string,
  details?: HashlineErrorDetails,
  options?: ErrorOptions,
): never {
  throw new HashlineError(code, message, details, options)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 错误消息语言:zhPrompt 开启后中文,默认英文(与提示词的 zhPrompt 同源)。 */
export function messageText(zhPrompt: boolean | undefined, en: string, zh: string): string {
  return zhPrompt === true ? zh : en
}

export function requireString(value: unknown, label: string, zhPrompt?: boolean): string {
  if (typeof value !== 'string') {
    fail('HASHLINE_INVALID_ARGUMENT', messageText(zhPrompt, `${label} must be a string`, `${label} 必须是字符串`))
  }
  return value
}

  /** str_replace 家族键名：任何值（含 null 占位）都在项级响亮拒绝，维持锚定契约边界。 */
  const STR_REPLACE_KEYS: readonly string[] = ['old_string', 'new_string', 'replace_all', 'replace']

    function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string, zhPrompt?: boolean): void {
    // 值为 null 的未知键是「当前操作未使用字段」的占位（对齐官方 v0.1.2 起内置
    // edit 的 null 占位语义），忽略；str_replace 家族键名仍任何值拒绝。
    const extras = Object.keys(value).filter((key) => {
      if (allowed.includes(key)) return false
      if (STR_REPLACE_KEYS.includes(key)) return true
      return value[key] !== null
    })
      if (extras.length > 0) {
        fail('HASHLINE_INVALID_ARGUMENT', messageText(zhPrompt,
          `${label} contains unsupported field(s): ${extras.join(', ')}`,
          `${label} 含不支持的键: ${extras.join(', ')}`))
      }
  }

export function hashText(value: string, length: number = DEFAULT_HASH_LENGTH): string {
  if (!Number.isInteger(length) || length < 3 || length > 16) {
    fail('HASHLINE_INVALID_CONFIG', 'hashLength must be an integer between 3 and 16')
  }
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, length)
}

/** 文本文件的一行：正文 `text` 与其完整行尾 `eol`（末行可为 `''`）。 */
export interface TextLine {
  text: string
  eol: string
}

export function hashLine(line: TextLine, length: number = DEFAULT_HASH_LENGTH): string {
  return hashText(line.text + line.eol, length)
}

/** 拆分后的文本文件模型：BOM 标志、去除 BOM 的正文、行数组与行尾风格。 */
export interface SplitTextFile {
  bom: boolean
  body: string
  lines: TextLine[]
  eol: 'unknown' | 'mixed' | 'crlf' | 'lf'
}

export function splitTextFile(content: string): SplitTextFile {
  requireString(content, 'content')
  const bom = content.startsWith('\uFEFF')
  const body = bom ? content.slice(1) : content
  const lines: TextLine[] = []
  let start = 0

  for (let index = 0; index < body.length; index += 1) {
    if (body.charCodeAt(index) !== 10) continue
    const hasCr = index > start && body.charCodeAt(index - 1) === 13
    lines.push({
      text: body.slice(start, hasCr ? index - 1 : index),
      eol: hasCr ? '\r\n' : '\n',
    })
    start = index + 1
  }

  if (start < body.length) lines.push({ text: body.slice(start), eol: '' })

  return {
    bom,
    body,
    lines,
    eol: detectEol(lines),
  }
}

export function joinTextFile({ bom, lines }: { bom: boolean; lines: TextLine[] }): string {
  const body = lines.map((line) => line.text + line.eol).join('')
  return (bom ? '\uFEFF' : '') + body
}

export function detectEol(lines: TextLine[]): 'unknown' | 'mixed' | 'crlf' | 'lf' {
  let crlf = 0
  let lf = 0
  for (const line of lines) {
    if (line.eol === '\r\n') crlf += 1
    else if (line.eol === '\n') lf += 1
  }
  if (crlf === 0 && lf === 0) return 'unknown'
  if (crlf > 0 && lf > 0) return 'mixed'
  return crlf > 0 ? 'crlf' : 'lf'
}

export function dominantEol(lines: TextLine[]): string {
  let crlf = 0
  let lf = 0
  for (const line of lines) {
    if (line.eol === '\r\n') crlf += 1
    else if (line.eol === '\n') lf += 1
  }
  return crlf > lf ? '\r\n' : '\n'
}

/** 替换文本解析结果：规范化后的行与是否存在尾随换行。 */
export interface ReplacementText {
  lines: string[]
  trailingEol: boolean
}

export function parseReplacementText(value: string): ReplacementText {
  requireString(value, 'new_text')
  if (value === '') return { lines: [], trailingEol: false }

  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const trailingEol = normalized.endsWith('\n')
  const lines = normalized.split('\n')
  if (trailingEol) lines.pop()

  return { lines, trailingEol }
}

/** 行显示结果：可能被截断的文本与截断标志。 */
export interface TruncationResult {
  text: string
  truncated: boolean
}

export function truncateLine(text: string, maxLength: number = DEFAULT_MAX_LINE_LENGTH): TruncationResult {
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    fail('HASHLINE_INVALID_CONFIG', 'maxLineLength must be a positive integer')
  }
  if (text.length <= maxLength) return { text, truncated: false }
  return {
    text: `${text.slice(0, maxLength)}... [truncated, ${text.length} chars total]`,
    truncated: true,
  }
}

/** 行记录选项：哈希长度与最大显示行长度。 */
export interface LineRecordOptions {
  hashLength?: number
  maxLineLength?: number
}

/** 一行展示记录：行号、锚点、哈希与（可能截断的）文本。 */
export interface LineRecord {
  number: number
  hash: string
  anchor: string
  text: string
  truncated: boolean
}

export function lineRecord(lines: TextLine[], index: number, options: LineRecordOptions = {}): LineRecord {
  const hashLength = options.hashLength ?? DEFAULT_HASH_LENGTH
  const maxLineLength = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH
  const line = lines[index]
  const hash = hashLine(line, hashLength)
  const display = truncateLine(line.text, maxLineLength)
  return {
    number: index + 1,
    hash,
    anchor: `${index + 1}:${hash}`,
    text: display.text,
    truncated: display.truncated,
  }
}

/** 解析后的锚点：行号、规范化哈希与原始锚点字符串。 */
export interface ParsedAnchor {
  line: number
  hash: string
  anchor: string
}

export function parseAnchor(
  value: string,
  hashLength: number = DEFAULT_HASH_LENGTH,
  lines?: TextLine[],
  options: AnchorOptions = {},
): ParsedAnchor {
  const anchor = requireString(value, 'anchor')
  const expression = new RegExp(`^(\\d+)[:|]([0-9a-fA-F]{${hashLength}})$`)
  const match = expression.exec(anchor)
  if (match === null) {
    const details: HashlineErrorDetails = { anchor }
      let message = messageText(options.zhPrompt,
        `invalid anchor ${JSON.stringify(anchor)}: expected LINE:HASH with ${hashLength} hexadecimal characters`,
        `锚点 ${JSON.stringify(anchor)} 无效:应为 LINE:HASH 格式且哈希为 ${hashLength} 个十六进制字符`)
    // 当能拿到文件行且能解析出整数行号时，回显该行附近的真实锚点，
    // 让“哈希被截断/写错”能被自愈，而不是盲猜重试。
    if (lines !== undefined && lines.length > 0) {
      const lineMatch = /^(\d+)/.exec(anchor)
      const hintedLine = lineMatch === null ? NaN : Number(lineMatch[1])
      if (Number.isInteger(hintedLine) && hintedLine >= 1 && hintedLine <= lines.length) {
        details.hintedLine = hintedLine
        const records = contextRecords(lines, hintedLine, options)
        const body = records.map((record) => `${record.anchor}|${record.text}`).join('\n')
          message += messageText(options.zhPrompt,
            `\nNear line ${hintedLine}:\n${body}\nCopy the correct LINE:HASH anchor above and retry.`,
            `\n第 ${hintedLine} 行附近:\n${body}\n从上方复制正确的 LINE:HASH 锚点后重试。`)
      }
    }
    fail('HASHLINE_INVALID_ANCHOR', message, details)
  }
  return { line: Number(match[1]), hash: match[2].toLowerCase(), anchor }
}

/** 锚点校验的上下文选项。 */
export interface AnchorOptions extends LineRecordOptions {
  contextLines?: number
  /** 错误消息中的编辑工具名；替换模式下为 `edit`，默认 `hashline_edit`。 */
  toolName?: string
  /** 错误消息中的读取工具名；替换模式下为 `read`，默认 `hashline_read`。 */
    readToolName?: string
  /** 错误消息语言:开启后中文,默认英文(与提示词的 zhPrompt 同源)。 */
  zhPrompt?: boolean
}

function contextRecords(lines: TextLine[], lineNumber: number, options: AnchorOptions): LineRecord[] {
  const contextLines = options.contextLines ?? DEFAULT_CONTEXT_LINES
  const start = Math.max(1, lineNumber - contextLines)
  const end = Math.min(lines.length, lineNumber + contextLines)
  const records: LineRecord[] = []
  for (let line = start; line <= end; line += 1) {
    records.push(lineRecord(lines, line - 1, options))
  }
  return records
}

function mismatchMessage(
  label: string,
  parsed: ParsedAnchor,
  actual: string,
  context: LineRecord[],
  options: AnchorOptions = {},
): string {
  const toolName = options.toolName ?? 'hashline_edit'
  const readToolName = options.readToolName ?? 'hashline_read'
  const zh = options.zhPrompt === true
  const lines = [
    zh
      ? `${toolName}: ${label} 锚点 "${parsed.anchor}" 哈希不匹配;第 ${parsed.line} 行现在是 ${parsed.line}:${actual}`
      : `${toolName}: hash mismatch for ${label} anchor "${parsed.anchor}"; line ${parsed.line} is now ${parsed.line}:${actual}`,
    zh ? '文件在该锚点读取后已变化;未应用任何编辑。' : 'The file changed after this anchor was read; no edit was applied.',
  ]
  for (const record of context) {
    lines.push(`${record.number === parsed.line ? '>>> ' : '    '}${record.anchor}|${record.text}`)
  }
  lines.push(zh
    ? `从标记 >>> 的行复制更新后的锚点重试,或重新运行 ${readToolName}。`
    : `Copy the updated anchor from the line marked >>> and retry, or run ${readToolName} again.`)
  return lines.join('\n')
}

/** 锚点解析结果:目标行号与可选的重定位信息(锚点声明的行号与实际目标行不同时)。 */
export interface ResolvedAnchorLine {
  line: number
  /** 锚点声明的原始行号;内容唯一匹配重定位时与 line 不同。 */
  relocatedFrom?: number
}

export function resolveAnchorLine(
  lines: TextLine[],
  value: string,
  label: string,
  options: AnchorOptions = {},
): ResolvedAnchorLine {
  const hashLength = options.hashLength ?? DEFAULT_HASH_LENGTH
  const parsed = parseAnchor(value, hashLength, lines, options)
      if (parsed.line < 1 || parsed.line > lines.length) {
        const toolName = options.toolName ?? 'hashline_edit'
        const readToolName = options.readToolName ?? 'hashline_read'
        fail(
          'HASHLINE_ANCHOR_OUT_OF_RANGE',
          messageText(options.zhPrompt,
            `${toolName}: ${label} anchor "${parsed.anchor}" is outside this file (${lines.length} line(s)); run ${readToolName} again`,
            `${toolName}: ${label} 锚点 "${parsed.anchor}" 超出本文件范围(共 ${lines.length} 行);请重新运行 ${readToolName}`),
          { label, anchor: parsed.anchor, totalLines: lines.length },
        )
      }

    const actual = hashLine(lines[parsed.line - 1], hashLength)
    if (actual !== parsed.hash) {
      // 锚点漂移重定位：行号因先前编辑而漂移是常态。若全文件里
      // 恰有一行内容哈希与锚点哈希一致，则重定位到该行并记录 relocations
      // (输出层透明注明);0 个或 2 个以上候选仍按 stale-read 报错，避免误改。
      const candidates: number[] = []
      for (let index = 0; index < lines.length; index += 1) {
        if (hashLine(lines[index], hashLength) === parsed.hash) candidates.push(index + 1)
      }
      if (candidates.length === 1) {
        return { line: candidates[0], relocatedFrom: parsed.line }
      }
      const context = contextRecords(lines, parsed.line, options)
        const relocationHint =
          candidates.length > 1
            ? messageText(options.zhPrompt,
              `\nThe anchor hash also matches lines [${candidates.join(', ')}]; re-read the file to disambiguate before retrying.`,
              `\n该锚点哈希还匹配行 [${candidates.join(', ')}];重试前请重新读取文件消除歧义。`)
            : ''
      fail(
        'HASHLINE_HASH_MISMATCH',
        mismatchMessage(label, parsed, actual, context, options) + relocationHint,
        {
          label,
          anchor: parsed.anchor,
          line: parsed.line,
          expected: parsed.hash,
          actual,
          context,
          ...(candidates.length > 1 ? { ambiguousLines: candidates } : {}),
        },
      )
    }
    return { line: parsed.line }
}

/** 向后兼容包装:仅返回解析后的目标行号。 */
export function validateAnchor(
  lines: TextLine[],
  value: string,
  label: string,
  options: AnchorOptions = {},
): number {
  return resolveAnchorLine(lines, value, label, options).line
}

/** set_line 编辑变体。 */
export interface SetLineEdit {
  kind: 'set_line'
  order: number
  anchor: string
  newText: string
}

/** replace_lines 编辑变体。 */
export interface ReplaceLinesEdit {
  kind: 'replace_lines'
  order: number
  startAnchor: string
  endAnchor: string
  newText: string
}

/** insert_after 编辑变体。 */
export interface InsertAfterEdit {
  kind: 'insert_after'
  order: number
  anchor: string
  newText: string
}

/** replace（精确文本替换）已在 0.2.0 移除：字面替换属于内置 edit 的职责。 */

/** 解析阶段得到的编辑变体（不含解析后的行号）。 */
export type ParsedEdit = SetLineEdit | ReplaceLinesEdit | InsertAfterEdit

/** 锚定编辑：参与锚点解析与行号补全。 */
export type AnchorEdit = SetLineEdit | ReplaceLinesEdit | InsertAfterEdit

/** 编辑请求的输入形式：扁平 op 形状（0.3.0 起 schema 主形状）或嵌套变体键（历史形状，仍被接受）。 */
export type RawEdit =
  | { op: EditKind; anchor?: unknown; start_anchor?: unknown; end_anchor?: unknown; new_text: unknown }
  | { set_line: { anchor: unknown; new_text: unknown } }
  | { replace_lines: { start_anchor: unknown; end_anchor: unknown; new_text: unknown } }
  | { insert_after: { anchor: unknown; new_text: unknown } }

export function parseEditEntries(rawEdits: RawEdit[], zhPrompt?: boolean): ParsedEdit[] {
  if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
    fail('HASHLINE_INVALID_ARGUMENT', messageText(zhPrompt, 'edits must be a non-empty array', 'edits 必须是非空数组'))
  }

    return rawEdits.map((rawEntry, order) => {
      // RawEdit 是 union，方言回收需要按字段存在性路由，先统一为记录视图。
      const entry = rawEntry as unknown as Record<string, unknown>
      if (!isPlainObject(entry)) {
        fail('HASHLINE_INVALID_ARGUMENT', messageText(zhPrompt,
          `edits[${order}] must be an object with exactly one variant`,
          `edits[${order}] 必须是恰好包含一个变体的对象`))
      }
      const keys = Object.keys(entry)
      const variantKeys = keys.filter((key) => (EDIT_KINDS as readonly string[]).includes(key))
      if (variantKeys.length === 1 && !keys.includes('op')) {
        return parseNestedVariantEntry(entry, variantKeys[0] as EditKind, order, zhPrompt)
      }
      if (variantKeys.length === 0 && keys.includes('op')) {
        return parseFlatEditEntry(entry, order, zhPrompt)
      }
      // op 缺省的扁平项（忘传 op 的常见方言）：无变体键但携带锚点/新文本字段，
      // 交给 parseFlatEditEntry 做无歧义形状推断或给出指向性错误。
      if (variantKeys.length === 0 && !keys.includes('op') &&
        (entry.anchor !== undefined || entry.start_anchor !== undefined || entry.end_anchor !== undefined || entry.new_text !== undefined)) {
        return parseFlatEditEntry(entry, order, zhPrompt)
      }
      if (keys.includes('op') || entry.anchor !== undefined || entry.start_anchor !== undefined || entry.end_anchor !== undefined || entry.new_text !== undefined) {
        fail(
          'HASHLINE_INVALID_ARGUMENT',
          messageText(zhPrompt,
            `edits[${order}] mixes the flat "op"/anchor fields with variant key(s) [${variantKeys.join(', ')}]; use exactly one form per element`,
            `edits[${order}] 混用了扁平 "op"/锚点字段与变体键([${variantKeys.join(', ')}]);每个元素只能使用一种形式`),
        )
      }
      fail(
        'HASHLINE_INVALID_ARGUMENT',
        messageText(zhPrompt,
          `edits[${order}] must contain exactly one variant (${EDIT_KINDS.join(' | ')}); put each operation in its own edits array element`,
          `edits[${order}] 必须恰好包含一个变体(${EDIT_KINDS.join(' | ')});每个操作放入独立的 edits 数组元素`),
      )
    })
  }

/** 扁平形状允许的字段按 op 匹配（0.3.0 起 schema 主形状）。 */
const FLAT_EDIT_KEYS: Readonly<Record<EditKind, readonly string[]>> = {
  set_line: ['op', 'anchor', 'new_text'],
  replace_lines: ['op', 'start_anchor', 'end_anchor', 'new_text'],
  insert_after: ['op', 'anchor', 'new_text'],
}

/** 解析扁平形状：`{"op":"set_line","anchor":"42:f7a9","new_text":"..."}`。
 * op 缺省时按字段形状无歧义推断：`{anchor,new_text}` → set_line（观察到的失败
 * 样本里忘传 op 的意图几乎都是 set_line），`{start_anchor,end_anchor,new_text}` →
 * replace_lines（字段签名唯一）；带 op 但值无效仍响亮拒绝，缺字段不猜。 */
function parseFlatEditEntry(entry: Record<string, unknown>, order: number, zhPrompt?: boolean): ParsedEdit {
  const label = `edits[${order}]`
  const op = entry.op
  const hasStartEnd = entry.start_anchor !== undefined || entry.end_anchor !== undefined
  const hasAnchor = entry.anchor !== undefined
  if (op === undefined) {
    // 形状无歧义才推断：双锚点字段只属于 replace_lines；单 anchor 属于 set_line
    //（insert_after 与 set_line 字段签名相同，无法区分，默认 set_line）。推断后
    // 继续走统一校验，字段缺失仍按原错误路径响亮拒绝。
    if (hasStartEnd && !hasAnchor) return parseFlatEditEntry({ ...entry, op: 'replace_lines' }, order, zhPrompt)
    if (hasAnchor && !hasStartEnd) return parseFlatEditEntry({ ...entry, op: 'set_line' }, order, zhPrompt)
    if (hasStartEnd && hasAnchor) {
      fail('HASHLINE_INVALID_ARGUMENT', messageText(zhPrompt,
        `${label} is missing "op" and mixes anchor with start_anchor/end_anchor; use op="replace_lines" with start_anchor+end_anchor, or op="set_line"/"insert_after" with anchor`,
        `${label} 缺少 "op" 且混用了 anchor 与 start_anchor/end_anchor;replace_lines 用 start_anchor+end_anchor，set_line/insert_after 用 anchor`))
    }
    fail('HASHLINE_INVALID_ARGUMENT', messageText(zhPrompt,
      `${label} is missing "op"; use op="set_line"/"insert_after" with anchor+new_text, or op="replace_lines" with start_anchor+end_anchor+new_text`,
      `${label} 缺少 "op";set_line/insert_after 用 anchor+new_text，replace_lines 用 start_anchor+end_anchor+new_text`))
  }
    if (typeof op !== 'string' || !(EDIT_KINDS as readonly string[]).includes(op)) {
      fail('HASHLINE_INVALID_ARGUMENT', messageText(zhPrompt, `${label}.op must be one of ${EDIT_KINDS.join(' | ')}`, `${label}.op 必须是 ${EDIT_KINDS.join(' | ')} 之一`))
    }
    const kind = op as EditKind
  assertOnlyKeys(entry, FLAT_EDIT_KEYS[kind], label, zhPrompt)
  if (kind === 'set_line') {
    return {
      kind,
      order,
      anchor: requireString(entry.anchor, `${label}.anchor`, zhPrompt),
      newText: requireString(entry.new_text, `${label}.new_text`, zhPrompt),
    } satisfies SetLineEdit
  }
  if (kind === 'replace_lines') {
    return {
      kind,
      order,
      startAnchor: requireString(entry.start_anchor, `${label}.start_anchor`, zhPrompt),
      endAnchor: requireString(entry.end_anchor, `${label}.end_anchor`, zhPrompt),
      newText: requireString(entry.new_text, `${label}.new_text`, zhPrompt),
    } satisfies ReplaceLinesEdit
  }
  const insertText = requireString(entry.new_text, `${label}.new_text`, zhPrompt)
  if (insertText.length === 0) {
    fail('HASHLINE_INVALID_ARGUMENT', messageText(zhPrompt, `${label}.new_text must not be empty`, `${label}.new_text 不能为空`))
  }
  return {
    kind,
    order,
    anchor: requireString(entry.anchor, `${label}.anchor`, zhPrompt),
    newText: insertText,
  } satisfies InsertAfterEdit
}

/** 解析嵌套变体形状（历史/回放形状）：`{"set_line":{"anchor":"...","new_text":"..."}}`。 */
function parseNestedVariantEntry(entry: Record<string, unknown>, kind: EditKind, order: number, zhPrompt?: boolean): ParsedEdit {
  assertOnlyKeys(entry, [kind], `edits[${order}]`, zhPrompt)
  const value = entry[kind]
  if (!isPlainObject(value)) {
    fail('HASHLINE_INVALID_ARGUMENT', messageText(zhPrompt, `edits[${order}].${kind} must be an object`, `edits[${order}].${kind} 必须是对象`))
  }

  if (kind === 'set_line') {
    assertOnlyKeys(value, ['anchor', 'new_text'], `edits[${order}].set_line`, zhPrompt)
    return {
      kind,
      order,
      anchor: requireString(value.anchor, `edits[${order}].set_line.anchor`, zhPrompt),
      newText: requireString(value.new_text, `edits[${order}].set_line.new_text`, zhPrompt),
    } satisfies SetLineEdit
  }

  if (kind === 'replace_lines') {
    assertOnlyKeys(value, ['start_anchor', 'end_anchor', 'new_text'], `edits[${order}].replace_lines`, zhPrompt)
    return {
      kind,
      order,
      startAnchor: requireString(value.start_anchor, `edits[${order}].replace_lines.start_anchor`, zhPrompt),
      endAnchor: requireString(value.end_anchor, `edits[${order}].replace_lines.end_anchor`, zhPrompt),
      newText: requireString(value.new_text, `edits[${order}].replace_lines.new_text`, zhPrompt),
    } satisfies ReplaceLinesEdit
  }

  if (kind === 'insert_after') {
    assertOnlyKeys(value, ['anchor', 'new_text'], `edits[${order}].insert_after`, zhPrompt)
    const newText = requireString(value.new_text, `edits[${order}].insert_after.new_text`, zhPrompt)
    if (newText.length === 0) {
      fail('HASHLINE_INVALID_ARGUMENT', messageText(zhPrompt, `edits[${order}].insert_after.new_text must not be empty`, `edits[${order}].insert_after.new_text 不能为空`))
    }
    return {
      kind,
      order,
      anchor: requireString(value.anchor, `edits[${order}].insert_after.anchor`, zhPrompt),
      newText,
    } satisfies InsertAfterEdit
  }

  // EDIT_KINDS 检查已把 kind 限定为上述三种；replace 变体已在 0.2.0 移除。
  return fail('HASHLINE_INVALID_ARGUMENT', `edits[${order}].replace is not accepted; use the built-in edit for literal replacement`)
}

/**
 * 已解析出目标行号的锚定编辑（`set_line` / `replace_lines` / `insert_after`），
 * `resolveAnchoredEdits` 阶段在原对象上补充 `start` / `end` / `boundary`。
 */
export type AnchoredEdit = ResolvedSetLineEdit | ResolvedReplaceLinesEdit | ResolvedInsertAfterEdit

export interface ResolvedSetLineEdit extends SetLineEdit {
  start: number
  end: number
}

export interface ResolvedReplaceLinesEdit extends ReplaceLinesEdit {
  start: number
  end: number
}

export interface ResolvedInsertAfterEdit extends InsertAfterEdit {
  boundary: number
}

/** 范围编辑（拥有 start/end 的锚定编辑）：set_line 与 replace_lines。 */
export type RangeEdit = ResolvedSetLineEdit | ResolvedReplaceLinesEdit

function describeEdit(edit: AnchoredEdit): string {
  return edit.kind === 'insert_after'
    ? `insert_after @${edit.boundary}`
    : `${edit.kind} ${edit.start}..${edit.end}`
}

export function assertNoOverlaps(edits: AnchoredEdit[], toolName: string = 'hashline_edit', zhPrompt?: boolean): void {
  for (let left = 0; left < edits.length; left += 1) {
    for (let right = left + 1; right < edits.length; right += 1) {
      const first = edits[left]
      const second = edits[right]
      if (first.kind === 'insert_after' && second.kind === 'insert_after') continue

      // 此处已排除“两者均为 insert_after”，故当一方是 insert_after 时另一方必为范围编辑。
      const overlaps = first.kind === 'insert_after'
        ? (second as RangeEdit).start <= first.boundary && first.boundary <= (second as RangeEdit).end
        : second.kind === 'insert_after'
          ? first.start <= second.boundary && second.boundary <= first.end
          : first.start <= second.end && second.start <= first.end

        if (overlaps) {
          fail(
            'HASHLINE_OVERLAPPING_EDIT',
            messageText(zhPrompt,
              `${toolName}: overlapping edits (${describeEdit(first)} vs ${describeEdit(second)}); no edit was applied`,
              `${toolName}: 编辑范围重叠(${describeEdit(first)} 与 ${describeEdit(second)});未应用任何编辑`),
            { first: describeEdit(first), second: describeEdit(second) },
          )
        }
    }
  }
}

/** 一次锚定编辑的增删行统计。 */
interface EditStats {
  removedLines: number
  addedLines: number
}

function materializeBlock(block: ReplacementText, internalEol: string, finalEol: string): TextLine[] {
  return block.lines.map((text, index) => ({
    text,
    eol: index === block.lines.length - 1 ? finalEol : internalEol,
  }))
}

function applyAnchoredEdit(lines: TextLine[], edit: AnchoredEdit, eol: string): EditStats {
  if (edit.kind === 'set_line') {
    const index = edit.start - 1
    const originalEol = lines[index].eol
    const block = parseReplacementText(edit.newText)
    if (block.lines.length === 0) {
      lines.splice(index, 1)
      return { removedLines: 1, addedLines: 0 }
    }
    const finalEol = block.trailingEol ? eol : originalEol
    lines.splice(index, 1, ...materializeBlock(block, eol, finalEol))
    return { removedLines: 1, addedLines: block.lines.length }
  }

  if (edit.kind === 'replace_lines') {
    const index = edit.start - 1
    const count = edit.end - edit.start + 1
    const originalEol = lines[index + count - 1].eol
    const block = parseReplacementText(edit.newText)
    if (block.lines.length === 0) {
      lines.splice(index, count)
      return { removedLines: count, addedLines: 0 }
    }
    const finalEol = block.trailingEol ? eol : originalEol
    lines.splice(index, count, ...materializeBlock(block, eol, finalEol))
    return { removedLines: count, addedLines: block.lines.length }
  }

  const index = edit.boundary - 1
  const originalEol = lines[index].eol
  const isLastLine = index === lines.length - 1
  const block = parseReplacementText(edit.newText)
  if (lines[index].eol === '') lines[index].eol = eol

  const finalEol = isLastLine
    ? (block.trailingEol ? eol : originalEol)
    : (originalEol || eol)
  lines.splice(index + 1, 0, ...materializeBlock(block, eol, finalEol))
  return { removedLines: 0, addedLines: block.lines.length }
}

/** 锚点漂移重定位记录:锚点声明的行号(from)与内容唯一匹配到的目标行号(to)。 */
export interface AnchorRelocation {
  from: number
  to: number
}

function resolveAnchoredEdits(
  lines: TextLine[],
  edits: AnchorEdit[],
  options: AnchorOptions,
): { edits: AnchoredEdit[]; relocations: AnchorRelocation[] } {
  const resolved: AnchoredEdit[] = []
  const relocations: AnchorRelocation[] = []
  const track = (anchor: ResolvedAnchorLine): number => {
    if (anchor.relocatedFrom !== undefined) {
      relocations.push({ from: anchor.relocatedFrom, to: anchor.line })
    }
    return anchor.line
  }
  // 阶段一:解析全部锚点并收集失败,而非首个即抛。
  // 1 个失败:原样重抛——消息回显附近行与 >>> 新锚点,调用方可一轮自愈(单点笔误场景)。
  // ≥2 个失败:调用方手中的读取快照已整体过期,逐锚点修补只会制造 N 轮失败往返;
  // 报稳定错误码并直接要求重新读取,不逐段回显上下文。原子性不变:任一失败整批零写入。
  const failures: Array<{ label: string; anchor: string; error: HashlineError }> = []
  let totalAnchors = 0
  const attempt = (value: string, label: string): number | undefined => {
    totalAnchors += 1
    try {
      return track(resolveAnchorLine(lines, value, label, options))
    } catch (error) {
      if (error instanceof HashlineError) {
        failures.push({ label, anchor: value, error })
        return undefined
      }
      throw error
    }
  }
  for (let index = 0; index < edits.length; index += 1) {
    const edit = edits[index]
    if (edit.kind === 'set_line') {
      const start = attempt(edit.anchor, `edits[${index}].set_line`)
      if (start !== undefined) resolved.push({ ...edit, start, end: start })
      continue
    }
    if (edit.kind === 'replace_lines') {
      const start = attempt(edit.startAnchor, `edits[${index}].replace_lines.start`)
      const end = attempt(edit.endAnchor, `edits[${index}].replace_lines.end`)
      if (start !== undefined && end !== undefined) resolved.push({ ...edit, start, end })
      continue
    }
    const boundary = attempt(edit.anchor, `edits[${index}].insert_after`)
    if (boundary !== undefined) resolved.push({ ...edit, boundary })
  }
  if (failures.length >= 2) {
    const toolName = options.toolName ?? 'hashline_edit'
    const readToolName = options.readToolName ?? 'hashline_read'
    const zh = options.zhPrompt === true
    // 每个失败锚点回显其声明行号处的当前内容(上下各 1 行,>>> 标记当前锚点),
    // 调用方一轮自愈,无需为拿新锚点而重新读取;行号超界时 clamp 到文件首/末行。
    const sections: string[] = []
    const failureDetails = failures.map((f) => {
      const declared = Number.parseInt(f.anchor, 10)
      const rawLine = (f.error.details as { line?: unknown } | undefined)?.line
      const source = typeof rawLine === 'number' ? rawLine : declared
      const line = Math.min(Math.max(Number.isInteger(source) ? source : 1, 1), lines.length)
      const context = contextRecords(lines, line, { ...options, contextLines: 1 })
      const head = zh
        ? `${f.label} 锚点 "${f.anchor}"(第 ${line} 行):`
        : `${f.label} anchor "${f.anchor}" (line ${line}):`
      const body = context
        .map((record) => `${record.number === line ? '>>> ' : '    '}${record.anchor}|${record.text}`)
        .join('\n')
      sections.push(`${head}\n${body}`)
      return {
        label: f.label,
        anchor: f.anchor,
        code: f.error.code,
        line,
        context: context.map(({ number, hash, text, truncated }) => ({ number, hash, text, truncated })),
      }
    })
    fail(
      'HASHLINE_MULTIPLE_ANCHOR_ERRORS',
      messageText(options.zhPrompt,
        `${toolName}: ${failures.length} of ${totalAnchors} anchors failed validation; no edit was applied. Current content at each failed location:\n${sections.join('\n')}\nRetry with the fresh anchors marked >>> above, or run ${readToolName} again for the full file.`,
        `${toolName}: ${totalAnchors} 个锚点中有 ${failures.length} 个校验失败;未应用任何编辑。各失败位置的当前内容:\n${sections.join('\n')}\n用上方标记 >>> 的新锚点重试;需要完整文件时重新运行 ${readToolName}。`),
      { totalAnchors, failedAnchors: failures.length, failures: failureDetails },
    )
  }
  if (failures.length === 1) throw failures[0].error
  // 阶段二:全部锚点有效,做范围与重叠校验(此时首错即抛:罕见且无自愈路径)。
  for (const edit of resolved) {
    if (edit.kind === 'replace_lines' && edit.end < edit.start) {
      fail(
        'HASHLINE_INVALID_RANGE',
        messageText(options.zhPrompt,
          `${options.toolName ?? 'hashline_edit'}: replace_lines end anchor (${edit.endAnchor}) precedes start anchor (${edit.startAnchor})`,
          `${options.toolName ?? 'hashline_edit'}: replace_lines 的 end 锚点(${edit.endAnchor})早于 start 锚点(${edit.startAnchor})`),
      )
    }
  }
  assertNoOverlaps(resolved, options.toolName, options.zhPrompt)
  return { edits: resolved, relocations }
}

/** 一次编辑计划的结果。 */
export interface EditPlan {
  after: string
  changed: boolean
  editsApplied: number
  removedLines: number
  addedLines: number
  firstChangedLine: number | null
  /** 锚点漂移重定位记录(锚点声明行号与实际目标行不同时);无重定位则缺省。 */
  relocations?: ReadonlyArray<AnchorRelocation>
}

/** 编辑计划的选项。 */
export interface EditOptions extends AnchorOptions {}

export function planEdits(content: string, rawEdits: RawEdit[], options: EditOptions = {}): EditPlan {
  const parsed = parseEditEntries(rawEdits, options.zhPrompt)
  const anchored: AnchorEdit[] = parsed
  const file = splitTextFile(content)

  const { edits: resolved, relocations } = resolveAnchoredEdits(file.lines, anchored, options)
  const sorted = [...resolved].sort((left, right) => {
    const leftLine = left.kind === 'insert_after' ? left.boundary : left.start
    const rightLine = right.kind === 'insert_after' ? right.boundary : right.start
    if (leftLine !== rightLine) return rightLine - leftLine
    return right.order - left.order
  })

  const lines = file.lines.map((line) => ({ ...line }))
  const eol = dominantEol(lines)
  let removedLines = 0
  let addedLines = 0
  let changedLine = Number.POSITIVE_INFINITY

  for (const edit of sorted) {
    const line = edit.kind === 'insert_after' ? edit.boundary + 1 : edit.start
    changedLine = Math.min(changedLine, line)
    const stats = applyAnchoredEdit(lines, edit, eol)
    removedLines += stats.removedLines
    addedLines += stats.addedLines
  }

  const after = joinTextFile({ bom: file.bom, lines })
  return {
    after,
    changed: after !== content,
    editsApplied: parsed.length,
    removedLines,
    addedLines,
      firstChangedLine: Number.isFinite(changedLine) ? changedLine : null,
      ...(relocations.length > 0 ? { relocations } : {}),
    }
  }

export function previewContent(content: string, firstLine: number | null, options: EditOptions = {}): LineRecord[] {
  const file = splitTextFile(content)
  if (file.lines.length === 0) return []
  const contextLines = options.contextLines ?? DEFAULT_CONTEXT_LINES
  const center = firstLine === null ? 1 : Math.min(Math.max(firstLine, 1), file.lines.length)
  const start = Math.max(1, center - contextLines)
  const end = Math.min(file.lines.length, center + contextLines)
  const result: LineRecord[] = []
  for (let line = start; line <= end; line += 1) {
    result.push(lineRecord(file.lines, line - 1, options))
  }
  return result
}
