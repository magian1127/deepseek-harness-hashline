import assert from 'node:assert/strict'
import test from 'node:test'

import {
  HashlineError,
  hashLine,
  lineRecord,
  parseReplacementText,
  planEdits,
  previewContent,
  splitTextFile,
  joinTextFile,
  truncateLine,
} from '../lib/core.js'

function anchor(content, lineNumber) {
  const file = splitTextFile(content)
  const hash = hashLine(file.lines[lineNumber - 1])
  return `${lineNumber}:${hash}`
}

function apply(content, edits) {
  return planEdits(content, edits).after
}

function expectCode(operation, code) {
  assert.throws(operation, error => {
    assert.ok(error instanceof HashlineError)
    assert.equal(error.code, code)
    return true
  })
}

test('拆分和合并保留 BOM、CRLF 与末行状态', () => {
  const content = '\uFEFFalpha\r\nbeta\r\nlast'
  const file = splitTextFile(content)
  assert.equal(file.bom, true)
  assert.equal(file.eol, 'crlf')
  assert.deepEqual(file.lines, [
    { text: 'alpha', eol: '\r\n' },
    { text: 'beta', eol: '\r\n' },
    { text: 'last', eol: '' },
  ])
  assert.equal(joinTextFile(file), content)
})

test('空文件没有虚构行，单独换行表示一个空白行', () => {
  assert.deepEqual(splitTextFile('').lines, [])
  assert.deepEqual(splitTextFile('\n').lines, [{ text: '', eol: '\n' }])
  assert.deepEqual(splitTextFile('a\n').lines, [{ text: 'a', eol: '\n' }])
})

test('行哈希固定为 4 hex，并把行尾纳入校验', () => {
  const lf = { text: 'same', eol: '\n' }
  const crlf = { text: 'same', eol: '\r\n' }
  assert.match(hashLine(lf), /^[0-9a-f]{4}$/)
  assert.equal(hashLine(lf), hashLine(lf))
  assert.notEqual(hashLine(lf), hashLine(crlf))
})

test('替换文本尾部换行不产生虚构空行', () => {
  assert.deepEqual(parseReplacementText('a\n'), { lines: ['a'], trailingEol: true })
  assert.deepEqual(parseReplacementText('\n'), { lines: [''], trailingEol: true })
  assert.deepEqual(parseReplacementText('a\n\n'), { lines: ['a', ''], trailingEol: true })
  assert.deepEqual(parseReplacementText(''), { lines: [], trailingEol: false })
})

test('set_line 保留末行无换行状态', () => {
  const content = 'old'
  const result = apply(content, [
    { set_line: { anchor: anchor(content, 1), new_text: 'new' } },
  ])
  assert.equal(result, 'new')
})

test('set_line 的显式尾换行只产生一行', () => {
  const content = 'old'
  const result = apply(content, [
    { set_line: { anchor: anchor(content, 1), new_text: 'new\n' } },
  ])
  assert.equal(result, 'new\n')
  assert.equal(splitTextFile(result).lines.length, 1)
})

test('set_line 使用换行可创建一个有行尾的空白行', () => {
  const content = 'old'
  const result = apply(content, [
    { set_line: { anchor: anchor(content, 1), new_text: '\n' } },
  ])
  assert.equal(result, '\n')
  assert.deepEqual(splitTextFile(result).lines, [{ text: '', eol: '\n' }])
})

test('replace_lines 保留最终文件无换行状态', () => {
  const content = 'a\nb\nc'
  const result = apply(content, [
    {
      replace_lines: {
        start_anchor: anchor(content, 2),
        end_anchor: anchor(content, 3),
        new_text: 'x',
      },
    },
  ])
  assert.equal(result, 'a\nx')
})

test('insert_after 在无尾换行文件中建立正确边界', () => {
  const content = 'a'
  const result = apply(content, [
    { insert_after: { anchor: anchor(content, 1), new_text: 'b' } },
  ])
  assert.equal(result, 'a\nb')
})

test('insert_after 保留原文件尾换行', () => {
  const content = 'a\n'
  const result = apply(content, [
    { insert_after: { anchor: anchor(content, 1), new_text: 'b' } },
  ])
  assert.equal(result, 'a\nb\n')
})

test('同一锚点的多个 insert_after 保持请求数组顺序', () => {
  const content = 'a'
  const sourceAnchor = anchor(content, 1)
  const result = apply(content, [
    { insert_after: { anchor: sourceAnchor, new_text: 'first' } },
    { insert_after: { anchor: sourceAnchor, new_text: 'second' } },
  ])
  assert.equal(result, 'a\nfirst\nsecond')
})

test('修改锚点行与在其后插入被判定为冲突', () => {
  const content = 'a\nb\n'
  const sourceAnchor = anchor(content, 1)
  expectCode(() => apply(content, [
    { set_line: { anchor: sourceAnchor, new_text: 'A' } },
    { insert_after: { anchor: sourceAnchor, new_text: 'between' } },
  ]), 'HASHLINE_OVERLAPPING_EDIT')
})

test('重叠范围在任何写入计划生成前被拒绝', () => {
  const content = 'a\nb\nc\n'
  expectCode(() => apply(content, [
    {
      replace_lines: {
        start_anchor: anchor(content, 1),
        end_anchor: anchor(content, 2),
        new_text: 'x',
      },
    },
    { set_line: { anchor: anchor(content, 2), new_text: 'y' } },
  ]), 'HASHLINE_OVERLAPPING_EDIT')
})

test('过期锚点返回当前上下文和稳定错误码', () => {
  const content = 'a\nb\nc\n'
  assert.throws(() => apply(content, [
    { set_line: { anchor: '2:0000', new_text: 'B' } },
  ]), error => {
    assert.equal(error.code, 'HASHLINE_HASH_MISMATCH')
    assert.equal(error.details.line, 2)
    assert.match(error.message, />>> 2:[0-9a-f]{4}\|b/)
    return true
  })
})

test('锚定编辑始终保留 BOM', () => {
  const content = '\uFEFFa\r\nb\r\n'
  const result = apply(content, [
    { set_line: { anchor: anchor(content, 1), new_text: 'A' } },
  ])
  assert.equal(result, '\uFEFFA\r\nb\r\n')
})

test('多行替换使用文件主导 CRLF', () => {
  const content = 'a\r\nb\r\n'
  const result = apply(content, [
    { set_line: { anchor: anchor(content, 1), new_text: 'x\ny' } },
  ])
  assert.equal(result, 'x\r\ny\r\nb\r\n')
})

test('删除 set_line 目标不会留下幽灵空行', () => {
  const content = 'a\nb\nc'
  const result = apply(content, [
    { set_line: { anchor: anchor(content, 2), new_text: '' } },
  ])
  assert.equal(result, 'a\nc')
})

test('replace 逃生舱要求唯一匹配并保留 BOM', () => {
  const content = '\uFEFFalpha beta'
  const result = planEdits(content, [
    { replace: { old_text: 'beta', new_text: 'gamma' } },
  ])
  assert.equal(result.after, '\uFEFFalpha gamma')
  assert.equal(result.replacements, 1)
})

test('replace all 按实际匹配数报告', () => {
  const result = planEdits('x x x', [
    { replace: { old_text: 'x', new_text: 'y', all: true } },
  ])
  assert.equal(result.after, 'y y y')
  assert.equal(result.replacements, 3)
})

test('replace 默认拒绝多个匹配', () => {
  expectCode(() => planEdits('x x', [
    { replace: { old_text: 'x', new_text: 'y' } },
  ]), 'HASHLINE_TEXT_NOT_UNIQUE')
})

test('锚定编辑与 replace 不可混用', () => {
  const content = 'a\n'
  expectCode(() => planEdits(content, [
    { set_line: { anchor: anchor(content, 1), new_text: 'A' } },
    { replace: { old_text: 'A', new_text: 'B' } },
  ]), 'HASHLINE_MIXED_EDIT_MODES')
})

test('insert_after 拒绝空文本', () => {
  const content = 'a'
  expectCode(() => planEdits(content, [
    { insert_after: { anchor: anchor(content, 1), new_text: '' } },
  ]), 'HASHLINE_INVALID_ARGUMENT')
})

test('长行只截断显示，不改变锚点哈希', () => {
  const text = 'x'.repeat(20)
  const file = splitTextFile(text)
  const record = lineRecord(file.lines, 0, { maxLineLength: 5 })
  assert.equal(record.hash, hashLine(file.lines[0]))
  assert.equal(record.truncated, true)
  assert.match(record.text, /^xxxxx\.\.\. \[truncated, 20 chars total\]$/)
})

test('编辑预览返回可继续使用的新锚点', () => {
  const content = 'a\nb\nc\nd\n'
  const records = previewContent(content, 2, { contextLines: 1 })
  assert.deepEqual(records.map(record => record.number), [1, 2, 3])
  assert.ok(records.every(record => record.anchor === `${record.number}:${record.hash}`))
})

test('无变化计划不虚报 changed', () => {
  const content = 'same\n'
  const result = planEdits(content, [
    { set_line: { anchor: anchor(content, 1), new_text: 'same' } },
  ])
  assert.equal(result.changed, false)
})
