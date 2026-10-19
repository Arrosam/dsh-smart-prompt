/**
 * Button harness — build a standalone comparison page from REAL sources.
 *
 * Two halves, both extracted rather than re-typed:
 *  - this plugin: the CSS string out of the built client bundle + the markup the actual
 *    component renders;
 *  - dsh-plan-board: the .pb-entry CSS strings out of its source and a DOM faithful to its
 *    render function (aurora, ring, orb SVG, label, dot, shine).
 *
 * The page exposes window.__DIP_BOXES__ (label and pill boxes in CSS px) so the rendered
 * text-versus-plate contrast can be measured from pixels — the plate is a gradient, so
 * computed colours cannot answer it.
 *
 * Usage: node scripts/button-harness.mjs [outfile]
 */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

// The plugin's own zh copy, captured from its locale registration rather than re-typed.
let ZH = {}

let captured = null
const styles = []
globalThis.window = {
  __ModuleLoader__: { load: (m) => { captured = m } },
  localStorage: { getItem: () => null, setItem: () => {} },
  setTimeout, clearTimeout,
}
globalThis.document = {
  querySelectorAll: () => [],
  createElement: () => {
    const el = { dataset: {}, remove() {}, _t: '' }
    Object.defineProperty(el, 'textContent', { get() { return el._t }, set(v) { el._t = v; styles.push(v) } })
    return el
  },
  head: { appendChild: () => {} },
}

await import(join(root, 'lib/client.js') + '?h=' + String(Date.now()))
const mod = captured.factory((id) => {
  if (id === 'react') return React
  if (id === 'react/jsx-runtime') return require('react/jsx-runtime')
  if (id === 'react-dom') return require('react-dom')
  if (id === 'react-dom/client') return require('react-dom/client')
  throw new Error('unexpected external ' + id)
})
const registered = []
mod.apply({
  slots: {
    inject: (_seat, fn) => { const it = fn(); if (it !== undefined && typeof it.next === 'function') it.next(); return () => {} },
    register: (options, component) => { registered.push({ options, component }); return () => {} },
  },
  locale: { register: (_namespace, dicts) => { ZH = dicts.zh; return () => {} }, bind: () => (key) => ZH[key] ?? key },
  effect: (fn) => fn(),
  get: () => undefined,
})
const Button = registered[0].component
const markup = renderToStaticMarkup(React.createElement(Button, {
  sessionId: 's1',
  useInput: (selector) => selector({ draft: '把那个登录接口改快一点，就是感觉有点慢', phase: 'plain' }),
  inputActions: { setDraft() {} },
  t: (key) => ZH[key] ?? key,
}))
const mineCss = styles.join('\n')

// ---- dsh-plan-board: pull its own .pb-entry CSS strings out of its source ----------
const pbPath = join(dirname(root), 'dsh-plan-board', 'src', 'client', 'index.ts')
let pbCss = ''
if (existsSync(pbPath)) {
  const src = readFileSync(pbPath, 'utf8')
  const block = src.slice(src.indexOf("'.pb-entry{"), src.indexOf('const orb ='))
  for (const line of block.split('\n')) {
    const m = /^\s*'((?:[^'\\]|\\.)*)',?\s*$/.exec(line)
    if (m !== null) pbCss += m[1].replace(/\\'/g, "'") + '\n'
  }
}
const PB_ORB = [
  '<span class="pb-orb" aria-hidden="true"><svg viewBox="0 0 18 18">',
  '<defs>',
  '<linearGradient id="pb-orb-orbit" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#e879f9"/></linearGradient>',
  '<radialGradient id="pb-orb-core" cx=".42" cy=".38" r=".68"><stop offset="0" stop-color="#fff"/><stop offset=".34" stop-color="#ddd6fe"/><stop offset="1" stop-color="#7c3aed"/></radialGradient>',
  '<radialGradient id="pb-orb-halo" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#a855f7" stop-opacity=".55"/><stop offset="1" stop-color="#a855f7" stop-opacity="0"/></radialGradient>',
  '</defs>',
  '<circle cx="9" cy="9" r="6.5" fill="url(#pb-orb-halo)"/>',
  '<g transform="rotate(-22 9 9)"><ellipse class="pb-orbit" cx="9" cy="9" rx="7.4" ry="2.9" fill="none" stroke="url(#pb-orb-orbit)" stroke-width="1"/>',
  '<circle class="pb-sat" cx="1.6" cy="9" r="1.25" fill="#22d3ee"/><circle class="pb-sat s2" cx="16.4" cy="9" r="1.25" fill="#e879f9"/></g>',
  '<circle class="pb-core" cx="9" cy="9" r="2.6" fill="url(#pb-orb-core)"/></svg></span>',
].join('')
const pbButton = '<button class="pb-entry" data-mode="dark" aria-pressed="false" title="dsh-plan-board">'
  + '<span class="pb-aurora" aria-hidden="true"></span><span class="pb-ring" aria-hidden="true"></span>'
  + PB_ORB + '<span class="pb-label">PlanBoard</span><span class="pb-dot pb-work"></span>'
  + '<span class="pb-shine" aria-hidden="true"></span></button>'

const THEMES = {
  dark: {
    '--dsw-alias-border-l2': '#333a48', '--dsw-alias-border-l3': '#4a5468',
    '--dsw-alias-label-secondary': '#a8b0c0', '--dsw-alias-label-primary': '#e8edf7',
    '--dsw-alias-label-dimmed': '#6b7484', '--dsw-alias-interactive-bg-hover': '#232833',
    '--dsw-alias-bg-base': '#161a22', '--dsw-alias-bg-elevated': '#1c212b', page: '#0f1115', cap: '#8b93a3',
  },
  light: {
    '--dsw-alias-border-l2': '#d8dce4', '--dsw-alias-border-l3': '#b9c0cc',
    '--dsw-alias-label-secondary': '#4a5261', '--dsw-alias-label-primary': '#14171d',
    '--dsw-alias-label-dimmed': '#98a0ae', '--dsw-alias-interactive-bg-hover': '#eceef2',
    '--dsw-alias-bg-base': '#ffffff', '--dsw-alias-bg-elevated': '#f6f7f9', page: '#ffffff', cap: '#7b8496',
  },
}
const vars = (t) => Object.entries(THEMES[t]).filter(([k]) => k.startsWith('--')).map(([k, v]) => k + ':' + v).join(';')

const row = (theme) => [
  '<section class="row" data-theme="' + theme + '" style="' + vars(theme) + ';background:' + THEMES[theme].page + '">',
  '  <div class="side"><div class="cap" style="color:' + THEMES[theme].cap + '">dsh-smart-prompt</div>',
  '    <div class="seatwrap" id="mine-' + theme + '">' + markup + '</div></div>',
  '  <div class="side"><div class="cap" style="color:' + THEMES[theme].cap + '">dsh-plan-board (reference)</div>',
  '    <div class="seatwrap" id="theirs-' + theme + '">' + pbButton + '</div></div>',
  '</section>',
].join('\n')

const boxes = [
  '<script>',
  'window.__DIP_BOXES__ = () => {',
  '  const out = {}',
  '  for (const theme of ["dark", "light"]) {',
  '    const scope = "#mine-" + theme',
  '    const chip = document.querySelector(scope + " .dip-root")',
  '    const label = document.querySelector(scope + " .dip-label")',
  '    if (!chip || !label) continue',
  '    const box = (sel) => {',
  '      const el = document.querySelector(scope + " " + sel)',
  '      if (!el) return null',
  '      const b = el.getBoundingClientRect()',
  '      return { x: b.x, y: b.y, w: b.width, h: b.height }',
  '    }',
  '    out[theme] = { chip: box(".dip-root"), main: box(".dip-btn"), label: box(".dip-label"),',
  '      spark: box(".dip-spark"), divider: box(".dip-divider"), chevron: box(".dip-chevron"),',
  '      caret: box(".dip-caret"), arc: box(".dip-arc") }',
  '  }',
  '  const mock = document.querySelector("#concise-mock")',
  '  const simChip = document.querySelector("#sim-mine .dip-root")',
  '  const picker = document.querySelector("#picker-mock")',
  '  if (mock !== null && simChip !== null && picker !== null) {',
  '    const mb = mock.getBoundingClientRect(), cb = simChip.getBoundingClientRect(), pb = picker.getBoundingClientRect()',
  '    out.sim = { mockLeft: mb.x, chipLeft: cb.x, chipRight: cb.x + cb.width, chipW: cb.width, pickerLeft: pb.x }',
  '  }',
  '  return out',
  '}',
  '<\/script>',
].join('\n')

const html = [
  '<!doctype html><html><head><meta charset="utf-8"><title>button comparison</title><style>',
  'body{margin:0;background:#0f1115;font-family:-apple-system,"PingFang SC",Inter,sans-serif}',
  '.row{display:flex;align-items:center;gap:46px;padding:26px 32px}',
  '.side{display:flex;flex-direction:column;gap:12px;align-items:flex-start}',
  '.cap{font-size:11px;letter-spacing:.03em}',
  '.seatwrap{display:inline-flex;min-height:34px;align-items:center}',
  // trailing-row simulation: the measured host structure (.row space-between + .trailing
  // margin-left:auto gap:12px) with a 42px concise mock left of the real chip — proves
  // the neighbor reflow without running the real composer
  '.simrow{display:flex;justify-content:space-between;align-items:center;padding:10px 32px 26px;background:#0f1115;border-top:1px solid #1b2029}',
  '.simleading{width:120px;height:28px;border-radius:8px;background:#161a22;border:1px solid #262c38}',
  '.simtrailing{flex:none;gap:12px;margin-left:auto;display:flex;align-items:center}',
  '.concise-mock{width:42px;height:28px;border-radius:999px;background:#161a22;border:1px solid #333a48;display:inline-flex;align-items:center;justify-content:center;color:#6b7484;font-size:10px}',
  '.picker-mock{height:28px;padding:0 10px;border-radius:8px;background:#161a22;border:1px solid #262c38;display:inline-flex;align-items:center;color:#a8b0c0;font-size:12px}',
  mineCss,
  pbCss,
  '</style></head><body>',
  row('dark'),
  row('light'),
  '<section class="simrow" style="' + vars('dark') + ';background:#0f1115">',
  '  <div class="simleading"></div>',
  '  <div class="simtrailing" id="simtrailing">',
  '    <div class="concise-mock" id="concise-mock">concise</div>',
  '    <div class="seatwrap" id="sim-mine">' + markup + '</div>',
  '    <div class="picker-mock" id="picker-mock">GLM-4.6</div>',
  '  </div>',
  '</section>',
  boxes,
  '</body></html>',
].join('\n')

const out = process.argv[2] ?? '/tmp/dip-button-harness.html'
writeFileSync(out, html)
console.log('harness written:', out)
console.log('my css chars:', mineCss.length, '| plan-board css chars:', pbCss.length)
console.log('plan-board extracted:', pbCss.includes('.pb-entry{') && pbCss.includes('pb-aurora'))
