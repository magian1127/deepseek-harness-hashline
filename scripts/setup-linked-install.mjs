import { lstat, mkdir, readFile, realpath, rm, symlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dshRoot = resolve(process.argv[2] ?? process.env.DSH_CHECKOUT ?? '')

if (dshRoot === pluginRoot || (process.argv[2] === undefined && process.env.DSH_CHECKOUT === undefined)) {
  throw new Error('Pass the DeepSeek Harness checkout path: npm run setup:link -- "D:/path/to/deepseek-harness"')
}

const peers = [
  ['@deepseek-ai/dsh-llm', join(dshRoot, 'packages', 'llm', 'llm')],
  ['@deepseek-ai/schemastery', join(dshRoot, 'vendor', 'schemastery')],
]

async function packageNameAt(target) {
  const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))
  return manifest.name
}

for (const [name, target] of peers) {
  const actualName = await packageNameAt(target)
  if (actualName !== name) throw new Error(`Expected ${name} at ${target}, found ${actualName ?? 'an unnamed package'}`)

  const link = join(pluginRoot, 'node_modules', ...name.split('/'))
  await mkdir(dirname(link), { recursive: true })
  try {
    const current = await lstat(link)
    if (!current.isSymbolicLink()) throw new Error(`${link} exists and is not a link; remove it manually before retrying`)
    if (resolve(await realpath(link)) === resolve(await realpath(target))) continue
    await rm(link, { force: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
}

console.log(`Linked DSH runtime peers from ${dshRoot}`)
