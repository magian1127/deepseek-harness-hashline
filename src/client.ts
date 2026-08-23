import React from 'react'
import { DisclosureRow, ReadBlock, StateDot, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'

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

const uiStyles = {
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
  toolRow: { width: '100%', minWidth: 0 },
  toolSep: { flex: 'none', width: 2, height: 2, margin: '0 8px', borderRadius: 1, background: 'var(--dsw-alias-label-caption)' },
  toolLink: {
    flex: 'auto', minWidth: 0, overflow: 'hidden', padding: 0, border: 0, background: 'none',
    color: 'var(--dsw-alias-label-secondary)', font: 'inherit', fontSize: 14, lineHeight: '24px',
    textAlign: 'left', textDecoration: 'underline', textDecorationColor: 'var(--dsw-alias-label-quaternary)',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer',
  },
  readBody: { margin: '4px 0 4px 4px' },
  diffBody: {
    position: 'relative', margin: '4px 0 4px 4px', borderRadius: 12,
    color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-markdown-code-block)',
  },
  diffCopy: {
    position: 'absolute', top: 8, right: 12, zIndex: 1, padding: 0, margin: 0, border: 0,
    background: 'transparent', color: 'var(--dsw-alias-label-secondary)',
    font: 'var(--dsw-font-xs-13)', cursor: 'pointer',
  },
  diffScroll: { padding: '12px 14px', overflowX: 'auto', overflowY: 'hidden', font: 'var(--dsw-font-markdown-code-block)' },
  diffLine: { display: 'flex', minHeight: 22, lineHeight: '22px', whiteSpace: 'pre' },
  diffPath: { display: 'block', minHeight: 22, lineHeight: '22px', paddingRight: 56, fontWeight: 600, whiteSpace: 'pre' },
  diffGap: { display: 'block', minHeight: 22, lineHeight: '22px', color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'pre' },
  diffGutter: { flex: 'none', userSelect: 'none', color: 'var(--dsw-alias-label-tertiary)' },
  diffDelContent: { flex: 'none', color: 'var(--dsw-alias-state-error-primary)' },
  diffAddContent: { flex: 'none', color: 'var(--dsw-alias-state-success-primary)' },
  diffExpand: {
    display: 'block', width: '100%', padding: 0, border: 0, background: 'transparent',
    color: 'var(--dsw-alias-label-tertiary)', font: 'inherit', textAlign: 'left', cursor: 'pointer',
  },
  diffFooter: { padding: '0 14px 12px', color: 'var(--dsw-alias-label-tertiary)', font: 'var(--dsw-font-markdown-code-block)' },
  toolInspect: {
    alignSelf: 'flex-start', margin: '4px 0 2px 4px', padding: '2px 8px',
    border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 999,
    background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-secondary)',
    fontSize: 11, lineHeight: '16px', cursor: 'pointer',
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
    return h('span', { style: uiStyles.override, 'data-hashline-override': '' }, props.overridden ? t('overridden') : t('inherited'))
  }

  function ToggleRow(props: { field: string; value: boolean; disabled: boolean; overridden: boolean; onChange: (next: boolean) => void }) {
    return h('label', { style: uiStyles.row, 'data-hashline-row': '' },
      h('span', { style: uiStyles.rowText },
        h('span', { style: uiStyles.labelLine, 'data-hashline-label-line': '' },
          h('span', { style: uiStyles.label }, t(props.field)),
          h(FieldIdentity, { overridden: props.overridden })),
        h('span', { style: uiStyles.hint, 'data-hashline-hint': '' }, t(props.field + 'Desc'))),
      h('input', {
        type: 'checkbox',
        role: 'switch',
        checked: props.value,
        disabled: props.disabled,
        'aria-label': t(props.field),
        style: Object.assign({}, uiStyles.checkbox, controlDisabledStyle(props.disabled)),
        onChange: function (event: { target: { checked: boolean } }) { props.onChange(event.target.checked) },
      }))
  }

  function NumberField(props: { spec: { key: string; min?: number; max?: number }; value: number; disabled: boolean; overridden: boolean; onChange: (next: number | '') => void }) {
    return h('label', { style: uiStyles.numberField },
      h('span', { style: uiStyles.labelLine, 'data-hashline-label-line': '' },
        h('span', { style: uiStyles.label }, t(props.spec.key)),
        h(FieldIdentity, { overridden: props.overridden })),
      h('span', { style: uiStyles.hint, 'data-hashline-hint': '' }, t(props.spec.key + 'Desc')),
      h('input', {
        type: 'number',
        inputMode: 'numeric',
        step: 1,
        min: props.spec.min,
        max: props.spec.max,
        value: props.value,
        disabled: props.disabled,
        'aria-label': t(props.spec.key),
        style: Object.assign({}, uiStyles.input, controlDisabledStyle(props.disabled)),
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
      body = h('p', { style: uiStyles.status }, t('loading'))
    } else if (snapshot.status !== 'ready') {
      body = h('p', { style: uiStyles.status }, t('unavailable'))
    } else {
      body = h(React.Fragment, null,
        snapshot.writable ? null : h('p', { style: uiStyles.status }, t('readOnly')),
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
        h('div', { style: uiStyles.numberGrid, 'data-hashline-number-grid': '' }, NUMBER_FIELDS.map(function (spec) {
          return h(NumberField, {
            key: spec.key,
            spec: spec,
            value: draft[spec.key as keyof SettingsValue],
            disabled: !editable,
            overridden: hasOwn(snapshot.user, spec.key),
            onChange: function (next: number | '') { change(spec.key, next) },
          })
        })),
        h('div', { style: uiStyles.footer, 'data-hashline-footer': '' },
          h('p', { style: uiStyles.error }, !valid ? t('invalid') : error === '' ? '' : t('saveFailed') + error),
          h('button', {
            type: 'button',
            disabled: !editable,
            style: Object.assign({}, uiStyles.secondaryButton, controlDisabledStyle(!editable)),
            onClick: restore,
          }, t('restore')),
          h('button', {
            type: 'button',
            disabled: !editable || !dirty,
            style: Object.assign({}, uiStyles.secondaryButton, controlDisabledStyle(!editable || !dirty)),
            onClick: discard,
          }, t('discard')),
          h('button', {
            type: 'button',
            disabled: !editable || !dirty || !valid,
            style: Object.assign({}, uiStyles.primaryButton, controlDisabledStyle(!editable || !dirty || !valid)),
            onClick: function () { void save() },
          }, saving ? t('saving') : t('save'))))
    }

    return h('li', { style: uiStyles.card, 'data-hashline-settings': '' },
      h('style', null, responsiveCss),
      h('button', {
        type: 'button',
        'aria-expanded': open,
        style: uiStyles.header,
        'data-hashline-header': '',
        onClick: function () { setOpen(!open) },
      },
        h('span', { style: uiStyles.headText, 'data-hashline-head-text': '' },
          h('span', { style: uiStyles.name, 'data-hashline-name': '' }, t('title')),
          h('span', { style: uiStyles.description, 'data-hashline-description': '' }, t('description'))),
        h('span', { style: uiStyles.badge, 'data-hashline-badge': '' }, headerBadge),
        h('span', { style: uiStyles.chevron, 'data-hashline-chevron': '', 'aria-hidden': 'true' }, open ? '▾' : '▸')),
      open ? h('div', { style: uiStyles.body, 'data-hashline-body': '' }, body) : null)
  }
}

interface HashlineReadLine {
  number: number
  hash: string
  text: string
}

interface HashlineReadView {
  card: 'read'
  path: string
  offset: number
  lines: HashlineReadLine[]
  totalLines: number
  lang?: string
}

const HASHLINE_RE = /^[0-9a-f]{3,16}$/u

function normalizeHashlineReadLine(value: unknown): HashlineReadLine | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const line = value as Record<string, unknown>
  if (typeof line.number !== 'number' || !Number.isInteger(line.number) || line.number < 1) return undefined
  if (typeof line.text !== 'string') return undefined
  if (typeof line.hash === 'string' && HASHLINE_RE.test(line.hash)) {
    return { number: line.number, hash: line.hash, text: line.text }
  }
  // 兼容 Host 尚未热重载的早期投影：`text` 曾为 `|HASH  正文`。
  // 只接受严格前缀，避免误把普通内置 read 的正文当成 Hashline 行。
  const legacy = /^\|([0-9a-f]+)  ([\s\S]*)$/u.exec(line.text)
  if (legacy === null || !HASHLINE_RE.test(legacy[1])) return undefined
  return { number: line.number, hash: legacy[1], text: legacy[2] }
}

function hashlineReadView(block: any): HashlineReadView | undefined {
  if (block === null || typeof block !== 'object' || block.kind !== 'tool-result') return undefined
  const view = block.resultView
  if (view === null || typeof view !== 'object' || view.card !== 'read') return undefined
  if (typeof view.path !== 'string' || !Number.isInteger(view.offset) || view.offset < 1) return undefined
  if (!Number.isInteger(view.totalLines) || view.totalLines < 0 || !Array.isArray(view.lines)) return undefined
  if (view.lang !== undefined && typeof view.lang !== 'string') return undefined
  const lines: HashlineReadLine[] = []
  let previousNumber = 0
  for (const candidate of view.lines) {
    const line = normalizeHashlineReadLine(candidate)
    if (line === undefined || line.number <= previousNumber || line.number > view.totalLines) return undefined
    lines.push(line)
    previousNumber = line.number
  }
  if (lines.length > 0 && lines[0].number !== view.offset) return undefined
  return {
    card: 'read', path: view.path, offset: view.offset, lines, totalLines: view.totalLines,
    ...(view.lang === undefined ? {} : { lang: view.lang }),
  }
}

interface HashlineDiffHunk {
  path: string
  oldText: string | null
  newText: string
  oldHashes: string[]
  newHashes: string[]
}

function diffLineCount(text: string | null): number {
  return text === null || text === '' ? 0 : text.split('\n').length
}

function normalizeHashlineDiff(value: unknown): HashlineDiffHunk | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const diff = value as Record<string, unknown>
  if (typeof diff.path !== 'string' || (diff.oldText !== null && typeof diff.oldText !== 'string') || typeof diff.newText !== 'string') return undefined
  if (!Array.isArray(diff.oldHashes) || !Array.isArray(diff.newHashes)) return undefined
  if (!diff.oldHashes.every(hash => typeof hash === 'string' && HASHLINE_RE.test(hash))) return undefined
  if (!diff.newHashes.every(hash => typeof hash === 'string' && HASHLINE_RE.test(hash))) return undefined
  if (diff.oldHashes.length !== diffLineCount(diff.oldText as string | null)) return undefined
  if (diff.newHashes.length !== diffLineCount(diff.newText)) return undefined
  return {
    path: diff.path,
    oldText: diff.oldText as string | null,
    newText: diff.newText,
    oldHashes: diff.oldHashes as string[],
    newHashes: diff.newHashes as string[],
  }
}

function hashlineDiffs(block: any): HashlineDiffHunk[] | undefined {
  if (block === null || typeof block !== 'object' || block.kind !== 'tool-result' || block.isError === true) return undefined
  const view = block.resultView
  if (view === null || typeof view !== 'object' || view.card !== 'diff' || !Array.isArray(view.diffs) || view.diffs.length === 0) return undefined
  const diffs = view.diffs.map(normalizeHashlineDiff)
  return diffs.every((diff: HashlineDiffHunk | undefined) => diff !== undefined) ? diffs as HashlineDiffHunk[] : undefined
}

type HashlineDiffRow =
  | { kind: 'path'; text: string }
  | { kind: 'gap'; text: string }
  | { kind: 'del'; sign: '-'; hash: string; text: string }
  | { kind: 'add'; sign: '+'; hash: string; text: string }

function textLines(text: string | null): string[] {
  return text === null || text === '' ? [] : text.split('\n')
}

function buildHashlineDiffRows(diffs: HashlineDiffHunk[]): {
  rows: HashlineDiffRow[]
  added: number
  removed: number
  files: number
} {
  const rows: HashlineDiffRow[] = []
  const paths = new Set<string>()
  let added = 0
  let removed = 0
  let previousPath: string | undefined
  for (const diff of diffs) {
    paths.add(diff.path)
    rows.push(diff.path === previousPath ? { kind: 'gap', text: '⋯' } : { kind: 'path', text: diff.path })
    previousPath = diff.path
    textLines(diff.oldText).forEach(function (text, index) {
      rows.push({ kind: 'del', sign: '-', hash: diff.oldHashes[index], text })
      removed += 1
    })
    textLines(diff.newText).forEach(function (text, index) {
      rows.push({ kind: 'add', sign: '+', hash: diff.newHashes[index], text })
      added += 1
    })
  }
  return { rows, added, removed, files: paths.size }
}

function hashlineDiffCopyText(rows: HashlineDiffRow[]): string {
  return rows.map(function (row) {
    return row.kind === 'del' || row.kind === 'add' ? `${row.sign} ${row.text}` : row.text
  }).join('\n')
}

function HashlineDiffBlock({ diffs, maxLines = 8 }: { diffs: HashlineDiffHunk[]; maxLines?: number }): any {
  const model = React.useMemo(function () { return buildHashlineDiffRows(diffs) }, [diffs])
  const [expanded, setExpanded] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  if (model.rows.length === 0) return null
  const hidden = model.rows.length - maxLines
  const capped = hidden > 0 && !expanded
  const headLines = Math.ceil(maxLines / 2)
  const tailLines = maxLines - headLines
  const head = capped ? model.rows.slice(0, headLines) : model.rows
  const tail = capped ? model.rows.slice(model.rows.length - tailLines) : []
  const copy = function () {
    if (copied) return
    void writeClipboard(hashlineDiffCopyText(model.rows)).then(function (ok: boolean) {
      if (!ok) return
      setCopied(true)
      window.setTimeout(function () { setCopied(false) }, 1000)
    })
  }
  const renderRows = function (rows: HashlineDiffRow[], keyPrefix: string) {
    return rows.map(function (row, index) {
      if (row.kind === 'path') return h('div', { key: `${keyPrefix}-${index}`, style: uiStyles.diffPath }, row.text)
      if (row.kind === 'gap') return h('div', { key: `${keyPrefix}-${index}`, style: uiStyles.diffGap }, row.text)
      const contentStyle = row.kind === 'del' ? uiStyles.diffDelContent : uiStyles.diffAddContent
      return h('div', { key: `${keyPrefix}-${index}`, style: uiStyles.diffLine },
        h('span', { style: uiStyles.diffGutter, 'aria-hidden': true }, `${row.sign}|${row.hash}  `),
        h('span', { style: contentStyle }, row.text))
    })
  }
  return h('div', { style: uiStyles.diffBody, 'data-hashline-diff': '' },
    h('button', { type: 'button', style: uiStyles.diffCopy, onClick: copy }, copied ? '复制成功' : '复制'),
    h('div', { style: uiStyles.diffScroll },
      renderRows(head, 'head'),
      hidden > 0 ? h('button', {
        type: 'button', style: uiStyles.diffExpand, 'aria-expanded': expanded,
        'aria-label': expanded ? '收起差异' : `展开其余 ${hidden} 行差异`,
        onClick: function () { setExpanded(!expanded) },
      }, expanded ? '收起' : `… 其余 ${hidden} 行`) : null,
      renderRows(tail, 'tail')),
    h('div', { style: uiStyles.diffFooter }, `└ +${model.added} -${model.removed} · ${model.files} file${model.files === 1 ? '' : 's'}`))
}
function createHashlineEditRow(): (props: any) => any {
  const h = React.createElement
  return function HashlineEditRow(props: any): any {
    const diffs = hashlineDiffs(props.block)
    const [open, setOpen] = React.useState(false)
    const path = filePathFromBlock(props.block) ?? diffs?.[0]?.path ?? props.callId ?? ''
    const running = props.block?.kind !== 'tool-result'
    const error = props.block?.kind === 'tool-result' && props.block.isError === true
    const expandable = diffs !== undefined
    const isOpen = open && expandable
    const openPath = function (event: any) {
      event.stopPropagation()
      if (path !== '') props.openFile(path)
    }

    const state = running ? 'ongoing' : error ? 'error' : 'done'
    const collapsedContent = path === '' ? null : h(React.Fragment, null,
      h('span', { style: uiStyles.toolSep, 'aria-hidden': true }),
      h('button', {
        type: 'button', style: uiStyles.toolLink, onClick: openPath,
        onKeyDown: function (event: any) { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation() },
      }, path))
    const body = !isOpen || diffs === undefined ? null : h(React.Fragment, null,
      h(HashlineDiffBlock, { diffs, maxLines: 8 }),
      props.inspect === undefined ? null : h('button', {
        type: 'button', style: uiStyles.toolInspect, onClick: props.inspect,
      }, 'Inspect'))
    return h('div', { 'data-tool': props.toolName, 'data-state': state },
      h(DisclosureRow, {
        style: uiStyles.toolRow,
        icon: h(StateDot, { state }),
        title: 'Edit',
        open: isOpen,
        expandable,
        onToggle: function () { setOpen(!open) },
        expandOnRowClick: true,
        previewChevron: true,
        collapsedContent,
      }, body))
  }
}
function filePathFromBlock(block: any): string | undefined {
  const argsRaw = block?.kind === 'tool-result' ? block.call?.argsRaw : block?.argsRaw
  if (typeof argsRaw !== 'string') return undefined
  try {
    const args = JSON.parse(argsRaw)
    return typeof args?.file_path === 'string' && args.file_path !== '' ? args.file_path : undefined
  } catch {
    return undefined
  }
}

/**
 * 复用官方 ReadBlock 的折叠、复制、语法高亮与全部原生样式。
 * ReadBlock 运行时只把 `number` 当 React children/key 使用；这里专用 toolview
 * 有意传入 `LINE|HASH` 字符串，让完整锚点进入原生灰色、aria-hidden gutter。
 */
function createHashlineReadRow(): (props: any) => any {
  const h = React.createElement
  return function HashlineReadRow(props: any): any {
    const view = hashlineReadView(props.block)
    const [open, setOpen] = React.useState(false)
    const path = filePathFromBlock(props.block) ?? view?.path ?? props.callId ?? ''
    const running = props.block?.kind !== 'tool-result'
    const error = props.block?.kind === 'tool-result' && props.block.isError === true
    const expandable = view !== undefined
    const isOpen = open && expandable
    const openPath = function (event: any) {
      event.stopPropagation()
      if (path !== '') props.openFile(path)
    }
    const lines = view?.lines.map(function (line) {
      return { number: `${line.number}|${line.hash}`, text: line.text }
    }) ?? []
    const state = running ? 'ongoing' : error ? 'error' : 'done'
    const collapsedContent = path === '' ? null : h(React.Fragment, null,
      h('span', { style: uiStyles.toolSep, 'aria-hidden': true }),
      h('button', {
        type: 'button', style: uiStyles.toolLink, onClick: openPath,
        onKeyDown: function (event: any) { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation() },
      }, path))
    const body = !isOpen || view === undefined ? null : h(React.Fragment, null,
      h(ReadBlock, {
        style: uiStyles.readBody,
        label: view.path,
        lines,
        totalLines: view.totalLines,
        lang: view.lang,
        maxLines: 8,
      }),
      props.inspect === undefined ? null : h('button', {
        type: 'button', style: uiStyles.toolInspect, onClick: props.inspect,
      }, 'Inspect'))
    return h('div', { 'data-tool': props.toolName, 'data-state': state },
      h(DisclosureRow, {
        style: uiStyles.toolRow,
        icon: h(StateDot, { state }),
        title: 'Read',
        open: isOpen,
        expandable,
        onToggle: function () { setOpen(!open) },
        expandOnRowClick: true,
        previewChevron: true,
        collapsedContent,
      }, body))
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
  const HashlineReadRow = createHashlineReadRow()
  const HashlineEditRow = createHashlineEditRow()

  ctx.slots.inject('tool.call.toolview', function* () {
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'hashline_read' }, HashlineReadRow)
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'hashline_edit' }, HashlineEditRow)
  })
  // 只有 Host 确实用 Hashline 替换内置 read 时才接管 shipped `read-row`；
  // 默认模式绝不遮蔽普通内置 read 的原生工具卡。
  ctx.effect(function () {
    let disposeBuiltins: (() => void) | undefined
    const sync = function () {
      const value = scope.getSnapshot().value
      const shouldOwnBuiltins = value?.enabled === true && value?.replaceBuiltinEdit === true
      if (shouldOwnBuiltins && disposeBuiltins === undefined) {
        disposeBuiltins = ctx.slots.inject('tool.call.toolview', function* () {
          // Shipped read/edit toolviews occupy priority 0. Keyed slots render the
          // lowest live priority, so -100 shadows them without replacing their Fiber;
          // disposing this contribution restores the shipped rows immediately.
          yield ctx.slots.register({ name: 'tool.call.toolview', key: 'read', priority: -100 }, HashlineReadRow)
          yield ctx.slots.register({ name: 'tool.call.toolview', key: 'edit', priority: -100 }, HashlineEditRow)
        })
      } else if (!shouldOwnBuiltins && disposeBuiltins !== undefined) {
        disposeBuiltins()
        disposeBuiltins = undefined
      }
    }
    sync()
    const unsubscribe = scope.subscribe(sync)
    return function () {
      unsubscribe()
      disposeBuiltins?.()
    }
  }, 'dsh-hashline: scoped read/edit toolviews')
}

export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']
export { apply }
