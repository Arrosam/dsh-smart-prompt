/**
 * dsh-smart-prompt — client half.
 *
 * Two slot entries and nothing else:
 * - `conversation.input.right` — the sparkle button in the composer tool row.
 * - `conversation.input.overlay` — the floating "improved · certificate" bubble. The host pins
 *   this slot's anchor at zero height to the top edge of the composer card, so the bubble
 *   never takes layout space (the `conversation.input.dock` row it used to sit in did).
 *
 * Slot contract verified against @deepseek-ai/dsh-client-ui-conversation 0.1.5-rc.1:
 * a session-scoped entry receives `useInput` + `inputActions` (the standard session
 * props) plus whatever `inject` adds — here the `sessionId`.
 *
 * @module dsh-smart-prompt/client
 */

import React from 'react'
import { ImproveButton, StatusBar, type TFn } from './components.js'
import { NS, en, zh } from './locales.js'
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
  session?: { modelCatalog?: () => Promise<{ ok: boolean; value?: { groups?: readonly CatalogGroup[] } }> }
  $on?: (event: string, listener: () => void) => () => void
}

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
  }, component: unknown): unknown
}

interface ClientContext {
  slots: SlotsFace
  locale?: LocaleFace
  effect(fn: () => unknown | (() => void), label?: string): void
  get?(name: string): unknown
}

/** The module loader's require, when the bundle runs under it. */
declare const require: ((id: string) => unknown) | undefined

function loadPrimitives(): Primitives | undefined {
  try {
    const mod = typeof require === 'function' ? require(PRIMITIVES_MODULE) as Partial<Primitives> | undefined : undefined
    return mod !== undefined && typeof mod.SettingsFormModel === 'function' && typeof mod.SettingsForm === 'function'
      && typeof mod.SegmentedControl === 'function' && typeof mod.settingsTextField === 'function'
      ? mod as Primitives
      : undefined
  } catch {
    return undefined
  }
}

type SlotProps = Record<string, unknown> & { sessionId?: string }

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

  // Composer tool row: the sparkle button, immediately before the submit action.
  ctx.effect(() => {
    try {
      return ctx.slots.inject('conversation.input.right', function* () {
        yield ctx.slots.register({
          name: 'conversation.input.right',
          id: 'dsh-smart-prompt-button',
          order: 40,
          locale: NS,
          inject: (sessionId: string) => ({ sessionId }),
        }, (slotProps: SlotProps) => React.createElement(ImproveButton, Object.assign({}, slotProps, { t }) as never))
      })
    } catch (error) {
      console.error('[dsh-smart-prompt] button slot registration failed', error)
      return () => {}
    }
  }, 'dsh-smart-prompt: composer button')

  // Floating over the transcript, just above the composer card: the certificate bubble.
  ctx.effect(() => {
    try {
      return ctx.slots.inject('conversation.input.overlay', function* () {
        yield ctx.slots.register({
          name: 'conversation.input.overlay',
          id: 'dsh-smart-prompt-bar',
          order: 40,
          locale: NS,
          inject: (sessionId: string) => ({ sessionId }),
        }, (slotProps: SlotProps) => React.createElement(StatusBar, {
          sessionId: slotProps !== undefined && typeof slotProps.sessionId === 'string' ? slotProps.sessionId : undefined,
          t,
        } as never))
      })
    } catch (error) {
      console.error('[dsh-smart-prompt] status bar slot registration failed', error)
      return () => {}
    }
  }, 'dsh-smart-prompt: status bar')

  // Plugins page (DSH 0.2+): the mode and model settings. Skipped quietly on hosts
  // without the settings services, so the composer button never depends on them.
  const configForms = ctx.get?.('configForms') as ConfigFormsFace | undefined
  const remote = ctx.get?.('remote') as RemoteFace | undefined
  const primitives = loadPrimitives()
  if (configForms === undefined || primitives === undefined) return
  const loadCatalog = async (): Promise<readonly CatalogGroup[] | undefined> => {
    const response = await remote?.session?.modelCatalog?.()
    return response?.ok === true ? response.value?.groups ?? [] : undefined
  }
  const Section = SettingsSection(primitives)
  ctx.effect(() => {
    try {
      const section = settingsSection(primitives, configForms.get(ENTRY_ID), loadCatalog)
      const stopServing = configForms.whileServed([ENTRY_ID], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
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
