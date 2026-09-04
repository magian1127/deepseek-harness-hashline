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

test('replace 变体已在 0.2.0 移除并被拒绝', () => {
  expectCode(() => planEdits('alpha beta', [
    { replace: { old_text: 'beta', new_text: 'gamma' } },
  ]), 'HASHLINE_INVALID_ARGUMENT')
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


test('扁平 op 形状：三种操作与嵌套形状等价解析', () => {
  const content = 'alpha\nbeta\ngamma\n'
  assert.equal(apply(content, [
    { op: 'set_line', anchor: anchor(content, 2), new_text: 'BETA' },
  ]), 'alpha\nBETA\ngamma\n')
  assert.equal(apply(content, [
    { op: 'replace_lines', start_anchor: anchor(content, 1), end_anchor: anchor(content, 2), new_text: 'A2\nB2' },
  ]), 'A2\nB2\ngamma\n')
  assert.equal(apply(content, [
    { op: 'insert_after', anchor: anchor(content, 2), new_text: 'INSERTED' },
  ]), 'alpha\nbeta\nINSERTED\ngamma\n')
  // 扁平与嵌套可在同一数组中混用（旧回放与新形状共存）。
  assert.equal(apply(content, [
    { op: 'set_line', anchor: anchor(content, 1), new_text: 'A' },
    { set_line: { anchor: anchor(content, 3), new_text: 'G' } },
  ]), 'A\nbeta\nG\n')
})

test('扁平 op 形状：非法 op 与缺字段在写入前拒绝', () => {
  const content = 'alpha\n'
  expectCode(() => apply(content, [
    { op: 'delete_line', anchor: anchor(content, 1), new_text: 'x' },
  ]), 'HASHLINE_INVALID_ARGUMENT')
  expectCode(() => apply(content, [
    { op: 'set_line', new_text: 'x' },
  ]), 'HASHLINE_INVALID_ARGUMENT')
  expectCode(() => apply(content, [
    { op: 'replace_lines', start_anchor: anchor(content, 1), new_text: 'x' },
  ]), 'HASHLINE_INVALID_ARGUMENT')
  expectCode(() => apply(content, [
    { op: 'insert_after', anchor: anchor(content, 1), new_text: '' },
  ]), 'HASHLINE_INVALID_ARGUMENT')
  // op 与变体键混用是歧义形状，拒绝。
  expectCode(() => apply(content, [
    { op: 'set_line', set_line: { anchor: anchor(content, 1), new_text: 'x' } },
  ]), 'HASHLINE_INVALID_ARGUMENT')
})

test('锚点接受显示分隔符 | 并与 : 等价', () => {
  const content = 'alpha\nbeta\n'
  const pipeAnchor = anchor(content, 2).replace(':', '|')
  assert.equal(apply(content, [
    { op: 'set_line', anchor: pipeAnchor, new_text: 'BETA' },
  ]), 'alpha\nBETA\n')
})

test('扁平 op 形状：拒绝另一操作的多余锚点字段', () => {
  const content = 'alpha\nbeta\n'
  for (const entry of [
    { op: 'set_line', anchor: anchor(content, 1), start_anchor: anchor(content, 1), new_text: 'ALPHA' },
    { op: 'insert_after', anchor: anchor(content, 1), end_anchor: anchor(content, 1), new_text: 'after' },
    { op: 'replace_lines', anchor: anchor(content, 1), start_anchor: anchor(content, 1), end_anchor: anchor(content, 2), new_text: 'ALPHA\nBETA' },
  ]) {
    assert.throws(() => apply(content, [entry]), error => {
      assert.equal(error.code, 'HASHLINE_INVALID_ARGUMENT')
      assert.match(error.message, /unsupported field/)
      return true
    })
  }
})

test('扁平 op 形状：另一操作锚点字段的 null 占位被忽略；str_replace 家族任何值拒绝', () => {
  const content = 'alpha\nbeta\n'
  assert.equal(apply(content, [
    { op: 'set_line', anchor: anchor(content, 1), start_anchor: null, end_anchor: null, new_text: 'ALPHA' },
  ]), 'ALPHA\nbeta\n')
  assert.equal(apply(content, [
    { op: 'insert_after', anchor: anchor(content, 1), end_anchor: null, new_text: 'after' },
  ]), 'alpha\nafter\nbeta\n')
  assert.throws(() => apply(content, [
    { op: 'set_line', anchor: anchor(content, 1), old_string: null, new_text: 'ALPHA' },
  ]), error => error.code === 'HASHLINE_INVALID_ARGUMENT')
  })

test('错误消息随 zhPrompt 切换中英文', () => {
  const content = 'alpha\nbeta\n'
  const staleAnchor = '1:0000'
  // 默认英文:hash mismatch 与重试指引。
  assert.throws(
    () => planEdits(content, [{ op: 'set_line', anchor: staleAnchor, new_text: 'x' }]),
    error => {
      assert.equal(error.code, 'HASHLINE_HASH_MISMATCH')
        assert.match(error.message, /hash mismatch for edits\[0\]\.set_line anchor/)
      assert.match(error.message, /Copy the updated anchor from the line marked >>>/)
      return true
    },
  )
  // zhPrompt 开启后中文,同一错误不再出现英文文案。
  assert.throws(
    () => planEdits(content, [{ op: 'set_line', anchor: staleAnchor, new_text: 'x' }], { zhPrompt: true }),
    error => {
      assert.equal(error.code, 'HASHLINE_HASH_MISMATCH')
      assert.match(error.message, /哈希不匹配/)
      assert.match(error.message, /从标记 >>> 的行复制更新后的锚点/)
      assert.doesNotMatch(error.message, /hash mismatch|Copy the updated anchor/)
      return true
    },
  )
  // 参数错误同样随 zhPrompt 切换。
  assert.throws(() => planEdits(content, []), error => {
    assert.equal(error.code, 'HASHLINE_INVALID_ARGUMENT')
    assert.match(error.message, /edits must be a non-empty array/)
    return true
  })
    // 多个锚点失败(快照整体过期):各失败处直接回显当前内容与 >>> 新锚点,一轮自愈。
    assert.throws(
      () => planEdits('a\nb\nc\nd\n', [
        { op: 'set_line', anchor: '1:0000', new_text: 'x' },
        { op: 'set_line', anchor: '4:0000', new_text: 'y' },
      ]),
      error => {
        assert.equal(error.code, 'HASHLINE_MULTIPLE_ANCHOR_ERRORS')
        assert.match(error.message, /2 of 2 anchors failed validation; no edit was applied\. Current content at each failed location:/)
        // 每个失败项:标签头 + 上下各 1 行,目标行以 >>> 标记当前真实锚点(hash 动态匹配)。
        assert.match(error.message, /edits\[0\]\.set_line anchor "1:0000" \(line 1\):\n>>> 1:[0-9a-f]+\|a\n    2:[0-9a-f]+\|b/)
        assert.match(error.message, /edits\[1\]\.set_line anchor "4:0000" \(line 4\):\n    3:[0-9a-f]+\|c\n>>> 4:[0-9a-f]+\|d/)
        assert.match(error.message, /Retry with the fresh anchors marked >>> above, or run hashline_read again/)
        assert.equal(error.details.failures.length, 2)
        assert.equal(error.details.failures[0].line, 1)
        assert.equal(error.details.failures[0].context.length, 2)
        assert.equal(error.details.failures[1].line, 4)
        return true
      },
    )
    // zhPrompt 开启后同样回显且指引自愈。
    assert.throws(
      () => planEdits('a\nb\nc\nd\n', [
        { op: 'set_line', anchor: '1:0000', new_text: 'x' },
        { op: 'set_line', anchor: '4:0000', new_text: 'y' },
      ], { zhPrompt: true }),
      error => {
        assert.equal(error.code, 'HASHLINE_MULTIPLE_ANCHOR_ERRORS')
        assert.match(error.message, /2 个校验失败/)
        assert.match(error.message, /各失败位置的当前内容:/)
        assert.match(error.message, /用上方标记 >>> 的新锚点重试/)
        return true
      },
    )
    assert.throws(() => planEdits(content, [], { zhPrompt: true }), error => {
      assert.equal(error.code, 'HASHLINE_INVALID_ARGUMENT')
      assert.match(error.message, /edits 必须是非空数组/)
      return true
    })
})

test('锚点漂移重定位被记录到 plan.relocations(宽容但可观测)', () => {
  const content = 'alpha\nbeta\ngamma\n'
  // 行 3 的内容锚点,但行号漂移写成 2(gamma 内容全文件唯一)。
  const drifted = `2:${anchor(content, 3).split(':')[1]}`
  const plan = planEdits(content, [{ op: 'set_line', anchor: drifted, new_text: 'GAMMA' }])
  assert.equal(plan.after, 'alpha\nbeta\nGAMMA\n')
  assert.deepEqual(plan.relocations, [{ from: 2, to: 3 }])
  // 正常锚点不产生 relocations。
  const plain = planEdits(content, [{ op: 'set_line', anchor: anchor(content, 1), new_text: 'ALPHA' }])
  assert.equal(plain.after, 'ALPHA\nbeta\ngamma\n')
  assert.equal(plain.relocations, undefined)
})
