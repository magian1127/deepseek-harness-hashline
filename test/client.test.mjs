import assert from 'node:assert/strict'
import test from 'node:test'

function createReactHarness() {
  const state = []
  let cursor = 0

  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      const nextProps = {
        ...(props ?? {}),
        ...(children.length === 0
          ? {}
          : { children: children.length === 1 ? children[0] : children }),
      }
      if (typeof type === 'function') return type(nextProps)
      if (type === React.Fragment) return nextProps.children ?? null
      return { type, props: nextProps }
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot()
    },
    useState(initial) {
      const index = cursor
      cursor += 1
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
      return [state[index], (next) => {
        state[index] = typeof next === 'function' ? next(state[index]) : next
      }]
    },
      useEffect() {},
      useMemo(factory) { return factory() },
  }

  return {
    React,
    render(Component) {
      cursor = 0
      return Component()
    },
  }
}

function flatten(node, output = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return output
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, output)
    return output
  }
  if (typeof node === 'string' || typeof node === 'number') {
    output.push(node)
    return output
  }
  output.push(node)
  flatten(node.props?.children, output)
  return output
}

async function loadClientModule(React, primitives = {}) {
  const defaults = {
    DisclosureRow(props) {
      return React.createElement('div', {
        'data-disclosure-row': '',
        role: props.expandable && props.expandOnRowClick ? 'button' : undefined,
        tabIndex: props.expandable && props.expandOnRowClick ? 0 : undefined,
        'aria-expanded': props.expandable && props.expandOnRowClick ? props.open : undefined,
        onClick: props.expandable && props.expandOnRowClick ? props.onToggle : undefined,
        onKeyDown: props.expandable && props.expandOnRowClick ? event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); props.onToggle() }
        } : undefined,
      }, props.icon, props.title, props.collapsedContent, props.open ? props.children : null)
    },
    StateDot(props) { return React.createElement('span', { 'data-state': props.state }) },
      writeClipboard: async () => true,
    ...primitives,
  }
  let definition
  globalThis.window = {
      setTimeout() {},
    __ModuleLoader__: {
      load(value) {
        definition = value
      },
    },
  }
  try {
    await import(`../lib/client.js?test=${Date.now()}`)
  } finally {
    delete globalThis.window
  }
  assert.ok(definition)
  return {
    definition,
    exports: definition.factory((specifier) => {
        if (specifier === 'react') return React
        if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return defaults
        assert.fail('unexpected client external: ' + specifier)
      }),
    }
}

test('客户端 bundle 绑定 Hashline settings 并注册插件配置卡片', async () => {
  const reactHarness = createReactHarness()
  const { definition, exports } = await loadClientModule(reactHarness.React)
  const localeRegistrations = []
  const slotRegistrations = []
  const boundNamespaces = []
  const setCalls = []
  const unsetCalls = []
  const snapshot = {
    status: 'ready',
    value: {
      enabled: true,
      replaceBuiltinEdit: false,
      promptGuidance: true,
      hashLength: 4,
      readLimit: 2000,
      maxLineLength: 500,
      contextLines: 2,
    },
    base: {
      enabled: true,
      replaceBuiltinEdit: false,
      promptGuidance: true,
      hashLength: 4,
      readLimit: 2000,
      maxLineLength: 500,
      contextLines: 2,
    },
    user: {},
    revision: 0,
    writable: true,
    mode: 'host',
  }
  let acceptWrites = true
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    async set(field, value) {
      setCalls.push([field, value])
      if (acceptWrites) {
        snapshot.value = { ...snapshot.value, [field]: value }
        snapshot.user = { ...snapshot.user, [field]: value }
        snapshot.revision += 1
      }
    },
    async unset(field) {
      unsetCalls.push(field)
      if (acceptWrites) {
        const { [field]: _removed, ...remaining } = snapshot.user
        snapshot.user = remaining
        snapshot.value = { ...snapshot.value, [field]: snapshot.base[field] }
        snapshot.revision += 1
      }
    },
  }
  const ctx = {
    locale: {
      bind: () => key => key,
      register(namespace, dictionaries) {
        localeRegistrations.push({ namespace, dictionaries })
        return () => {}
      },
    },
    settingsScope: {
      bind(spec) {
        boundNamespaces.push(spec.namespace)
        return scope
      },
    },
    slots: {
      inject(name, factory) {
        assert.ok(name === 'settings.plugin.item' || name === 'tool.call.toolview')
        const effect = factory()
        if (effect !== null && typeof effect === 'object' && Symbol.iterator in effect) {
          const disposers = [...effect]
          return () => { for (const dispose of disposers.reverse()) dispose?.() }
        }
        return effect
      },
      register(options, Component) {
        slotRegistrations.push({ options, Component })
        return () => {}
      },
    },
    effect(setup) {
      return setup()
    },
  }

  assert.equal(definition.id, 'deepseek-harness-hashline')
  assert.deepEqual(exports.inject, ['slots', 'locale', 'connection', 'remote', 'settingsScope'])
  exports.apply(ctx)
  assert.deepEqual(boundNamespaces, ['hashline'])
  assert.equal(localeRegistrations[0].namespace, 'settings.hashline')
  assert.ok(localeRegistrations[0].dictionaries.zh)
  assert.ok(localeRegistrations[0].dictionaries.en)
  const zhDictionary = localeRegistrations[0].dictionaries.zh
  const enDictionary = localeRegistrations[0].dictionaries.en
  assert.deepEqual(Object.keys(zhDictionary).sort(), Object.keys(enDictionary).sort())
  assert.equal(zhDictionary.title, '哈希锚点编辑')
  assert.equal(zhDictionary.replaceBuiltinEdit, '替换内置读写')
  assert.equal(enDictionary.title, 'Hashline editing')
  assert.equal(enDictionary.replaceBuiltinEdit, 'Replace built-in read/edit')
  assert.equal(enDictionary.save, 'Save')
  assert.equal(slotRegistrations.length, 3)
  assert.deepEqual(slotRegistrations[0].options, {
    name: 'settings.plugin.item',
    key: 'hashline',
    locale: 'settings.hashline',
  })

  assert.deepEqual(slotRegistrations.slice(1).map(item => item.options), [
    { name: 'tool.call.toolview', key: 'hashline_read', locale: 'settings.hashline' },
    { name: 'tool.call.toolview', key: 'hashline_edit', locale: 'settings.hashline' },
  ])
  const Card = slotRegistrations[0].Component
  let tree = reactHarness.render(Card)
  assert.equal(tree.type, 'li')
  assert.equal(tree.props['data-hashline-settings'], '')
  let nodes = flatten(tree)
  const header = nodes.find(node => node?.type === 'button' && node.props['aria-expanded'] === false)
  assert.ok(header)
  header.props.onClick()

  tree = reactHarness.render(Card)
  nodes = flatten(tree)
  assert.equal(nodes.filter(node => node?.type === 'input' && node.props.type === 'checkbox').length, 4)
  assert.equal(nodes.filter(node => node?.type === 'input' && node.props.type === 'number').length, 4)

  const enabled = nodes.find(node => node?.type === 'input' && node.props['aria-label'] === 'enabled')
  enabled.props.onChange({ target: { checked: false } })
  tree = reactHarness.render(Card)
  nodes = flatten(tree)
  const save = nodes.find(node => node?.type === 'button' && node.props.children === 'save')
  assert.ok(save)
  assert.equal(save.props.disabled, false)
  save.props.onClick()
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(setCalls, [['enabled', false]])
  assert.deepEqual(unsetCalls, [])

  acceptWrites = false
  tree = reactHarness.render(Card)
  nodes = flatten(tree)
  const rejectedEnabled = nodes.find(node => node?.type === 'input' && node.props['aria-label'] === 'enabled')
  rejectedEnabled.props.onChange({ target: { checked: true } })
  tree = reactHarness.render(Card)
  nodes = flatten(tree)
  const rejectedSave = nodes.find(node => node?.type === 'button' && node.props.children === 'save')
  rejectedSave.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  tree = reactHarness.render(Card)
  nodes = flatten(tree)
  assert.ok(nodes.some(node => typeof node === 'string' && node.includes('saveNotApplied')))
})

test('替换内置 toolview 使用低优先级阴影并可逆清理', async () => {
  const reactHarness = createReactHarness()
  const { exports } = await loadClientModule(reactHarness.React)
  let snapshot = {
    status: 'ready', value: { enabled: true, replaceBuiltinEdit: true },
    base: {}, user: {}, revision: 0, writable: false, mode: 'host',
  }
  const listeners = new Set()
  const registrations = []
  const disposed = []
  const scope = {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    set: async () => {}, unset: async () => {},
  }
  const ctx = {
    locale: { bind: () => key => key, register: () => () => {} },
    settingsScope: { bind: () => scope },
    slots: {
      inject: (_name, factory) => {
        const effect = factory()
        if (effect !== null && typeof effect === 'object' && Symbol.iterator in effect) {
          const disposers = [...effect]
          return () => { for (const dispose of disposers.reverse()) dispose?.() }
        }
        return effect
      },
      register(options, Component) {
        registrations.push({ options, Component })
        return () => { disposed.push(options) }
      },
    },
    effect: setup => setup(),
  }
  exports.apply(ctx)
  assert.deepEqual(registrations.filter(item => item.options.key === 'read' || item.options.key === 'edit').map(item => item.options), [
    { name: 'tool.call.toolview', key: 'read', priority: -100, locale: 'settings.hashline' },
    { name: 'tool.call.toolview', key: 'edit', priority: -100, locale: 'settings.hashline' },
  ])
  snapshot = { ...snapshot, value: { enabled: true, replaceBuiltinEdit: false }, revision: 1 }
  for (const listener of listeners) listener()
  assert.deepEqual(disposed.map(options => options.key), ['edit', 'read'])
})
test('Hashline 读取 toolview 复用原生 ReadBlock 并把完整 LINE|HASH 传给 gutter', async () => {
  const reactHarness = createReactHarness()
  let readBlockProps
  const { exports } = await loadClientModule(reactHarness.React, {
    ReadBlock(props) {
      readBlockProps = props
      return { type: 'native-read-block', props }
    },
  })
  const registrations = []
  const ctx = {
    locale: { bind: () => key => key, register: () => () => {} },
    settingsScope: {
      bind: () => ({
        getSnapshot: () => ({ status: 'ready', value: {}, base: {}, user: {}, revision: 0, writable: false, mode: 'host' }),
        subscribe: () => () => {}, set: async () => {}, unset: async () => {},
      }),
    },
    styles: { insert: () => () => {} },
    slots: {
      inject: (_name, factory) => {
        const effect = factory()
        if (effect !== null && typeof effect === 'object' && Symbol.iterator in effect) {
          const disposers = [...effect]
          return () => { for (const dispose of disposers.reverse()) dispose?.() }
        }
        return effect
      },
      register(options, Component) {
        registrations.push({ options, Component })
        return () => {}
      },
    },
    effect: setup => setup(),
  }
  exports.apply(ctx)
  const ReadRow = registrations.find(item => item.options.key === 'hashline_read').Component
  const block = {
    kind: 'tool-result', callId: 'call-1', isError: false,
    call: { name: 'hashline_read', argsRaw: JSON.stringify({ file_path: 'demo.ts' }) },
    meta: {
      path: 'demo.ts', offset: 1, totalLines: 1, lang: 'ts',
      lines: [{ number: 1, hash: 'b6a9', text: 'const alpha = 1' }],
    },
  }
  let tree = reactHarness.render(() => ReadRow({
    callId: 'call-1', toolName: 'hashline_read', block, openFile: () => {},
  }))
  let nodes = flatten(tree)
  const header = nodes.find(node => node?.props?.['aria-expanded'] === false)
  assert.ok(header)
  header.props.onClick()
  tree = reactHarness.render(() => ReadRow({
    callId: 'call-1', toolName: 'hashline_read', block, openFile: () => {},
  }))
  assert.equal(tree.props['data-tool'], 'hashline_read')
  assert.ok(readBlockProps)
  assert.equal(readBlockProps.label, 'demo.ts')
  assert.equal(readBlockProps.lang, 'ts')
  assert.equal(readBlockProps.maxLines, 8)
  // ReadBlock 契约：chrome 文案经必需 labels 传入（缺省在展开时抛 TypeError），
  // 定位由外层包裹元素承担而不是 style prop。
  assert.equal(readBlockProps.style, undefined)
  assert.equal(readBlockProps.labels.copy, 'copy')
  assert.equal(readBlockProps.labels.copied, 'copied')
  assert.equal(readBlockProps.labels.collapse, 'collapse')
  assert.equal(readBlockProps.labels.collapseAria, 'read.collapseAria')
  assert.equal(readBlockProps.labels.window(1, 2), 'read.window')
  assert.equal(readBlockProps.labels.expandAria(3), 'read.expandAria')
  assert.equal(readBlockProps.labels.expand(3), 'read.expandRest')
  assert.deepEqual(readBlockProps.lines, [{ number: '1|b6a9', text: 'const alpha = 1' }])
  // 注册声明 locale 后框架注入 t 座位；注入时 labels 优先采用注入的翻译。
  let injectedLabels
  reactHarness.render(() => ReadRow({
    callId: 'call-1', toolName: 'hashline_read', block, openFile: () => {},
    t: key => `zh:${key}`,
  }))
  injectedLabels = readBlockProps.labels
  assert.equal(injectedLabels.copy, 'zh:copy')
  assert.equal(injectedLabels.window(3, 9), 'zh:read.window')

  // Host 半边尚未热重载时的旧 `{ number, text: '|HASH  正文' }` 投影也要正常显示。
  block.meta.lines = [{ number: 1, text: '|b6a9  const alpha = 1' }]
  readBlockProps = undefined
  reactHarness.render(() => ReadRow({
    callId: 'call-1', toolName: 'hashline_read', block, openFile: () => {},
  }))
  assert.deepEqual(readBlockProps.lines, [{ number: '1|b6a9', text: 'const alpha = 1' }])
})
test('Hashline 编辑 toolview 把 -|旧HASH / +|新HASH 作为灰色不可选 gutter', async () => {
  const reactHarness = createReactHarness()
  const clipboard = []
  let resolveClipboard
  const { exports } = await loadClientModule(reactHarness.React, {
    writeClipboard: text => { clipboard.push(text); return new Promise(resolve => { resolveClipboard = resolve }) },
  })
  const registrations = []
  const ctx = {
    locale: { bind: () => key => key, register: () => () => {} },
    settingsScope: { bind: () => ({
      getSnapshot: () => ({ status: 'ready', value: {}, base: {}, user: {}, revision: 0, writable: false, mode: 'host' }),
      subscribe: () => () => {}, set: async () => {}, unset: async () => {},
    }) },
    slots: {
      inject: (_name, factory) => {
        const effect = factory()
        if (effect !== null && typeof effect === 'object' && Symbol.iterator in effect) {
          const disposers = [...effect]
          return () => { for (const dispose of disposers.reverse()) dispose?.() }
        }
        return effect
      },
      register(options, Component) { registrations.push({ options, Component }); return () => {} },
    },
    effect: setup => setup(),
  }
  exports.apply(ctx)
  const EditRow = registrations.find(item => item.options.key === 'hashline_edit').Component
  const block = {
    kind: 'tool-result', callId: 'edit-1', isError: false,
    call: { name: 'hashline_edit', argsRaw: JSON.stringify({ file_path: 'demo.ts' }) },
    meta: { diffs: [{
      path: 'demo.ts', oldText: 'const beta = 2', newText: 'const beta = 3',
      oldHashes: ['ab9b'], newHashes: ['8359'],
    }] },
  }
  let tree = reactHarness.render(() => EditRow({ callId: 'edit-1', toolName: 'hashline_edit', block, openFile: () => {} }))
  let nodes = flatten(tree)
  const header = nodes.find(node => node?.props?.['aria-expanded'] === false)
  assert.ok(header)
  header.props.onClick()
  tree = reactHarness.render(() => EditRow({ callId: 'edit-1', toolName: 'hashline_edit', block, openFile: () => {} }))
  nodes = flatten(tree)
  assert.equal(tree.props['data-tool'], 'hashline_edit')
  const oldGutter = nodes.find(node => node?.type === 'span' && node.props.children === '-|ab9b  ')
  const newGutter = nodes.find(node => node?.type === 'span' && node.props.children === '+|8359  ')
  assert.equal(oldGutter.props['aria-hidden'], true)
  assert.equal(newGutter.props['aria-hidden'], true)
  assert.equal(oldGutter.props.style.userSelect, 'none')
  assert.equal(newGutter.props.style.userSelect, 'none')
  assert.equal(oldGutter.props.style.color, 'var(--dsw-alias-label-tertiary)')
  assert.ok(nodes.some(node => node?.type === 'span' && node.props.children === 'const beta = 2'))
  assert.ok(nodes.some(node => node?.type === 'span' && node.props.children === 'const beta = 3'))
  const copy = nodes.find(node => node?.type === 'button' && node.props.children === '复制')
  copy.props.onClick()
  // 路径已移入 banner,复制文本不再含路径行,只保留纯 diff 行。
  assert.deepEqual(clipboard, ['- const beta = 2\n+ const beta = 3'])
  resolveClipboard(false)
  await Promise.resolve()
})
test('Hashline 读取 toolview 对畸形行号回放安全回退', async () => {
  const reactHarness = createReactHarness()
  const { exports } = await loadClientModule(reactHarness.React, {
    ReadBlock() { throw new Error('畸形回放不得进入 ReadBlock') },
  })
  const registrations = []
  const ctx = {
    locale: { bind: () => key => key, register: () => () => {} },
    settingsScope: { bind: () => ({
      getSnapshot: () => ({ status: 'ready', value: {}, base: {}, user: {}, revision: 0, writable: false, mode: 'host' }),
      subscribe: () => () => {}, set: async () => {}, unset: async () => {},
    }) },
    styles: { insert: () => () => {} },
    slots: {
      inject: (_name, factory) => {
        const effect = factory()
        if (effect !== null && typeof effect === 'object' && Symbol.iterator in effect) {
          const disposers = [...effect]
          return () => { for (const dispose of disposers.reverse()) dispose?.() }
        }
        return effect
      },
      register(options, Component) { registrations.push({ options, Component }); return () => {} },
    },
    effect: setup => setup(),
  }
  exports.apply(ctx)
  const ReadRow = registrations.find(item => item.options.key === 'hashline_read').Component
  const block = {
    kind: 'tool-result', callId: 'call-invalid', isError: false,
    call: { name: 'hashline_read', argsRaw: '{}' },
    meta: { path: 'bad.txt', offset: 1, totalLines: 2, lines: [
      { number: 2, hash: 'aaaa', text: 'two' },
      { number: 1, hash: 'bbbb', text: 'one' },
    ] },
  }
  const tree = reactHarness.render(() => ReadRow({ callId: 'call-invalid', toolName: 'hashline_read', block, openFile: () => {} }))
  const nodes = flatten(tree)
  assert.ok(nodes.some(node => node?.props?.['data-state'] === 'done'))
  assert.ok(!nodes.some(node => node?.props?.['aria-expanded'] !== undefined))
})

test('Hashline 编辑 toolview 对失败结果可展开并展示错误文本', async () => {
  const reactHarness = createReactHarness()
  const { exports } = await loadClientModule(reactHarness.React)
  const registrations = []
  const ctx = {
    locale: { bind: () => key => key, register: () => () => {} },
    settingsScope: { bind: () => ({
      getSnapshot: () => ({ status: 'ready', value: {}, base: {}, user: {}, revision: 0, writable: false, mode: 'host' }),
      subscribe: () => () => {}, set: async () => {}, unset: async () => {},
    }) },
    slots: {
      inject: (_name, factory) => {
        const effect = factory()
        if (effect !== null && typeof effect === 'object' && Symbol.iterator in effect) {
          const disposers = [...effect]
          return () => { for (const dispose of disposers.reverse()) dispose?.() }
        }
        return effect
      },
      register(options, Component) { registrations.push({ options, Component }); return () => {} },
    },
    effect: setup => setup(),
  }
  exports.apply(ctx)
  const EditRow = registrations.find(item => item.options.key === 'hashline_edit').Component
  const message = 'Error: edit: overlapping edits (replace_lines 1101..1103 vs replace_lines 1102..1103); no edit was applied'
  const block = {
    kind: 'tool-result', callId: 'edit-err', isError: true,
    call: { name: 'hashline_edit', argsRaw: JSON.stringify({ file_path: 'src/index.ts' }) },
    content: [{ type: 'text', text: message }],
  }
  const props = { callId: 'edit-err', toolName: 'hashline_edit', block, openFile: () => {} }
  // 失败结果必须可展开（修复前 expandable=false，点缩放无效果）。
  const collapsed = reactHarness.render(() => EditRow(props))
  const collapsedNodes = flatten(collapsed)
  const header = collapsedNodes.find(node => node?.props?.['aria-expanded'] === false)
  assert.ok(header, '失败结果应当可展开（aria-expanded 存在）')
  // 折叠摘要应带错误文本第一行，且用与原生 ToolRow 一致的状态错误色（而非 label-error）。
  assert.ok(collapsedNodes.some(node => node?.type === 'span' && node.props.style?.color === 'var(--dsw-alias-state-error-primary)' && String(node.props.children).includes('overlapping edits')))
    // 错误行折叠摘要只显示错误首行,不含路径链接(路径在展开体查看,避免标题过长)。
    assert.ok(!collapsedNodes.some(node => node?.type === 'button' && node.props.children === 'src/index.ts'), '错误折叠摘要不应含文件路径链接')
  // 对齐原生 ToolRow：根节点带 data-variant，且有 screen-reader 状态文本（英文，交给 dsh-zh 改写）。
  assert.equal(collapsed.props['data-variant'], 'edit')
  assert.ok(collapsedNodes.some(node => node?.type === 'span' && node.props.style?.position === 'absolute' && node.props.children === 'Failed'))
  // 展开后 body 应展示完整错误文本。
  header.props.onClick()
  const expanded = reactHarness.render(() => EditRow(props))
  const expandedNodes = flatten(expanded)
    // 展开后 body 应对齐原生 ioCard：OUT 标签 + data-error 的完整错误文本，顶部带文件路径行。
    assert.ok(expandedNodes.some(node => node?.type === 'span' && node.props['data-error'] === true && node.props.children === message))
    assert.ok(expandedNodes.some(node => node?.type === 'span' && node.props.children === 'OUT'))
    assert.ok(expandedNodes.some(node => node?.type === 'div' && node.props.style?.fontFamily === 'var(--ds-font-family-code)' && node.props.children === 'src/index.ts'), '错误展开体顶部应有复刻原生样式的文件路径行')
})
test('PTC 子调用的读取行（无 meta）可展开并以 OUT 文本回退', async () => {
  const reactHarness = createReactHarness()
  const { exports } = await loadClientModule(reactHarness.React)
  const registrations = []
  const ctx = {
    locale: { bind: () => key => key, register: () => () => {} },
    settingsScope: { bind: () => ({
      getSnapshot: () => ({ status: 'ready', value: {}, base: {}, user: {}, revision: 0, writable: false, mode: 'host' }),
      subscribe: () => () => {}, set: async () => {}, unset: async () => {},
    }) },
    slots: {
      inject: (_name, factory) => {
        const effect = factory()
        if (effect !== null && typeof effect === 'object' && Symbol.iterator in effect) {
          const disposers = [...effect]
          return () => { for (const dispose of disposers.reverse()) dispose?.() }
        }
        return effect
      },
      register(options, Component) { registrations.push({ options, Component }); return () => {} },
    },
    effect: setup => setup(),
  }
  exports.apply(ctx)
  const ReadRow = registrations.find(item => item.options.key === 'hashline_read').Component
  const envelope = '<path>demo.ts</path>\n<type>file</type>\n<content>\n1|b6a9  const alpha = 1\n\n(End of file - total 1 lines)\n</content>'
  // PTC（run_code 程序模式）子调用投影：tool/code-dispatch 事件不携带 meta，
  // 成功结果的 content 只有 envelope 文本。
  const block = {
    kind: 'tool-result', callId: 'call-1:code:1', isError: false,
    parentCallId: 'call-1',
    call: { name: 'read', argsRaw: JSON.stringify({ file_path: 'demo.ts' }) },
    content: [{ type: 'text', text: envelope }],
  }
  const props = { callId: 'call-1:code:1', toolName: 'read', block, openFile: () => {} }
  const collapsed = reactHarness.render(() => ReadRow(props))
  const collapsedNodes = flatten(collapsed)
  // 修复前：无 meta 且非错误 → expandable=false，行不可展开（aria-expanded 不存在）。
  const header = collapsedNodes.find(node => node?.props?.['aria-expanded'] === false)
  assert.ok(header, '无 meta 的成功子调用应当可展开（aria-expanded 存在）')
  header.props.onClick()
  const expanded = reactHarness.render(() => ReadRow(props))
  const expandedNodes = flatten(expanded)
  // 展开体回退为 OUT 文本（不带错误标记）。
  assert.ok(expandedNodes.some(node => node?.type === 'span' && node.props.children === 'OUT'))
  assert.ok(expandedNodes.some(node => node?.type === 'span' && node.props.children === envelope))
  assert.ok(!expandedNodes.some(node => node?.props?.['data-error'] === true))
})
test('PTC 子调用的编辑行（无 meta）可展开并以 OUT 文本回退', async () => {
  const reactHarness = createReactHarness()
  const { exports } = await loadClientModule(reactHarness.React)
  const registrations = []
  const ctx = {
    locale: { bind: () => key => key, register: () => () => {} },
    settingsScope: { bind: () => ({
      getSnapshot: () => ({ status: 'ready', value: {}, base: {}, user: {}, revision: 0, writable: false, mode: 'host' }),
      subscribe: () => () => {}, set: async () => {}, unset: async () => {},
    }) },
    slots: {
      inject: (_name, factory) => {
        const effect = factory()
        if (effect !== null && typeof effect === 'object' && Symbol.iterator in effect) {
          const disposers = [...effect]
          return () => { for (const dispose of disposers.reverse()) dispose?.() }
        }
        return effect
      },
      register(options, Component) { registrations.push({ options, Component }); return () => {} },
    },
    effect: setup => setup(),
  }
  exports.apply(ctx)
  const EditRow = registrations.find(item => item.options.key === 'hashline_edit').Component
  const summary = 'edit: applied 1 edit(s) to demo.ts; lines removed=1, lines added=1\nUpdated anchors:\n2|c31d|const beta = 3'
  const block = {
    kind: 'tool-result', callId: 'edit-1:code:2', isError: false,
    parentCallId: 'edit-1',
    call: { name: 'edit', argsRaw: JSON.stringify({ file_path: 'demo.ts' }) },
    content: [{ type: 'text', text: summary }],
  }
  const props = { callId: 'edit-1:code:2', toolName: 'edit', block, openFile: () => {} }
  const collapsed = reactHarness.render(() => EditRow(props))
  const collapsedNodes = flatten(collapsed)
  const header = collapsedNodes.find(node => node?.props?.['aria-expanded'] === false)
  assert.ok(header, '无 meta 的成功子调用编辑行应当可展开')
  header.props.onClick()
  const expanded = reactHarness.render(() => EditRow(props))
  const expandedNodes = flatten(expanded)
  assert.ok(expandedNodes.some(node => node?.type === 'span' && node.props.children === 'OUT'))
  assert.ok(expandedNodes.some(node => node?.type === 'span' && node.props.children === summary))
})
test('运行中的读取/编辑子调用不显示展开箭头（对齐原生 previewChevron 语义）', async () => {
  const reactHarness = createReactHarness()
  const { exports } = await loadClientModule(reactHarness.React)
  const registrations = []
  const ctx = {
    locale: { bind: () => key => key, register: () => () => {} },
    settingsScope: { bind: () => ({
      getSnapshot: () => ({ status: 'ready', value: {}, base: {}, user: {}, revision: 0, writable: false, mode: 'host' }),
      subscribe: () => () => {}, set: async () => {}, unset: async () => {},
    }) },
    slots: {
      inject: (_name, factory) => {
        const effect = factory()
        if (effect !== null && typeof effect === 'object' && Symbol.iterator in effect) {
          const disposers = [...effect]
          return () => { for (const dispose of disposers.reverse()) dispose?.() }
        }
        return effect
      },
      register(options, Component) { registrations.push({ options, Component }); return () => {} },
    },
    effect: setup => setup(),
  }
  exports.apply(ctx)
  const ReadRow = registrations.find(item => item.options.key === 'hashline_read').Component
  const running = {
    callId: 'call-1:code:1', parentCallId: 'call-1', name: 'read',
    argsRaw: JSON.stringify({ file_path: 'demo.ts' }), subCalls: [],
  }
  const collapsed = reactHarness.render(() => ReadRow({
    callId: 'call-1:code:1', toolName: 'read', block: running, openFile: () => {},
  }))
  const nodes = flatten(collapsed)
  // 修复前 previewChevron 恒为 true：无展开能力的行也显示 hover 箭头（死箭头）。
  assert.ok(!nodes.some(node => node?.props?.['aria-expanded'] !== undefined))
})
test('客户端配置卡片包含全局、替换、提示词、中文化和四个数值字段', async () => {
  const reactHarness = createReactHarness()
  const { exports } = await loadClientModule(reactHarness.React)
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('../lib/client.js', import.meta.url), 'utf8'))

  for (const field of [
    'enabled',
    'replaceBuiltinEdit',
    'promptGuidance',
    'zhPrompt',
    'hashLength',
    'readLimit',
    'maxLineLength',
    'contextLines',
  ]) {
    assert.match(source, new RegExp(`['"]${field}['"]`))
  }
  assert.equal(typeof exports.apply, 'function')
})
