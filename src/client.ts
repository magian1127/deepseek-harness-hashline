import React from 'react'
import { DisclosureRow, ReadBlock, StateDot, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'

const h = React.createElement

// DSH 0.1.7 起 settings 命名空间退役,配置值挂在插件行 config 上;
// configForms 服务按入口 id(profile 行 id)取 ConfigForm。
const CONFIG_ENTRY_ID = 'tool-hashline'
const LOCALE_NAMESPACE = 'settings.hashline'
/** plugins.bundle.config 槽位的键:profile 中本包的 npm 包名(非 settings 命名空间)。 */
const BUNDLE_PACKAGE_NAME = 'deepseek-harness-hashline'

const FIELDS = [
  'enabled',
  'replaceBuiltinEdit',
  'replaceBuiltinEditInHeadless',
  'promptGuidance',
  'zhPrompt',
  'hashLength',
  'readLimit',
  'maxLineLength',
  'contextLines',
]

const DEFAULTS = {
  enabled: true,
  replaceBuiltinEdit: false,
  replaceBuiltinEditInHeadless: false,
  promptGuidance: true,
  zhPrompt: false,
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
  summary: '基于哈希锚点的读取与原子文件编辑:工具替换、提示词与数值参数。',
  loading: '正在读取设置…',
  unavailable: '当前部署未提供哈希锚点设置。',
  readOnly: '当前设置文档为只读，无法保存更改。',
  enabled: '启用哈希锚点工具',
  enabledDesc: '控制哈希锚点读取、编辑工具及相关提示。关闭后仍保留配置入口。',
  replaceBuiltinEdit: '替换内置读写',
  replaceBuiltinEditDesc: '让每个允许编辑的智能体使用哈希锚点读写；替换后的编辑工具只接受读取工具最新输出中的行哈希锚点，不接受文本替换参数。关闭后恢复原工具。',
  replaceBuiltinEditInHeadless: '无头模式替换内置读写',
  replaceBuiltinEditInHeadlessDesc: '仅用于 Open Design 等 headless 调用。还需同时开启“替换内置读写”才会替换 read/edit；关闭时仍保留显式 hashline_read/hashline_edit。默认关闭。',
  promptGuidance: '注入工具选择提示',
  promptGuidanceDesc: '在系统提示中说明何时使用哈希锚点读取和编辑。',
  zhPrompt: '提示词中文化',
  zhPromptDesc: '将注入的提示词与工具说明改为中文；工具名保持英文。',
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
  save: '保存',
  saving: '保存中…',
  invalid: '请修正超出范围或非整数的数值。',
  saveFailed: '保存失败：',
  saveNotApplied: '主程序未接受全部设置，已保留草稿。',
  // 读取卡 chrome 词条：复制/收起等共享词由 DSH common vocabulary 提供，
  // 这里只注册 ReadBlock 专属的窗口与展开文案（对齐原生 read 卡）。
  'read.window': '显示 {shown} / {total} 行',
  'read.collapseAria': '收起内容',
  'read.expandAria': '展开其余 {count} 行',
  'read.expandRest': '… 其余 {count} 行',
}

const en = {
  summary: 'Hash-anchored reading and atomic file editing: tool replacement, prompts, and numeric parameters.',
  loading: 'Loading settings...',
  unavailable: 'Hashline settings are not available in this deployment.',
  readOnly: 'Settings are read-only; changes cannot be saved.',
  enabled: 'Enable Hashline tools',
  enabledDesc: 'Controls Hashline read/edit tools and related guidance. The configuration entry remains available when disabled.',
  replaceBuiltinEdit: 'Replace built-in read/edit',
  replaceBuiltinEditDesc: 'Let each allowed agent use Hashline read/edit; the replacement edit only accepts line-hash anchors from the latest read output and rejects literal replacement parameters. Disabling restores the original tools.',
  replaceBuiltinEditInHeadless: 'Replace built-in read/edit in headless mode',
  replaceBuiltinEditInHeadlessDesc: 'Applies only to headless callers such as Open Design. Replace built-in read/edit must also be enabled; when this is off, explicit hashline_read/hashline_edit remain available. Off by default.',
  promptGuidance: 'Inject tool-selection guidance',
  promptGuidanceDesc: 'Explain when to use Hashline reading and editing in the system prompt.',
  zhPrompt: 'Chinese prompt text',
  zhPromptDesc: 'Translate injected prompt guidance and tool descriptions into Chinese; tool names remain English.',
  hashLength: 'Hash length',
  hashLengthDesc: 'Number of hexadecimal characters in each line anchor (3-16).',
  readLimit: 'Maximum lines per read',
  readLimitDesc: 'Maximum number of lines returned by one read.',
  maxLineLength: 'Maximum displayed line length',
  maxLineLengthDesc: 'Display character limit for long lines; anchors still cover the full content.',
  contextLines: 'Edit preview context',
  contextLinesDesc: 'Number of lines returned before and after a change (0-20).',
  inherited: 'Inherited',
  overridden: 'Overridden',
  save: 'Save',
  saving: 'Saving...',
  invalid: 'Fix out-of-range or non-integer values.',
  saveFailed: 'Save failed:',
  saveNotApplied: 'The host did not accept all settings; the draft was kept.',
  // Read-card chrome: shared copy/collapse words come from the DSH common
  // vocabulary; only the ReadBlock-specific window/expand strings live here.
  'read.window': 'Showing {shown} of {total} lines',
  'read.collapseAria': 'Collapse content',
  'read.expandAria': 'Expand {count} more lines',
  'read.expandRest': '… {count} more lines',
}

// 页面表单容器:对齐官方 PluginConfigForm.module.css 的 .form(flex column)。
const formStyle = { display: 'flex', flexDirection: 'column' } as const

const uiStyles = {
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
    paddingTop: 16,
  },
  error: { flex: '1 1 220px', margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-error)' },
  toolRow: { width: '100%', minWidth: 0 },
  toolSep: { flex: 'none', width: 2, height: 2, margin: '0 8px', borderRadius: 1, background: 'var(--dsw-alias-label-caption)' },
    toolLink: {
      /* shrink-to-fit(flex-grow 0):点击目标止于路径文字末尾,行内剩余空白归展开/收起切换(对齐原生 ToolRow.fileLink)。 */
      flex: '0 1 auto', minWidth: 0, overflow: 'hidden', padding: 0, border: 0, background: 'none',
    color: 'var(--dsw-alias-label-secondary)', font: 'inherit', fontSize: 14, lineHeight: '24px',
    textAlign: 'left', textDecoration: 'underline', textDecorationColor: 'var(--dsw-alias-label-quaternary)',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer',
  },
  readBody: { margin: '4px 0 4px 4px' },
  ioCard: {
    display: 'flex', flexDirection: 'column', margin: '4px 0 4px 4px',
    border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12,
    background: 'var(--dsw-alias-markdown-code-block)', font: 'var(--dsw-font-markdown-code-block-small)',
  },
  ioSection: {
    display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 14,
    alignItems: 'baseline', padding: '12px 16px', maxHeight: 150, overflowY: 'auto',
  },
  ioLabel: {
    position: 'sticky', top: 0, alignSelf: 'start', color: 'var(--dsw-alias-label-caption)',
  },
  ioText: {
    minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--dsw-alias-label-secondary)',
  },
    errorSummary: {
      flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, lineHeight: '20px',
    },
    /* 错误展开体顶部的文件路径行:精确复刻原生 ReadBlock banner 的 .label 样式
       (code 字体、primary 色、单行 ellipsis,不加粗、不断行)。 */
    errorPath: {
      minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      color: 'var(--dsw-alias-label-primary)',
      fontFamily: 'var(--ds-font-family-code)',
      fontSize: 12, lineHeight: '18px',
      margin: '4px 0 2px 4px',
    },
  diffBody: {
    position: 'relative', margin: '4px 0 4px 4px', borderRadius: 12,
    color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-markdown-code-block)',
  },
    /* 顶部 banner 精确复刻原生 ReadBlock:.banner(padding 9px 14px、banner 背景、上侧圆角);
       label 复用原生 .label 样式(code 字体、primary 色、单行 ellipsis,不加粗)。 */
    diffBanner: {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
      padding: '9px 14px', background: 'var(--dsw-alias-markdown-code-block-banner)',
      borderTopLeftRadius: 12, borderTopRightRadius: 12,
    },
    diffBannerLabel: {
      minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      color: 'var(--dsw-alias-label-primary)',
      fontFamily: 'var(--ds-font-family-code)',
      fontSize: 12, lineHeight: '18px',
    },
    diffCopy: {
      flex: 'none', padding: 0, margin: 0, border: 0,
      background: 'transparent', color: 'var(--dsw-alias-label-secondary)',
      font: 'var(--dsw-font-xs-13)', cursor: 'pointer',
    },
    diffScroll: { padding: '12px 14px', overflowX: 'auto', overflowY: 'hidden', font: 'var(--dsw-font-markdown-code-block)' },
    diffLine: { display: 'flex', minHeight: 22, lineHeight: '22px', whiteSpace: 'pre' },
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
  visuallyHidden: {
    position: 'absolute', width: 1, height: 1, overflow: 'hidden',
    clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
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
  replaceBuiltinEditInHeadless: boolean
  promptGuidance: boolean
  zhPrompt: boolean
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
      replaceBuiltinEditInHeadless: typeof source.replaceBuiltinEditInHeadless === 'boolean' ? source.replaceBuiltinEditInHeadless : DEFAULTS.replaceBuiltinEditInHeadless,
      promptGuidance: typeof source.promptGuidance === 'boolean' ? source.promptGuidance : DEFAULTS.promptGuidance,
      zhPrompt: typeof source.zhPrompt === 'boolean' ? source.zhPrompt : DEFAULTS.zhPrompt,
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

function createForm(scope: any, t: (key: string) => string): (props: { view?: string }) => any {
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

  return function HashlineConfigPage(props: { view?: string }) {
    // summary 视图:插件页标题下的一句话简介;组合包页面目前只用 page 视图,
    // summary 分支作为契约兜底(契约声明两种视图都会传)。
    if (props?.view === 'summary') return h('span', { 'data-hashline-summary': '' }, t('summary'))
    const snapshot = React.useSyncExternalStore(
      function (listener: () => void) { return scope.subscribe(listener) },
      function () { return scope.getSnapshot() },
    )
    const value = normalized(snapshot.value)
    const [draft, setDraft] = React.useState(function () { return value })
    const [saving, setSaving] = React.useState(false)
    const [error, setError] = React.useState('')
    const dirty = !sameSettings(draft, value)
    const valid = validDraft(draft)
    const editable = snapshot.status === 'ready' && snapshot.writable && !saving

    React.useEffect(function () {
      if (!dirty && !saving && snapshot.status === 'ready') setDraft(normalized(snapshot.value))
    }, [snapshot.revision, snapshot.status, dirty, saving])

    function change(field: string, nextValue: any) {
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
        for (let index = 0; index < FIELDS.length; index += 1) {
          const field = FIELDS[index]
          if (!Object.is(draft[field as keyof SettingsValue], value[field as keyof SettingsValue])) await scope.set(field, draft[field as keyof SettingsValue])
        }
        const accepted = normalized(scope.getSnapshot().value)
        if (!sameSettings(accepted, draft)) throw new Error(t('saveNotApplied'))
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : String(saveError))
      } finally {
        setSaving(false)
      }
    }

    // 离开页面即卸载,草稿随组件状态丢弃(官方约定:只有保存才写入)。
    return h('div', { style: formStyle, 'data-hashline-config': '' },
      snapshot.status === 'loading'
        ? h('p', { style: uiStyles.status }, t('loading'))
        : snapshot.status !== 'ready'
          ? h('p', { style: uiStyles.status }, t('unavailable'))
          : h(React.Fragment, null,
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
          field: 'replaceBuiltinEditInHeadless', value: draft.replaceBuiltinEditInHeadless, disabled: !editable,
          overridden: hasOwn(snapshot.user, 'replaceBuiltinEditInHeadless'),
          onChange: function (next: boolean) { change('replaceBuiltinEditInHeadless', next) },
        }),
        h(ToggleRow, {
          field: 'promptGuidance', value: draft.promptGuidance, disabled: !editable,
          overridden: hasOwn(snapshot.user, 'promptGuidance'),
          onChange: function (next: boolean) { change('promptGuidance', next) },
        }),
        h(ToggleRow, {
          field: 'zhPrompt', value: draft.zhPrompt, disabled: !editable,
          overridden: hasOwn(snapshot.user, 'zhPrompt'),
          onChange: function (next: boolean) { change('zhPrompt', next) },
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
            disabled: !editable || !dirty || !valid,
            style: Object.assign({}, uiStyles.primaryButton, controlDisabledStyle(!editable || !dirty || !valid)),
            onClick: function () { void save() },
          }, saving ? t('saving') : t('save')))))
  }
}

interface HashlineReadLine {
  number: number
  hash: string
  text: string
}

interface HashlineReadView {
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
  if (block.isError === true) return undefined
  // DSH 0.1.2 起 presentResult 视图（block.resultView）已被整体移除；读取卡的
  // 数据源是 Host output.presentationMeta 持久化进 tool/result 的 block.meta
  // （{ path, offset, lines: [{ number, hash, text }], totalLines, lang? }）。
  // 行结构的哈希校验天然排除官方 read 的无哈希投影与其它工具的 meta。
  const view = block.meta
  if (view === null || typeof view !== 'object' || Array.isArray(view)) return undefined
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
    path: view.path, offset: view.offset, lines, totalLines: view.totalLines,
    ...(view.lang === undefined ? {} : { lang: view.lang }),
  }
}

interface HashlineDiffHunk {
  path: string
  oldText: string | null
  newText: string
  /** hunk 在旧文件中的 1 基起始行号;旧回放 meta 无此字段时缺省,gutter 退化为 -|HASH。 */
  oldStart?: number
  /** hunk 在新文件中的 1 基起始行号;同上。 */
  newStart?: number
  oldHashes: string[]
  newHashes: string[]
}

/**
 * 校验哈希数组长度与文本行数一致（哈希长度是行数真值）。文本为空字符串时无法区分
 * “无行”与“单个空行”（两者 join 结果都是 ''），因此额外兼容 0 行形状。
 */
function diffLineCountMatches(text: string | null, hashes: string[]): boolean {
  if (text === null) return hashes.length === 0
  return hashes.length === text.split('\n').length || (text === '' && hashes.length === 0)
}

function normalizeHashlineDiff(value: unknown): HashlineDiffHunk | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const diff = value as Record<string, unknown>
  if (typeof diff.path !== 'string' || (diff.oldText !== null && typeof diff.oldText !== 'string') || typeof diff.newText !== 'string') return undefined
  if (!Array.isArray(diff.oldHashes) || !Array.isArray(diff.newHashes)) return undefined
  if (!diff.oldHashes.every(hash => typeof hash === 'string' && HASHLINE_RE.test(hash))) return undefined
  if (!diff.newHashes.every(hash => typeof hash === 'string' && HASHLINE_RE.test(hash))) return undefined
    if (!diffLineCountMatches(diff.oldText as string | null, diff.oldHashes as string[])) return undefined
    if (!diffLineCountMatches(diff.newText, diff.newHashes as string[])) return undefined
    if (diff.oldStart !== undefined && (typeof diff.oldStart !== 'number' || !Number.isSafeInteger(diff.oldStart))) return undefined
    if (diff.newStart !== undefined && (typeof diff.newStart !== 'number' || !Number.isSafeInteger(diff.newStart))) return undefined
    return {
      path: diff.path,
      oldText: diff.oldText as string | null,
      newText: diff.newText,
      ...(diff.oldStart === undefined ? {} : { oldStart: diff.oldStart }),
      ...(diff.newStart === undefined ? {} : { newStart: diff.newStart }),
      oldHashes: diff.oldHashes as string[],
      newHashes: diff.newHashes as string[],
    }
  }

function hashlineDiffs(block: any): HashlineDiffHunk[] | undefined {
  if (block === null || typeof block !== 'object' || block.kind !== 'tool-result' || block.isError === true) return undefined
  // 与读取卡同源：block.meta 携带 presentationMeta 投影的 { diffs }（旧
  // resultView.card === 'diff' 通道在 DSH 0.1.2 中已不存在）。
  const meta = block.meta
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return undefined
  if (!Array.isArray(meta.diffs) || meta.diffs.length === 0) return undefined
  const diffs = meta.diffs.map(normalizeHashlineDiff)
  return diffs.every((diff: HashlineDiffHunk | undefined) => diff !== undefined) ? diffs as HashlineDiffHunk[] : undefined
}

/**
 * 从已结算的工具结果中拉平错误文本（与原生 toolRowModel.resultText 同义）。
 * 错误结果的 content 里带 `Error: ...` 文本块；空 content 时回退结构化 error 的 name:code。
 * 用于让 Hashline 替换后的 read/edit 行在失败时也能展示错误详情（而非不可展开的空卡）。
 */
function hashlineResultText(block: any): string {
  if (block === null || typeof block !== 'object' || block.kind !== 'tool-result') return ''
  const parts: string[] = []
  const content = block.content
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part !== null && typeof part === 'object' && typeof part.text === 'string') parts.push(part.text)
      else if (part !== null && typeof part === 'object') parts.push(JSON.stringify(part))
    }
  }
  if (parts.length === 0 && block.error !== undefined && block.error !== null && typeof block.error === 'object') {
    const name = typeof block.error.name === 'string' ? block.error.name : 'ToolError'
    const code = typeof block.error.code === 'string' ? block.error.code : undefined
    parts.push(code === undefined ? name : `${name}: ${code}`)
  }
  return parts.join('\n')
}

function firstLineOf(text: string): string {
  const nl = text.indexOf('\n')
  return nl === -1 ? text : text.slice(0, nl)
}

/** 标题行的文件路径链接:shrink-to-fit,点击/键盘打开文件且不冒泡触发行展开。 */
function pathLinkButton(h: any, path: string, openPath: (event: any) => void): any {
  return h('button', {
    type: 'button', style: uiStyles.toolLink, onClick: openPath,
    onKeyDown: function (event: any) { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation() },
  }, path)
}

/**
 * 对齐原生 ToolRow 的错误态展开 body：ioCard（OUT 标签 + 红字完整错误）+ Inspect。
 * 原生 .ioCard / .ioSection / .ioLabel / .ioText[data-error] 的结构与配色在此复刻。
 */
/**
 * 对齐原生 ToolRow 的展开 body：ioCard（OUT 标签 + 文本）+ Inspect。成功回退
 * 不带 data-error；错误态传 error: true 复刻原生红字。原生 .ioCard / .ioSection /
 * .ioLabel / .ioText[data-error] 的结构与配色在此复刻。
 */
function outIoCard(text: string, options: { error?: boolean; inspect?: (() => void) | undefined }): any {
  const h = React.createElement
  return h(React.Fragment, null,
    h('div', { style: uiStyles.ioCard },
      h('div', { style: uiStyles.ioSection },
        h('span', { style: uiStyles.ioLabel }, 'OUT'),
        h('span', Object.assign({ style: uiStyles.ioText }, options.error ? { 'data-error': true } : {}), text))),
    options.inspect === undefined ? null : h('button', { type: 'button', style: uiStyles.toolInspect, onClick: options.inspect }, 'Inspect'))
}

function errorIoCard(errorText: string, inspect: (() => void) | undefined, path?: string): any {
  const h = React.createElement
  return h(React.Fragment, null,
    path === undefined || path === '' ? null : h('div', { style: uiStyles.errorPath }, path),
    outIoCard(errorText, { error: true, inspect }))
}

/**
 * 对齐原生 ToolRow 的 screen-reader 状态文本：错误/运行中输出英文（dsh-zh 的
 * DOM 改写层会在中文界面把 'Failed' 译成「失败」），成功态无文本。
 */
function rowStatusText(state: string): string | null {
  if (state === 'error') return 'Failed'
  if (state === 'ongoing') return 'Running'
  return null
}

type HashlineDiffRow =
  | { kind: 'path'; text: string }
  | { kind: 'gap'; text: string }
  | { kind: 'del'; sign: '-'; hash: string; text: string; number?: number }
  | { kind: 'add'; sign: '+'; hash: string; text: string; number?: number }

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
      if (diff.path === previousPath) rows.push({ kind: 'gap', text: '⋯' })
    previousPath = diff.path
      textLines(diff.oldText).forEach(function (text, index) {
        rows.push({ kind: 'del', sign: '-', hash: diff.oldHashes[index], text,
          ...(diff.oldStart === undefined ? {} : { number: diff.oldStart + index }) })
        removed += 1
      })
      textLines(diff.newText).forEach(function (text, index) {
        rows.push({ kind: 'add', sign: '+', hash: diff.newHashes[index], text,
          ...(diff.newStart === undefined ? {} : { number: diff.newStart + index }) })
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
        if (row.kind === 'path') return null
        if (row.kind === 'gap') return h('div', { key: `${keyPrefix}-${index}`, style: uiStyles.diffGap }, row.text)
        const contentStyle = row.kind === 'del' ? uiStyles.diffDelContent : uiStyles.diffAddContent
        return h('div', { key: `${keyPrefix}-${index}`, style: uiStyles.diffLine },
          h('span', { style: uiStyles.diffGutter, 'aria-hidden': true }, `${row.sign}${row.number === undefined ? '' : row.number}|${row.hash}  `),
          h('span', { style: contentStyle }, row.text))
      })
    }
    // 顶部 banner 复刻 ReadBlock:左侧完整路径 label(与读取 banner 同源 displayPath),右侧复制按钮;
    // 与正文之间的间距由 banner 的 padding/背景与 scroll 的 padding 自然分隔,与读取卡一致。
    const bannerPath = diffs[0]?.path ?? ''
    return h('div', { style: uiStyles.diffBody, 'data-hashline-diff': '' },
      bannerPath === '' ? null : h('div', { style: uiStyles.diffBanner },
        h('div', { style: uiStyles.diffBannerLabel }, bannerPath),
        h('button', { type: 'button', style: uiStyles.diffCopy, onClick: copy }, copied ? '复制成功' : '复制')),
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
      // 失败时 content 里带 `Error: ...` 文本；用于展开详情和折叠摘要，与原生
      // FileMutationRow 的 output / errorSummary 保持一致（错误不可展开即此 bug）。
        const errorText = error ? hashlineResultText(props.block) : ''
        // PTC（run_code 程序模式）子调用的投影没有 block.meta（tool/code-dispatch
        // 事件不携带 meta）；成功结果回退为 OUT 文本展开，与 shipped 工具行的
        // 子调用展开一致。hashlineResultText 对非结算块返回 ''，running 行保持不可展开。
        const outputText = errorText === '' && diffs === undefined ? hashlineResultText(props.block) : ''
        const expandable = diffs !== undefined || errorText !== '' || outputText !== ''
      const isOpen = open && expandable
      const openPath = function (event: any) {
        event.stopPropagation()
        if (path !== '') props.openFile(path)
      }

      const state = running ? 'ongoing' : error ? 'error' : 'done'
      const errorLine = errorText === '' ? null : h('span', { style: uiStyles.errorSummary, title: errorText }, firstLineOf(errorText))
        // 错误行折叠摘要只显示错误首行(路径与完整错误在展开体查看);
        // keepContentWhenOpen 让展开时该摘要仍留在标题行。
        const collapsedContent = errorLine !== null ? h(React.Fragment, null,
          h('span', { style: uiStyles.toolSep, 'aria-hidden': true }),
          errorLine) : path === '' ? null : h(React.Fragment, null,
          h('span', { style: uiStyles.toolSep, 'aria-hidden': true }),
          pathLinkButton(h, path, openPath))
          const body = !isOpen ? null : errorText !== '' ? errorIoCard(errorText, props.inspect, path) : diffs !== undefined ? h(React.Fragment, null,
          h(HashlineDiffBlock, { diffs, maxLines: 8 }),
          props.inspect === undefined ? null : h('button', {
            type: 'button', style: uiStyles.toolInspect, onClick: props.inspect,
          }, 'Inspect')) : outputText !== '' ? outIoCard(outputText, { inspect: props.inspect }) : null
      const status = rowStatusText(state)
      return h('div', { 'data-variant': 'edit', 'data-tool': props.toolName, 'data-state': state, style: uiStyles.toolRow },
        status === null ? null : h('span', { style: uiStyles.visuallyHidden }, status),
        h(DisclosureRow, {
          icon: h(StateDot, { state }),
          title: 'Edit',
          open: isOpen,
          expandable,
          onToggle: function () { setOpen(!open) },
          expandOnRowClick: true,
            previewChevron: expandable,
          keepContentWhenOpen: true,
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
  function createHashlineReadRow(fallbackT: (key: string, params?: Record<string, unknown>) => string): (props: any) => any {
    const h = React.createElement
    return function HashlineReadRow(props: any): any {
      // 注册声明 locale 后框架注入 t 座位（随界面语言切换重渲染）；
      // 未注入的旧宿主回退 apply 闭包里的 bind 结果。
      const t = typeof props.t === 'function' ? props.t : fallbackT
      const view = hashlineReadView(props.block)
      const [open, setOpen] = React.useState(false)
      const path = filePathFromBlock(props.block) ?? view?.path ?? props.callId ?? ''
      const running = props.block?.kind !== 'tool-result'
      const error = props.block?.kind === 'tool-result' && props.block.isError === true
        const errorText = error ? hashlineResultText(props.block) : ''
        // 同 HashlineEditRow：PTC 子调用无 block.meta 时，成功结果回退 OUT 文本展开。
        const outputText = errorText === '' && view === undefined ? hashlineResultText(props.block) : ''
        const expandable = view !== undefined || errorText !== '' || outputText !== ''
      const isOpen = open && expandable
      const openPath = function (event: any) {
        event.stopPropagation()
        if (path !== '') props.openFile(path)
      }
      const lines = view?.lines.map(function (line) {
        return { number: `${line.number}|${line.hash}`, text: line.text }
      }) ?? []
      // ReadBlock 自 0.1.1-rc 起把 chrome 文案作为必需 labels 传入（缺省会在
      // 展开渲染时抛 TypeError，读取卡无法展开）；copy/copied/collapse 取自
      // DSH 共享 common vocabulary，窗口与展开词条来自本插件 namespace。
      const readLabels = React.useMemo(function () {
        return {
          window: function (shown: number, total: number) { return t('read.window', { shown, total }) },
          copy: t('copy'),
          copied: t('copied'),
          collapseAria: t('read.collapseAria'),
          expandAria: function (count: number) { return t('read.expandAria', { count }) },
          collapse: t('collapse'),
          expand: function (count: number) { return t('read.expandRest', { count }) },
        }
      }, [t])
      const state = running ? 'ongoing' : error ? 'error' : 'done'
      const errorLine = errorText === '' ? null : h('span', { style: uiStyles.errorSummary, title: errorText }, firstLineOf(errorText))
        // 错误行折叠摘要只显示错误首行(路径与完整错误在展开体查看);
        // keepContentWhenOpen 让展开时该摘要仍留在标题行。
        const collapsedContent = errorLine !== null ? h(React.Fragment, null,
          h('span', { style: uiStyles.toolSep, 'aria-hidden': true }),
          errorLine) : path === '' ? null : h(React.Fragment, null,
          h('span', { style: uiStyles.toolSep, 'aria-hidden': true }),
          pathLinkButton(h, path, openPath))
          const body = !isOpen ? null : errorText !== '' ? errorIoCard(errorText, props.inspect, path) : view !== undefined ? h(React.Fragment, null,
          // ReadBlock 只接受 className 定位；外边距由插件自己的包裹元素承担。
          h('div', { style: uiStyles.readBody },
            h(ReadBlock, {
              label: view.path,
              labels: readLabels,
              lines,
              totalLines: view.totalLines,
              lang: view.lang,
              maxLines: 8,
            })),
          props.inspect === undefined ? null : h('button', {
            type: 'button', style: uiStyles.toolInspect, onClick: props.inspect,
          }, 'Inspect')) : outputText !== '' ? outIoCard(outputText, { inspect: props.inspect }) : null
      const status = rowStatusText(state)
      return h('div', { 'data-variant': 'read', 'data-tool': props.toolName, 'data-state': state, style: uiStyles.toolRow },
        status === null ? null : h('span', { style: uiStyles.visuallyHidden }, status),
        h(DisclosureRow, {
          icon: h(StateDot, { state }),
          title: 'Read',
          open: isOpen,
          expandable,
          onToggle: function () { setOpen(!open) },
          expandOnRowClick: true,
            previewChevron: expandable,
          keepContentWhenOpen: true,
          collapsedContent,
        }, body))
    }
  }
function apply(ctx: any): void {
  const t = ctx.locale.bind(LOCALE_NAMESPACE)
  // 旧 settingsScope 已随 settings 命名空间退役;经 configForms 按入口 id
  // 取 ConfigForm:snapshot/subscribe/set 面与旧 settingsScope 同构。
  const configForms = ctx.configForms
  const scope = configForms !== undefined && configForms !== null && typeof configForms.get === 'function'
    ? configForms.get(CONFIG_ENTRY_ID)
    : undefined
  const ConfigPage = scope === undefined ? undefined : createForm(scope, t)
  ctx.effect(function () {
    return ctx.locale.register(LOCALE_NAMESPACE, { zh, en })
  }, 'dsh-hashline: settings dictionaries')
  // 插件页组合包页面:键必须是 profile 里本包的 npm 包名(见
  // plugins.bundle.config 槽位契约);读写走 configForms(行 config)。
  if (ConfigPage !== undefined) {
    ctx.slots.inject('plugins.bundle.config', function () {
      return ctx.slots.register({
        name: 'plugins.bundle.config',
        key: BUNDLE_PACKAGE_NAME,
        locale: LOCALE_NAMESPACE,
      }, ConfigPage)
    })
  } else {
    console.warn('[dsh-hashline] configForms 服务不可用,设置卡片未注册')
  }
  const HashlineReadRow = createHashlineReadRow(t)
  const HashlineEditRow = createHashlineEditRow()

  ctx.slots.inject('tool.call.toolview', function* () {
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'hashline_read', locale: LOCALE_NAMESPACE }, HashlineReadRow)
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'hashline_edit', locale: LOCALE_NAMESPACE }, HashlineEditRow)
  })
  // 只有 Host 确实用 Hashline 替换内置 read 时才接管 shipped `read-row`；
  // 默认模式绝不遮蔽普通内置 read 的原生工具卡。configForms 不可用时跳过
  // (无从得知 Host 侧 replaceBuiltinEdit,保持默认不接管)。
  if (scope !== undefined) {
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
            yield ctx.slots.register({ name: 'tool.call.toolview', key: 'read', priority: -100, locale: LOCALE_NAMESPACE }, HashlineReadRow)
            yield ctx.slots.register({ name: 'tool.call.toolview', key: 'edit', priority: -100, locale: LOCALE_NAMESPACE }, HashlineEditRow)
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
}

export const inject = ['slots', 'locale', 'connection', 'configForms']
export { apply }
