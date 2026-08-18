import assert from 'node:assert/strict'
import test from 'node:test'
import { HarnessError } from '@deepseek-ai/dsh-llm'

import { Config, apply } from '../lib/index.js'

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function createHarness(options = {}) {
  let content = options.content ?? 'a\nb\n'
  let versionNumber = 1
  let exists = options.exists ?? true
  let changeDuringFirstRead = options.changeDuringFirstRead ?? false
  let settingsState
  const target = { targetKey: 'file-1', displayPath: 'C:\\workspace\\sample.txt' }
  const tools = new Map()
  const sections = new Map()
  const observations = []
  const resolveCalls = []
  const writeCalls = []
  const waterfallCalls = []
  const policyRequests = []
  const approvalRequests = []
  const settingsRegistrations = []
  const settingsWatchers = new Set()
  const eventHandlers = new Map()
  const effectDisposers = []
  const liveAgents = []
  const warnings = []
  const builtInEdit = { name: 'edit', source: 'tool-fs' }
  const builtInRead = { name: 'read', source: 'tool-fs' }

  function dispatch(name, payload) {
    for (const handler of eventHandlers.get(name) ?? []) handler(payload)
  }

  function makeAgent(id, hiddenTools = [], announce = false) {
    const session = { header: { cwd: 'C:\\workspace', id } }
    const scoped = new Map()
    const restrictions = []
    const inheritedHidden = new Set(hiddenTools)
    const agent = { id, session }
    const scopedTools = {
      register(definition) {
        if (scoped.has(definition.name)) throw new Error(`duplicate scoped tool ${definition.name}`)
        scoped.set(definition.name, definition)
        let active = true
        return () => {
          if (!active) return
          active = false
          if (scoped.get(definition.name) === definition) scoped.delete(definition.name)
        }
      },
      restrict(filter) {
        const denied = new Set(filter.deny ?? [])
        restrictions.push(denied)
        let active = true
        return () => {
          if (!active) return
          active = false
          const index = restrictions.indexOf(denied)
          if (index >= 0) restrictions.splice(index, 1)
        }
      },
    }
    agent.ctx = {
      tools: scopedTools,
      get(name) {
        return name === 'tools' ? scopedTools : undefined
      },
    }
    agent.__scopedTools = scoped
    agent.__restrictions = restrictions
    agent.__inheritedHidden = inheritedHidden
    liveAgents.push(agent)
    if (announce) dispatch('agent/created', { agent })
    return agent
  }

  const agent = makeAgent('agent-1', options.hiddenTools)
  const exec = {
    agent,
    callId: 'call-1',
    signal: new AbortController().signal,
  }

  const fs = {
    sandboxMode: options.sandboxMode,
    async resolve(path, resolveOptions) {
      resolveCalls.push({ path, options: resolveOptions })
      return target
    },
    async stat() {
      return exists ? { type: 'file', version: `v${versionNumber}`, size: content.length } : undefined
    },
    async readText() {
      const result = content
      if (changeDuringFirstRead) {
        changeDuringFirstRead = false
        content = options.changedContent ?? 'changed\n'
        versionNumber += 1
      }
      if (options.changeDuringEveryRead) {
        content += 'x'
        versionNumber += 1
      }
      return result
    },
    async writeText(_target, nextContent, expected, signal, policy) {
      if (options.staleBeforeWrite) {
        options.staleBeforeWrite = false
        versionNumber += 1
      }
      writeCalls.push({ nextContent, expected, signal, policy })
      if (options.denyWrite) throw codedError('FS_SANDBOX_DENIED', 'denied by mock sandbox')
      if (expected?.kind === 'replaceIfVersion' && expected.version !== `v${versionNumber}`) {
        throw codedError('FS_STALE_VERSION', 'mock stale version')
      }
      const before = content
      content = nextContent
      versionNumber += 1
      return {
        operation: 'update',
        before,
        after: content.replaceAll('\r\n', '\n'),
        version: `v${versionNumber}`,
      }
    },
  }

  const policyService = options.sandboxMode === undefined
    ? undefined
    : {
        resolve(request) {
          policyRequests.push(request)
          return { mode: options.policyMode ?? options.sandboxMode, workspaceRoot: 'C:\\workspace' }
        },
      }

  const approval = {
    async request(request) {
      approvalRequests.push(request)
      return options.approvalOutcome ?? 'allowed-once'
    },
  }

  const settings = {
    register(namespace, schema, registrationOptions) {
      settingsState = { ...registrationOptions.base, ...(options.settings ?? {}) }
      const scope = {
        get: () => settingsState,
        watch(callback) {
          settingsWatchers.add(callback)
          return () => settingsWatchers.delete(callback)
        },
      }
      settingsRegistrations.push({ namespace, schema, options: registrationOptions, scope })
      return scope
    },
  }

  const ctx = {
    fs,
    settings,
    agents: {
      list: () => [...liveAgents],
    },
    logger: {
      warn(message) {
        warnings.push(message)
      },
    },
    tools: {
      register(definition) {
        if (tools.has(definition.name)) throw new Error(`duplicate tool ${definition.name}`)
        tools.set(definition.name, definition)
        let active = true
        return () => {
          if (!active) return
          active = false
          if (tools.get(definition.name) === definition) tools.delete(definition.name)
        }
      },
      get(toolName, scope) {
        if (scope?.__scopedTools?.has(toolName)) return scope.__scopedTools.get(toolName)
        if (scope?.__inheritedHidden?.has(toolName)) return undefined
        if (scope?.__restrictions?.some(denied => denied.has(toolName))) return undefined
        if (toolName === 'edit') return options.builtinEdit === false ? undefined : builtInEdit
        if (toolName === 'read') return options.builtinRead === false ? undefined : builtInRead
        return tools.get(toolName)
      },
    },
    systemPrompt: {
      section(section) {
        if (sections.has(section.name)) throw new Error(`duplicate section ${section.name}`)
        sections.set(section.name, section)
        let active = true
        return () => {
          if (!active) return
          active = false
          if (sections.get(section.name) === section) sections.delete(section.name)
        }
      },
    },
    inject(deps, callback) {
      if (deps.includes('hmr') && options.hmr !== undefined) callback(ctx)
    },
    get(name) {
      if (name === 'sandboxPolicy') return policyService
      if (name === 'approval') return approval
      if (name === 'hmr') return options.hmr
      return undefined
    },
    effect(setup) {
      const dispose = setup()
      if (typeof dispose === 'function') effectDisposers.push(dispose)
      return dispose
    },
    on(name, handler) {
      const handlers = eventHandlers.get(name) ?? new Set()
      handlers.add(handler)
      eventHandlers.set(name, handlers)
      const dispose = () => handlers.delete(handler)
      effectDisposers.push(dispose)
      return dispose
    },
    emit(name, ...args) {
      observations.push({ name, args })
    },
    async waterfall(name, ...args) {
      waterfallCalls.push({ name, args: args.slice(0, -1) })
      return args.at(-1)()
    },
  }

  return {
    ctx,
    tools,
    sections,
    observations,
    resolveCalls,
    writeCalls,
    waterfallCalls,
    policyRequests,
    approvalRequests,
    settingsRegistrations,
    warnings,
    exec,
    agent,
    updateSettings(patch) {
      const previous = settingsState
      settingsState = { ...settingsState, ...patch }
      for (const watcher of settingsWatchers) watcher(settingsState, previous)
    },
    createAgent(id = `agent-${liveAgents.length + 1}`, hiddenTools = []) {
      return makeAgent(id, hiddenTools, true)
    },
    removeAgent(targetAgent) {
      const index = liveAgents.indexOf(targetAgent)
      if (index >= 0) liveAgents.splice(index, 1)
      targetAgent.__scopedTools.clear()
      targetAgent.__restrictions.length = 0
      dispatch('agent/disposed', { agent: targetAgent })
    },
    viewTool(name, targetAgent = agent) {
      return ctx.tools.get(name, targetAgent)
    },
    async disposePlugin() {
      const pending = []
      while (effectDisposers.length > 0) pending.push(Promise.resolve(effectDisposers.pop()()))
      await Promise.allSettled(pending)
    },
    get content() {
      return content
    },
    set content(value) {
      content = value
      versionNumber += 1
    },
    set exists(value) {
      exists = value
    },
  }
}

async function readAnchors(harness) {
  return harness.tools.get('hashline_read').execute({ file_path: 'sample.txt' }, harness.exec)
}

test('apply 注册两个工具和一个提示词 section', () => {
  const harness = createHarness()
  apply(harness.ctx)
  assert.deepEqual([...harness.tools.keys()], ['hashline_read', 'hashline_edit'])
  assert.deepEqual([...harness.sections.keys()], ['tool:hashline'])
  assert.equal(harness.tools.get('hashline_read').isConcurrencySafe(), true)
})

test('promptGuidance=false 时不注册提示词', () => {
  const harness = createHarness()
  apply(harness.ctx, { promptGuidance: false })
  assert.equal(harness.sections.size, 0)
  assert.equal(harness.tools.size, 2)
})

test('注册显式暴露的 Hashline 持久设置命名空间', () => {
  const harness = createHarness()
  apply(harness.ctx)

  assert.equal(harness.settingsRegistrations.length, 1)
  const registration = harness.settingsRegistrations[0]
  assert.equal(registration.namespace, 'hashline')
  assert.equal(registration.options.exposeToClients, true)
  assert.equal(registration.options.applies, 'live')
  assert.deepEqual(registration.options.base, Config({}))
  assert.equal(Config({ replaceBuiltinEdit: true }).replaceBuiltinEdit, true)
  assert.throws(() => Config({ hashLength: 2 }))
})

test('全局开关实时卸载并恢复工具和提示词，但保留设置入口', () => {
  const harness = createHarness({ settings: { enabled: false } })
  apply(harness.ctx)
  assert.equal(harness.tools.size, 0)
  assert.equal(harness.sections.size, 0)
  assert.equal(harness.settingsRegistrations.length, 1)

  harness.updateSettings({ enabled: true })
  assert.deepEqual([...harness.tools.keys()], ['hashline_read', 'hashline_edit'])
  assert.deepEqual([...harness.sections.keys()], ['tool:hashline'])

  harness.updateSettings({ enabled: false })
  assert.equal(harness.tools.size, 0)
  assert.equal(harness.sections.size, 0)
})

test('数值与提示词设置实时重建工具定义', async () => {
  const harness = createHarness()
  apply(harness.ctx)
  const previousRead = harness.tools.get('hashline_read')

  harness.updateSettings({ hashLength: 8, readLimit: 5, promptGuidance: false })
  const currentRead = harness.tools.get('hashline_read')
  assert.notEqual(currentRead, previousRead)
  assert.match(currentRead.description, /8 hexadecimal/)
  assert.equal(harness.sections.size, 0)
  const result = await currentRead.execute({ file_path: 'sample.txt' }, harness.exec)
  assert.match(result.lines[0].anchor, /^1:[0-9a-f]{8}$/)
  await assert.rejects(
    currentRead.execute({ file_path: 'sample.txt', limit: 6 }, harness.exec),
    error => error.code === 'HASHLINE_INVALID_ARGUMENT',
  )
})

test('replaceBuiltinEdit 对现有 Agent 可逆遮蔽内置 read/edit', async () => {
  const harness = createHarness({ content: 'a\nb\n', settings: { replaceBuiltinEdit: true } })
  apply(harness.ctx)

  const readTool = harness.viewTool('read')
  assert.equal(readTool.name, 'read')
  assert.equal(readTool.source, undefined)
  assert.equal(harness.viewTool('hashline_read'), undefined)

  const replacement = harness.viewTool('edit')
  assert.equal(replacement.name, 'edit')
  assert.equal(replacement.source, undefined)
  assert.equal(harness.viewTool('hashline_edit'), undefined)
  assert.match(harness.sections.get('tool:hashline').text, /followed by edit/)

  const read = await readTool.execute({ file_path: 'sample.txt' }, harness.exec)
  await replacement.execute({
    file_path: 'sample.txt',
    edits: [{ set_line: { anchor: read.lines[1].anchor, new_text: 'B' } }],
  }, harness.exec)
  assert.equal(harness.content, 'a\nB\n')

  harness.updateSettings({ replaceBuiltinEdit: false })
  assert.equal(harness.viewTool('edit').source, 'tool-fs')
  assert.equal(harness.viewTool('hashline_edit').name, 'hashline_edit')
  assert.equal(harness.viewTool('read').source, 'tool-fs')
  assert.equal(harness.viewTool('hashline_read').name, 'hashline_read')
  assert.match(harness.sections.get('tool:hashline').text, /built-in edit/)
})

test('read/edit 替换覆盖后创建的 Agent，并尊重 preset 隐藏策略', () => {
  const harness = createHarness({ settings: { replaceBuiltinEdit: true } })
  apply(harness.ctx)

  const later = harness.createAgent('agent-2')
  assert.equal(harness.viewTool('edit', later).source, undefined)
  assert.equal(harness.viewTool('hashline_edit', later), undefined)
  assert.equal(harness.viewTool('read', later).source, undefined)
  assert.equal(harness.viewTool('hashline_read', later), undefined)

  const editHidden = harness.createAgent('agent-hidden-edit', ['edit'])
  assert.equal(harness.viewTool('edit', editHidden), undefined)
  assert.equal(harness.viewTool('hashline_edit', editHidden).name, 'hashline_edit')
  assert.equal(harness.viewTool('read', editHidden).source, 'tool-fs')
  assert.equal(harness.viewTool('hashline_read', editHidden).name, 'hashline_read')

  const readHidden = harness.createAgent('agent-hidden-read', ['hashline_read'])
  assert.equal(harness.viewTool('edit', readHidden).source, 'tool-fs')
  assert.equal(harness.viewTool('hashline_edit', readHidden).name, 'hashline_edit')
  assert.equal(harness.viewTool('read', readHidden).source, 'tool-fs')
  assert.equal(harness.viewTool('hashline_read', readHidden), undefined)

  const builtinReadHidden = harness.createAgent('agent-hidden-builtin-read', ['read'])
  assert.equal(harness.viewTool('edit', builtinReadHidden).source, 'tool-fs')
  assert.equal(harness.viewTool('hashline_edit', builtinReadHidden).name, 'hashline_edit')
  assert.equal(harness.viewTool('read', builtinReadHidden), undefined)
  assert.equal(harness.viewTool('hashline_read', builtinReadHidden).name, 'hashline_read')
})

test('已有 Agent scoped read/edit 冲突时保留原定义并回滚整组替换', () => {
  const harness = createHarness()
  apply(harness.ctx)

  const customRead = { name: 'read', source: 'custom-agent-read' }
  harness.agent.ctx.tools.register(customRead)

  harness.updateSettings({ replaceBuiltinEdit: true })
  assert.equal(harness.viewTool('read'), customRead)
  assert.equal(harness.viewTool('hashline_read').name, 'hashline_read')
  assert.equal(harness.viewTool('edit').source, 'tool-fs')
  assert.equal(harness.viewTool('hashline_edit').name, 'hashline_edit')
  assert.equal(harness.warnings.length, 1)
  assert.match(harness.warnings[0], /duplicate scoped tool read/)
})

test('插件卸载清理全局与 Agent scoped 副作用', () => {
  const harness = createHarness({ settings: { replaceBuiltinEdit: true } })
  apply(harness.ctx)
  assert.equal(harness.viewTool('edit').source, undefined)
  assert.equal(harness.viewTool('read').source, undefined)

  harness.disposePlugin()
  assert.equal(harness.tools.size, 0)
  assert.equal(harness.sections.size, 0)
  assert.equal(harness.viewTool('edit').source, 'tool-fs')
  assert.equal(harness.viewTool('read').source, 'tool-fs')
})

test('Host 源文件通过官方 HMR 服务热重载并随 Fiber 清理 watcher', async () => {
  const callbacks = new Map()
  const stashed = new Set()
  let reloads = 0
  let disposed = 0
  const hmr = {
    config: { root: [] },
    baseDir: 'C:\\profile',
    stashed,
    async registerConfig(filename, callback) {
      callbacks.set(filename, callback)
      callback()
      return async () => {
        callbacks.delete(filename)
        disposed += 1
      }
    },
    async partialReload() {
      reloads += 1
    },
  }
  const harness = createHarness({ hmr })
  apply(harness.ctx)
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(callbacks.size, 2)
  assert.equal(reloads, 0)
  assert.equal(stashed.size, 0)
  const indexPath = [...callbacks.keys()].find(path => path.replaceAll('\\', '/').endsWith('/lib/index.js'))
  assert.ok(indexPath)
  callbacks.get(indexPath)()
  await new Promise(resolve => setTimeout(resolve, 180))
  assert.equal(reloads, 1)
  assert.ok([...stashed].some(url => url.endsWith('/lib/index.js')))

  await harness.disposePlugin()
  assert.equal(callbacks.size, 0)
  assert.equal(disposed, 2)
})

test('hashline_read 使用会话 cwd、返回结构化锚点并记录观察', async () => {
  const harness = createHarness({ content: '\uFEFFa\r\nb\r\n' })
  apply(harness.ctx)
  const result = await readAnchors(harness)

  assert.equal(harness.resolveCalls[0].options.cwd, 'C:\\workspace')
  assert.equal(result.bom, true)
  assert.equal(result.eol, 'crlf')
  assert.equal(result.lines.length, 2)
  assert.match(result.lines[0].anchor, /^1:[0-9a-f]{4}$/)
  assert.equal(harness.observations.at(-1).name, 'fs/observed')
  assert.deepEqual(harness.observations.at(-1).args[1], { kind: 'present', version: 'v1' })
})

test('hashline_read 对读取期间变化重试并只发布稳定版本', async () => {
  const harness = createHarness({ content: 'old\n', changeDuringFirstRead: true, changedContent: 'new\n' })
  apply(harness.ctx)
  const result = await readAnchors(harness)
  assert.equal(result.lines[0].text, 'new')
  assert.deepEqual(harness.observations.at(-1).args[1], { kind: 'present', version: 'v2' })
})

test('hashline_read 在两次快照都不稳定时响亮失败', async () => {
  const harness = createHarness({ content: 'a\n', changeDuringEveryRead: true })
  apply(harness.ctx)
  await assert.rejects(readAnchors(harness), error => {
    assert.equal(error.code, 'HASHLINE_FILE_CHANGED_DURING_READ')
    return true
  })
  assert.equal(harness.observations.length, 0)
})

test('hashline_read 拒绝越界窗口和超限 limit', async () => {
  const harness = createHarness({ content: 'a\nb\n' })
  apply(harness.ctx)
  const tool = harness.tools.get('hashline_read')
  await assert.rejects(
    tool.execute({ file_path: 'sample.txt', offset: 3 }, harness.exec),
    error => error.code === 'HASHLINE_OFFSET_OUT_OF_RANGE',
  )

  const untouched = createHarness()
  apply(untouched.ctx)
  await assert.rejects(
    untouched.tools.get('hashline_read').execute({ file_path: 'sample.txt', limit: 2001 }, untouched.exec),
    error => error.code === 'HASHLINE_INVALID_ARGUMENT',
  )
  assert.equal(untouched.resolveCalls.length, 0)
})

test('缺失文件发布 absent 观察后失败', async () => {
  const harness = createHarness({ exists: false })
  apply(harness.ctx)
  await assert.rejects(readAnchors(harness), error => {
    assert.equal(error.code, 'HASHLINE_FILE_NOT_FOUND')
    return true
  })
  assert.deepEqual(harness.observations.at(-1).args[1], { kind: 'absent' })
})

test('hashline_edit 通过 write-intent 与当前版本 CAS 原子写入', async () => {
  const harness = createHarness({ content: 'a\nb\n' })
  apply(harness.ctx)
  const read = await readAnchors(harness)
  const result = await harness.tools.get('hashline_edit').execute({
    file_path: 'sample.txt',
    edits: [{ set_line: { anchor: read.lines[1].anchor, new_text: 'B' } }],
  }, harness.exec)

  assert.equal(harness.content, 'a\nB\n')
  assert.equal(harness.waterfallCalls[0].name, 'fs/write-intent')
  assert.deepEqual(harness.writeCalls[0].expected, { kind: 'replaceIfVersion', version: 'v1' })
  assert.equal(result.changed, true)
  assert.equal(result.removedLines, 1)
  assert.equal(result.addedLines, 1)
  assert.ok(result.preview.some(line => line.text === 'B'))
  assert.equal(harness.observations.at(-1).args[1].version, 'v2')
})

test('CRLF 编辑预览基于磁盘文本，返回锚点可立即继续编辑', async () => {
  const harness = createHarness({ content: '\uFEFFa\r\nb\r\n' })
  apply(harness.ctx)
  const firstRead = await readAnchors(harness)
  const firstEdit = await harness.tools.get('hashline_edit').execute({
    file_path: 'sample.txt',
    edits: [{ set_line: { anchor: firstRead.lines[1].anchor, new_text: 'B' } }],
  }, harness.exec)

  assert.equal(harness.content, '\uFEFFa\r\nB\r\n')
  assert.equal(harness.writeCalls[0].nextContent, '\uFEFFa\r\nB\r\n')
  assert.equal(firstEdit.eol, 'crlf')
  assert.equal(firstEdit.bom, true)
  const previewAnchor = firstEdit.preview.find(line => line.number === 2).anchor

  await harness.tools.get('hashline_edit').execute({
    file_path: 'sample.txt',
    edits: [{ set_line: { anchor: previewAnchor, new_text: 'C' } }],
  }, harness.exec)
  assert.equal(harness.content, '\uFEFFa\r\nC\r\n')
})

test('锚点过期时不调用 writeText', async () => {
  const harness = createHarness({ content: 'a\nb\n' })
  apply(harness.ctx)
  const read = await readAnchors(harness)
  harness.content = 'a\nchanged\n'

  await assert.rejects(harness.tools.get('hashline_edit').execute({
    file_path: 'sample.txt',
    edits: [{ set_line: { anchor: read.lines[1].anchor, new_text: 'B' } }],
  }, harness.exec), error => {
    assert.equal(error.code, 'HASHLINE_HASH_MISMATCH')
    assert.ok(error instanceof HarnessError)
    return true
  })
  assert.equal(harness.writeCalls.length, 0)
  assert.equal(harness.content, 'a\nchanged\n')
})

test('写入前并发变化映射为可恢复的 FS_STALE_VERSION', async () => {
  const harness = createHarness({ content: 'a\n', staleBeforeWrite: true })
  apply(harness.ctx)
  const read = await readAnchors(harness)

  await assert.rejects(harness.tools.get('hashline_edit').execute({
    file_path: 'sample.txt',
    edits: [{ set_line: { anchor: read.lines[0].anchor, new_text: 'A' } }],
  }, harness.exec), error => {
    assert.equal(error.code, 'FS_STALE_VERSION')
    assert.match(error.message, /hashline_read again/)
    return true
  })
  assert.equal(harness.content, 'a\n')
})

test('沙箱策略接收调用会话，解析路径和写入使用同一 workspaceRoot', async () => {
  const harness = createHarness({ content: 'a\n', sandboxMode: 'workspace-write' })
  apply(harness.ctx)
  const read = await readAnchors(harness)
  await harness.tools.get('hashline_edit').execute({
    file_path: 'sample.txt',
    edits: [{ set_line: { anchor: read.lines[0].anchor, new_text: 'A' } }],
  }, harness.exec)

  assert.equal(harness.policyRequests[0].session, harness.exec.agent.session)
  assert.equal(harness.resolveCalls.at(-1).options.cwd, 'C:\\workspace')
  assert.deepEqual(harness.writeCalls[0].policy, { mode: 'workspace-write', workspaceRoot: 'C:\\workspace' })
})

test('受限文件系统才公开升级字段', () => {
  const openHarness = createHarness()
  apply(openHarness.ctx)
  assert.equal(openHarness.tools.get('hashline_edit').parameters.properties.sandbox_permissions, undefined)

  const confinedHarness = createHarness({ sandboxMode: 'workspace-write' })
  apply(confinedHarness.ctx)
  assert.deepEqual(
    confinedHarness.tools.get('hashline_edit').parameters.properties.sandbox_permissions.enum,
    ['workspace-write', 'danger-full-access'],
  )
})

test('一次性升级先审批，再把批准模式传给写入', async () => {
  const harness = createHarness({ content: 'a\n', sandboxMode: 'workspace-write' })
  apply(harness.ctx)
  const read = await readAnchors(harness)
  await harness.tools.get('hashline_edit').execute({
    file_path: 'sample.txt',
    edits: [{ set_line: { anchor: read.lines[0].anchor, new_text: 'A' } }],
    sandbox_permissions: 'danger-full-access',
    justification: '需要修改当前工作区之外的已确认目标文件。',
  }, harness.exec)

  assert.equal(harness.approvalRequests.length, 1)
  assert.equal(harness.approvalRequests[0].toolName, 'hashline_edit')
  assert.equal(harness.writeCalls[0].policy.mode, 'danger-full-access')
})

test('沙箱拒绝映射为统一标记且不写入', async () => {
  const harness = createHarness({ content: 'a\n', sandboxMode: 'workspace-write', denyWrite: true })
  apply(harness.ctx)
  const read = await readAnchors(harness)

  await assert.rejects(harness.tools.get('hashline_edit').execute({
    file_path: 'sample.txt',
    edits: [{ set_line: { anchor: read.lines[0].anchor, new_text: 'A' } }],
  }, harness.exec), error => {
    assert.equal(error.code, 'FS_SANDBOX_DENIED')
    assert.match(error.message, /^\[sandbox: file access denied under workspace-write mode\]/)
    assert.match(error.message, /escalation available/)
    return true
  })
  assert.equal(harness.content, 'a\n')
})

test('未知参数和无效配置响亮失败', async () => {
  const harness = createHarness()
  apply(harness.ctx)
  await assert.rejects(
    harness.tools.get('hashline_read').execute({ file_path: 'sample.txt', typo: true }, harness.exec),
    error => error.code === 'HASHLINE_INVALID_ARGUMENT',
  )

  const invalidHarness = createHarness()
  assert.throws(
    () => apply(invalidHarness.ctx, { hashLength: 2 }),
    error => error.code === 'HASHLINE_INVALID_CONFIG',
  )
})

test('畸形编辑在 sandbox、审批和文件 I/O 前失败', async () => {
  const harness = createHarness({ sandboxMode: 'workspace-write' })
  apply(harness.ctx)

  await assert.rejects(harness.tools.get('hashline_edit').execute({
    file_path: 'sample.txt',
    edits: [],
    sandbox_permissions: 'danger-full-access',
    justification: '不应实际发起的审批。',
  }, harness.exec), error => error.code === 'HASHLINE_INVALID_ARGUMENT')

  assert.equal(harness.policyRequests.length, 0)
  assert.equal(harness.approvalRequests.length, 0)
  assert.equal(harness.resolveCalls.length, 0)
})

test('无 agent 编辑在策略和 I/O 前失败', async () => {
  const harness = createHarness({ content: 'a\n' })
  apply(harness.ctx)
  const read = await readAnchors(harness)
  const resolvesBeforeEdit = harness.resolveCalls.length
  const exec = { ...harness.exec, agent: undefined }

  await assert.rejects(harness.tools.get('hashline_edit').execute({
    file_path: 'sample.txt',
    edits: [{ set_line: { anchor: read.lines[0].anchor, new_text: 'A' } }],
  }, exec), error => error.code === 'HASHLINE_AGENT_REQUIRED')
  assert.equal(harness.resolveCalls.length, resolvesBeforeEdit)
  assert.equal(harness.policyRequests.length, 0)
})

test('编辑参数 schema 用 oneOf 固定四种互斥变体', () => {
  const harness = createHarness()
  apply(harness.ctx)
  const item = harness.tools.get('hashline_edit').parameters.properties.edits.items
  assert.equal(item.oneOf.length, 4)
  assert.deepEqual(item.oneOf.map(branch => branch.required[0]), [
    'set_line',
    'replace_lines',
    'insert_after',
    'replace',
  ])
  assert.ok(item.oneOf.every(branch => branch.additionalProperties === false))
})
