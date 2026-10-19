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
 * `.dip-ask` — the follow-up panel in the composer seat, framed like the host's own
 * question card (same seat padding, card radius, surface and elevation tokens)
 *   `.dip-ask-original` — the draft being refined, read-only and scrollable
 *   `.dip-ask-q` — one question: `.dip-stardea` (pop/burst on click), `.dip-idea` checkboxes,
 *   `.dip-ask-error` (last Stardea note), `.dip-ask-own` (own words)
 *
 * @module dsh-smart-prompt/client/styles
 */

export const STYLE_ATTR = 'dsh-smart-prompt'

/** Hover/press fill for every half of the capsule: the host's interactive hover token. */
const HOVER_BG = 'var(--dsw-alias-interactive-bg-hover)'
/** Keyboard focus ring: the host's primary business colour. */
const FOCUS_RING = 'inset 0 0 0 2px var(--dsw-alias-state-business-primary)'
/**
 * Floating bubble shadow: the host's level-3 (floating layer) shadow. The fallback is the
 * value the bubble used before it adopted the token, for hosts that do not define it.
 */
const BUBBLE_SHADOW = 'var(--dsw-shadow-lv3,0 4px 14px rgba(0,0,0,.18))'
/** Failure bubble border: the host's error colour at half strength, as the bubble had before. */
const ERROR_BORDER = 'color-mix(in srgb,var(--dsw-alias-state-error-primary) 50%,transparent)'
/**
 * Follow-up panel surface: the tokens the host's question card uses, so the panel reads as
 * the same kind of seat takeover. Fallbacks cover hosts without the newer tokens.
 */
const PANEL_BG = 'var(--dsw-specific-input-major,var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base)))'
const PANEL_SHADOW = 'var(--dsw-elevation-panel,' + BUBBLE_SHADOW + ')'
const PANEL_RADIUS = 'var(--dsw-radius-xl,16px)'
/** Panel height cap: the host question card's, so the transcript above stays visible. */
const PANEL_MAX_HEIGHT = 'min(60vh,520px)'
/** Submit: the host's primary button fill and its foreground label colour. */
const PRIMARY_FILL = 'var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-business-primary))'
const PRIMARY_LABEL = 'var(--dsw-alias-label-primary-foreground,#fff)'
/** Outline focus ring for elements whose inset ring would be hidden (checkboxes, text fields). */
const FOCUS_OUTLINE = '2px solid var(--dsw-alias-state-business-primary)'
/** The original draft block's height cap (about five lines); longer drafts scroll inside it. */
const ORIGINAL_MAX_HEIGHT = '110px'
/** Length of one Stardea pop/burst; short enough to never delay reading the new ideas. */
const STARDEA_POP = '420ms cubic-bezier(.2,.8,.2,1) both'

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
  'font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);box-shadow:' + BUBBLE_SHADOW + '}',
  // Enter slides up and fades in; leave slides down and fades out. Only transform/opacity
  // animate, so the overlay still never changes any element's layout.
  '.dip-bar[data-state="entering"]{animation:dip-bar-in 200ms cubic-bezier(.2,.8,.2,1) both}',
  '.dip-bar[data-state="leaving"]{animation:dip-bar-out 160ms ease-in both;pointer-events:none}',
  '.dip-bar[data-kind="error"]{border-color:' + ERROR_BORDER + ';color:var(--dsw-alias-label-primary)}',
  '.dip-bar-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dip-sep{opacity:.4}',
  // Retry on the failure bubble: a compact pill in the same tokens as the composer capsule.
  '.dip-bar-retry{display:inline-flex;align-items:center;gap:4px;flex:none;height:22px;padding:0 8px;box-sizing:border-box;',
  'border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);',
  'font:inherit;font-size:12px;line-height:1;white-space:nowrap;cursor:pointer;outline:none;transition:background-color .15s,color .15s}',
  '.dip-bar-retry:hover{background:' + HOVER_BG + ';color:var(--dsw-alias-label-primary)}',
  '.dip-bar-retry:focus-visible{box-shadow:' + FOCUS_RING + '}',

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

  /* ---------- follow-up panel (composer seat) ---------- */
  // Same seat frame as the host's question card, so swapping the composer for the panel
  // does not shift the column.
  '.dip-ask{display:flex;justify-content:center;padding:6px calc(var(--dsh-composer-side-clearance,16px) + 16px) 10px}',
  '.dip-ask-card{width:100%;max-width:var(--dsh-chat-content-width,100%);max-height:' + PANEL_MAX_HEIGHT + ';display:flex;flex-direction:column;',
  'box-sizing:border-box;overflow:hidden;outline:none;border-radius:' + PANEL_RADIUS + ';background:' + PANEL_BG + ';box-shadow:' + PANEL_SHADOW + ';',
  'color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}',
  '.dip-ask-card *{box-sizing:border-box}',
  '.dip-ask-head{flex:none;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px 16px 8px 20px}',
  '.dip-ask-title{margin:0;font-size:15px;font-weight:500;line-height:22px}',
  '.dip-ask-close{flex:none;display:grid;place-items:center;width:24px;height:24px;padding:0;border:0;border-radius:999px;outline:none;',
  'background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
  '.dip-ask-close:hover{background:' + HOVER_BG + ';color:var(--dsw-alias-label-primary)}',
  '.dip-ask-close-icon{display:block}',
  '.dip-ask-body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:12px;padding:0 20px 4px}',
  '.dip-ask-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
  '.dip-ask-original{flex:none;max-height:' + ORIGINAL_MAX_HEIGHT + ';overflow-y:auto;margin-top:-8px;padding:8px 12px;white-space:pre-wrap;overflow-wrap:anywhere;',
  'font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-base);',
  'border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);outline:none}',
  '.dip-ask-q{flex:none;display:flex;flex-direction:column;gap:6px;padding-top:12px;border-top:.5px solid var(--dsw-alias-border-l2)}',
  '.dip-ask-q-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}',
  '.dip-ask-q-text{margin:0;flex:1;min-width:0;font-weight:500;overflow-wrap:anywhere}',
  '.dip-ideas{display:flex;flex-direction:column;gap:1px}',
  '.dip-idea{display:flex;align-items:flex-start;gap:8px;padding:6px 8px;border-radius:var(--dsw-radius-md);cursor:pointer;transition:background-color .12s}',
  '.dip-idea:hover{background:' + HOVER_BG + '}',
  '.dip-idea-check{flex:none;width:14px;height:14px;margin:4px 0 0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}',
  '.dip-idea-text{flex:1;min-width:0;overflow-wrap:anywhere}',
  '.dip-idea-source{flex:none;padding:0 6px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;',
  'font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
  '.dip-ask-error{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
  '.dip-ask-error[data-kind="error"]{color:var(--dsw-alias-state-error-primary)}',
  '.dip-ask-own{display:block;width:100%;min-height:44px;resize:vertical;padding:8px 12px;font:inherit;font-size:14px;line-height:22px;',
  'color:var(--dsw-alias-label-primary);caret-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-base);',
  'border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);outline:none}',
  '.dip-ask-own::placeholder{color:var(--dsw-alias-label-tertiary)}',
  '.dip-ask-own:focus{border-color:var(--dsw-alias-state-business-primary)}',
  '.dip-ask-foot{flex:none;display:flex;justify-content:flex-end;gap:8px;padding:10px 16px 14px}',
  '.dip-ask-btn{height:30px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;outline:none;',
  'background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:1;cursor:pointer;transition:background-color .15s,color .15s}',
  '.dip-ask-skip:hover{background:' + HOVER_BG + ';color:var(--dsw-alias-label-primary)}',
  '.dip-ask-submit{border-color:transparent;background:' + PRIMARY_FILL + ';color:' + PRIMARY_LABEL + ';font-weight:500}',
  '.dip-ask-submit:hover{background:var(--dsw-alias-button-primary-hover,' + PRIMARY_FILL + ')}',
  '.dip-ask-close:focus-visible,.dip-ask-btn:focus-visible,.dip-stardea:focus-visible{box-shadow:' + FOCUS_RING + '}',
  '.dip-ask-original:focus-visible,.dip-idea-check:focus-visible,.dip-ask-card:focus-visible{outline:' + FOCUS_OUTLINE + ';outline-offset:2px}',
  '.dip-ask-card:focus-visible{outline-offset:-2px}',

  /* ---------- the Stardea button: a star with burst rays that pops on every click ---------- */
  '.dip-stardea{flex:none;display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 10px 0 8px;box-sizing:border-box;',
  'border:1px solid var(--dsw-alias-border-l2);border-radius:999px;outline:none;background:transparent;',
  'color:var(--dsw-alias-state-business-primary);font:inherit;font-size:12px;line-height:1;white-space:nowrap;cursor:pointer;transition:background-color .15s}',
  '.dip-stardea:hover:not(:disabled){background:' + HOVER_BG + '}',
  '.dip-stardea:disabled{cursor:progress}',
  '.dip-stardea-glyph{width:16px;height:16px;flex:none;display:block;overflow:visible}',
  // SVG transforms resolve against the 16x16 view box by default, so (8, 8) is the glyph's centre.
  '.dip-stardea-star,.dip-stardea-rays{transform-origin:8px 8px}',
  '.dip-stardea-glyph[data-pop="true"] .dip-stardea-star{animation:dip-stardea-pop ' + STARDEA_POP + '}',
  '.dip-stardea-glyph[data-pop="true"] .dip-stardea-rays{animation:dip-stardea-burst ' + STARDEA_POP + '}',
  // While its ideas are on the way the glyph turns like the composer star does while busy.
  '.dip-stardea[data-busy="true"] .dip-stardea-glyph{animation:dip-icon-spin .8s linear infinite}',

  /* ---------- keyframes ---------- */
  '@keyframes dip-icon-spin{to{transform:rotate(360deg)}}',
  '@keyframes dip-bar-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
  '@keyframes dip-bar-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(6px)}}',
  '@keyframes dip-stardea-pop{0%{transform:scale(.6)}45%{transform:scale(1.3)}100%{transform:scale(1)}}',
  '@keyframes dip-stardea-burst{0%{opacity:0;transform:scale(.4)}45%{opacity:1;transform:scale(1.35)}100%{opacity:1;transform:scale(1)}}',

  /* ---------- motion preferences ---------- */
  '@media (prefers-reduced-motion: reduce){',
  '.dip-icon,.dip-btn,.dip-revert,.dip-retry,.dip-bar,.dip-bar-retry,.dip-idea,.dip-ask-btn,.dip-stardea,',
  '.dip-stardea-glyph,.dip-stardea-star,.dip-stardea-rays{animation:none!important;transition-duration:.01ms!important}',
  '}',
].join('\n')
