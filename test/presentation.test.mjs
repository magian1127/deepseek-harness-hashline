import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'

function hash(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 4)
}

const {
  computeHunkDiffs,
  extractReadBody,
  formatReadEnvelope,
  langFromPath,
  narrowDiffsMeta,
  narrowReadMeta,
} = await import('../lib/presentation.js')

test('读取 envelope 严格匹配原生结构，body 可往返提取', () => {
  const text = formatReadEnvelope('C:\\workspace\\a.ts', 1, [
    { number: 1, hash: 'b6a9', text: 'alpha' },
    { number: 2, hash: 'd445', text: 'beta = 1' },
  ], 2)
  assert.equal(text, [
    '<path>C:\\workspace\\a.ts</path>',
    '<type>file</type>',
    '<content>',
    '1|b6a9  alpha',
    '2|d445  beta = 1',
    '',
    '(End of file - total 2 lines)',
    '</content>',
  ].join('\n'))
  const body = extractReadBody(text)
  assert.equal(body, '1|b6a9  alpha\n2|d445  beta = 1\n\n(End of file - total 2 lines)')
})


test('读取 envelope 可追加 EOL 与 BOM 元数据', () => {
  const text = formatReadEnvelope('a.txt', 1, [
    { number: 1, hash: 'b6a9', text: 'alpha' },
  ], 1, { eol: 'crlf', bom: true })
  assert.match(text, /\(File metadata: eol=crlf, bom=yes\)/)
  assert.ok(extractReadBody(text)?.includes('(File metadata: eol=crlf, bom=yes)'))
})
test('读取 envelope 在窗口未到末尾时给出续读 footer', () => {
  const text = formatReadEnvelope('a.txt', 3, [
    { number: 3, hash: 'aaaa', text: 'x' },
    { number: 4, hash: 'bbbb', text: 'y' },
  ], 10)
  assert.match(text, /\(Showing lines 3-4 of 10\. Use offset=5 to continue\.\)/)
  assert.ok(extractReadBody(text)?.includes('(Showing lines 3-4 of 10. Use offset=5 to continue.)'))
})

test('空文件 envelope 仍可提取 body', () => {
  const text = formatReadEnvelope('empty.txt', 1, [], 0)
  assert.match(text, /\(End of file - total 0 lines\)/)
  assert.ok(extractReadBody(text)?.includes('(End of file - total 0 lines)'))
})

test('envelope 不匹配时提取返回 undefined', () => {
  assert.equal(extractReadBody('plain text'), undefined)
  // 缺结尾换行的 </content> 不匹配正则。
  assert.equal(extractReadBody('<path>p</path>\n<type>file</type>\n<content>\nx</content>'), undefined)
  // type 不是 file 时不匹配。
  assert.equal(extractReadBody('<path>p</path>\n<type>other</type>\n<content>\nx\n</content>'), undefined)
  // 路径含换行时不匹配（<path> 必须单行）。
  assert.equal(extractReadBody('<path>a\nb</path>\n<type>file</type>\n<content>\nx\n</content>'), undefined)
})

test('单行替换生成带上下文的单个 hunk', () => {
  const diffs = computeHunkDiffs('a.ts', 'a\nb\nc\nd\ne\nf\ng\n', 'a\nb\nC\nd\ne\nf\ng\n')
  assert.equal(diffs.length, 1)
  assert.equal(diffs[0].path, 'a.ts')
  assert.match(diffs[0].oldText, /b\nc\nd/)
  assert.match(diffs[0].newText, /b\nC\nd/)
})

test('带 hashLength 的编辑 hunks 投影逐行旧新哈希', () => {
  const [diff] = computeHunkDiffs('a.ts', 'const x = 1\n', 'const x = 2\n', 4)
  assert.deepEqual(diff.oldHashes, ['80ea'])
  assert.deepEqual(diff.newHashes, ['b6c6'])
  assert.equal(diff.oldHashes.length, diff.oldText.split('\n').length)
  assert.equal(diff.newHashes.length, diff.newText.split('\n').length)
  assert.notDeepEqual(diff.oldHashes, computeHunkDiffs('a.ts', 'const x = 1', 'const x = 2', 4)[0].oldHashes)
})

test('分散替换保持为多个 hunk', () => {
  // 替换点距离必须超过 2×上下文 + 1 行，否则 jsdiff 会把共享上下文的
  // hunks 合并为一个。
  const diffs = computeHunkDiffs(
    'a.ts',
    'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\n',
    'a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nK\nl\nm\n',
  )
  assert.equal(diffs.length, 2)
  assert.match(diffs[0].oldText, /a\nb\nc/)
  assert.match(diffs[1].oldText, /j\nk\nl/)
})

test('从空文件创建内容使用 oldText null，删空得到空 newText', () => {
  const inserted = computeHunkDiffs('a.ts', '', 'X\n')
  assert.equal(inserted[0].oldText, null)
  assert.match(inserted[0].newText, /X/)

  const removed = computeHunkDiffs('a.ts', 'a\nb\n', '')
  assert.equal(removed[0].newText, '')
  assert.match(removed[0].oldText, /a\nb/)
})

test('diff 展示层忽略 BOM 并把 CRLF 归一为 LF', () => {
  const diffs = computeHunkDiffs('crlf.txt', '\uFEFFa\r\nb\r\nc\r\n', '\uFEFFa\r\nB\r\nc\r\n')
  assert.equal(diffs.length, 1)
  assert.ok(!diffs[0].oldText?.includes('\r'))
  assert.ok(!diffs[0].newText.includes('\r'))
  assert.ok(!diffs[0].oldText?.includes('\uFEFF'))
  assert.match(diffs[0].newText, /a\nB\nc/)
})

test('mixed EOL 编辑 hunk 的旧新哈希使用各自真实行尾', () => {
  const [diff] = computeHunkDiffs('mixed.txt', 'a\r\nb\nc\r\n', 'a\r\nB\nc\r\n', 4)
  assert.deepEqual(diff.oldHashes, [hash('a\r\n'), hash('b\n'), hash('c\r\n')])
  assert.deepEqual(diff.newHashes, [hash('a\r\n'), hash('B\n'), hash('c\r\n')])
})

test('末尾无换行不泄漏统一 diff 标记', () => {
  const diffs = computeHunkDiffs('a.txt', 'a\nb', 'a\nB')
  assert.equal(diffs.length, 1)
  for (const part of [diffs[0].oldText, diffs[0].newText]) {
    assert.ok(!part?.includes('\\ No newline'))
  }
})

test('文本相同返回空 hunks', () => {
  assert.deepEqual(computeHunkDiffs('a.txt', 'same\n', 'same\n'), [])
})

test('语言提示按扩展名推导且大小写不敏感', () => {
  assert.equal(langFromPath('src/a.ts'), 'ts')
  assert.equal(langFromPath('A.TSX'), 'tsx')
  assert.equal(langFromPath('C:\\w\\x.yaml'), 'yaml')
  assert.equal(langFromPath('.gitignore'), undefined)
  assert.equal(langFromPath('noext'), undefined)
  assert.equal(langFromPath('foo.constructor'), undefined)
})

test('读取 meta 窄化接受合法投影并拒绝畸形回放', () => {
  const valid = {
    path: 'a.ts',
    offset: 2,
    lines: [{ number: 2, hash: 'aaaa', text: 'x' }, { number: 3, hash: 'bbbb', text: 'y' }],
    totalLines: 5,
    lang: 'ts',
  }
  assert.deepEqual(narrowReadMeta(valid), valid)

  assert.equal(narrowReadMeta(null), undefined)
  assert.equal(narrowReadMeta({ ...valid, offset: 0 }), undefined)
  assert.equal(narrowReadMeta({ ...valid, offset: 1.5 }), undefined)
  assert.equal(narrowReadMeta({ ...valid, totalLines: -1 }), undefined)
  assert.equal(narrowReadMeta({ ...valid, lang: 3 }), undefined)
  assert.equal(narrowReadMeta({ ...valid, lines: [{ number: 3, hash: 'aaaa', text: 'x' }, { number: 2, text: 'y' }] }), undefined)
  assert.equal(narrowReadMeta({ ...valid, lines: [{ number: 2, hash: 'aaaa', text: 'x' }, { number: 9, hash: 'bbbb', text: 'y' }] }), undefined)
  assert.equal(narrowReadMeta({ ...valid, lines: [{ number: 2, hash: 'aaaa', text: 'x' }, { number: 2, hash: 'bbbb', text: 'y' }] }), undefined)
  assert.equal(narrowReadMeta({ ...valid, lines: [{ number: 2, hash: 'aaaa', text: 42 }] }), undefined)
  assert.equal(narrowReadMeta({ ...valid, lines: [{ number: 2, text: 'x' }] }), undefined)
  assert.equal(narrowReadMeta({ ...valid, lines: [{ number: 2, hash: 'zzzz', text: 'x' }] }), undefined)
  // 无 lang 时返回对象不含 lang 键。
  const { lang: _lang, ...withoutLang } = valid
  assert.deepEqual(narrowReadMeta(withoutLang), withoutLang)
})

test('diff meta 窄化接受合法 hunks 并拒绝空与畸形数据', () => {
  const valid = { diffs: [{ path: 'a.ts', oldText: 'a', newText: 'b', oldHashes: ['aaaa'], newHashes: ['bbbb'] }] }
  assert.deepEqual(narrowDiffsMeta(valid), valid.diffs)

  assert.equal(narrowDiffsMeta(null), undefined)
  assert.equal(narrowDiffsMeta({ diffs: [] }), undefined)
  assert.equal(narrowDiffsMeta({ diffs: [{ path: 'a.ts', oldText: 3, newText: 'b' }] }), undefined)
  assert.equal(narrowDiffsMeta({ diffs: [{ path: 'a.ts', oldText: 'a', newText: 'b', oldHashes: [], newHashes: ['bbbb'] }] }), undefined)
  assert.equal(narrowDiffsMeta({ diffs: [{ path: 'a.ts', oldText: 'a', newText: 'b', oldHashes: ['zzzz'], newHashes: ['bbbb'] }] }), undefined)
  assert.equal(narrowDiffsMeta({ diffs: [{ path: 'a.ts', oldText: 'a', newText: 'b', oldHashes: ['aa'], newHashes: ['bbbb'] }] }), undefined)
  assert.equal(narrowDiffsMeta({ diffs: [{ path: 'a.ts', oldText: 'a', newText: 'b', oldHashes: ['a'.repeat(17)], newHashes: ['bbbb'] }] }), undefined)
  // oldText 为 null（无旧文本可显示）是合法 hunks。
  assert.deepEqual(narrowDiffsMeta({ diffs: [{ path: 'a.ts', oldText: null, newText: 'b' }] }), [
    { path: 'a.ts', oldText: null, newText: 'b' },
  ])
  assert.equal(narrowDiffsMeta({ other: 1 }), undefined)
})
