import React from 'react'

const h = React.createElement

const SETTINGS_NAMESPACE = 'hashline'
const LOCALE_NAMESPACE = 'settings.hashline'

const FIELDS = [
  'enabled',
  'replaceBuiltinEdit',
  'promptGuidance',
  'hashLength',
  'readLimit',
  'maxLineLength',
  'contextLines',
]

const DEFAULTS = {
  enabled: true,
  replaceBuiltinEdit: false,
  promptGuidance: true,
  hashLength: 4,
  readLimit: 2000,
  maxLineLength: 500,
  contextLines: 2,
}

const NUMBER_FIELDS = [
  { key: 'hashLength', min: 3, max: 16 },
  { key: 'readLimit', min: 1 },
  { key: 'maxLineLength', min: 1 },
  { key: 'contextLines', min: 0, max: 20 },
]

const zh = {
  title: '哈希锚点编辑',
  description: '基于哈希锚点的读取与原子文件编辑',
  enabledStatus: '已启用',
  disabledStatus: '已停用',
  pending: '未保存',
  loading: '正在读取设置…',
  unavailable: '当前部署未提供哈希锚点设置。',
  readOnly: '当前设置文档为只读，无法保存更改。',
  enabled: '启用哈希锚点工具',
  enabledDesc: '控制哈希锚点读取、编辑工具及相关提示。关闭后仍保留配置入口。',
  replaceBuiltinEdit: '替换内置读写',
  replaceBuiltinEditDesc: '让每个允许编辑的智能体使用哈希锚点读写方式；关闭后恢复该智能体原有的读取与编辑工具。',
  promptGuidance: '注入工具选择提示',
  promptGuidanceDesc: '在系统提示中说明何时使用哈希锚点读取和编辑。',
  hashLength: '哈希长度',
  hashLengthDesc: '每个行锚点中的十六进制字符数（3–16）。',
  readLimit: '单次读取最大行数',
  readLimitDesc: '一次读取可返回的最大行数。',
  maxLineLength: '单行显示上限',
  maxLineLengthDesc: '超长行的显示字符上限；锚点仍覆盖完整内容。',
  contextLines: '编辑预览上下文',
  contextLinesDesc: '结果在变更位置前后返回的行数 (0–20)。',
  inherited: '继承默认值',
  overridden: '用户覆盖',
  restore: '恢复默认值',
  discard: '放弃修改',
  save: '保存',
  saving: '保存中…',
  invalid: '请修正超出范围或非整数的数值。',
  saveFailed: '保存失败：',
  saveNotApplied: '主程序未接受全部设置，已保留草稿。',
}

const en = {
  title: '哈希锚点编辑',
  description: '基于哈希锚点的读取与原子文件编辑',
  enabledStatus: '已启用',
  disabledStatus: '已停用',
  pending: '未保存',
  loading: '正在读取设置…',
  unavailable: '当前部署未提供哈希锚点设置。',
  readOnly: '当前设置文档为只读，无法保存更改。',
  enabled: '启用哈希锚点工具',
  enabledDesc: '控制哈希锚点读取、编辑工具及相关提示。关闭后仍保留配置入口。',
  replaceBuiltinEdit: '替换内置读写',
  replaceBuiltinEditDesc: '让每个允许编辑的智能体使用哈希锚点读写方式；关闭后恢复该智能体原有的读取与编辑工具。',
  promptGuidance: '注入工具选择提示',
  promptGuidanceDesc: '在系统提示中说明何时使用哈希锚点读取和编辑。',
  hashLength: '哈希长度',
  hashLengthDesc: '每个行锚点中的十六进制字符数（3–16）。',
  readLimit: '单次读取最大行数',
  readLimitDesc: '一次读取可返回的最大行数。',
  maxLineLength: '单行显示上限',
  maxLineLengthDesc: '超长行的显示字符上限；锚点仍覆盖完整内容。',
  contextLines: '编辑预览上下文',
  contextLinesDesc: '结果在变更位置前后返回的行数 (0–20)。',
  inherited: '继承默认值',
  overridden: '用户覆盖',
  restore: '恢复默认值',
  discard: '放弃修改',
  save: '保存',
  saving: '保存中…',
  invalid: '请修正超出范围或非整数的数值。',
  saveFailed: '保存失败：',
  saveNotApplied: '主程序未接受全部设置，已保留草稿。',
}

const responsiveCss = [
  '@container (max-width: 180px) {',
  '  [data-hashline-header] { min-height: 0 !important; padding: 10px 8px !important; display: grid !important; grid-template-columns: minmax(0, 1fr) 12px !important; gap: 4px !important; }',
  '  [data-hashline-head-text] { min-width: 0 !important; }',
  '  [data-hashline-name] { font-size: 12px !important; word-break: keep-all; overflow-wrap: anywhere; }',
  '  [data-hashline-description], [data-hashline-badge], [data-hashline-hint], [data-hashline-override] { display: none !important; }',
  '  [data-hashline-body] { margin: 0 6px !important; }',
  '  [data-hashline-row] { min-height: 0 !important; padding: 8px 0 !important; flex-direction: column !important; align-items: flex-start !important; gap: 6px !important; }',
  '  [data-hashline-label-line] { display: block !important; word-break: keep-all; overflow-wrap: anywhere; }',
  '  [data-hashline-number-grid] { grid-template-columns: minmax(0, 1fr) !important; gap: 10px !important; padding: 10px 0 !important; }',
  '  [data-hashline-footer] { display: grid !important; grid-template-columns: minmax(0, 1fr) !important; }',
  '  [data-hashline-footer] button { width: 100% !important; padding: 5px 3px !important; overflow-wrap: anywhere; }',
  '}',
].join('\n')

const styles = {
  card: {
    listStyle: 'none',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 12,
    background: 'var(--dsw-alias-bg-layer-3)',
    color: 'var(--dsw-alias-label-primary)',
    overflow: 'hidden',
    containerType: 'inline-size',
  },
  header: {
    width: '100%',
    minHeight: 72,
    appearance: 'none',
    border: 0,
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 16px',
  },
  headText: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  name: { fontSize: 15, fontWeight: 600, lineHeight: 1.4 },
  description: { fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
  badge: {
    flex: 'none',
    borderRadius: 999,
    padding: '1px 8px',
    fontSize: 11,
    lineHeight: '17px',
    whiteSpace: 'nowrap',
    background: 'var(--dsw-alias-bg-module-platform)',
    color: 'var(--dsw-alias-label-secondary)',
  },
  chevron: { flex: 'none', width: 16, textAlign: 'center', color: 'var(--dsw-alias-label-tertiary)' },
  body: { borderTop: '1px solid var(--dsw-alias-border-l2)', margin: '0 16px', padding: '2px 0 8px' },
  status: { margin: '12px 0', fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    minHeight: 58,
    padding: '10px 0',
    borderBottom: '1px solid var(--dsw-alias-border-l2)',
  },
  rowText: { flex: 1, minWidth: 0 },
  labelLine: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
  label: { fontSize: 13, fontWeight: 600, lineHeight: 1.5 },
  override: { fontSize: 11, lineHeight: 1.4, color: 'var(--dsw-alias-label-tertiary)' },
  hint: { marginTop: 2, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
  checkbox: { flex: 'none', width: 18, height: 18, accentColor: 'var(--dsw-alias-brand-primary)' },
  numberGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))',
    gap: '12px 18px',
    padding: '14px 0',
  },
  numberField: { minWidth: 0 },
  input: {
    width: '100%',
    height: 34,
    boxSizing: 'border-box',
    marginTop: 7,
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 7,
    padding: '5px 9px',
    background: 'var(--dsw-alias-bg-layer-3)',
    color: 'var(--dsw-alias-label-primary)',
    font: 'inherit',
    fontSize: 13,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
    padding: '12px 0 4px',
    borderTop: '1px solid var(--dsw-alias-border-l2)',
  },
  error: { flex: '1 1 220px', margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-error)' },
  secondaryButton: {
    appearance: 'none',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 8,
    padding: '5px 12px',
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary)',
    font: 'inherit',
    fontSize: 13,
    lineHeight: 1.5,
    cursor: 'pointer',
  },
  primaryButton: {
    appearance: 'none',
    border: '1px solid transparent',
    borderRadius: 8,
    padding: '5px 14px',
    background: 'var(--dsw-alias-label-primary)',
    color: 'var(--dsw-alias-bg-layer-3)',
    font: 'inherit',
    fontSize: 13,
    lineHeight: 1.5,
    cursor: 'pointer',
  },
}

function hasOwn(value: unknown, key: string): boolean {
  return typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, key)
}

interface SettingsValue {
  enabled: boolean
  replaceBuiltinEdit: boolean
  promptGuidance: boolean
  hashLength: number
  readLimit: number
  maxLineLength: number
  contextLines: number
}

function normalized(value: unknown): SettingsValue {
  const source = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULTS.enabled,
    replaceBuiltinEdit: typeof source.replaceBuiltinEdit === 'boolean' ? source.replaceBuiltinEdit : DEFAULTS.replaceBuiltinEdit,
    promptGuidance: typeof source.promptGuidance === 'boolean' ? source.promptGuidance : DEFAULTS.promptGuidance,
    hashLength: source.hashLength !== undefined ? source.hashLength as number : DEFAULTS.hashLength,
    readLimit: source.readLimit !== undefined ? source.readLimit as number : DEFAULTS.readLimit,
    maxLineLength: source.maxLineLength !== undefined ? source.maxLineLength as number : DEFAULTS.maxLineLength,
    contextLines: source.contextLines !== undefined ? source.contextLines as number : DEFAULTS.contextLines,
  }
}

function sameSettings(left: SettingsValue, right: SettingsValue): boolean {
  return FIELDS.every((field) => Object.is(left[field as keyof SettingsValue], right[field as keyof SettingsValue]))
}

function validDraft(draft: SettingsValue): boolean {
  return NUMBER_FIELDS.every((spec) => {
    const value = draft[spec.key as keyof SettingsValue] as number
    if (!Number.isInteger(value) || value < spec.min) return false
    return spec.max === undefined || value <= spec.max
  })
}

function controlDisabledStyle(disabled: boolean): { opacity: number; cursor: string } | null {
  return disabled ? { opacity: 0.45, cursor: 'default' } : null
}

function createCard(scope: any, t: (key: string) => string): () => any {
  function FieldIdentity(props: { overridden: boolean }) {
    return h('span', { style: styles.override, 'data-hashline-override': '' }, props.overridden ? t('overridden') : t('inherited'))
  }

  function ToggleRow(props: { field: string; value: boolean; disabled: boolean; overridden: boolean; onChange: (next: boolean) => void }) {
    return h('label', { style: styles.row, 'data-hashline-row': '' },
      h('span', { style: styles.rowText },
        h('span', { style: styles.labelLine, 'data-hashline-label-line': '' },
          h('span', { style: styles.label }, t(props.field)),
          h(FieldIdentity, { overridden: props.overridden })),
        h('span', { style: styles.hint, 'data-hashline-hint': '' }, t(props.field + 'Desc'))),
      h('input', {
        type: 'checkbox',
        role: 'switch',
        checked: props.value,
        disabled: props.disabled,
        'aria-label': t(props.field),
        style: Object.assign({}, styles.checkbox, controlDisabledStyle(props.disabled)),
        onChange: function (event: { target: { checked: boolean } }) { props.onChange(event.target.checked) },
      }))
  }

  function NumberField(props: { spec: { key: string; min?: number; max?: number }; value: number; disabled: boolean; overridden: boolean; onChange: (next: number | '') => void }) {
    return h('label', { style: styles.numberField },
      h('span', { style: styles.labelLine, 'data-hashline-label-line': '' },
        h('span', { style: styles.label }, t(props.spec.key)),
        h(FieldIdentity, { overridden: props.overridden })),
      h('span', { style: styles.hint, 'data-hashline-hint': '' }, t(props.spec.key + 'Desc')),
      h('input', {
        type: 'number',
        inputMode: 'numeric',
        step: 1,
        min: props.spec.min,
        max: props.spec.max,
        value: props.value,
        disabled: props.disabled,
        'aria-label': t(props.spec.key),
        style: Object.assign({}, styles.input, controlDisabledStyle(props.disabled)),
        onChange: function (event: { target: { value: string } }) {
          const raw = event.target.value
          props.onChange(raw === '' ? '' : Number(raw))
        },
      }))
  }

  return function HashlineSettingsCard() {
    const snapshot = React.useSyncExternalStore(
      function (listener: () => void) { return scope.subscribe(listener) },
      function () { return scope.getSnapshot() },
    )
    const value = normalized(snapshot.value)
    const [draft, setDraft] = React.useState(function () { return value })
    const [open, setOpen] = React.useState(false)
    const [saving, setSaving] = React.useState(false)
    const [error, setError] = React.useState('')
    const [resetAll, setResetAll] = React.useState(false)
    const dirty = !sameSettings(draft, value) || resetAll
    const valid = validDraft(draft)
    const editable = snapshot.status === 'ready' && snapshot.writable && !saving

    React.useEffect(function () {
      if (!dirty && !saving && snapshot.status === 'ready') {
        setDraft(normalized(snapshot.value))
        setResetAll(false)
      }
    }, [snapshot.revision, snapshot.status, dirty, saving])

    function change(field: string, nextValue: any) {
      setResetAll(false)
      setError('')
      setDraft(function (previous: SettingsValue) {
        return Object.assign({}, previous, { [field]: nextValue })
      })
    }

    async function save() {
      if (!editable || !dirty || !valid) return
      setSaving(true)
      setError('')
      try {
        if (resetAll) {
          for (let resetIndex = 0; resetIndex < FIELDS.length; resetIndex += 1) {
            await scope.unset(FIELDS[resetIndex])
          }
        } else {
          for (let index = 0; index < FIELDS.length; index += 1) {
            const field = FIELDS[index]
            if (!Object.is(draft[field as keyof SettingsValue], value[field as keyof SettingsValue])) await scope.set(field, draft[field as keyof SettingsValue])
          }
        }
        const accepted = normalized(scope.getSnapshot().value)
        const expected = resetAll ? normalized(scope.getSnapshot().base) : draft
        if (!sameSettings(accepted, expected)) throw new Error(t('saveNotApplied'))
        setResetAll(false)
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : String(saveError))
      } finally {
        setSaving(false)
      }
    }

    function discard() {
      setDraft(value)
      setResetAll(false)
      setError('')
    }

    function restore() {
      setDraft(normalized(snapshot.base))
      setResetAll(true)
      setError('')
    }

    const statusText = value.enabled ? t('enabledStatus') : t('disabledStatus')
    const headerBadge = dirty ? t('pending') : statusText
    let body
    if (snapshot.status === 'loading') {
      body = h('p', { style: styles.status }, t('loading'))
    } else if (snapshot.status !== 'ready') {
      body = h('p', { style: styles.status }, t('unavailable'))
    } else {
      body = h(React.Fragment, null,
        snapshot.writable ? null : h('p', { style: styles.status }, t('readOnly')),
        h(ToggleRow, {
          field: 'enabled', value: draft.enabled, disabled: !editable,
          overridden: hasOwn(snapshot.user, 'enabled'),
          onChange: function (next: boolean) { change('enabled', next) },
        }),
        h(ToggleRow, {
          field: 'replaceBuiltinEdit', value: draft.replaceBuiltinEdit, disabled: !editable,
          overridden: hasOwn(snapshot.user, 'replaceBuiltinEdit'),
          onChange: function (next: boolean) { change('replaceBuiltinEdit', next) },
        }),
        h(ToggleRow, {
          field: 'promptGuidance', value: draft.promptGuidance, disabled: !editable,
          overridden: hasOwn(snapshot.user, 'promptGuidance'),
          onChange: function (next: boolean) { change('promptGuidance', next) },
        }),
        h('div', { style: styles.numberGrid, 'data-hashline-number-grid': '' }, NUMBER_FIELDS.map(function (spec) {
          return h(NumberField, {
            key: spec.key,
            spec: spec,
            value: draft[spec.key as keyof SettingsValue],
            disabled: !editable,
            overridden: hasOwn(snapshot.user, spec.key),
            onChange: function (next: number | '') { change(spec.key, next) },
          })
        })),
        h('div', { style: styles.footer, 'data-hashline-footer': '' },
          h('p', { style: styles.error }, !valid ? t('invalid') : error === '' ? '' : t('saveFailed') + error),
          h('button', {
            type: 'button',
            disabled: !editable,
            style: Object.assign({}, styles.secondaryButton, controlDisabledStyle(!editable)),
            onClick: restore,
          }, t('restore')),
          h('button', {
            type: 'button',
            disabled: !editable || !dirty,
            style: Object.assign({}, styles.secondaryButton, controlDisabledStyle(!editable || !dirty)),
            onClick: discard,
          }, t('discard')),
          h('button', {
            type: 'button',
            disabled: !editable || !dirty || !valid,
            style: Object.assign({}, styles.primaryButton, controlDisabledStyle(!editable || !dirty || !valid)),
            onClick: function () { void save() },
          }, saving ? t('saving') : t('save'))))
    }

    return h('li', { style: styles.card, 'data-hashline-settings': '' },
      h('style', null, responsiveCss),
      h('button', {
        type: 'button',
        'aria-expanded': open,
        style: styles.header,
        'data-hashline-header': '',
        onClick: function () { setOpen(!open) },
      },
        h('span', { style: styles.headText, 'data-hashline-head-text': '' },
          h('span', { style: styles.name, 'data-hashline-name': '' }, t('title')),
          h('span', { style: styles.description, 'data-hashline-description': '' }, t('description'))),
        h('span', { style: styles.badge, 'data-hashline-badge': '' }, headerBadge),
        h('span', { style: styles.chevron, 'data-hashline-chevron': '', 'aria-hidden': 'true' }, open ? '▾' : '▸')),
      open ? h('div', { style: styles.body, 'data-hashline-body': '' }, body) : null)
  }
}

function apply(ctx: any): void {
  const t = ctx.locale.bind(LOCALE_NAMESPACE)
  const scope = ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE })
  const Card = createCard(scope, t)
  ctx.effect(function () {
    return ctx.locale.register(LOCALE_NAMESPACE, { zh, en })
  }, 'dsh-hashline: settings dictionaries')
  ctx.slots.inject('settings.plugin.item', function () {
    return ctx.slots.register({
      name: 'settings.plugin.item',
      key: SETTINGS_NAMESPACE,
      locale: LOCALE_NAMESPACE,
    }, Card)
  })
}

export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']
export { apply }
