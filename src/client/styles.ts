/**
 * Plugin-owned CSS, scoped by a data attribute and torn down with the fiber.
 *
 * ## Material: a plain capsule in the host's own design tokens
 *
 * The button is a single-purpose control (click = improve), so it carries no mode
 * switch, hover expansion, glow or animated light. It reuses the host's `--dsw-alias-*`
 * tokens (border, label, hover background — the same ones the composer toolbar uses)
 * so it follows the page in both themes. The Revert | Retry capsule shares the plate.
 *
 * `.dip-root` — the capsule (border + radius)
 *   `.dip-btn`     — the improve action; sparkle icon in `currentColor`
 *   `.dip-revert` / `.dip-divider` / `.dip-retry` — the refined state's two halves
 *
 * @module dsh-smart-prompt/client/styles
 */

export const STYLE_ATTR = 'dsh-smart-prompt'

/** Hover/press fill for every half of the capsule: the host's interactive hover token. */
const HOVER_BG = 'var(--dsw-alias-interactive-bg-hover)'
/** Keyboard focus ring: the host's primary business colour. */
const FOCUS_RING = 'inset 0 0 0 2px var(--dsw-alias-state-business-primary)'

export const css = [
  /* ---------- the capsule ---------- */
  '.dip-root{position:relative;display:inline-flex;align-items:stretch;height:30px;box-sizing:border-box;',
  'border:1px solid var(--dsw-alias-border-l2);border-radius:999px;overflow:hidden;user-select:none;',
  'vertical-align:middle;flex:none;background:transparent;color:var(--dsw-alias-label-secondary)}',

  /* ---------- the improve action ---------- */
  '.dip-btn,.dip-revert,.dip-retry{display:inline-flex;align-items:center;justify-content:center;gap:5px;',
  'height:100%;box-sizing:border-box;border:0;outline:none;background:transparent;color:inherit;cursor:pointer;',
  'font:inherit;font-size:12px;line-height:1;white-space:nowrap;transition:background-color .15s,color .15s}',
  '.dip-btn{padding:0 12px}',
  '.dip-revert,.dip-retry{padding:0 10px}',
  '.dip-btn:hover:not(:disabled),.dip-revert:hover,.dip-retry:hover{background:' + HOVER_BG + ';color:var(--dsw-alias-label-primary)}',
  '.dip-btn:focus-visible,.dip-revert:focus-visible,.dip-retry:focus-visible{box-shadow:' + FOCUS_RING + '}',
  '.dip-btn:disabled{cursor:default;color:var(--dsw-alias-label-tertiary)}',
  '.dip-icon{width:14px;height:14px;flex:none;display:block}',
  '.dip-capsule-icon{display:block;flex:none}',

  /* ---------- busy: the click cancels; the icon spins, as before, so the wait is visible ---------- */
  '.dip-root[data-busy="true"] .dip-btn{cursor:progress;color:var(--dsw-alias-state-business-primary)}',
  '.dip-root[data-busy="true"] .dip-icon{animation:dip-icon-spin .8s linear infinite}',

  /* ---------- refined: the Revert | Retry halves ---------- */
  '.dip-divider{width:1px;align-self:stretch;margin:7px 0;background:var(--dsw-alias-border-l2);pointer-events:none}',

  /* ---------- status bar ---------- */
  // Rendered in the host's `conversation.input.overlay` anchor: a zero-height box pinned to
  // the composer card's top edge. Positioned absolutely above it, the bubble paints over the
  // transcript inside the sticky composer layer and never changes any element's size.
  '.dip-bar{position:absolute;left:0;right:0;bottom:var(--dsh-composer-stack-gap,6px);width:fit-content;margin:0 auto;display:flex;align-items:center;gap:8px;',
  'max-width:100%;box-sizing:border-box;padding:5px 10px;',
  'border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base));',
  'font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);box-shadow:0 4px 14px rgba(0,0,0,.18)}',
  // Enter slides up and fades in; leave slides down and fades out. Only transform/opacity
  // animate, so the overlay still never changes any element's layout.
  '.dip-bar[data-state="entering"]{animation:dip-bar-in 200ms cubic-bezier(.2,.8,.2,1) both}',
  '.dip-bar[data-state="leaving"]{animation:dip-bar-out 160ms ease-in both;pointer-events:none}',
  '.dip-bar[data-kind="error"]{border-color:rgba(220,90,70,.5);color:var(--dsw-alias-label-primary)}',
  '.dip-bar-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dip-sep{opacity:.4}',

  /* ---------- settings section (Plugins page), host tokens only ---------- */
  '.dip-set-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:12px 0}',
  '.dip-set-row+.dip-set-row{border-top:.5px solid var(--dsw-alias-border-l2)}',
  '.dip-set-text{flex:1;min-width:0}',
  '.dip-set-label{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}',
  '.dip-set-hint{margin:2px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
  '.dip-set-control{flex:none}',
  '.dip-set-dedicated{display:grid;gap:10px;padding:0 0 12px}',
  '.dip-set-field{display:grid;gap:4px}',
  '.dip-set-select,.dip-set-number{height:32px;padding:0 8px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);',
  'background:var(--dsw-alias-bg-base);border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md)}',
  '.dip-set-number{width:72px}',
  '.dip-set-number[aria-invalid="true"]{border-color:var(--dsw-alias-state-error-primary)}',
  '.dip-set-error{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary)}',
  '.dip-set-link{padding:0;border:0;background:0 0;font:inherit;color:var(--dsw-alias-state-business-primary);cursor:pointer}',

  /* ---------- keyframes ---------- */
  '@keyframes dip-icon-spin{to{transform:rotate(360deg)}}',
  '@keyframes dip-bar-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
  '@keyframes dip-bar-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(6px)}}',

  /* ---------- motion preferences ---------- */
  '@media (prefers-reduced-motion: reduce){',
  '.dip-icon,.dip-btn,.dip-revert,.dip-retry,.dip-bar{animation:none!important;transition-duration:.01ms!important}',
  '}',
].join('\n')
