/**
 * Plugin-owned CSS, scoped by a data attribute and torn down with the fiber.
 *
 * ## Material: a plain capsule in the host's own design tokens
 *
 * A click improves; holding or sliding the star opens the mode bar (mode.ts), and at rest only the
 * glyph shows the mode, so the button carries no visible switch, hover expansion, glow or animated
 * light. It reuses the host's `--dsw-alias-*`
 * tokens (border, label, hover background — the same ones the composer toolbar uses)
 * so it follows the page in both themes. The Revert | Retry capsule shares the plate.
 *
 * `.dip-root` — the capsule (border + radius)
 *   `.dip-btn`     — the improve action; the active mode's glyph in `currentColor`
 *   `.dip-revert` / `.dip-divider` / `.dip-retry` — the refined state's two halves
 *
 * `.dip-slide` — the mode bar a press on the star opens, floating in the page body above the star
 *   `.dip-slide-thumb` — the plate under the selected segment; `.dip-slide-seg` — one mode
 *
 * `.dip-onboard` — the first-use window, floating above the composer by the star like the
 * status bubble (same surface, border and shadow tokens)
 *
 * `.dip-ask` — the follow-up panel in the composer seat, framed like the host's own
 * question card (same seat padding, card radius, surface and elevation tokens)
 *   `.dip-ask-original` — the draft being refined, read-only and scrollable
 *   `.dip-ask-q` — one question: `.dip-stardea` (pop/burst on click), `.dip-idea` checkboxes,
 *   `.dip-ask-error` (last Stardea note), `.dip-ask-own` (own words)
 *
 * @module dsh-smart-prompt/client/styles
 */

import { SLIDE, SLIDE_BAR_WIDTH_PX } from './mode.js'

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
/** First-use window width, and its gap from the composer card's right edge (where the star sits). */
const ONBOARD_WIDTH = '300px'
const ONBOARD_INSET = '8px'
/**
 * The mode bar's opening (it grows out of the press point) and the thumb's move between segments:
 * short, so a quick slide is never held up by them.
 */
const SLIDE_OPEN = '160ms cubic-bezier(.2,.8,.2,1) both'
const SLIDE_THUMB_MOVE = '140ms cubic-bezier(.2,.8,.2,1)'
/**
 * The mode bar floats over the whole page, above the composer's own layers and the host's
 * floating menus (whose z-index runs up to the 1200s), as a pointer-held overlay should.
 */
const SLIDE_Z_INDEX = '2000'
/** The bar's padding: its frame less its border (the bar is border-box). */
const SLIDE_PAD_PX = SLIDE.insetPx - SLIDE.borderPx
/**
 * One written line of the Detailed glyph while a rewrite runs: unhurried, like handwriting, and
 * slower than the other modes' loops.
 */
const PEN_WRITE = '1.4s ease-in-out infinite'
/** One strike of the Light glyph while a rewrite runs: a fast flash, then a short pause. */
const BOLT_STRIKE = '.9s ease-out infinite'
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

  // The star takes horizontal touch slides (the mode bar) and leaves vertical ones to the page.
  // Only the star carries data-mode; the Revert | Retry capsule does not switch modes.
  // A long press must not start a text selection or the touch callout either.
  '.dip-root[data-mode]{touch-action:pan-y;-webkit-touch-callout:none}',

  /* ---------- the mode bar (page body, fixed above the star) ---------- */
  // mode.ts sets left/bottom (kept inside the window) and the transform origin (the press point).
  // It takes no pointer input: the star holds the pointer while it is open.
  '.dip-slide{position:fixed;z-index:' + SLIDE_Z_INDEX + ';display:flex;box-sizing:border-box;width:' + String(SLIDE_BAR_WIDTH_PX) + 'px;',
  'height:' + String(SLIDE.heightPx) + 'px;padding:' + String(SLIDE_PAD_PX) + 'px;border:' + String(SLIDE.borderPx) + 'px solid var(--dsw-alias-border-l2);border-radius:999px;',
  'background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base));box-shadow:' + BUBBLE_SHADOW + ';color:var(--dsw-alias-label-secondary);',
  'font-size:12px;line-height:1;pointer-events:none;user-select:none;animation:dip-slide-in ' + SLIDE_OPEN + '}',
  // Offsets of an absolute child start inside the border, so the padding alone lines the thumb up
  // with the segments.
  '.dip-slide-thumb{position:absolute;top:' + String(SLIDE_PAD_PX) + 'px;bottom:' + String(SLIDE_PAD_PX) + 'px;left:' + String(SLIDE_PAD_PX) + 'px;',
  'width:' + String(SLIDE.segmentPx) + 'px;border-radius:999px;background:' + HOVER_BG + ';transition:transform ' + SLIDE_THUMB_MOVE + '}',
  '.dip-slide-seg{position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;',
  'width:' + String(SLIDE.segmentPx) + 'px;white-space:nowrap;transition:color .12s}',
  '.dip-slide-seg[data-selected="true"]{color:var(--dsw-alias-label-primary);font-weight:500}',
  '.dip-slide-icon{width:14px;height:14px;flex:none;display:block}',

  /* ---------- busy: the click cancels; the glyph runs its mode's animation, so the wait is visible ---------- */
  '.dip-root[data-busy="true"] .dip-btn{cursor:progress;color:var(--dsw-alias-state-business-primary)}',
  // Standard: the sparkle spins, as before.
  '.dip-root[data-busy="true"] .dip-icon[data-mode="standard"]{animation:dip-icon-spin .8s linear infinite}',
  // Detailed: the pen writes its line over and over. The ink is drawn on (a dash of the whole,
  // normalised length sliding into view) while the pen travels along it in step, then the line
  // fades and the pen goes back to the line's start. Same duration for both, so they stay in step.
  '.dip-root[data-busy="true"] .dip-glyph-ink{stroke-dasharray:1;animation:dip-ink-draw ' + PEN_WRITE + '}',
  '.dip-root[data-busy="true"] .dip-glyph-pen{animation:dip-pen-write ' + PEN_WRITE + '}',
  // Light: the bolt strikes — a quick double flash with a jolt in size, then a dim pause.
  '.dip-root[data-busy="true"] .dip-icon[data-mode="light"]{animation:dip-bolt-strike ' + BOLT_STRIKE + '}',

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
  '.dip-set-tip{margin-top:4px}',

  /* ---------- first-use window (composer overlay, by the star) ---------- */
  // Same anchor as the status bubble, pinned to the right edge where the star sits. It floats over
  // the transcript, so the composer stays free to type in while it shows.
  '.dip-onboard{position:absolute;right:' + ONBOARD_INSET + ';bottom:var(--dsh-composer-stack-gap,6px);z-index:1;width:' + ONBOARD_WIDTH + ';',
  'max-width:calc(100% - 2 * ' + ONBOARD_INSET + ');box-sizing:border-box;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;',
  'background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base));box-shadow:' + BUBBLE_SHADOW + ';',
  'color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;animation:dip-bar-in 200ms cubic-bezier(.2,.8,.2,1) both}',
  '.dip-onboard *{box-sizing:border-box}',
  '.dip-onboard-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}',
  '.dip-onboard-title{margin:0;font-size:13px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary)}',
  '.dip-onboard-close{flex:none;display:grid;place-items:center;width:20px;height:20px;padding:0;border:0;border-radius:999px;outline:none;',
  'background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
  '.dip-onboard-close:hover{background:' + HOVER_BG + ';color:var(--dsw-alias-label-primary)}',
  '.dip-onboard-close-icon{display:block}',
  '.dip-onboard-text{margin:6px 0 0}',
  '.dip-onboard-note{color:var(--dsw-alias-label-tertiary)}',
  '.dip-onboard-modes{margin:6px 0 0;padding:0;list-style:none;display:grid;gap:2px}',
  // The active mode's row is highlighted, so a slide tried while the window is open shows here too.
  '.dip-onboard-mode{display:flex;align-items:flex-start;gap:8px;padding:4px 6px;border-radius:var(--dsw-radius-md,6px)}',
  '.dip-onboard-mode[data-active="true"]{background:' + HOVER_BG + ';color:var(--dsw-alias-label-primary)}',
  '.dip-onboard-icon{flex:none;display:block;width:16px;height:16px;margin-top:1px;color:var(--dsw-alias-label-primary)}',
  '.dip-onboard-desc{flex:1;min-width:0}',
  '.dip-onboard-tag{display:inline-block;margin-left:6px;padding:0 6px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;',
  'font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
  '.dip-onboard-foot{display:flex;justify-content:flex-end;margin-top:10px}',
  '.dip-onboard-ok{height:26px;padding:0 12px;border:0;border-radius:999px;outline:none;background:' + PRIMARY_FILL + ';color:' + PRIMARY_LABEL + ';',
  'font:inherit;font-size:12px;font-weight:500;line-height:1;cursor:pointer}',
  '.dip-onboard-ok:hover{background:var(--dsw-alias-button-primary-hover,' + PRIMARY_FILL + ')}',
  '.dip-onboard-close:focus-visible,.dip-onboard-ok:focus-visible{box-shadow:' + FOCUS_RING + '}',

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
  // The pen's point (8, 12) starts on the ink line's start (3.5, 12.6) and follows its wave to the
  // line's end (7.7, 12.2), next to where the pen rests (16x16 glyph units).
  '@keyframes dip-pen-write{0%{transform:translate(-4.5px,.6px)}18%{transform:translate(-3.5px,0)}36%{transform:translate(-2.3px,.6px)}',
  '54%{transform:translate(-1.2px,.1px)}72%,86%{transform:translate(0,0)}100%{transform:translate(-4.5px,.6px)}}',
  '@keyframes dip-ink-draw{0%{stroke-dashoffset:1;opacity:1}72%{stroke-dashoffset:0;opacity:1}86%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:0}}',
  // No glow: the capsule stays free of glow effects (see the header); the flash is opacity and size.
  '@keyframes dip-bolt-strike{0%{opacity:.35;transform:scale(.9)}6%{opacity:1;transform:scale(1.18)}',
  '12%{opacity:.3;transform:scale(1)}18%{opacity:1;transform:scale(1.1)}40%{opacity:1;transform:scale(1)}100%{opacity:.35;transform:scale(.9)}}',
  '@keyframes dip-slide-in{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}',
  '@keyframes dip-bar-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
  '@keyframes dip-bar-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(6px)}}',
  '@keyframes dip-stardea-pop{0%{transform:scale(.6)}45%{transform:scale(1.3)}100%{transform:scale(1)}}',
  '@keyframes dip-stardea-burst{0%{opacity:0;transform:scale(.4)}45%{opacity:1;transform:scale(1.35)}100%{opacity:1;transform:scale(1)}}',

  /* ---------- motion preferences ---------- */
  '@media (prefers-reduced-motion: reduce){',
  '.dip-icon,.dip-slide,.dip-slide-thumb,.dip-slide-seg,.dip-btn,.dip-revert,.dip-retry,.dip-bar,.dip-bar-retry,.dip-idea,.dip-ask-btn,.dip-stardea,.dip-onboard,',
  '.dip-stardea-glyph,.dip-stardea-star,.dip-stardea-rays,.dip-glyph-pen,.dip-glyph-ink{animation:none!important;transition-duration:.01ms!important}',
  '}',
].join('\n')
