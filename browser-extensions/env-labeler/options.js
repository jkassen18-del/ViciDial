import { initPage } from './shared/page.js';
import { bindSettings, mountBrandingPanel, mountBackupPanel, mountAboutPanel, initSideNav, lockChip } from './shared/settings-ui.js';
import { h, icon, $, toast, confirmDialog, debounce, relativeTime, formatDateTime } from './shared/ui.js';
import { send } from './shared/messaging.js';
import { ensureHostPermission } from './shared/config.js';
import { isHex } from './shared/brand.js';
import { hostOf } from './shared/domain.js';
import { DEFAULTS, DEFAULT_RULES, COLOR_PRESETS, RIBBON_POSITIONS } from './defaults.js';
import {
  SOURCES, normalizeRules, normalizeRule, normalizePattern, patternProblem, describePattern,
  shortLabel, textColorFor, mergeRules, explainMatch, newRuleId,
} from './rules.js';

const ctx = await initPage({ defaults: DEFAULTS, title: 'Environment Labeler · Settings', options: true });

const clone = (v) => JSON.parse(JSON.stringify(v));
const withVars = (el, vars) => { for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v); return el; };

const state = {
  personal: normalizeRules(ctx.settings.personalRules),
  urls: [...(ctx.settings.rulesUrls || [])],
  remote: {},
  expanded: new Set(),
  textMode: new Set(),
  testUrl: '',
};
// Open the first empty rule so new users land on the pattern editor.
const firstEmpty = state.personal.find((r) => !r.patterns.length);
if (firstEmpty) state.expanded.add(firstEmpty.id);

const personalLocked = () => ctx.isLocked('personalRules');
const personalAllowed = () => {
  const el = document.querySelector('[data-setting="allowPersonalRules"]');
  return el ? el.checked : ctx.settings.allowPersonalRules !== false;
};
const urlsLocked = () => ctx.isLocked('rulesUrls');

function edited() { ctx.markDirty(); refreshTest(); }

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------
function sourceBadge(source, name) {
  const s = SOURCES[source] || SOURCES.personal;
  return h('span', { class: `badge ${s.tone}`, title: name ? `Source: ${name}` : '' }, icon(s.icon), s.label);
}

function envChip(rule) {
  return withVars(h('span', { class: 'env-chip' }, shortLabel(rule) || '?'), { '--env-bg': rule.color, '--env-fg': textColorFor(rule) });
}

function switchEl(checked, onChange, { disabled, label } = {}) {
  const input = h('input', { type: 'checkbox', checked: !!checked, disabled: !!disabled, 'aria-label': label || '' });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' }, input, h('span', { class: 'track' }));
}

function allRulesDraft() {
  return mergeRules({ ...ctx.settings, personalRules: state.personal, rulesUrls: state.urls, allowPersonalRules: personalAllowed() }, state.remote);
}

// ---------------------------------------------------------------------------
// Live preview of a rule (mini browser window)
// ---------------------------------------------------------------------------
function ribbonPrefs() {
  const hEl = $('#ribbon-height'), oEl = $('#ribbon-opacity');
  return {
    height: Number(hEl?.value || ctx.settings.ribbonHeight || 26),
    opacity: Number(oEl?.value || ctx.settings.ribbonOpacity || 0.95),
    host: $('[data-setting="showHostname"]')?.checked !== false,
  };
}

function preview(rule, host = 'app.example.com') {
  const prefs = ribbonPrefs();
  const fg = textColorFor(rule);
  const short = shortLabel(rule);
  const fav = h('span', { class: 'pv-fav' }, rule.faviconTint ? h('span', { class: 'pv-fav-band' }) : null);
  const page = h('div', { class: `pv-page${rule.border ? ' bordered' : ''}` },
    h('div', { class: 'pv-content' },
      h('div', { class: 'pv-line w60' }), h('div', { class: 'pv-line w90' }), h('div', { class: 'pv-line w75' }),
      h('div', { class: 'pv-btns' }, h('span', { class: 'pv-btn' }), h('span', { class: 'pv-btn ghost' }))));
  if (rule.ribbon !== 'none') {
    const bar = h('div', { class: `pv-ribbon ${rule.ribbon}` },
      h('span', { class: 'pv-ribbon-text' }, icon('server'), h('b', {}, rule.label || 'ENVIRONMENT'),
        prefs.host && rule.ribbon !== 'corner' ? [h('i', { class: 'pv-sep' }), h('span', { class: 'mono' }, host)] : null));
    page.append(bar);
  }
  const win = h('div', { class: 'pv-window', 'aria-hidden': 'true' },
    h('div', { class: 'pv-tabs' },
      h('div', { class: 'pv-tab' }, fav, h('span', { class: 'truncate' }, rule.titlePrefix ? `[${short}] Dashboard` : 'Dashboard')),
      h('span', { class: 'pv-dots' }, h('i'), h('i'), h('i'))),
    h('div', { class: 'pv-url' }, icon('lock', { size: 11 }), h('span', { class: 'truncate' }, host),
      h('span', { class: 'grow' }), withVars(h('span', { class: 'pv-badge' }, short.slice(0, 4)), {})),
    page);
  return withVars(win, {
    '--env-bg': rule.color, '--env-fg': fg,
    '--pv-h': `${Math.round(prefs.height * 0.72)}px`, '--pv-op': String(prefs.opacity),
  });
}

// Mini thumbnails for the ribbon position control.
function positionThumb(pos) {
  return h('span', { class: `pos-thumb ${pos}` }, h('span', { class: 'pos-mark' }));
}

// ---------------------------------------------------------------------------
// Pattern editor
// ---------------------------------------------------------------------------
const EXAMPLES = [
  ['app.example.com', 'host and all its subdomains'],
  ['=admin.example.com', 'exactly this host'],
  ['*.prod.example.com', 'subdomains only'],
  ['app-*.example.com', 'host glob'],
  ['example.com/admin*', 'host plus path'],
  ['localhost:8080', 'specific port'],
  ['re:^https://[^/]+\\.prd\\.', 'regular expression on the full URL'],
];

function patternHelp() {
  return h('details', { class: 'pattern-help' },
    h('summary', {}, icon('help', { size: 14 }), 'Pattern syntax'),
    h('table', { class: 'table mt-8' },
      h('tbody', {}, EXAMPLES.map(([p, d]) => h('tr', {}, h('td', {}, h('code', {}, p)), h('td', { class: 'muted' }, d))))),
    h('p', { class: 'subtle mt-8' }, 'Host globs match the whole host name: ', h('code', {}, '*staging*'), ' matches any host containing "staging", ',
      h('code', {}, 'stg.*'), ' matches hosts that start with "stg.". Pasting a full URL keeps just its host and path.'));
}

function patternEditor(rule, editable) {
  const wrap = h('div', { class: 'stack-sm' });
  const draw = () => {
    wrap.replaceChildren();
    const input = h('input', { class: 'input code', placeholder: 'app.example.com, *.prod.example.com …', 'aria-label': `Add pattern to ${rule.label}` });
    const err = h('div', { class: 'error', hidden: true });
    if (state.textMode.has(rule.id) && editable) {
      const ta = h('textarea', { class: 'textarea code', rows: Math.max(4, rule.patterns.length + 1), spellcheck: false, 'aria-label': `${rule.label} patterns, one per line` }, rule.patterns.join('\n'));
      ta.addEventListener('input', () => {
        rule.patterns = ta.value.split('\n').map(normalizePattern).filter(Boolean);
        ta.classList.toggle('invalid', rule.patterns.some(patternProblem));
        edited();
        updateHead(rule);
      });
      wrap.append(ta, h('div', { class: 'row between' }, h('span', { class: 'help' }, 'One pattern per line.'),
        h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { state.textMode.delete(rule.id); draw(); } }, icon('tag'), 'Edit as chips')));
      return;
    }
    if (!rule.patterns.length) {
      wrap.append(h('div', { class: 'empty pattern-empty' },
        h('div', { class: 'empty-icon' }, icon('globe')),
        h('h3', {}, `Which sites are ${rule.label || 'this environment'}?`),
        h('p', { class: 'subtle' }, 'Add host names or patterns. Until you do, this rule never matches.'),
        editable ? h('div', { class: 'chip-list example-chips' }, EXAMPLES.slice(0, 4).map(([p]) =>
          h('button', { class: 'chip example', type: 'button', title: 'Use this example', onclick: () => { input.value = p; input.focus(); } }, icon('plus', { size: 12 }), p))) : null));
    } else {
      wrap.append(h('div', { class: 'chip-list' }, rule.patterns.map((p, i) => {
        const problem = patternProblem(p);
        return h('span', { class: `chip pattern${problem ? ' bad' : ''}`, title: problem || describePattern(p) },
          h('span', { class: 'mono' }, p),
          editable ? h('button', { type: 'button', 'aria-label': `Remove ${p}`, onclick: () => { rule.patterns.splice(i, 1); edited(); draw(); updateHead(rule); } }, icon('x')) : null);
      })));
    }
    if (!editable) return;
    const add = () => {
      const values = input.value.split(/[\s,]+/).map(normalizePattern).filter(Boolean);
      if (!values.length) return;
      const bad = values.map(patternProblem).find(Boolean);
      if (bad) { err.textContent = bad; err.hidden = false; input.classList.add('invalid'); return; }
      for (const v of values) if (!rule.patterns.includes(v)) rule.patterns.push(v);
      input.value = '';
      edited();
      draw();
      updateHead(rule);
      wrap.querySelector('input.input')?.focus();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    input.addEventListener('input', () => { err.hidden = true; input.classList.remove('invalid'); });
    wrap.append(
      h('div', { class: 'input-group' }, input, h('button', { class: 'btn', type: 'button', onclick: add }, icon('plus'), 'Add')),
      err,
      h('div', { class: 'row between' }, patternHelp(),
        h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { state.textMode.add(rule.id); draw(); } }, icon('file-text'), 'Edit as text')));
  };
  draw();
  return wrap;
}

// ---------------------------------------------------------------------------
// Rule cards
// ---------------------------------------------------------------------------
const heads = new Map();
function summary(rule) {
  const n = rule.patterns.length;
  const bits = [n ? `${n} pattern${n > 1 ? 's' : ''}` : 'No sites yet', rule.ribbon === 'none' ? 'no ribbon' : `${rule.ribbon} ribbon`];
  if (rule.confirmForms) bits.push('confirms forms');
  return bits.join(' · ');
}
function updateHead(rule) {
  const head = heads.get(rule);
  if (!head) return;
  head.chip.replaceWith(head.chip = envChip(rule));
  head.title.textContent = rule.label || 'Untitled';
  head.sub.textContent = summary(rule);
  head.sub.classList.toggle('text-warning', !rule.patterns.length);
}

function ruleCard(rule, { source, sourceName, editable, index, list }) {
  const open = state.expanded.has(rule.id);
  const card = h('div', { class: `card rule-card${open ? ' open' : ''}${rule.enabled ? '' : ' disabled'}`, dataset: { id: rule.id } });
  const chip = envChip(rule);
  const title = h('div', { class: 'rule-title truncate' }, rule.label || 'Untitled');
  const sub = h('div', { class: `subtle truncate${rule.patterns.length ? '' : ' text-warning'}` }, summary(rule));
  heads.set(rule, { chip, title, sub });

  const toggle = () => { if (open) state.expanded.delete(rule.id); else state.expanded.add(rule.id); renderRules(); };
  const move = (d) => {
    const j = index + d;
    if (j < 0 || j >= list.length) return;
    [list[index], list[j]] = [list[j], list[index]];
    edited(); renderRules();
    document.querySelector(`.rule-card[data-id="${CSS.escape(rule.id)}"] .rule-move-${d < 0 ? 'up' : 'down'}`)?.focus();
  };
  const remove = async () => {
    const ok = await confirmDialog({ title: `Delete ${rule.label}?`, message: `${rule.patterns.length} pattern(s) will stop being labelled. You can undo by discarding unsaved changes.`, confirmLabel: 'Delete rule', tone: 'danger' });
    if (!ok) return;
    list.splice(index, 1); edited(); renderRules();
  };

  const headMain = h('button', { class: 'rule-head-main', type: 'button', 'aria-expanded': String(open), onclick: toggle },
    chip, h('div', { class: 'grow' }, title, sub));
  const controls = editable ? [
    switchEl(rule.enabled, (v) => { rule.enabled = v; card.classList.toggle('disabled', !v); edited(); }, { label: `Enable ${rule.label}` }),
    h('div', { class: 'btn-group' },
      h('button', { class: 'btn sm icon ghost rule-move-up', type: 'button', title: 'Move up', 'aria-label': 'Move up', disabled: index === 0, onclick: () => move(-1) }, icon('chevron-down', { class: 'flip' })),
      h('button', { class: 'btn sm icon ghost rule-move-down', type: 'button', title: 'Move down', 'aria-label': 'Move down', disabled: index === list.length - 1, onclick: () => move(1) }, icon('chevron-down'))),
    h('button', { class: 'btn sm icon ghost', type: 'button', title: 'Delete rule', 'aria-label': `Delete ${rule.label}`, onclick: remove }, icon('trash')),
  ] : [sourceBadge(source, sourceName), rule.enabled ? null : h('span', { class: 'badge' }, 'Off')];
  const grip = editable ? h('span', { class: 'grip', title: 'Drag to reorder', 'aria-hidden': 'true' }, icon('grip')) : h('span', { class: 'rule-index' }, String(index + 1));
  const head = h('div', { class: 'rule-head' }, grip, headMain, h('div', { class: 'row' }, controls),
    h('button', { class: 'btn sm icon ghost', type: 'button', 'aria-label': open ? 'Collapse' : 'Expand', onclick: toggle }, icon(open ? 'chevron-down' : 'chevron-right')));
  card.append(head);

  if (editable) {
    card.draggable = false;
    grip.addEventListener('mousedown', () => { card.draggable = true; });
    card.addEventListener('dragstart', (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(index)); card.classList.add('dragging'); });
    card.addEventListener('dragend', () => { card.draggable = false; card.classList.remove('dragging'); });
    card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drop-target'); });
    card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = Number(e.dataTransfer.getData('text/plain'));
      if (!Number.isInteger(from) || from === index) return renderRules();
      const [item] = list.splice(from, 1);
      list.splice(index, 0, item);
      edited(); renderRules();
    });
  }

  if (open) card.append(editable ? ruleEditor(rule) : ruleReadOnly(rule));
  return card;
}

function ruleReadOnly(rule) {
  const feats = [
    ['Ribbon', rule.ribbon], ['Favicon tint', rule.faviconTint ? 'Yes' : 'No'], ['Title prefix', rule.titlePrefix ? `[${shortLabel(rule)}]` : 'No'],
    ['Border', rule.border ? 'Yes' : 'No'], ['Confirm forms', rule.confirmForms ? 'Yes' : 'No'],
  ];
  return h('div', { class: 'rule-body' },
    h('div', { class: 'rule-grid' },
      h('div', { class: 'stack' },
        h('div', { class: 'field' }, h('label', {}, 'Patterns'), patternEditor(rule, false)),
        h('dl', { class: 'kv' }, feats.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))),
      h('div', {}, h('div', { class: 'label mb-6' }, 'Preview'), preview(rule))));
}

function ruleEditor(rule) {
  const pv = h('div', { class: 'pv-holder' }, preview(rule));
  const redraw = () => { pv.replaceChildren(preview(rule)); updateHead(rule); };
  const change = (patch) => { Object.assign(rule, patch); edited(); redraw(); };

  // name + tag
  const name = h('input', { class: 'input', value: rule.label, maxlength: 40, 'aria-label': 'Environment name' });
  name.addEventListener('input', () => change({ label: name.value.toUpperCase().slice(0, 40) }));
  name.addEventListener('blur', () => { name.value = rule.label; });
  const short = h('input', { class: 'input code', value: rule.short || '', maxlength: 5, placeholder: shortLabel({ label: rule.label }) || 'AUTO', 'aria-label': 'Badge tag', style: { width: '96px' } });
  short.addEventListener('input', () => { const v = short.value.trim().toUpperCase(); if (v) rule.short = v; else delete rule.short; edited(); redraw(); });

  // colours
  const picker = h('input', { type: 'color', class: 'swatch-input', value: rule.color, 'aria-label': 'Custom colour' });
  const hex = h('input', { class: 'input code', value: rule.color, maxlength: 7, style: { width: '96px' }, 'aria-label': 'Colour hex value' });
  const presets = h('div', { class: 'swatches' }, COLOR_PRESETS.map((p) => h('button', {
    class: 'swatch env-sw', type: 'button', title: p.name, 'aria-label': `${p.name}`, 'aria-pressed': String(p.color === rule.color), style: { background: p.color },
    onclick: () => setColor(p.color),
  })));
  function setColor(c) {
    change({ color: c.toUpperCase() });
    picker.value = rule.color; if (document.activeElement !== hex) hex.value = rule.color;
    for (const b of presets.children) b.setAttribute('aria-pressed', String(b.title && COLOR_PRESETS.find((p) => p.name === b.title)?.color === rule.color));
    syncText();
  }
  picker.addEventListener('input', () => setColor(picker.value));
  hex.addEventListener('input', () => { const v = hex.value.trim(); if (isHex(v)) setColor(v.length === 4 ? '#' + v.slice(1).split('').map((c) => c + c).join('') : v); });

  // text colour
  const textPicker = h('input', { type: 'color', class: 'swatch-input', value: rule.textColor || textColorFor(rule), 'aria-label': 'Text colour' });
  const textSeg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Text colour' });
  const textModes = [['auto', 'Auto'], ['#FFFFFF', 'White'], ['#0B1020', 'Dark'], ['custom', 'Custom']];
  const mode = () => (!rule.textColor ? 'auto' : rule.textColor === '#FFFFFF' ? '#FFFFFF' : rule.textColor === '#0B1020' ? '#0B1020' : 'custom');
  let customMode = mode() === 'custom';
  function syncText() {
    const m = customMode ? 'custom' : mode();
    for (const b of textSeg.children) b.setAttribute('aria-pressed', String(b.dataset.v === m));
    textPicker.hidden = m !== 'custom';
    textPicker.value = textColorFor(rule);
  }
  textModes.forEach(([v, l]) => textSeg.append(h('button', { type: 'button', dataset: { v }, onclick: () => {
    customMode = v === 'custom';
    if (v === 'auto') change({ textColor: '' });
    else if (v !== 'custom') change({ textColor: v });
    else change({ textColor: textColorFor(rule) });
    syncText();
  } }, l)));
  textPicker.addEventListener('input', () => { change({ textColor: textPicker.value.toUpperCase() }); });
  syncText();

  // ribbon position
  const posSeg = h('div', { class: 'pos-picker', role: 'radiogroup', 'aria-label': 'Ribbon position' }, RIBBON_POSITIONS.map((p) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(rule.ribbon === p), class: 'pos-option',
    onclick: (e) => { change({ ribbon: p }); for (const b of posSeg.children) b.setAttribute('aria-checked', String(b === e.currentTarget)); },
  }, positionThumb(p), h('span', {}, p === 'none' ? 'None' : p[0].toUpperCase() + p.slice(1)))));
  withVars(posSeg, { '--env-bg': rule.color });

  const toggle = (key, title, desc, ic) => h('div', { class: 'setting-row' },
    h('div', { class: 'text' }, h('strong', { class: 'row gap-4' }, icon(ic, { size: 15 }), title), h('span', {}, desc)),
    h('div', { class: 'control' }, switchEl(rule[key], (v) => change({ [key]: v }), { label: title })));

  return h('div', { class: 'rule-body' },
    h('div', { class: 'rule-grid' },
      h('div', { class: 'stack' },
        h('div', { class: 'row gap-12 top' },
          h('div', { class: 'field grow' }, h('label', {}, 'Environment name'), name),
          h('div', { class: 'field' }, h('label', { title: 'Shown on the toolbar badge and in the title prefix' }, 'Tag'), short)),
        h('div', { class: 'field' }, h('label', {}, 'Colour'), h('div', { class: 'row wrap gap-12' }, presets, h('div', { class: 'row' }, picker, hex))),
        h('div', { class: 'field' }, h('label', {}, 'Text colour'), h('div', { class: 'row' }, textSeg, textPicker),
          h('div', { class: 'help' }, 'Auto picks white or dark text for the best contrast.'))),
      h('div', { class: 'stack' }, h('div', { class: 'label' }, 'Live preview'), pv)),
    h('div', { class: 'field mt-16' }, h('label', {}, 'Sites (patterns)'), patternEditor(rule, true)),
    h('div', { class: 'field mt-16' }, h('label', {}, 'Ribbon position'), posSeg),
    h('div', { class: 'mt-16 toggles' },
      toggle('faviconTint', 'Tint favicon', 'Adds a coloured band with the tag to the site icon so you can tell tabs apart.', 'image'),
      toggle('titlePrefix', 'Prefix tab title', `Adds [${shortLabel(rule)}] in front of the page title.`, 'type'),
      toggle('border', 'Page border', 'Draws a coloured frame around the whole page.', 'square'),
      toggle('confirmForms', 'Confirm before submitting forms', 'Asks "Are you sure?" before any form is submitted on these sites.', 'shield-check')));
}

// ---------------------------------------------------------------------------
// Rules section
// ---------------------------------------------------------------------------
const rulesPanel = $('#rules-panel');
const testBox = h('div', { class: 'card test-card' });
const testResult = h('div', { class: 'test-result' });
const testInput = h('input', { class: 'input code', type: 'url', placeholder: 'https://app.staging.example.com/login', 'aria-label': 'URL to test' });
testInput.addEventListener('input', debounce(() => { state.testUrl = testInput.value.trim(); refreshTest(); }, 120));
testBox.append(
  h('div', { class: 'card-head' }, h('h3', {}, icon('search', { size: 18 }), 'Test a URL'), h('span', { class: 'subtle' }, 'Uses your unsaved changes')),
  h('div', { class: 'input-icon' }, icon('globe'), testInput),
  testResult);

function refreshTest() {
  const raw = state.testUrl;
  if (!raw) {
    testResult.replaceChildren(h('p', { class: 'subtle mt-8' }, 'Type or paste an address to see which rule labels it and why.'));
    return;
  }
  const url = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  if (!hostOf(url)) { testResult.replaceChildren(h('p', { class: 'error mt-8' }, 'That does not look like a URL.')); return; }
  const res = explainMatch(url, allRulesDraft());
  const w = res.winner;
  const verdict = w
    ? withVars(h('div', { class: 'test-verdict hit' }, envChip(w.rule),
      h('div', { class: 'grow' }, h('strong', {}, w.rule.label), h('div', { class: 'subtle' }, 'Pattern ', h('code', {}, w.pattern), ` — ${describePattern(w.pattern)}`)),
      sourceBadge(w.rule.source, w.rule.sourceName)), { '--env-bg': w.rule.color })
    : h('div', { class: 'test-verdict miss' }, h('span', { class: 'env-chip none' }, '—'),
      h('div', { class: 'grow' }, h('strong', {}, 'No label'), h('div', { class: 'subtle' }, `No enabled rule matches ${res.host}.`)));
  const steps = h('ol', { class: 'test-steps' }, res.steps.map((s) => {
    let st, text;
    if (s === w) { st = 'win'; text = `matched ${s.pattern}`; }
    else if (s.disabled && s.pattern) { st = 'skip'; text = `would match ${s.pattern}, but the rule is off`; }
    else if (s.shadowed) { st = 'skip'; text = `also matches ${s.pattern}, but a rule above wins`; }
    else if (s.disabled) { st = 'off'; text = 'rule is off'; }
    else { st = 'no'; text = s.rule.patterns.length ? 'no pattern matches' : 'no patterns yet'; }
    return h('li', { class: st }, icon(st === 'win' ? 'check' : st === 'no' || st === 'off' ? 'minus' : 'alert', { size: 14 }),
      h('span', { class: 'env-dot', style: { background: s.rule.color } }), h('strong', {}, s.rule.label),
      h('span', { class: 'subtle' }, `(${SOURCES[s.rule.source]?.label || ''})`), h('span', { class: 'muted' }, text));
  }));
  testResult.replaceChildren(verdict, res.steps.length ? h('details', { class: 'mt-8', open: !w || undefined }, h('summary', { class: 'subtle' }, `How ${res.steps.length} rule${res.steps.length === 1 ? ' was' : 's were'} checked`), steps) : null);
}

function onboarding() {
  if (!personalAllowed() || personalLocked()) return null;
  const prod = state.personal.find((r) => /^PROD|PRODUCTION|LIVE/i.test(r.label) && !r.patterns.length);
  if (!prod) return null;
  const input = h('input', { class: 'input code', placeholder: 'app.yourcompany.com', 'aria-label': 'Production host' });
  const add = () => {
    const values = input.value.split(/[\s,]+/).map(normalizePattern).filter(Boolean);
    if (!values.length) { input.focus(); return; }
    const bad = values.map(patternProblem).find(Boolean);
    if (bad) { toast(bad, { tone: 'warning' }); return; }
    prod.patterns.push(...values.filter((v) => !prod.patterns.includes(v)));
    edited(); renderRules();
    toast(`Added to ${prod.label}. Save to apply.`, { tone: 'success' });
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  return withVars(h('div', { class: 'onboard' },
    h('div', { class: 'onboard-icon' }, icon('shield-alert')),
    h('div', { class: 'grow stack-sm' },
      h('h3', {}, 'Tell us which sites are production'),
      h('p', { class: 'muted' }, 'Staging, QA and local dev sites are recognised automatically from common naming. Production hosts are unique to your company, so add them here and they will get a red ribbon, a tinted favicon and a confirmation before forms are submitted.'),
      h('div', { class: 'input-group mt-8' }, input, h('button', { class: 'btn danger', type: 'button', onclick: add }, icon('plus'), 'Add production site')),
      h('div', { class: 'chip-list mt-4' }, h('span', { class: 'subtle' }, 'Examples:'), ['app.example.com', '*.prod.example.com', 'admin.example.com/*'].map((p) =>
        h('button', { class: 'chip example', type: 'button', onclick: () => { input.value = p; input.focus(); } }, p))))), { '--env-bg': prod.color });
}

function group(title, desc, badge, cards, extra) {
  return h('div', { class: 'rule-group' },
    h('div', { class: 'group-head' }, h('div', { class: 'grow' }, h('h3', { class: 'row' }, title, badge), desc && h('p', { class: 'subtle' }, desc)), extra),
    h('div', { class: 'rule-list' }, cards));
}

function renderRules() {
  heads.clear();
  const parts = [onboarding(), testBox];
  const company = normalizeRules(ctx.settings.rules);
  let pos = 0;
  if (company.length) {
    parts.push(group('Company rules', 'Set by your organization. Checked first; they cannot be changed here.', lockChip(),
      company.map((r, i) => ruleCard(r, { source: 'company', sourceName: 'Your organization', editable: false, index: pos + i, list: company }))));
    pos += company.length;
  }
  const remoteCards = [];
  for (const url of state.urls) {
    const entry = state.remote[url];
    for (const r of normalizeRules(entry?.rules)) remoteCards.push(ruleCard(r, { source: 'remote', sourceName: entry.name || hostOf(url), editable: false, index: pos + remoteCards.length, list: [] }));
  }
  if (remoteCards.length) {
    parts.push(group('Remote rules', 'Loaded from your remote rule sources. Checked after company rules.', h('span', { class: 'badge info' }, icon('cloud'), `${state.urls.length} source${state.urls.length > 1 ? 's' : ''}`), remoteCards,
      h('a', { class: 'btn ghost sm', href: '#remote' }, 'Manage sources', icon('arrow-right'))));
  }

  const editable = !personalLocked() && personalAllowed();
  const addBtn = h('button', { class: 'btn primary sm', type: 'button', disabled: !editable, onclick: () => {
    const r = normalizeRule({ id: newRuleId(), label: 'SANDBOX', color: '#7C3AED', patterns: [], ribbon: 'top' });
    state.personal.push(r); state.expanded.add(r.id); edited(); renderRules();
    setTimeout(() => document.querySelector(`.rule-card[data-id="${CSS.escape(r.id)}"] input`)?.select(), 30);
  } }, icon('plus'), 'Add rule');
  const resetBtn = h('button', { class: 'btn ghost sm', type: 'button', disabled: !editable, onclick: async () => {
    const ok = await confirmDialog({ title: 'Restore the default rules?', message: 'Your personal rules will be replaced with PRODUCTION, STAGING, QA and DEV defaults.', confirmLabel: 'Restore defaults' });
    if (!ok) return;
    state.personal = normalizeRules(clone(DEFAULT_RULES)); edited(); renderRules();
  } }, icon('refresh'), 'Restore defaults');

  let personalBody;
  if (!personalAllowed()) {
    personalBody = h('div', { class: 'callout warning' }, icon('lock'), h('div', {}, h('strong', {}, 'Personal rules are off. '),
      ctx.isLocked('allowPersonalRules') ? 'Your organization only allows company and remote rules.' : 'Turn on "Allow personal rules" under Behaviour to use them.'));
  } else if (!state.personal.length) {
    personalBody = h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, icon('layers')), h('h3', {}, 'No personal rules'),
      h('p', { class: 'subtle' }, 'Add a rule for each environment you work with.'), h('div', { class: 'row mt-12', style: { justifyContent: 'center' } }, addBtn.cloneNode(true)));
    personalBody.querySelector('button').addEventListener('click', () => addBtn.click());
  } else {
    personalBody = state.personal.map((r, i) => ruleCard(r, { source: 'personal', editable, index: i, list: state.personal }));
  }
  parts.push(group('Your rules', editable ? 'Drag the handle or use the arrows to change the order.' : null,
    personalLocked() ? lockChip() : h('span', { class: 'badge' }, icon('user'), 'Personal'), personalBody,
    h('div', { class: 'row' }, resetBtn, addBtn)));

  rulesPanel.replaceChildren(...parts.filter(Boolean));
  refreshTest();
}

// ---------------------------------------------------------------------------
// Remote sources section
// ---------------------------------------------------------------------------
const remotePanel = $('#remote-panel');
let refreshing = false;

function sourceStatus(url) {
  const e = state.remote[url];
  if (!e) return h('span', { class: 'badge' }, icon('clock'), (ctx.settings.rulesUrls || []).includes(url) ? 'Not fetched yet' : 'Save to fetch');
  if (e.ok) return h('span', { class: 'badge success', title: formatDateTime(e.fetchedAt) }, icon('check'), `${e.rules?.length || 0} rules · ${relativeTime(e.fetchedAt)}`);
  return h('span', { class: 'badge danger', title: e.error }, icon('alert'), e.rules ? `Failed · using copy from ${relativeTime(e.lastSuccess)}` : 'Failed');
}

function renderRemote() {
  const locked = urlsLocked();
  const rows = state.urls.map((url, i) => {
    const e = state.remote[url];
    return h('div', { class: 'source-row' },
      h('span', { class: 'li-icon' }, icon('cloud')),
      h('div', { class: 'grow', style: { minWidth: 0 } },
        h('div', { class: 'row' }, h('strong', { class: 'truncate' }, e?.name || hostOf(url) || url), sourceStatus(url)),
        h('div', { class: 'mono subtle truncate', title: url }, url),
        e && !e.ok ? h('div', { class: 'error' }, e.error) : null),
      locked ? null : h('button', { class: 'btn sm icon ghost', type: 'button', 'aria-label': `Remove ${url}`, title: 'Remove source', onclick: () => {
        state.urls.splice(i, 1); edited(); renderRemote(); renderRules();
      } }, icon('trash')));
  });
  const input = h('input', { class: 'input code', type: 'url', placeholder: 'https://config.example.com/env-rules.json', 'aria-label': 'Rule source URL', disabled: locked });
  const err = h('div', { class: 'error', hidden: true });
  const add = async () => {
    const url = input.value.trim();
    let ok = false;
    try { const u = new URL(url); ok = /^https?:$/.test(u.protocol); } catch { /* invalid */ }
    if (!ok) { err.textContent = 'Enter a full http(s) URL to a JSON file.'; err.hidden = false; return; }
    // Request access first, while we still have the user gesture.
    const granted = await ensureHostPermission(url);
    if (!granted) { err.textContent = `Access to ${new URL(url).host} was not granted, so the file cannot be fetched.`; err.hidden = false; return; }
    if (!state.urls.includes(url)) state.urls.push(url);
    input.value = ''; err.hidden = true;
    edited(); renderRemote();
    await refreshNow([url]);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  input.addEventListener('input', () => { err.hidden = true; });

  const refreshBtn = h('button', { class: 'btn', type: 'button', disabled: refreshing || !state.urls.length, onclick: () => refreshNow() },
    refreshing ? h('span', { class: 'spinner' }) : icon('refresh'), refreshing ? 'Refreshing…' : 'Refresh now');

  remotePanel.replaceChildren(
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', { class: 'row' }, icon('link', { size: 18 }), 'Sources', locked ? lockChip() : null), refreshBtn),
      rows.length ? h('div', { class: 'source-list' }, rows)
        : h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, icon('cloud')), h('h3', {}, 'No remote sources'),
          h('p', { class: 'subtle' }, 'Point to a JSON file to share one set of rules with your whole team.')),
      locked ? null : h('div', { class: 'field mt-16' }, h('label', {}, 'Add a source'),
        h('div', { class: 'input-group' }, input, h('button', { class: 'btn primary', type: 'button', onclick: add }, icon('plus'), 'Add')),
        err, h('div', { class: 'help' }, 'Your browser asks once for permission to read from that site. Try it locally with ', h('code', {}, 'node tools/dev-server.mjs'), ' and ', h('code', {}, 'http://localhost:8787/config/env-rules.json'), '.'))),
  );
}

async function refreshNow(urls) {
  refreshing = true; renderRemote();
  try {
    const res = await send('refreshRemote', { urls: urls || state.urls });
    state.remote = { ...state.remote, ...res };
    const failed = Object.entries(res).filter(([, e]) => !e.ok);
    if (failed.length) toast(`${failed.length} source${failed.length > 1 ? 's' : ''} could not be fetched`, { tone: 'warning' });
    else toast('Remote rules updated', { tone: 'success' });
  } catch (err) {
    toast(`Refresh failed: ${err.message}`, { tone: 'danger' });
  } finally {
    refreshing = false; renderRemote(); renderRules();
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
async function loadRemote() {
  try { state.remote = (await send('getRules')).remote || {}; } catch { state.remote = {}; }
}

await loadRemote();
bindSettings(document, ctx);
renderRemote();
renderRules();

// Range readouts + live preview refresh
const outs = [['#ribbon-height', '#ribbon-height-out', (v) => `${v}px`], ['#ribbon-opacity', '#ribbon-opacity-out', (v) => `${Math.round(v * 100)}%`]];
const syncOuts = () => { for (const [i, o, f] of outs) { const el = $(i); if (el) $(o).textContent = f(Number(el.value)); } };
syncOuts();
for (const [i] of outs) $(i)?.addEventListener('input', () => { syncOuts(); renderRulesPreviewsOnly(); });
$('[data-setting="showHostname"]')?.addEventListener('change', renderRulesPreviewsOnly);
$('[data-setting="allowPersonalRules"]')?.addEventListener('change', () => { renderRules(); });
function renderRulesPreviewsOnly() { debouncedRules(); }
const debouncedRules = debounce(renderRules, 60);

ctx.registerCollector(() => {
  const patch = {};
  if (!personalLocked()) patch.personalRules = state.personal.map((r) => ({ ...r, patterns: r.patterns.map(normalizePattern).filter(Boolean) }));
  if (!urlsLocked()) patch.rulesUrls = [...state.urls];
  return patch;
});
ctx.registerValidator((patch) => {
  for (const r of patch.personalRules || []) {
    if (!r.label.trim()) return 'Every rule needs a name';
    const bad = r.patterns.find(patternProblem);
    if (bad) return `${r.label}: "${bad}" — ${patternProblem(bad)}`;
  }
  const n = Number($('[data-setting="refreshMinutes"]')?.value);
  if (!(n >= 1)) return 'Refresh interval must be at least 1 minute';
  return null;
});
ctx.onSaved(async () => { setTimeout(async () => { await loadRemote(); renderRemote(); renderRules(); }, 600); });
ctx.onChange(async () => {
  state.personal = normalizeRules(ctx.settings.personalRules);
  state.urls = [...(ctx.settings.rulesUrls || [])];
  await loadRemote();
  renderRemote(); renderRules();
});

mountBrandingPanel($('#branding-panel'), ctx);
mountBackupPanel($('#backup-panel'), ctx, { slug: 'env-labeler', secretKeys: [] });
mountAboutPanel($('#about-panel'), ctx, {
  description: 'Environment Labeler makes production, staging, QA and development sites impossible to confuse: a coloured ribbon, a tinted favicon, a title prefix, an optional page border, a toolbar badge and an optional confirmation before submitting forms on production.',
  privacy: 'Everything happens in your browser. Page addresses are matched locally against your rules and are never sent anywhere. The only network requests are downloads of the remote rule files you configure, made without cookies.',
});
initSideNav();
