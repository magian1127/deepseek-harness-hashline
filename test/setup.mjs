import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const npmCli = process.env.npm_execpath
if (npmCli === undefined) throw new Error('test:setup must be invoked through npm')
const env = { ...process.env }
delete env.npm_config_allow_scripts
const result = spawnSync(process.execPath, [npmCli, 'install', '--ignore-scripts', '--include=peer'], {
  cwd: fileURLToPath(new URL('.', import.meta.url)),
  env,
  stdio: 'inherit',
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
