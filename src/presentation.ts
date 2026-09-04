/**
 * Host 展示层纯逻辑：读取 envelope、紧凑 diff hunks 与回放 metadata 窄化。
 *
 * 分层约定：`src/core.ts` 只负责文本模型、锚点解析、计划与写前验证；本模块只接收普通字符串、
 * 路径和编辑前后文本，返回自有 JSON diff 与 envelope，不接触 React、ToolResult 或 DSH 运行时
 * 实例。所有函数必须可独立测试，且任何畸形输入都应返回 `undefined` / 空数组，让调用方回退
 * 普通文本结果，绝不抛错。
 *
 * diff 只在展示层把 CRLF 统一到 LF、忽略 BOM 影响并去除 unified diff 特殊标记；实际写入仍使用
 * `core.ts` 的文本模型，文件保真不受影响。
 */

import { structuredPatch } from 'diff'
import { DEFAULT_HASH_LENGTH, hashLine, splitTextFile } from './core.js'

/** 展示层 diff 的上下文行数（与 DSH 原生 tool-fs 一致）。 */
export const DIFF_CONTEXT = 3

/** 一个文件变更的展示 diff：`oldText` 为 `null` 表示纯插入（没有旧文本可显示）。 */
export interface FileDiff {
  path: string
  oldText: string | null
  newText: string
  /** hunk 在旧文件中的 1 基起始行号；`oldText` 为 null(纯插入)时缺省。 */
  oldStart?: number
  /** hunk 在新文件中的 1 基起始行号。 */
  newStart?: number
  oldHashes?: string[]
  newHashes?: string[]
}

/** 读取卡投影的一行：1 基行号、独立哈希 chrome 与纯文件正文。 */
export interface ReadPresentationLine {
  number: number
  hash: string
  text: string
}

/** 读取卡 UI 投影：路径、窗口起始、行、总行数与可选语言提示。 */
export interface ReadMeta {
  path: string
  offset: number
  lines: ReadPresentationLine[]
  totalLines: number
  lang?: string
}

/**
 * 展示层归一：去掉 UTF-8 BOM 并把 CRLF / 孤立 CR 统一为 LF。
 * 只用于 diff 与 envelope 的展示计算，绝不进入实际写入路径。
 */
export function normalizeForDiff(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/**
 * 计算 `before` / `after` 之间的紧凑 hunks，每个 hunk 一个 {@link FileDiff}，
 * 带 {@link DIFF_CONTEXT} 行上下文。纯插入使用 `oldText: null`，统一 diff 的
 * 缺尾换行标记（`\ No newline at end of file`）被丢弃，分散的替换保持为多个 hunk。
 *
 * @param path - 每个 diff 上盖的路径（模型-facing 路径）。
 * @param before - 变更前的文件文本（磁盘原文，展示层会归一）。
 * @param after - 变更后的文件文本（同一来源）。
 * @returns 按文件顺序的 hunks；文本相同时为空数组。
 */
export function computeHunkDiffs(
  path: string,
  before: string,
  after: string,
  hashLength: number = DEFAULT_HASH_LENGTH,
): FileDiff[] {
  const beforeNormalized = normalizeForDiff(before)
  const afterNormalized = normalizeForDiff(after)
  // jsdiff needs a normalized LF view, but hashes must use the original per-line
  // terminators. The hunk line indexes are stable across EOL normalization.
  const beforeLines = splitTextFile(before).lines
  const afterLines = splitTextFile(after).lines
  const patch = structuredPatch('', '', beforeNormalized, afterNormalized, undefined, undefined, {
    context: DIFF_CONTEXT,
  })
  const diffs: FileDiff[] = []
  for (const hunk of patch.hunks) {
    const oldLines: string[] = []
    const newLines: string[] = []
    for (const line of hunk.lines) {
      // unified diff 的缺尾换行标记注释的是补丁本身，不是内容——跳过，
      // 避免它泄漏进 diff 块。
      if (line.startsWith('\\')) continue
      const text = line.slice(1)
      if (line.startsWith('-')) {
        oldLines.push(text)
      } else if (line.startsWith('+')) {
        newLines.push(text)
      } else {
        // 上下文（未变化）行同时出现在两侧。
        oldLines.push(text)
        newLines.push(text)
      }
    }
    const oldText = oldLines.length > 0 ? oldLines.join('\n') : null
    const newText = newLines.join('\n')
    const oldSlice = beforeLines.slice(hunk.oldStart - 1, hunk.oldStart - 1 + hunk.oldLines)
    const newSlice = afterLines.slice(hunk.newStart - 1, hunk.newStart - 1 + hunk.newLines)
      diffs.push({
        path,
        oldText,
        newText,
        ...(oldText === null ? {} : { oldStart: hunk.oldStart }),
        newStart: hunk.newStart,
        ...(oldText === null ? {} : { oldHashes: oldSlice.map(line => hashLine(line, hashLength)) }),
        newHashes: newSlice.map(line => hashLine(line, hashLength)),
      })
  }
  return diffs
}

/**
 * 小写文件扩展名 → 语法高亮语言提示。键为不带点的扩展名；未知扩展名
 * （以及 `.gitignore` 这类无扩展名点文件）返回 `undefined`，UI 按纯文本渲染。
 * 故意保持精简——常见源码、配置与标记扩展名即可。
 */
const LANG_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'ts', tsx: 'tsx', mts: 'ts', cts: 'ts',
  js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  json: 'json', jsonc: 'json',
  py: 'py', rb: 'rb', go: 'go', rs: 'rs', java: 'java',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cxx: 'cpp',
  cs: 'cs', kt: 'kotlin', swift: 'swift', php: 'php',
  sh: 'sh', bash: 'sh', zsh: 'sh',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini',
  md: 'md', markdown: 'md', mdx: 'mdx',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  sql: 'sql', xml: 'xml', lua: 'lua',
}

/**
 * 从读取路径的扩展名推导语法高亮语言提示。纯函数，扩展名大小写不敏感；
 * 点文件（无扩展名）与未知扩展名都返回 `undefined`。对 `foo.constructor`
 * 这类扩展名恰好是 Object 原型键的文件做 own-property 检查，避免继承成员
 * 落入 `lang` 字段导致工具输出校验失败。
 */
export function langFromPath(path: string): string | undefined {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  // 前导点是点文件（无扩展名），不是空扩展名。
  if (dot <= 0) return undefined
  const ext = base.slice(dot + 1).toLowerCase()
  return Object.hasOwn(LANG_BY_EXTENSION, ext) ? LANG_BY_EXTENSION[ext] : undefined
}

/**
 * 生成与 DSH 原生 `read` 一致的模型-facing envelope，并以 `LINE|HASH  内容` 展示锚点。
 * `hash` 与 `number` 在 envelope 中拼为 `LINE|HASH`，`text` 始终只保存文件正文，
 * 所以模型文本是 `1|b6a9  alpha`，UI 也能把锚点 chrome 和正文分开渲染。
 * 结构必须严格匹配 `extractReadBody` 的正则（`<content>` 前后各有一个换行），
 * 这样 `presentResult` 能在成功时把 envelope-stripped body 作为 UI content 返回；
 * 任何偏离都会让读取卡回退 generic，不抛错。
 *
 * @param path - 模型-facing 路径。
 * @param offset - 1 基窗口起始行。
 * @param lines - 窗口行（number/hash 为锚点 chrome，text 为纯文件正文）。
 * @param totalLines - 文件精确总行数。
   * @param fileMeta - 可选的模型-facing EOL/BOM 元数据；UI 读取卡仍只消费结构化行。
   * @param zhPrompt - 开启后 footer/元数据文案使用中文,默认英文。
   */
export function formatReadEnvelope(
    path: string,
    offset: number,
    lines: ReadPresentationLine[],
    totalLines: number,
    fileMeta?: { eol: string; bom: boolean },
    zhPrompt?: boolean,
  ): string {
    const endLine = lines.length > 0 ? lines[lines.length - 1].number : Math.max(0, offset - 1)
    const footer = endLine < totalLines
      ? zhPrompt === true
        ? `(已展示第 ${offset}-${endLine} 行,共 ${totalLines} 行。使用 offset=${endLine + 1} 继续。)`
        : `(Showing lines ${offset}-${endLine} of ${totalLines}. Use offset=${endLine + 1} to continue.)`
      : zhPrompt === true
        ? `(文件结束 - 共 ${totalLines} 行)`
        : `(End of file - total ${totalLines} lines)`
    const metadata = fileMeta === undefined
      ? undefined
      : zhPrompt === true
        ? `(文件元数据: eol=${fileMeta.eol}, bom=${fileMeta.bom ? 'yes' : 'no'})`
        : `(File metadata: eol=${fileMeta.eol}, bom=${fileMeta.bom ? 'yes' : 'no'})`
  const suffix = metadata === undefined ? footer : `${metadata}\n${footer}`
  const body = lines.length > 0
    ? `${lines.map(line => `${line.number}|${line.hash}  ${line.text}`).join('\n')}\n\n${suffix}`
    : suffix
  return `<path>${path}</path>\n<type>file</type>\n<content>\n${body}\n</content>`
}

/** 与 DSH 原生 `read` 的 `presentResult` 一致的 envelope 提取正则。 */
const READ_ENVELOPE_RE = /^<path>[^\n]*<\/path>\n<type>file<\/type>\n<content>\n([\s\S]*)\n<\/content>$/u

/**
 * 从模型-facing 读取文本中提取 envelope body（含末尾换行）。envelope 不匹配
 * （路径含换行、旧回放格式或任何偏离）返回 `undefined`，调用方回退 generic。
 */
export function extractReadBody(text: string): string | undefined {
  const match = READ_ENVELOPE_RE.exec(text)
  return match === null ? undefined : match[1]
}

/** 判断一个未知值是否为合法的展示行 `{ number, hash, text }`。 */
function isPresentationLine(value: unknown): value is ReadPresentationLine {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { number, hash, text } = value as Record<string, unknown>
  return typeof number === 'number' && Number.isInteger(number) && number >= 1
    && typeof hash === 'string' && /^[0-9a-f]+$/u.test(hash)
    && typeof text === 'string'
}

/**
 * 把不透明 meta 窄化为读取卡投影。除形状外还强制语义契约：`offset` 为 1 基整数、
 * `totalLines` 为非负整数、行号必须 1 基、严格递增且不超过 `totalLines`。
 * 任何偏离都返回 `undefined`，让旧回放或畸形日志回退 generic，而不是渲染错位卡片。
 */
export function narrowReadMeta(meta: unknown): ReadMeta | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const { path, offset, lines, totalLines, lang } = meta as Record<string, unknown>
  if (typeof path !== 'string' || typeof totalLines !== 'number' || typeof offset !== 'number') return undefined
  if (!Number.isInteger(offset) || offset < 1) return undefined
  if (!Number.isInteger(totalLines) || totalLines < 0) return undefined
  if (!Array.isArray(lines) || !lines.every(isPresentationLine)) return undefined
  if (lang !== undefined && typeof lang !== 'string') return undefined
  let previous = offset - 1
  for (const { number } of lines) {
    if (number <= previous || number > totalLines) return undefined
    previous = number
  }
  return { path, offset, lines, totalLines, ...(lang === undefined ? {} : { lang }) }
}

/**
 * 校验哈希数组长度与文本行数一致。哈希数组长度是行数真值（生成侧从快照 slice 映射）；
 * 文本为空字符串时无法区分“无行”与“单个空行”（两者 join 结果都是 ''），因此额外兼容 0 行形状。
 */
function hashesMatchLines(text: string, hashes: string[] | undefined): boolean {
  if (hashes === undefined) return true
  return hashes.length === text.split('\n').length || (text === '' && hashes.length === 0)
}

/** 判断一个未知值是否为合法的 {@link FileDiff}。 */
function isFileDiff(value: unknown): value is FileDiff {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { path, oldText, newText, oldHashes, newHashes } = value as Record<string, unknown>
  const hashes = (candidate: unknown): candidate is string[] | undefined =>
    candidate === undefined || (Array.isArray(candidate)
      && candidate.every(hash => typeof hash === 'string' && /^[0-9a-f]{3,16}$/u.test(hash)))
  return typeof path === 'string'
    && (oldText === null || typeof oldText === 'string')
    && typeof newText === 'string'
    && hashes(oldHashes)
    && hashes(newHashes)
    && (oldText === null
      ? oldHashes === undefined || oldHashes.length === 0
      : hashesMatchLines(oldText, oldHashes))
    && hashesMatchLines(newText, newHashes)
}

/**
 * 把不透明 meta 窄化为非空文件 diff 列表。畸形 meta 返回 `undefined`，
 * 让回放回退 generic，而不是渲染虚假的 diff 卡。
 */
export function narrowDiffsMeta(meta: unknown): FileDiff[] | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const diffs = (meta as Record<string, unknown>).diffs
  if (!Array.isArray(diffs) || diffs.length === 0 || !diffs.every(isFileDiff)) return undefined
  return diffs
}
