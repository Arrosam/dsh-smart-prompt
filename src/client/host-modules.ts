/**
 * Modules the host's module loader serves to this bundle at run time (see the tsdown externals).
 *
 * @module dsh-smart-prompt/client/host-modules
 */

/** The module loader's require, when the bundle runs under it. */
declare const require: ((id: string) => unknown) | undefined

/**
 * One host-served module, read when it is needed rather than at bundle load, so a host (or a
 * harness) without it still runs everything that does not need it.
 *
 * @param id - the module's specifier.
 * @returns its exports, or undefined when the loader is absent or does not serve it.
 */
export function hostModule(id: string): unknown {
  try {
    return typeof require === 'function' ? require(id) : undefined
  } catch {
    return undefined
  }
}
