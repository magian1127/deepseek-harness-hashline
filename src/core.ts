import { createHash } from 'node:crypto'
import { loadDshLlm } from './profile-modules.js'

type HarnessErrorConstructor = new (message: string, code: string, options?: ErrorOptions) => Error

// 优先从 profile 解析 DSH 的 HarnessError（与主进程同一实例，保留错误身份
// 与结构化 { name, code } 序列化）；profile 不可用时降级为普通 Error。
const HarnessErrorBase: HarnessErrorConstructor =
  (loadDshLlm() as { HarnessError?: HarnessErrorConstructor } | null)?.HarnessError ??
  (Error as unknown as HarnessErrorConstructor)


export const DEFAULT_HASH_LENGTH = 4
export const DEFAULT_MAX_LINE_LENGTH = 500
export const DEFAULT_READ_LIMIT = 2000
export const DEFAULT_CONTEXT_LINES = 2

/** 锚定/精确替换编辑的四种变体名称。 */
export type EditKind = 'set_line' | 'replace_lines' | 'insert_after' | 'replace'

const EDIT_KINDS: readonly EditKind[] = ['set_line', 'replace_lines', 'insert_after', 'replace']

/** Hashline 编辑错误码（稳定、可机器路由）。 */
export type HashlineErrorCode =
  | 'HASHLINE_INVALID_ARGUMENT'
  | 'HASHLINE_INVALID_CONFIG'
  | 'HASHLINE_INVALID_ANCHOR'
  | 'HASHLINE_ANCHOR_OUT_OF_RANGE'
  | 'HASHLINE_HASH_MISMATCH'
  | 'HASHLINE_INVALID_RANGE'
  | 'HASHLINE_OVERLAPPING_EDIT'
  | 'HASHLINE_TEXT_NOT_FOUND'
  | 'HASHLINE_TEXT_NOT_UNIQUE'
  | 'HASHLINE_MIXED_EDIT_MODES'

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

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') fail('HASHLINE_INVALID_ARGUMENT', `${label} must be a string`)
  return value
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail('HASHLINE_INVALID_ARGUMENT', `${label} must be a boolean`)
  return value
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key))
  if (extras.length > 0) {
    fail('HASHLINE_INVALID_ARGUMENT', `${label} contains unsupported field(s): ${extras.join(', ')}`)
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
  const expression = new RegExp(`^(\\d+):([0-9a-fA-F]{${hashLength}})$`)
  const match = expression.exec(anchor)
  if (match === null) {
    const details: HashlineErrorDetails = { anchor }
    let message = `invalid anchor ${JSON.stringify(anchor)}: expected LINE:HASH with ${hashLength} hexadecimal characters`
    // 当能拿到文件行且能解析出整数行号时，回显该行附近的真实锚点，
    // 让“哈希被截断/写错”能被自愈，而不是盲猜重试。
    if (lines !== undefined && lines.length > 0) {
      const lineMatch = /^(\d+)/.exec(anchor)
      const hintedLine = lineMatch === null ? NaN : Number(lineMatch[1])
      if (Number.isInteger(hintedLine) && hintedLine >= 1 && hintedLine <= lines.length) {
        details.hintedLine = hintedLine
        const records = contextRecords(lines, hintedLine, options)
        const body = records.map((record) => `${record.anchor}|${record.text}`).join('\n')
        message += `\nNear line ${hintedLine}:\n${body}\nCopy the correct LINE:HASH anchor above and retry.`
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
  const lines = [
    `${toolName}: hash mismatch for ${label} anchor "${parsed.anchor}"; line ${parsed.line} is now ${parsed.line}:${actual}`,
    'The file changed after this anchor was read; no edit was applied.',
  ]
  for (const record of context) {
    lines.push(`${record.number === parsed.line ? '>>> ' : '    '}${record.anchor}|${record.text}`)
  }
  lines.push(`Copy the updated anchor from the line marked >>> and retry, or run ${readToolName} again.`)
  return lines.join('\n')
}

export function validateAnchor(
  lines: TextLine[],
  value: string,
  label: string,
  options: AnchorOptions = {},
): number {
  const hashLength = options.hashLength ?? DEFAULT_HASH_LENGTH
  const parsed = parseAnchor(value, hashLength, lines, options)
  if (parsed.line < 1 || parsed.line > lines.length) {
    fail(
      'HASHLINE_ANCHOR_OUT_OF_RANGE',
      `${options.toolName ?? 'hashline_edit'}: ${label} anchor "${parsed.anchor}" is outside this file (${lines.length} line(s)); run ${options.readToolName ?? 'hashline_read'} again`,
      { label, anchor: parsed.anchor, totalLines: lines.length },
    )
  }

  const actual = hashLine(lines[parsed.line - 1], hashLength)
  if (actual !== parsed.hash) {
    // 锚点漂移重定位：行号因先前编辑而漂移是常态。若全文件里
    // 恰有一行内容哈希与锚点哈希一致，则静默重定位到该行；
    // 0 个或 2 个以上候选仍按 stale-read 报错，避免误改。
    const candidates: number[] = []
    for (let index = 0; index < lines.length; index += 1) {
      if (hashLine(lines[index], hashLength) === parsed.hash) candidates.push(index + 1)
    }
    if (candidates.length === 1) {
      return candidates[0]
    }
    const context = contextRecords(lines, parsed.line, options)
    const relocationHint =
      candidates.length > 1
        ? `\nThe anchor hash also matches lines [${candidates.join(', ')}]; re-read the file to disambiguate before retrying.`
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
  return parsed.line
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

/** replace（精确文本替换）编辑变体。 */
export interface ReplaceEdit {
  kind: 'replace'
  order: number
  oldText: string
  newText: string
  all: boolean
}

/** 解析阶段得到的编辑变体（不含解析后的行号）。 */
export type ParsedEdit = SetLineEdit | ReplaceLinesEdit | InsertAfterEdit | ReplaceEdit

/** 锚定编辑（不含 replace 逃生舱）：参与锚点解析与行号补全。 */
export type AnchorEdit = SetLineEdit | ReplaceLinesEdit | InsertAfterEdit

/** 编辑请求的输入形式：恰好一个变体键。 */
export type RawEdit =
  | { set_line: { anchor: unknown; new_text: unknown } }
  | { replace_lines: { start_anchor: unknown; end_anchor: unknown; new_text: unknown } }
  | { insert_after: { anchor: unknown; new_text: unknown } }
  | { replace: { old_text: unknown; new_text: unknown; all?: unknown } }

export function parseEditEntries(rawEdits: RawEdit[]): ParsedEdit[] {
  if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
    fail('HASHLINE_INVALID_ARGUMENT', 'edits must be a non-empty array')
  }

  return rawEdits.map((entry, order) => {
    if (!isPlainObject(entry)) {
      fail('HASHLINE_INVALID_ARGUMENT', `edits[${order}] must be an object with exactly one variant`)
    }
    const keys = Object.keys(entry)
    if (keys.length !== 1 || !EDIT_KINDS.includes(keys[0] as EditKind)) {
      fail(
        'HASHLINE_INVALID_ARGUMENT',
        `edits[${order}] must contain exactly one variant (${EDIT_KINDS.join(' | ')}); put each operation in its own edits array element`,
      )
    }

    const kind = keys[0] as EditKind
    const record = entry as Record<string, unknown>
    const value = record[kind]
    if (!isPlainObject(value)) {
      fail('HASHLINE_INVALID_ARGUMENT', `edits[${order}].${kind} must be an object`)
    }

    if (kind === 'set_line') {
      assertOnlyKeys(value, ['anchor', 'new_text'], `edits[${order}].set_line`)
      return {
        kind,
        order,
        anchor: requireString(value.anchor, `edits[${order}].set_line.anchor`),
        newText: requireString(value.new_text, `edits[${order}].set_line.new_text`),
      } satisfies SetLineEdit
    }

    if (kind === 'replace_lines') {
      assertOnlyKeys(value, ['start_anchor', 'end_anchor', 'new_text'], `edits[${order}].replace_lines`)
      return {
        kind,
        order,
        startAnchor: requireString(value.start_anchor, `edits[${order}].replace_lines.start_anchor`),
        endAnchor: requireString(value.end_anchor, `edits[${order}].replace_lines.end_anchor`),
        newText: requireString(value.new_text, `edits[${order}].replace_lines.new_text`),
      } satisfies ReplaceLinesEdit
    }

    if (kind === 'insert_after') {
      assertOnlyKeys(value, ['anchor', 'new_text'], `edits[${order}].insert_after`)
      const newText = requireString(value.new_text, `edits[${order}].insert_after.new_text`)
      if (newText.length === 0) {
        fail('HASHLINE_INVALID_ARGUMENT', `edits[${order}].insert_after.new_text must not be empty`)
      }
      return {
        kind,
        order,
        anchor: requireString(value.anchor, `edits[${order}].insert_after.anchor`),
        newText,
      } satisfies InsertAfterEdit
    }

    assertOnlyKeys(value, ['old_text', 'new_text', 'all'], `edits[${order}].replace`)
    const oldText = requireString(value.old_text, `edits[${order}].replace.old_text`)
    const newText = requireString(value.new_text, `edits[${order}].replace.new_text`)
    if (oldText.length === 0) {
      fail('HASHLINE_INVALID_ARGUMENT', `edits[${order}].replace.old_text must not be empty`)
    }
    if (oldText === newText) {
      fail('HASHLINE_INVALID_ARGUMENT', `edits[${order}].replace old_text and new_text must differ`)
    }
    return {
      kind,
      order,
      oldText,
      newText,
      all: value.all === undefined ? false : requireBoolean(value.all, `edits[${order}].replace.all`),
    } satisfies ReplaceEdit
  })
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

export function assertNoOverlaps(edits: AnchoredEdit[], toolName: string = 'hashline_edit'): void {
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
          `${toolName}: overlapping edits (${describeEdit(first)} vs ${describeEdit(second)}); no edit was applied`,
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

function resolveAnchoredEdits(lines: TextLine[], edits: AnchorEdit[], options: AnchorOptions): AnchoredEdit[] {
  const resolved: AnchoredEdit[] = []
  for (const edit of edits) {
    if (edit.kind === 'set_line') {
      const start = validateAnchor(lines, edit.anchor, 'set_line', options)
      resolved.push({ ...edit, start, end: start })
      continue
    }
    if (edit.kind === 'replace_lines') {
      const start = validateAnchor(lines, edit.startAnchor, 'replace_lines.start', options)
      const end = validateAnchor(lines, edit.endAnchor, 'replace_lines.end', options)
      if (end < start) {
        fail(
          'HASHLINE_INVALID_RANGE',
          `${options.toolName ?? 'hashline_edit'}: replace_lines end anchor (${edit.endAnchor}) precedes start anchor (${edit.startAnchor})`,
        )
      }
      resolved.push({ ...edit, start, end })
      continue
    }
    const boundary = validateAnchor(lines, edit.anchor, 'insert_after', options)
    resolved.push({ ...edit, boundary })
  }
  assertNoOverlaps(resolved, options.toolName)
  return resolved
}

/** 精确替换应用的统计结果。 */
interface ReplaceResult {
  body: string
  replacements: number
}

/** 归一化：把 CRLF 与孤立 CR 统一为 LF，用于 replace 的受控匹配。 */
function normalizeEolForMatch(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

interface NormalizedMatchView {
  text: string
  /** `boundaries[i]` 是归一化文本位置 i 对应的原文 UTF-16 边界。 */
  boundaries: number[]
}

/**
 * 构造仅供匹配使用的 LF 视图，同时保留每个归一化边界到原文边界的映射。
 * 这样 old_text 可跨 CRLF/LF 匹配，但写回只拼接匹配区间之外的原文切片，
 * 不会把 mixed EOL 文件中未触及的行尾整体重写。
 */
function normalizedMatchView(text: string): NormalizedMatchView {
  let normalized = ''
  const boundaries = [0]
  for (let index = 0; index < text.length;) {
    if (text[index] === '\r' && text[index + 1] === '\n') {
      normalized += '\n'
      index += 2
    } else {
      normalized += text[index]
      index += 1
    }
    boundaries.push(index)
  }
  return { text: normalized, boundaries }
}

function matchStarts(haystack: string, needle: string): number[] {
  const starts: number[] = []
  for (let cursor = 0;;) {
    const found = haystack.indexOf(needle, cursor)
    if (found === -1) return starts
    starts.push(found)
    cursor = found + needle.length
  }
}

function replacementEol(originalSlice: string, body: string, originalStart: number, originalEnd: number): string {
  if (originalSlice.includes('\r\n')) return '\r\n'
  if (originalSlice.includes('\n')) return '\n'
  const adjacent = body.slice(Math.max(0, originalStart - 2), Math.min(body.length, originalEnd + 2))
  if (adjacent.includes('\r\n')) return '\r\n'
  if (adjacent.includes('\n')) return '\n'
  return dominantEol(splitTextFile(body).lines)
}

function applyOneExactReplace(body: string, edit: ReplaceEdit, toolName: string): ReplaceResult {
  const view = normalizedMatchView(body)
  const oldText = normalizeEolForMatch(edit.oldText)
  const newText = normalizeEolForMatch(edit.newText)
  const starts = matchStarts(view.text, oldText)
  const matches = starts.length
  if (matches === 0) {
    fail(
      'HASHLINE_TEXT_NOT_FOUND',
      `${toolName}: replace text not found: ${JSON.stringify(edit.oldText.slice(0, 120))}`,
    )
  }
  if (!edit.all && matches !== 1) {
    fail(
      'HASHLINE_TEXT_NOT_UNIQUE',
      `${toolName}: replace old_text matches multiple times; set all: true or make old_text more specific`,
      { matches },
    )
  }

  const selected = edit.all ? starts : starts.slice(0, 1)
  const parts: string[] = []
  let originalCursor = 0
  for (const start of selected) {
    const originalStart = view.boundaries[start]
    const originalEnd = view.boundaries[start + oldText.length]
    const originalSlice = body.slice(originalStart, originalEnd)
    parts.push(body.slice(originalCursor, originalStart))
    parts.push(newText.replace(/\n/g, replacementEol(originalSlice, body, originalStart, originalEnd)))
    originalCursor = originalEnd
  }
  parts.push(body.slice(originalCursor))
  return { body: parts.join(''), replacements: selected.length }
}

function applyExactReplaces(body: string, edits: ReplaceEdit[], toolName: string = 'hashline_edit'): ReplaceResult {
  let current = body
  let replacements = 0
  for (const edit of edits) {
    const result = applyOneExactReplace(current, edit, toolName)
    current = result.body
    replacements += result.replacements
  }
  return { body: current, replacements }
}
export function firstChangedLine(before: string, after: string): number | null {
  if (before === after) return null
  const limit = Math.min(before.length, after.length)
  let index = 0
  while (index < limit && before.charCodeAt(index) === after.charCodeAt(index)) index += 1
  let line = 1
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (before.charCodeAt(cursor) === 10) line += 1
  }
  return line
}

/** 一次编辑计划的结果。 */
export interface EditPlan {
  after: string
  changed: boolean
  editsApplied: number
  replacements: number
  removedLines: number
  addedLines: number
  firstChangedLine: number | null
}

/** 编辑计划的选项。 */
export interface EditOptions extends AnchorOptions {}

export function planEdits(content: string, rawEdits: RawEdit[], options: EditOptions = {}): EditPlan {
  const parsed = parseEditEntries(rawEdits)
  const anchored = parsed.filter(
    (edit): edit is AnchorEdit => edit.kind !== 'replace',
  )
  const replacements = parsed.filter((edit): edit is ReplaceEdit => edit.kind === 'replace')
  if (anchored.length > 0 && replacements.length > 0) {
    fail(
      'HASHLINE_MIXED_EDIT_MODES',
      `${options.toolName ?? 'hashline_edit'}: anchor-verified edits and replace cannot be mixed in one call; split them into separate calls`,
    )
  }

  const file = splitTextFile(content)
  if (replacements.length > 0) {
    const result = applyExactReplaces(file.body, replacements, options.toolName)
    const after = (file.bom ? '\uFEFF' : '') + result.body
    return {
      after,
      changed: after !== content,
      editsApplied: parsed.length,
      replacements: result.replacements,
      removedLines: 0,
      addedLines: 0,
      firstChangedLine: firstChangedLine(file.body, result.body),
    }
  }

  const resolved = resolveAnchoredEdits(file.lines, anchored, options)
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
    replacements: 0,
    removedLines,
    addedLines,
    firstChangedLine: Number.isFinite(changedLine) ? changedLine : null,
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
