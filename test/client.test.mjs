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

async function loadClientModule(React) {
  let definition
  globalThis.window = {
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
      assert.equal(specifier, 'react')
      return React
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
        assert.equal(name, 'settings.plugin.item')
        return factory()
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
  const dictionaries = [localeRegistrations[0].dictionaries.zh, localeRegistrations[0].dictionaries.en]
  for (const dictionary of dictionaries) {
    assert.ok(Object.values(dictionary).every(value => !/[A-Za-z]/.test(value)))
  }
  assert.equal(localeRegistrations[0].dictionaries.zh.replaceBuiltinEdit, '替换内置读写')
  assert.equal(localeRegistrations[0].dictionaries.en.replaceBuiltinEdit, '替换内置读写')
  assert.equal(slotRegistrations.length, 1)
  assert.deepEqual(slotRegistrations[0].options, {
    name: 'settings.plugin.item',
    key: 'hashline',
    locale: 'settings.hashline',
  })

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
  assert.equal(nodes.filter(node => node?.type === 'input' && node.props.type === 'checkbox').length, 3)
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

test('客户端配置卡片包含全局、替换、提示词和四个数值字段', async () => {
  const reactHarness = createReactHarness()
  const { exports } = await loadClientModule(reactHarness.React)
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('../lib/client.js', import.meta.url), 'utf8'))

  for (const field of [
    'enabled',
    'replaceBuiltinEdit',
    'promptGuidance',
    'hashLength',
    'readLimit',
    'maxLineLength',
    'contextLines',
  ]) {
    assert.match(source, new RegExp(`['"]${field}['"]`))
  }
  assert.equal(typeof exports.apply, 'function')
})
