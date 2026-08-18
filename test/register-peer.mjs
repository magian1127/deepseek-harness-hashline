import { createRequire, registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

const testRequire = createRequire(new URL('./package.json', import.meta.url))
const peerUrls = new Map([
  ['@deepseek-ai/dsh-llm', pathToFileURL(testRequire.resolve('@deepseek-ai/dsh-llm')).href],
  ['@deepseek-ai/schemastery', pathToFileURL(testRequire.resolve('@deepseek-ai/schemastery')).href],
])

registerHooks({
  resolve(specifier, context, nextResolve) {
    const url = peerUrls.get(specifier)
    if (url !== undefined) return { shortCircuit: true, url }
    return nextResolve(specifier, context)
  },
})
