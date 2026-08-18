import { createHash } from 'node:crypto'
import { HarnessError } from '@deepseek-ai/dsh-llm'

export const DEFAULT_HASH_LENGTH = 4
export const DEFAULT_MAX_LINE_LENGTH = 500
export const DEFAULT_READ_LIMIT = 2000
export const DEFAULT_CONTEXT_LINES = 2

const EDIT_KINDS = ['set_line', 'replace_lines', 'insert_after', 'replace']

export class HashlineError extends HarnessError {
  constructor(code, message, details = undefined, options = undefined) {
    super(message, code, options)
    if (details !== undefined) this.details = details
  }
}

function fail(code, message, details = undefined, options = undefined) {
  throw new HashlineError(code, message, details, options)
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value, label) {
  if (typeof value !== 'string') fail('HASHLINE_INVALID_ARGUMENT', `${label} must be a string`)
  return value
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') fail('HASHLINE_INVALID_ARGUMENT', `${label} must be a boolean`)
  return value
}

function assertOnlyKeys(value, allowed, label) {
  const extras = Object.keys(value).filter(key => !allowed.includes(key))
  if (extras.length > 0) {
    fail('HASHLINE_INVALID_ARGUMENT', `${label} contains unsupported field(s): ${extras.join(', ')}`)
  }
}

export function hashText(value, length = DEFAULT_HASH_LENGTH) {
  if (!Number.isInteger(length) || length < 3 || length > 16) {
    fail('HASHLINE_INVALID_CONFIG', 'hashLength must be an integer between 3 and 16')
  }
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, length)
}

export function hashLine(line, length = DEFAULT_HASH_LENGTH) {
  return hashText(line.text + line.eol, length)
}

export function splitTextFile(content) {
  requireString(content, 'content')
  const bom = content.startsWith('\uFEFF')
  const body = bom ? content.slice(1) : content
  const lines = []
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

export function joinTextFile({ bom, lines }) {
  const body = lines.map(line => line.text + line.eol).join('')
  return (bom ? '\uFEFF' : '') + body
}

export function detectEol(lines) {
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

export function dominantEol(lines) {
  let crlf = 0
  let lf = 0
  for (const line of lines) {
    if (line.eol === '\r\n') crlf += 1
    else if (line.eol === '\n') lf += 1
  }
  return crlf > lf ? '\r\n' : '\n'
}

export function parseReplacementText(value) {
  requireString(value, 'new_text')
  if (value === '') return { lines: [], trailingEol: false }

  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const trailingEol = normalized.endsWith('\n')
  const lines = normalized.split('\n')
  if (trailingEol) lines.pop()

  return { lines, trailingEol }
}

export function truncateLine(text, maxLength = DEFAULT_MAX_LINE_LENGTH) {
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    fail('HASHLINE_INVALID_CONFIG', 'maxLineLength must be a positive integer')
  }
  if (text.length <= maxLength) return { text, truncated: false }
  return {
    text: `${text.slice(0, maxLength)}... [truncated, ${text.length} chars total]`,
    truncated: true,
  }
}

export function lineRecord(lines, index, options = {}) {
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

export function parseAnchor(value, hashLength = DEFAULT_HASH_LENGTH) {
  const anchor = requireString(value, 'anchor')
  const expression = new RegExp(`^(\\d+):([0-9a-fA-F]{${hashLength}})$`)
  const match = expression.exec(anchor)
  if (match === null) {
    fail(
      'HASHLINE_INVALID_ANCHOR',
      `invalid anchor ${JSON.stringify(anchor)}: expected LINE:HASH with ${hashLength} hexadecimal characters`,
      { anchor },
    )
  }
  return { line: Number(match[1]), hash: match[2].toLowerCase(), anchor }
}

function contextRecords(lines, lineNumber, options) {
  const contextLines = options.contextLines ?? DEFAULT_CONTEXT_LINES
  const start = Math.max(1, lineNumber - contextLines)
  const end = Math.min(lines.length, lineNumber + contextLines)
  const records = []
  for (let line = start; line <= end; line += 1) {
    records.push(lineRecord(lines, line - 1, options))
  }
  return records
}

function mismatchMessage(label, parsed, actual, context) {
  const lines = [
    `hashline_edit: hash mismatch for ${label} anchor "${parsed.anchor}"; line ${parsed.line} is now ${parsed.line}:${actual}`,
    'The file changed after this anchor was read; no edit was applied.',
  ]
  for (const record of context) {
    lines.push(`${record.number === parsed.line ? '>>> ' : '    '}${record.anchor}|${record.text}`)
  }
  lines.push('Copy the updated anchor from the line marked >>> and retry, or run hashline_read again.')
  return lines.join('\n')
}

export function validateAnchor(lines, value, label, options = {}) {
  const hashLength = options.hashLength ?? DEFAULT_HASH_LENGTH
  const parsed = parseAnchor(value, hashLength)
  if (parsed.line < 1 || parsed.line > lines.length) {
    fail(
      'HASHLINE_ANCHOR_OUT_OF_RANGE',
      `hashline_edit: ${label} anchor "${parsed.anchor}" is outside this file (${lines.length} line(s)); run hashline_read again`,
      { label, anchor: parsed.anchor, totalLines: lines.length },
    )
  }

  const actual = hashLine(lines[parsed.line - 1], hashLength)
  if (actual !== parsed.hash) {
    const context = contextRecords(lines, parsed.line, options)
    fail(
      'HASHLINE_HASH_MISMATCH',
      mismatchMessage(label, parsed, actual, context),
      { label, anchor: parsed.anchor, line: parsed.line, expected: parsed.hash, actual, context },
    )
  }
  return parsed.line
}

export function parseEditEntries(rawEdits) {
  if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
    fail('HASHLINE_INVALID_ARGUMENT', 'edits must be a non-empty array')
  }

  return rawEdits.map((entry, order) => {
    if (!isPlainObject(entry)) {
      fail('HASHLINE_INVALID_ARGUMENT', `edits[${order}] must be an object with exactly one variant`)
    }
    const keys = Object.keys(entry)
    if (keys.length !== 1 || !EDIT_KINDS.includes(keys[0])) {
      fail(
        'HASHLINE_INVALID_ARGUMENT',
        `edits[${order}] must contain exactly one variant (${EDIT_KINDS.join(' | ')})`,
      )
    }

    const kind = keys[0]
    const value = entry[kind]
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
      }
    }

    if (kind === 'replace_lines') {
      assertOnlyKeys(value, ['start_anchor', 'end_anchor', 'new_text'], `edits[${order}].replace_lines`)
      return {
        kind,
        order,
        startAnchor: requireString(value.start_anchor, `edits[${order}].replace_lines.start_anchor`),
        endAnchor: requireString(value.end_anchor, `edits[${order}].replace_lines.end_anchor`),
        newText: requireString(value.new_text, `edits[${order}].replace_lines.new_text`),
      }
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
      }
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
    }
  })
}

function describeEdit(edit) {
  return edit.kind === 'insert_after'
    ? `insert_after @${edit.boundary}`
    : `${edit.kind} ${edit.start}..${edit.end}`
}

export function assertNoOverlaps(edits) {
  for (let left = 0; left < edits.length; left += 1) {
    for (let right = left + 1; right < edits.length; right += 1) {
      const first = edits[left]
      const second = edits[right]
      if (first.kind === 'insert_after' && second.kind === 'insert_after') continue

      const insert = first.kind === 'insert_after'
        ? first
        : second.kind === 'insert_after' ? second : undefined
      const replacement = insert === first ? second : insert === second ? first : undefined

      const overlaps = insert !== undefined
        ? replacement.start <= insert.boundary && insert.boundary <= replacement.end
        : first.start <= second.end && second.start <= first.end

      if (overlaps) {
        fail(
          'HASHLINE_OVERLAPPING_EDIT',
          `hashline_edit: overlapping edits (${describeEdit(first)} vs ${describeEdit(second)}); no edit was applied`,
          { first: describeEdit(first), second: describeEdit(second) },
        )
      }
    }
  }
}

function materializeBlock(block, internalEol, finalEol) {
  return block.lines.map((text, index) => ({
    text,
    eol: index === block.lines.length - 1 ? finalEol : internalEol,
  }))
}

function applyAnchoredEdit(lines, edit, eol) {
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

function resolveAnchoredEdits(lines, edits, options) {
  for (const edit of edits) {
    if (edit.kind === 'set_line') {
      edit.start = validateAnchor(lines, edit.anchor, 'set_line', options)
      edit.end = edit.start
      continue
    }
    if (edit.kind === 'replace_lines') {
      edit.start = validateAnchor(lines, edit.startAnchor, 'replace_lines.start', options)
      edit.end = validateAnchor(lines, edit.endAnchor, 'replace_lines.end', options)
      if (edit.end < edit.start) {
        fail(
          'HASHLINE_INVALID_RANGE',
          `hashline_edit: replace_lines end anchor (${edit.endAnchor}) precedes start anchor (${edit.startAnchor})`,
        )
      }
      continue
    }
    edit.boundary = validateAnchor(lines, edit.anchor, 'insert_after', options)
  }
  assertNoOverlaps(edits)
}

function applyExactReplaces(body, edits) {
  let current = body
  let replacements = 0
  for (const edit of edits) {
    const matches = current.split(edit.oldText).length - 1
    if (matches === 0) {
      fail(
        'HASHLINE_TEXT_NOT_FOUND',
        `hashline_edit: replace text not found: ${JSON.stringify(edit.oldText.slice(0, 120))}`,
      )
    }
    if (!edit.all && matches !== 1) {
      fail(
        'HASHLINE_TEXT_NOT_UNIQUE',
        'hashline_edit: replace old_text matches multiple times; set all: true or make old_text more specific',
        { matches },
      )
    }
    const count = edit.all ? matches : 1
    current = edit.all
      ? current.split(edit.oldText).join(edit.newText)
      : current.replace(edit.oldText, edit.newText)
    replacements += count
  }
  return { body: current, replacements }
}

export function firstChangedLine(before, after) {
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

export function planEdits(content, rawEdits, options = {}) {
  const parsed = parseEditEntries(rawEdits)
  const anchored = parsed.filter(edit => edit.kind !== 'replace')
  const replacements = parsed.filter(edit => edit.kind === 'replace')
  if (anchored.length > 0 && replacements.length > 0) {
    fail(
      'HASHLINE_MIXED_EDIT_MODES',
      'hashline_edit: anchor-verified edits and replace cannot be mixed in one call; split them into separate calls',
    )
  }

  const file = splitTextFile(content)
  if (replacements.length > 0) {
    const result = applyExactReplaces(file.body, replacements)
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

  resolveAnchoredEdits(file.lines, anchored, options)
  const sorted = [...anchored].sort((left, right) => {
    const leftLine = left.kind === 'insert_after' ? left.boundary : left.start
    const rightLine = right.kind === 'insert_after' ? right.boundary : right.start
    if (leftLine !== rightLine) return rightLine - leftLine
    return right.order - left.order
  })

  const lines = file.lines.map(line => ({ ...line }))
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

export function previewContent(content, firstLine, options = {}) {
  const file = splitTextFile(content)
  if (file.lines.length === 0) return []
  const contextLines = options.contextLines ?? DEFAULT_CONTEXT_LINES
  const center = firstLine === null ? 1 : Math.min(Math.max(firstLine, 1), file.lines.length)
  const start = Math.max(1, center - contextLines)
  const end = Math.min(file.lines.length, center + contextLines)
  const result = []
  for (let line = start; line <= end; line += 1) {
    result.push(lineRecord(file.lines, line - 1, options))
  }
  return result
}
