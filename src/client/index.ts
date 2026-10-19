/**
 * dsh-smart-prompt — client half.
 *
 * Slot entries:
 * - `conversation.input.right` — the sparkle button in the composer tool row.
 * - `conversation.input.overlay` — the floating "improved · certificate" bubble. The host pins
 *   this slot's anchor at zero height to the top edge of the composer card, so the bubble
 *   never takes layout space (the `conversation.input.dock` row it used to sit in did).
 * - `conversation.composer` (chain) — the follow-up panel, which takes the composer seat while
 *   a refine waits for answers. Only on hosts with the `uiSession` pending-interaction registry.
 * - `plugins.bundle.config` — the settings section, on hosts that serve settings forms.
 *
 * Slot contract verified against @deepseek-ai/dsh-client-ui-conversation 0.1.5-rc.1:
 * a session-scoped entry receives `useInput` + `inputActions` (the standard session
 * props) plus whatever `inject` adds — here the `sessionId`.
 *
 * @module dsh-smart-prompt/client
 */

import React from 'react'
import { ImproveButton, StatusBar, type TFn } from './components.js'
import { FollowUpPanel } from './follow-up.js'
import { NS, en, zh } from './locales.js'
import { asFollowUp, providePublisher, type FollowUpInteraction, type FollowUpPublisher } from './refine.js'
import { STYLE_ATTR, css } from './styles.js'
import { ENTRY_ID, PACKAGE_NAME, SettingsSection, settingsSection, type CatalogGroup, type Primitives } from './settings.js'

/** Required client services. */
export const inject = ['slots', 'locale']

/**
 * Host primitives module the settings section renders with. Loaded through the module
 * loader's `require` at apply time (see tsdown externals), never bundled.
 */
const PRIMITIVES_MODULE = '@deepseek-ai/dsh-client-ui-primitives'

/** Services the settings section needs; read with ctx.get so hosts without them still run the button. */
interface ConfigFormsFace {
  get(entryId: string): unknown
  whileServed(namespaces: readonly string[], register: () => () => void): () => void
}
interface RemoteFace {
  $on?: (event: string, listener: () => void) => () => void
}
interface RemoteSessionFace {
  modelCatalog?: () => Promise<{ ok: boolean; value?: { groups?: readonly CatalogGroup[] } }>
}

/**
 * The Remote `session` namespace is its own service, `remote.session`, provided once the
 * Host mounts it. Reading `remote.session` through the `remote` service throws unless the
 * plugin injects it, and injecting it would gate the composer button on it.
 */
const REMOTE_SESSION_SERVICE = 'remote.session'

interface LocaleFace {
  register(namespace: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(namespace: string): TFn
}

interface SlotsFace {
  inject(seat: string, fn: () => unknown): unknown
  register(options: {
    name: string
    id?: string
    priority?: number
    order?: number
    locale?: string
    /** Keyed slots (`plugins.bundle.config`) address the entry by key. */
    key?: string
    inject?: (sessionId: string) => unknown
    /** Chain slots (`conversation.composer`): the entry renders when this returns non-null. */
    select?: (ownerProps: { pendingInteraction?: unknown }) => unknown
  }, component: unknown): unknown
}

/** The slice of the host `uiSession` service (`@deepseek-ai/dsh-client-ui-session`) used here. */
interface UiSessionFace {
  registerPendingInteraction?: (precedence: (interaction: FollowUpInteraction) => number) => FollowUpPublisher
}

interface ClientContext {
  slots: SlotsFace
  locale?: LocaleFace
  effect(fn: () => unknown | (() => void), label?: string): void
  get?(name: string): unknown
  /** Cordis: run `apply` once every named service is provided, and undo it when one goes. */
  inject?(services: readonly string[], apply: (inner: ClientContext & Record<string, unknown>) => unknown): unknown
}

/** Host service that serves plugin settings forms (`@deepseek-ai/dsh-client-ui-settings`). */
const CONFIG_FORMS_SERVICE = 'configForms'

/**
 * Host service holding the composer seat's pending interactions. Never injected: the composer
 * button must not wait for it, so the panel is mounted whenever it appears.
 */
const UI_SESSION_SERVICE = 'uiSession'

/** Host slots this plugin fills. */
const SLOT = Object.freeze({
  button: 'conversation.input.right',
  bar: 'conversation.input.overlay',
  composer: 'conversation.composer',
  settings: 'plugins.bundle.config',
})

/** Entry id of the follow-up panel in the composer chain. */
const FOLLOW_UP_ENTRY_ID = 'dsh-smart-prompt-follow-up'

/**
 * Precedence of the follow-up panel among a session's pending interactions (larger wins).
 * Equal to the host's ordinary question card (1; its plan review is 2), so neither outranks
 * the other and a plan review still comes first.
 */
const FOLLOW_UP_PRECEDENCE = 1

/** Order of both composer entries within their slots: just before the host's submit action. */
const COMPOSER_ORDER = 40

/**
 * Register one session-scoped composer entry for the plugin's lifetime. A failed
 * registration is logged and leaves the rest of the plugin running.
 *
 * @param ctx - the plugin context that owns the registration.
 * @param slot - the slot name.
 * @param id - the entry id.
 * @param inject - extra props for the entry, per session.
 * @param render - the entry component.
 * @param label - the effect label.
 * @param logName - how the failure log names the entry.
 */
function registerComposerEntry(
  ctx: ClientContext,
  slot: string,
  id: string,
  inject: (sessionId: string) => unknown,
  render: (props: SlotProps) => unknown,
  label: string,
  logName: string,
): void {
  registerSlotEntry(ctx, { name: slot, id, order: COMPOSER_ORDER, locale: NS, inject }, render, label, logName)
}

/**
 * Register one slot entry while `ctx` lives. A failed registration is logged and leaves the
 * rest of the plugin running.
 *
 * @param ctx - the context that owns the registration.
 * @param options - the entry's registration options; `name` is the slot.
 * @param render - the entry component.
 * @param label - the effect label.
 * @param logName - how the failure log names the entry.
 */
function registerSlotEntry(
  ctx: ClientContext,
  options: Parameters<SlotsFace['register']>[0],
  render: (props: SlotProps) => unknown,
  label: string,
  logName: string,
): void {
  ctx.effect(() => {
    try {
      return ctx.slots.inject(options.name, function* () {
        yield ctx.slots.register(options, render)
      })
    } catch (error) {
      console.error('[dsh-smart-prompt] ' + logName + ' slot registration failed', error)
      return () => {}
    }
  }, 'dsh-smart-prompt: ' + label)
}

/**
 * Make the follow-up panel available while `ctx` lives: register the pending-interaction
 * domain the panel is published through, and the composer-chain entry that renders it.
 * Without the registry (older hosts) nothing happens, and refines ask no questions.
 *
 * @param ctx - context that owns the registrations (disposed with the `uiSession` service).
 * @param uiSession - the host's Session UI service, if provided.
 * @param t - localized copy lookup.
 */
function mountFollowUp(ctx: ClientContext, uiSession: UiSessionFace | undefined, t: TFn): void {
  if (typeof uiSession?.registerPendingInteraction !== 'function') return
  let publish: FollowUpPublisher
  try {
    publish = uiSession.registerPendingInteraction(() => FOLLOW_UP_PRECEDENCE)
  } catch (error) {
    console.error('[dsh-smart-prompt] follow-up registration failed; refines ask no questions', error)
    return
  }
  ctx.effect(() => providePublisher(publish), 'dsh-smart-prompt: follow-up questions')
  registerSlotEntry(ctx, {
    name: SLOT.composer,
    id: FOLLOW_UP_ENTRY_ID,
    locale: NS,
    select: ({ pendingInteraction }) => asFollowUp(pendingInteraction),
  }, (slotProps) => React.createElement(FollowUpPanel, Object.assign({}, slotProps, { t }) as never),
  'follow-up panel', 'follow-up panel')
}

/** The module loader's require, when the bundle runs under it. */
declare const require: ((id: string) => unknown) | undefined

function loadPrimitives(): Primitives | undefined {
  try {
    const mod = typeof require === 'function' ? require(PRIMITIVES_MODULE) as Partial<Primitives> | undefined : undefined
    return mod !== undefined && typeof mod.SettingsFormModel === 'function' && typeof mod.SettingsForm === 'function'
      && typeof mod.SegmentedControl === 'function' && typeof mod.Switch === 'function' && typeof mod.settingsTextField === 'function'
      && typeof mod.settingsNumberField === 'function'
      ? mod as Primitives
      : undefined
  } catch {
    return undefined
  }
}

type SlotProps = Record<string, unknown> & { sessionId?: string }

/** The slice of the host `conversation` service (`@deepseek-ai/dsh-client-ui-conversation`) used here. */
interface ConversationFace {
  serializeDraftAttachments?: (ids: readonly string[]) => Promise<{ attachments?: readonly unknown[] }>
}

/**
 * Attach the client half.
 *
 * @param ctx - client context carrying `slots` and `locale`.
 */
export function apply(ctx: ClientContext): void {
  // Fallback lookup: the UI must render something even if locale registration failed.
  let t: TFn = (key: string) => (en[key] !== undefined ? en[key]! : key)

  ctx.effect(() => {
    if (typeof document === 'undefined') return undefined
    document.querySelectorAll('style[data-plugin="' + STYLE_ATTR + '"]').forEach((node) => { node.remove() })
    const style = document.createElement('style')
    style.dataset.plugin = STYLE_ATTR
    style.textContent = css
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'dsh-smart-prompt: styles')

  if (ctx.locale !== undefined) {
    ctx.effect(() => ctx.locale!.register(NS, { zh, en }), 'dsh-smart-prompt: locale')
    try {
      t = ctx.locale.bind(NS)
    } catch (error) {
      console.error('[dsh-smart-prompt] locale bind failed; using the built-in English copy', error)
    }
  } else {
    console.error('[dsh-smart-prompt] no locale service; using the built-in English copy')
  }

  if (ctx.slots === undefined) {
    console.error('[dsh-smart-prompt] no slots service; composer entries not registered')
    return
  }

  // Draft attachments in the wire form the host's own commands receive. The service is
  // read at call time and never injected: a host without it still gets the button.
  const serializeAttachments = async (ids: readonly string[]): Promise<readonly unknown[]> => {
    const conversation = ctx.get?.('conversation') as ConversationFace | undefined
    if (typeof conversation?.serializeDraftAttachments !== 'function') return []
    return (await conversation.serializeDraftAttachments(ids)).attachments ?? []
  }

  // Composer tool row: the sparkle button, immediately before the submit action.
  registerComposerEntry(ctx, SLOT.button, 'dsh-smart-prompt-button',
    (sessionId) => ({ sessionId, serializeAttachments }),
    (slotProps) => React.createElement(ImproveButton, Object.assign({}, slotProps, { t }) as never),
    'composer button', 'button')

  // Floating over the transcript, just above the composer card: the certificate bubble.
  registerComposerEntry(ctx, SLOT.bar, 'dsh-smart-prompt-bar',
    (sessionId) => ({ sessionId }),
    (slotProps) => React.createElement(StatusBar, {
      sessionId: slotProps !== undefined && typeof slotProps.sessionId === 'string' ? slotProps.sessionId : undefined,
      t,
    } as never),
    'status bar', 'status bar')

  // Composer seat: the follow-up panel. Like `configForms` below, `uiSession` may start after
  // this plugin, and it is never on the inject list, so the composer button never waits for it.
  const followUp = (owner: ClientContext): void => {
    mountFollowUp(owner, owner.get?.(UI_SESSION_SERVICE) as UiSessionFace | undefined, t)
  }
  if (typeof ctx.inject === 'function') ctx.inject([UI_SESSION_SERVICE], followUp)
  else followUp(ctx)

  // Plugins page (DSH 0.2+): the mode and model settings. Never on the plugin's own
  // inject list, so the composer button never waits for the settings services.
  const primitives = loadPrimitives()
  if (primitives === undefined) return
  const Section = SettingsSection(primitives)
  const loadCatalog = async (): Promise<readonly CatalogGroup[] | undefined> => {
    // Read at call time: the namespace may mount after this plugin applies.
    const session = ctx.get?.(REMOTE_SESSION_SERVICE) as RemoteSessionFace | undefined
    const response = await session?.modelCatalog?.()
    return response?.ok === true ? response.value?.groups ?? [] : undefined
  }
  // DSH does not order client plugin start-up, so `configForms` may not exist yet when
  // this plugin applies; a one-off `ctx.get` then skipped the section for good (seen on
  // fresh installs). `ctx.inject` waits for the service instead, and withdraws the
  // section if the service goes away.
  const mount = (owner: ClientContext): void => {
    mountSettings(owner, owner.get?.(CONFIG_FORMS_SERVICE) as ConfigFormsFace | undefined, primitives, Section, loadCatalog, t)
  }
  if (typeof ctx.inject === 'function') ctx.inject([CONFIG_FORMS_SERVICE], mount)
  else mount(ctx)
}

/**
 * Register the settings section on the Plugins page while the host serves its entry.
 *
 * @param ctx - context that owns the registration (disposed with it).
 * @param configForms - the host settings-forms service; nothing is registered without it.
 */
function mountSettings(
  ctx: ClientContext,
  configForms: ConfigFormsFace | undefined,
  primitives: Primitives,
  Section: ReturnType<typeof SettingsSection>,
  loadCatalog: () => Promise<readonly CatalogGroup[] | undefined>,
  t: TFn,
): void {
  if (configForms === undefined) return
  const remote = ctx.get?.('remote') as RemoteFace | undefined
  ctx.effect(() => {
    try {
      const section = settingsSection(primitives, configForms.get(ENTRY_ID), loadCatalog)
      const stopServing = configForms.whileServed([ENTRY_ID], () => ctx.slots.inject(SLOT.settings, () => ctx.slots.register({
        name: SLOT.settings,
        key: PACKAGE_NAME,
        locale: NS,
        inject: () => ({ hooks: { smartPromptSettings: section.store }, ...section.actions }),
      }, (props: Record<string, unknown>) => React.createElement(Section, Object.assign({}, props, { t }) as never))) as () => void)
      // Model list changes (new adapters, edited settings) re-read the catalog.
      const offAdapters = remote?.$on?.('llm/adapters-updated', section.actions.refreshCatalog)
      return () => { stopServing(); offAdapters?.(); section.dispose() }
    } catch (error) {
      console.error('[dsh-smart-prompt] settings section registration failed', error)
      return () => {}
    }
  }, 'dsh-smart-prompt: settings section')
}
