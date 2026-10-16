/**
 * The plugin's settings section on the DSH 0.2+ Plugins page (`plugins.bundle.config`).
 *
 * Fields are the host Config's `.volatile()` keys, edited through the host's shared
 * `configForms` entry form and saved together with the host `SettingsForm` (staged:
 * only Save writes). The improvement mode lives here since the composer button lost
 * its switch.
 *
 * Host primitives are reached through the runtime `require` the module loader gives the
 * bundle, and described structurally here, so a primitives version skew degrades to "no
 * settings section" instead of breaking the composer button.
 *
 * @module dsh-smart-prompt/client/settings
 */

import React from 'react'
import { NS } from './locales.js'

/** Profile entry id of the host half (cordis.patch.yml) — the configForms key. */
export const ENTRY_ID = 'dsh-smart-prompt'
/** Package name — the `plugins.bundle.config` key. */
export const PACKAGE_NAME = 'dsh-smart-prompt'

/** Field names, as declared in the host Config. */
export const FIELD = {
  mode: 'defaultMode',
  source: 'modelSource',
  provider: 'provider',
  model: 'model',
  effort: 'dedicatedReasoningEffort',
  maxQuestions: 'maxQuestions',
} as const

/** Shown when the field is empty; must match `DEFAULT_MAX_QUESTIONS` in the host config. */
const DEFAULT_MAX_QUESTIONS = 5
/** Smallest accepted question cap (the host schema's `min(1)`). */
const MIN_QUESTIONS = 1

export type TFn = (key: string) => string
type Mode = 'standard' | 'light'
type Source = 'conversation' | 'dedicated'

/** One provider group of the host model catalog (`remote.session.modelCatalog()`). */
export interface CatalogGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly {
    readonly id: string
    readonly name: string
    readonly reasoning?: { readonly efforts: readonly { readonly id: string; readonly name: string }[]; readonly defaultEffort?: string }
  }[]
}

interface FieldState { text: string; overridden: boolean; invalid: boolean }
interface Shell { available: boolean; writable: boolean; dirty: boolean; invalid: boolean; saving: boolean; failed: boolean }
interface Store<S> { getSnapshot(): S; subscribe(listener: () => void): () => void }
interface FormModel {
  bind<S>(project: () => S): Store<S>
  shell(): Shell
  field(name: string): FieldState
  actions(): { edit(field: string, text: string): void; resetField(field: string): void; save(): void; discard(): void }
  dispose(): void
}
/** The subset of `@deepseek-ai/dsh-client-ui-primitives` this section uses. */
export interface Primitives {
  SettingsFormModel: new (scope: unknown, specs: unknown[]) => FormModel
  settingsTextField(field: string): unknown
  settingsNumberField(field: string): unknown
  SettingsForm: React.ComponentType<{ labels: Record<string, string>; state: Shell; onSave: () => void; onDiscard: () => void; children?: React.ReactNode }>
  SegmentedControl: React.ComponentType<{ id: string; value: string; options: readonly { value: string; label: string }[]; onChange: (next: string) => void; label: string; disabled?: boolean }>
}

/** What the section renders. */
export interface SettingsState extends Shell {
  mode: Mode
  source: Source
  provider: string
  model: string
  effort: string
  /** Draft text of the question cap; empty means the default. */
  maxQuestions: string
  catalog: { status: 'idle' | 'loading' | 'ready' | 'error'; groups: readonly CatalogGroup[] }
}

/** Separator inside the `<select>` value; provider/model ids never contain it. */
const ROUTE_SEP = '\u0000'

/** Mode and source fields store a closed set; anything else reads as the default. */
function pick<T extends string>(text: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(text) ? (text as T) : fallback
}

/**
 * Build the section's state store and actions over one configForms entry.
 *
 * @param primitives - host settings primitives.
 * @param scope - `configForms.get(ENTRY_ID)`.
 * @param loadCatalog - reads the host model catalog.
 * @returns the store, the actions the component injects, and a disposer.
 */
export function settingsSection(
  primitives: Primitives,
  scope: unknown,
  loadCatalog: () => Promise<readonly CatalogGroup[] | undefined>,
): { store: Store<SettingsState>; actions: SettingsActions; dispose: () => void } {
  const form = new primitives.SettingsFormModel(scope, [
    primitives.settingsTextField(FIELD.mode),
    primitives.settingsTextField(FIELD.source),
    primitives.settingsTextField(FIELD.provider),
    primitives.settingsTextField(FIELD.model),
    primitives.settingsTextField(FIELD.effort),
    primitives.settingsNumberField(FIELD.maxQuestions),
  ])
  let catalog: SettingsState['catalog'] = { status: 'idle', groups: [] }
  const catalogListeners = new Set<() => void>()
  const formStore = form.bind(() => {
    const source = pick<Source>(form.field(FIELD.source).text, ['conversation', 'dedicated'], 'conversation')
    const provider = form.field(FIELD.provider).text
    const model = form.field(FIELD.model).text
    const maxQuestions = form.field(FIELD.maxQuestions).text
    const shell = form.shell()
    return {
      ...shell,
      // "Dedicated" without a model would silently fall back to the conversation's
      // model, so it blocks the save instead. The host schema rejects a cap below 1
      // or a fraction, so those block the save here too.
      invalid: shell.invalid || (source === 'dedicated' && (provider === '' || model === ''))
        || (maxQuestions !== '' && !validQuestionCap(maxQuestions)),
      mode: pick<Mode>(form.field(FIELD.mode).text, ['standard', 'light'], 'standard'),
      source,
      provider,
      model,
      effort: form.field(FIELD.effort).text,
      maxQuestions,
    }
  })
  // The model catalog is fetched state, not form state: merge it in with a cached
  // snapshot so selectors see a stable reference between changes.
  let cachedForm: ReturnType<typeof formStore.getSnapshot> | undefined
  let cachedOut: SettingsState | undefined
  const stable: Store<SettingsState> = {
    getSnapshot: () => {
      const current = formStore.getSnapshot()
      if (cachedOut === undefined || cachedForm !== current || cachedOut.catalog !== catalog) {
        cachedForm = current
        cachedOut = { ...current, catalog }
      }
      return cachedOut
    },
    subscribe: (listener) => {
      catalogListeners.add(listener)
      const off = formStore.subscribe(listener)
      return () => { catalogListeners.delete(listener); off() }
    },
  }
  const setCatalog = (next: SettingsState['catalog']): void => {
    catalog = next
    for (const listener of catalogListeners) listener()
  }
  let disposed = false
  const refreshCatalog = (): void => {
    if (disposed || catalog.status === 'loading') return
    setCatalog({ status: 'loading', groups: catalog.groups })
    void loadCatalog().then((groups) => {
      if (!disposed) setCatalog(groups === undefined ? { status: 'error', groups: [] } : { status: 'ready', groups })
    }, () => { if (!disposed) setCatalog({ status: 'error', groups: [] }) })
  }
  const base = form.actions()
  const actions: SettingsActions = {
    save: base.save,
    discard: base.discard,
    setMode: (mode) => { base.edit(FIELD.mode, mode) },
    setSource: (source) => {
      base.edit(FIELD.source, source)
      if (source === 'dedicated') refreshCatalog()
    },
    setRoute: (provider, model, effort) => {
      base.edit(FIELD.provider, provider)
      base.edit(FIELD.model, model)
      base.edit(FIELD.effort, effort)
    },
    setEffort: (effort) => { base.edit(FIELD.effort, effort) },
    setMaxQuestions: (text) => { base.edit(FIELD.maxQuestions, text) },
    refreshCatalog,
  }
  if (stable.getSnapshot().source === 'dedicated') refreshCatalog()
  return { store: stable, actions, dispose: () => { disposed = true; form.dispose() } }
}

function validQuestionCap(text: string): boolean {
  const value = Number(text)
  return Number.isInteger(value) && value >= MIN_QUESTIONS
}

/** Actions the section's slot entry injects. */
export interface SettingsActions {
  save(): void
  discard(): void
  setMode(mode: Mode): void
  setSource(source: Source): void
  setRoute(provider: string, model: string, effort: string): void
  setEffort(effort: string): void
  setMaxQuestions(text: string): void
  refreshCatalog(): void
}

/** Props the slot hands the section: injected actions, bound hook, locale, view. */
export type SettingsProps = SettingsActions & {
  view: 'summary' | 'page'
  t: TFn
  useSmartPromptSettings: (selector: (state: SettingsState) => SettingsState) => SettingsState
}

/**
 * Render the settings section.
 *
 * @param primitives - host settings primitives.
 * @returns the slot component.
 */
export function SettingsSection(primitives: Primitives): (props: SettingsProps) => React.ReactElement | null {
  const { SettingsForm, SegmentedControl } = primitives
  return function SmartPromptSettings(props: SettingsProps): React.ReactElement | null {
    const { t } = props
    const state = props.useSmartPromptSettings((s) => s)
    const baseId = React.useId()
    if (props.view === 'summary') return null
    const disabled = !state.writable || state.saving

    const models = state.catalog.groups.flatMap((group) => group.models.map((model) => ({ group, model })))
    const current = models.find((m) => m.group.id === state.provider && m.model.id === state.model)
    const efforts = current?.model.reasoning?.efforts ?? []
    const routeValue = state.provider !== '' && state.model !== '' ? state.provider + ROUTE_SEP + state.model : ''

    const row = (label: string, hint: string, control: React.ReactNode): React.ReactElement =>
      React.createElement('div', { className: 'dip-set-row' },
        React.createElement('div', { className: 'dip-set-text' },
          React.createElement('div', { className: 'dip-set-label' }, label),
          React.createElement('div', { className: 'dip-set-hint' }, hint)),
        React.createElement('div', { className: 'dip-set-control' }, control))

    return React.createElement(SettingsForm, {
      labels: {
        unavailable: t('settingsUnavailable'),
        readOnly: t('settingsReadOnly'),
        saveFailed: t('settingsSaveFailed'),
        save: t('settingsSave'),
        saving: t('settingsSaving'),
      },
      state,
      onSave: props.save,
      onDiscard: props.discard,
    },
    row(t('settingsMode'), state.mode === 'light' ? t('modeLightHint') : t('modeStandardHint'),
      React.createElement(SegmentedControl, {
        id: baseId + '-mode',
        value: state.mode,
        label: t('settingsMode'),
        disabled,
        options: [{ value: 'standard', label: t('modeStandard') }, { value: 'light', label: t('modeLight') }],
        onChange: (next) => { props.setMode(next as Mode) },
      })),
    row(t('settingsModel'), state.source === 'dedicated' ? t('settingsModelDedicatedHint') : t('settingsModelConversationHint'),
      React.createElement(SegmentedControl, {
        id: baseId + '-source',
        value: state.source,
        label: t('settingsModel'),
        disabled,
        options: [{ value: 'conversation', label: t('settingsModelConversation') }, { value: 'dedicated', label: t('settingsModelDedicated') }],
        onChange: (next) => { props.setSource(next as Source) },
      })),
    state.source === 'dedicated'
      ? React.createElement('div', { className: 'dip-set-dedicated' },
        state.catalog.status === 'error'
          ? React.createElement('p', { className: 'dip-set-error', role: 'alert' }, t('settingsCatalogError'), ' ',
            React.createElement('button', { type: 'button', className: 'dip-set-link', onClick: props.refreshCatalog }, t('settingsRetry')))
          : null,
        React.createElement('label', { className: 'dip-set-field' },
          React.createElement('span', { className: 'dip-set-label' }, t('settingsPickModel')),
          React.createElement('select', {
            className: 'dip-set-select',
            value: routeValue,
            disabled: disabled || state.catalog.status === 'loading',
            onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
              const [provider = '', model = ''] = event.target.value.split(ROUTE_SEP)
              const picked = models.find((m) => m.group.id === provider && m.model.id === model)
              props.setRoute(provider, model, picked?.model.reasoning?.defaultEffort ?? '')
            },
          },
          React.createElement('option', { value: '', disabled: true },
            state.catalog.status === 'loading' ? t('settingsLoadingModels') : t('settingsChooseModel')),
          // A saved model the catalog no longer lists stays selectable, so the form never
          // silently drops it.
          routeValue !== '' && current === undefined
            ? React.createElement('option', { value: routeValue }, state.provider + '/' + state.model + ' · ' + t('settingsUnavailableModel'))
            : null,
          ...state.catalog.groups.map((group) => React.createElement('optgroup', { key: group.id, label: group.name },
            ...group.models.map((model) => React.createElement('option', { key: model.id, value: group.id + ROUTE_SEP + model.id }, model.name)))),
          )),
        efforts.length > 0
          ? React.createElement('label', { className: 'dip-set-field' },
            React.createElement('span', { className: 'dip-set-label' }, t('settingsEffort')),
            React.createElement('select', {
              className: 'dip-set-select',
              value: state.effort,
              disabled,
              onChange: (event: React.ChangeEvent<HTMLSelectElement>) => { props.setEffort(event.target.value) },
            },
            React.createElement('option', { value: '' }, t('settingsEffortDefault')),
            ...efforts.map((effort) => React.createElement('option', { key: effort.id, value: effort.id }, effort.name))))
          : null,
        state.provider === '' || state.model === ''
          ? React.createElement('p', { className: 'dip-set-error' }, t('settingsPickModelRequired'))
          : null)
      : null,
    row(t('settingsMaxQuestions'), t('settingsMaxQuestionsHint'),
      React.createElement('input', {
        className: 'dip-set-number',
        type: 'number',
        min: MIN_QUESTIONS,
        step: 1,
        inputMode: 'numeric',
        'aria-label': t('settingsMaxQuestions'),
        placeholder: String(DEFAULT_MAX_QUESTIONS),
        value: state.maxQuestions,
        disabled,
        'aria-invalid': state.maxQuestions !== '' && !validQuestionCap(state.maxQuestions),
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => { props.setMaxQuestions(event.target.value) },
      })),
    )
  }
}

/** Locale namespace the section's copy lives in. */
export const SETTINGS_NS = NS
