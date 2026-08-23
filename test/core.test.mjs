import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// 用 fixtures 假 profile 隔离 DSH 运行时模块（dsh-llm），
// 必须在 import 库模块之前设置。
process.env.DSH_HOME = fileURLToPath(new URL('./fixtures/dsh-home', import.meta.url))

const {
  HashlineError,
  hashLine,
  lineRecord,
  parseAnchor,
  parseReplacementText,
  planEdits,
  previewContent,
  splitTextFile,
  joinTextFile,
  truncateLine,
} = await import('../lib/core.js')

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

test('锚点行号漂移时唯一哈希匹配自动重定位', () => {
  // 原始文件 3 行；读取后文件被外部插入一行，原第 3 行漂到第 4 行。
  const original = 'a\nb\nc\n'
  const drifted = 'a\nb\nX\nc\n'
  // 用“原始第 3 行 c”的哈希（未变），但行号仍是 3（已漂移）。
  const staleAnchor = anchor(original, 3)
  const result = apply(drifted, [
    { set_line: { anchor: staleAnchor, new_text: 'C' } },
  ])
  // 唯一哈希匹配：自动重定位到第 4 行的 c，改为 C。
  assert.equal(result, 'a\nb\nX\nC\n')
})

test('锚点哈希存在多个候选时拒绝并报告歧义', () => {
  const content = 'a\nb\na\n'
  // a 的哈希在文件第 1、3 行各出现一次；把锚点行号指到第 2 行（b），
  // 使其哈希不匹配，且在全文件有 2 个候选 → 拒绝并报告歧义。
  const aHash = hashLine(splitTextFile(content).lines[0])
  const ambiguousAnchor = `2:${aHash}`
  assert.throws(() => apply(content, [
    { set_line: { anchor: ambiguousAnchor, new_text: 'A' } },
  ]), error => {
    assert.equal(error.code, 'HASHLINE_HASH_MISMATCH')
    assert.ok(Array.isArray(error.details.ambiguousLines))
    return true
  })
})

test('无效锚点报错回显附近真实锚点', () => {
  const lines = splitTextFile('alpha\nbeta\ngamma\n').lines
  assert.throws(() => parseAnchor('2:9', 4, lines, { contextLines: 1 }), error => {
    assert.equal(error.code, 'HASHLINE_INVALID_ANCHOR')
    assert.match(error.message, /Near line 2/)
    assert.match(error.message, /2:[0-9a-f]{4}\|beta/)
    return true
  })
})


test('replace 保留 mixed EOL 文件中未触及区域的原始行尾', () => {
  const lfMajor = 'a\nb\r\nc\n'
  const lfResult = planEdits(lfMajor, [
    { replace: { old_text: 'b', new_text: 'B' } },
  ])
  assert.equal(lfResult.after, 'a\nB\r\nc\n')

  const crlfMajor = 'a\r\nb\r\nc\n'
  const crlfResult = planEdits(crlfMajor, [
    { replace: { old_text: 'b', new_text: 'B' } },
  ])
  assert.equal(crlfResult.after, 'a\r\nB\r\nc\n')
})


test('replace 新增换行时沿用命中位置附近的原始行尾', () => {
  const content = 'head\r\nvalue\r\ntail\n'
  const result = planEdits(content, [
    { replace: { old_text: 'value', new_text: 'first\nsecond' } },
  ])
  assert.equal(result.after, 'head\r\nfirst\r\nsecond\r\ntail\n')
})
test('跨行 replace 仅沿用被替换区间的行尾风格', () => {
  const content = 'head\nold1\r\nold2\r\ntail\n'
  const result = planEdits(content, [
    { replace: { old_text: 'old1\nold2\n', new_text: 'new1\nnew2\n' } },
  ])
  assert.equal(result.after, 'head\nnew1\r\nnew2\r\ntail\n')
})
test('replace 对 CRLF 文件自动做 LF 归一匹配', () => {
  const content = 'alpha\r\nbeta\r\n'
  const result = planEdits(content, [
    { replace: { old_text: 'beta\n', new_text: 'gamma\n' } },
  ])
  assert.equal(result.after, 'alpha\r\ngamma\r\n')
  assert.equal(result.replacements, 1)
})
