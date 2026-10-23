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
import {
  DEFAULT_LOOKUP_ROUNDS, DEFAULT_MAX_QUESTIONS, DEFAULT_MODE, DEFAULT_MODEL_SOURCE, DEFAULT_STARDEA_IDEAS, DEFAULT_STARDEA_ROUNDS,
  DEFAULT_STARDEA_WEB_SEARCH, MAX_LOOKUP_ROUNDS, MAX_STARDEA_IDEAS, MAX_STARDEA_ROUNDS, MIN_LOOKUP_ROUNDS, MIN_MAX_QUESTIONS,
  MIN_STARDEA_IDEAS, MIN_STARDEA_ROUNDS, MODE_VALUES, MODEL_SOURCE_VALUES, isOneOf, type Mode, type ModelSource as Source,
} from '../settings-fields.js'
import type { TFn } from './components.js'

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
  lookupRounds: 'sessionLookupRounds',
  stardeaIdeas: 'stardeaIdeas',
  stardeaRounds: 'stardeaRounds',
  stardeaWeb: 'stardeaWebSearch',
} as const

/** Bounds and placeholder of one whole-number field; must match the host Config schema. */
interface NumberSpec {
  readonly field: string
  readonly min: number
  readonly max: number
  /** Shown when the field is empty: the host default. */
  readonly fallback: number
  readonly label: string
  readonly hint: string
}

/** The whole-number fields, bounded by the same constants as the host Config schema. */
const NUMBER_FIELDS = {
  maxQuestions: { field: FIELD.maxQuestions, min: MIN_MAX_QUESTIONS, max: Infinity, fallback: DEFAULT_MAX_QUESTIONS, label: 'settingsMaxQuestions', hint: 'settingsMaxQuestionsHint' },
  lookupRounds: { field: FIELD.lookupRounds, min: MIN_LOOKUP_ROUNDS, max: MAX_LOOKUP_ROUNDS, fallback: DEFAULT_LOOKUP_ROUNDS, label: 'settingsLookupRounds', hint: 'settingsLookupRoundsHint' },
  stardeaIdeas: { field: FIELD.stardeaIdeas, min: MIN_STARDEA_IDEAS, max: MAX_STARDEA_IDEAS, fallback: DEFAULT_STARDEA_IDEAS, label: 'settingsStardeaIdeas', hint: 'settingsStardeaIdeasHint' },
  stardeaRounds: { field: FIELD.stardeaRounds, min: MIN_STARDEA_ROUNDS, max: MAX_STARDEA_ROUNDS, fallback: DEFAULT_STARDEA_ROUNDS, label: 'settingsStardeaRounds', hint: 'settingsStardeaRoundsHint' },
} as const satisfies Record<string, NumberSpec>

type NumberKey = keyof typeof NUMBER_FIELDS
/** The number fields in display order. */
const NUMBER_KEYS = Object.keys(NUMBER_FIELDS) as NumberKey[]

/** Settings-page label and hint of each mode; the display order comes from MODE_VALUES. */
const MODE_COPY: Record<Mode, { readonly label: string; readonly hint: string }> = {
  standard: { label: 'modeStandard', hint: 'modeStandardHint' },
  detailed: { label: 'modeDetailed', hint: 'modeDetailedHint' },
  light: { label: 'modeLight', hint: 'modeLightHint' },
}

/**
 * Draft text of an on/off field. The host form model stages every field as text and ships
 * only text and number specs, so a switch stages one of these and {@link settingsFlagField}
 * turns it into the boolean the host Config schema declares.
 */
const FLAG_TEXT = Object.freeze({ on: 'true', off: 'false' })

/**
 * Conversion spec of an on/off field, in the shape of the host's `settingsTextField`.
 *
 * @param field - field name in the host Config.
 * @returns the spec: an empty draft clears the field (the schema default applies again),
 *   'true'/'false' set it, anything else is invalid and blocks the save.
 */
function settingsFlagField(field: string): {
  field: string
  format: (value: unknown) => string
  parse: (text: string) => { kind: 'set'; value: boolean } | { kind: 'clear' } | undefined
} {
  return {
    field,
    format: (value) => value === true ? FLAG_TEXT.on : value === false ? FLAG_TEXT.off : '',
    parse: (text) => text === '' ? { kind: 'clear' }
      : text === FLAG_TEXT.on ? { kind: 'set', value: true }
        : text === FLAG_TEXT.off ? { kind: 'set', value: false } : undefined,
  }
}

/** A staged on/off draft as a boolean; empty (nothing saved) reads as the default. */
function flagOf(text: string, fallback: boolean): boolean {
  return text === FLAG_TEXT.on ? true : text === FLAG_TEXT.off ? false : fallback
}

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
  Switch: React.ComponentType<{ checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }>
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
  /** Draft text of the rewrite's session lookup round limit; empty means the default. */
  lookupRounds: string
  /** Draft text of the ideas per Stardea click; empty means the default. */
  stardeaIdeas: string
  /** Draft text of the lookup rounds per Stardea click; empty means the default. */
  stardeaRounds: string
  /** Whether Stardea may search the web, as staged (the default when nothing is saved). */
  stardeaWebSearch: boolean
  catalog: { status: 'idle' | 'loading' | 'ready' | 'error'; groups: readonly CatalogGroup[] }
}

/** Separator inside the `<select>` value; provider/model ids never contain it. */
const ROUTE_SEP = '\u0000'

/** Mode and source fields store a closed set; anything else reads as the default. */
function pick<T extends string>(text: string, allowed: readonly T[], fallback: T): T {
  return isOneOf(text, allowed) ? text : fallback
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
    ...NUMBER_KEYS.map((key) => primitives.settingsNumberField(NUMBER_FIELDS[key].field)),
    settingsFlagField(FIELD.stardeaWeb),
  ])
  let catalog: SettingsState['catalog'] = { status: 'idle', groups: [] }
  const catalogListeners = new Set<() => void>()
  const formStore = form.bind(() => {
    const source = pick<Source>(form.field(FIELD.source).text, MODEL_SOURCE_VALUES, DEFAULT_MODEL_SOURCE)
    const provider = form.field(FIELD.provider).text
    const model = form.field(FIELD.model).text
    const numbers = Object.fromEntries(NUMBER_KEYS.map((key) => [key, form.field(NUMBER_FIELDS[key].field).text])) as Record<NumberKey, string>
    const shell = form.shell()
    return {
      ...shell,
      // "Dedicated" without a model would silently fall back to the conversation's
      // model, so it blocks the save instead. The host schema rejects a number outside
      // its bounds or a fraction, so those block the save here too.
      invalid: shell.invalid || (source === 'dedicated' && (provider === '' || model === ''))
        || NUMBER_KEYS.some((key) => !validNumber(numbers[key], NUMBER_FIELDS[key])),
      mode: pick<Mode>(form.field(FIELD.mode).text, MODE_VALUES, DEFAULT_MODE),
      source,
      provider,
      model,
      effort: form.field(FIELD.effort).text,
      ...numbers,
      stardeaWebSearch: flagOf(form.field(FIELD.stardeaWeb).text, DEFAULT_STARDEA_WEB_SEARCH),
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
    setLookupRounds: (text) => { base.edit(FIELD.lookupRounds, text) },
    setStardeaIdeas: (text) => { base.edit(FIELD.stardeaIdeas, text) },
    setStardeaRounds: (text) => { base.edit(FIELD.stardeaRounds, text) },
    setStardeaWebSearch: (on) => { base.edit(FIELD.stardeaWeb, on ? FLAG_TEXT.on : FLAG_TEXT.off) },
    refreshCatalog,
  }
  if (stable.getSnapshot().source === 'dedicated') refreshCatalog()
  return { store: stable, actions, dispose: () => { disposed = true; form.dispose() } }
}

/** Empty (the default) or a whole number within the field's bounds. */
function validNumber(text: string, spec: NumberSpec): boolean {
  if (text === '') return true
  const value = Number(text)
  return Number.isInteger(value) && value >= spec.min && value <= spec.max
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
  setLookupRounds(text: string): void
  setStardeaIdeas(text: string): void
  setStardeaRounds(text: string): void
  setStardeaWebSearch(on: boolean): void
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
  const { SettingsForm, SegmentedControl, Switch } = primitives
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

    // One whole-number row; every number field shares the same input and validation.
    const numberRow = (key: NumberKey, onEdit: (text: string) => void): React.ReactElement => {
      const spec: NumberSpec = NUMBER_FIELDS[key]
      const value = state[key]
      return row(t(spec.label), t(spec.hint),
        React.createElement('input', {
          className: 'dip-set-number',
          type: 'number',
          min: spec.min,
          max: Number.isFinite(spec.max) ? spec.max : undefined,
          step: 1,
          inputMode: 'numeric',
          'aria-label': t(spec.label),
          placeholder: String(spec.fallback),
          value,
          disabled,
          'aria-invalid': !validNumber(value, spec),
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => { onEdit(event.target.value) },
        }))
    }

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
    row(t('settingsMode'), t(MODE_COPY[state.mode].hint),
      React.createElement(SegmentedControl, {
        id: baseId + '-mode',
        value: state.mode,
        label: t('settingsMode'),
        disabled,
        options: MODE_VALUES.map((value) => ({ value, label: t(MODE_COPY[value].label) })),
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
    numberRow('maxQuestions', props.setMaxQuestions),
    numberRow('lookupRounds', props.setLookupRounds),
    numberRow('stardeaIdeas', props.setStardeaIdeas),
    numberRow('stardeaRounds', props.setStardeaRounds),
    row(t('settingsStardeaWeb'), t('settingsStardeaWebHint'),
      React.createElement(Switch, {
        checked: state.stardeaWebSearch,
        label: t('settingsStardeaWeb'),
        disabled,
        onChange: (next) => { props.setStardeaWebSearch(next) },
      })),
    )
  }
}
