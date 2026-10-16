import { api, openOptions, extUrl } from './shared/browser.js';
import { initPage } from './shared/page.js';
import { send } from './shared/messaging.js';
import { h, icon, toast, $ } from './shared/ui.js';
import { hostOf, isRestrictedUrl } from './shared/domain.js';
import { DEFAULTS, COLOR_PRESETS } from './defaults.js';
import { SOURCES, matchRules, mergeRules, normalizeRules, shortLabel, textColorFor, newRuleId, describePattern } from './rules.js';

const settingsBtn = h('button', { class: 'btn ghost icon sm', type: 'button', title: 'Settings', 'aria-label': 'Open settings', onclick: () => { openOptions(); window.close(); } }, icon('settings'));
const ctx = await initPage({ defaults: DEFAULTS, title: 'Environment Labeler', headerActions: [settingsBtn] });
const main = $('#main');

const state = { tab: null, url: '', data: null, hidden: false, contentReady: false, picker: false, creating: false };

async function resolveTab() {
  const params = new URLSearchParams(location.search);
  let tab = null;
  try {
    if (params.get('tabId')) tab = await api.tabs.get(Number(params.get('tabId')));
    else [tab] = await api.tabs.query({ active: true, currentWindow: true });
  } catch { tab = null; }
  let url = tab?.url || '';
  if (url.startsWith(extUrl(''))) return { tab: null, url: '' };
  if (!url && tab) {
    const st = await send('tabState', { tabId: tab.id }).catch(() => null);
    url = st?.url || '';
  }
  return { tab, url: /^(https?|file):/i.test(url) && !isRestrictedUrl(url) ? url : '' };
}

async function probeContent() {
  if (!state.tab) return;
  try {
    const res = await api.tabs.sendMessage(state.tab.id, { type: 'env:state' });
    state.contentReady = !!res?.ok;
    state.hidden = !!res?.data?.hidden;
  } catch {
    state.contentReady = false;
  }
}

async function load() {
  Object.assign(state, await resolveTab());
  state.data = await send('getRules');
  await probeContent();
  render();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function swatch(rule, size = 14) {
  return h('span', { class: 'env-swatch', style: { background: rule.color, width: `${size}px`, height: `${size}px` } });
}

function sourceBadge(rule) {
  const s = SOURCES[rule.source] || SOURCES.personal;
  return h('span', { class: `badge ${s.tone}`, title: rule.sourceName ? `Source: ${rule.sourceName}` : '' }, icon(s.icon), s.label);
}

function currentMatch() {
  if (!state.url || !state.data) return null;
  if (!state.data.enabled) return null;
  return matchRules(state.url, state.data.rules);
}

function heroCard(m) {
  let host = hostOf(state.url);
  try { host = new URL(state.url).host; } catch { /* keep */ }
  if (!state.url) {
    return h('div', { class: 'empty env-empty' },
      h('div', { class: 'empty-icon' }, icon('globe')),
      h('h3', {}, 'Open a website to see its environment'),
      h('p', { class: 'subtle' }, 'Environment Labeler marks production, staging and dev sites with a colour, a ribbon and a badge on this icon.'));
  }
  if (!m) {
    return h('div', { class: 'env-none' },
      h('div', { class: 'row' }, h('span', { class: 'env-none-icon' }, icon('tag')),
        h('div', { class: 'grow' },
          h('div', { class: 'env-none-title' }, 'No environment label for this site'),
          h('div', { class: 'mono subtle truncate', title: state.url }, host))));
  }
  const { rule, pattern } = m;
  const fg = textColorFor(rule);
  const features = [
    rule.ribbon !== 'none' && ['flag', `${rule.ribbon[0].toUpperCase()}${rule.ribbon.slice(1)} ribbon`],
    rule.faviconTint && ['image', 'Favicon'],
    rule.titlePrefix && ['type', `[${shortLabel(rule)}] title`],
    rule.border && ['square', 'Border'],
    rule.confirmForms && ['shield-check', 'Confirms forms'],
  ].filter(Boolean);
  const s = SOURCES[rule.source] || SOURCES.personal;
  return withVars(h('div', { class: 'env-hero' },
    h('div', { class: 'row between' },
      h('span', { class: 'env-tag' }, icon('server'), shortLabel(rule)),
      h('span', { class: 'env-src', title: rule.sourceName || '' }, icon(s.icon), `${s.label} rule`)),
    h('div', { class: 'env-label' }, rule.label),
    h('div', { class: 'env-host mono truncate', title: state.url }, host),
    h('div', { class: 'env-why', title: describePattern(pattern) }, 'Matched ', h('code', {}, pattern)),
    features.length ? h('div', { class: 'env-feats' }, features.map(([ic, t]) => h('span', {}, icon(ic), t))) : null), { '--env-bg': rule.color, '--env-fg': fg });
}

function withVars(el, vars) {
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  return el;
}

function canLabel(m) {
  const d = state.data;
  if (!d.allowPersonalRules) return { ok: false, why: 'Your organization has turned off personal rules.' };
  if (d.personalLocked) return { ok: false, why: 'Rules are managed by your organization.' };
  if (m && m.rule.source !== 'personal') return { ok: false, why: `Labelled by ${m.rule.source === 'company' ? 'your organization' : m.rule.sourceName}. Personal rules cannot override it.` };
  return { ok: true };
}

function sitePattern() {
  try {
    const u = new URL(state.url);
    return `=${u.hostname.toLowerCase()}${u.port ? ':' + u.port : ''}`;
  } catch { return ''; }
}

function actions(m) {
  if (!state.url) return null;
  const perm = canLabel(m);
  const wrap = h('div', { class: 'stack-sm' });
  const labelBtn = h('button', {
    class: `btn block ${m ? '' : 'primary'}`, type: 'button', disabled: !perm.ok, 'aria-expanded': String(state.picker),
    onclick: () => { state.picker = !state.picker; state.creating = false; render(); },
  }, icon('tag'), m ? 'Change label for this site…' : 'Label this site as…', h('span', { class: 'grow' }), icon(state.picker ? 'chevron-down' : 'chevron-right'));
  wrap.append(labelBtn);
  if (!perm.ok) wrap.append(h('p', { class: 'subtle row gap-4' }, icon('lock', { size: 13 }), perm.why));
  if (state.picker && perm.ok) wrap.append(picker(m));

  const hasVisual = m && (m.rule.ribbon !== 'none' || m.rule.border);
  if (hasVisual) {
    const allowHide = ctx.settings.allowHideRibbon !== false;
    const hideBtn = h('button', {
      class: 'btn block ghost', type: 'button', disabled: !state.contentReady || !allowHide,
      onclick: async () => {
        try {
          const res = await api.tabs.sendMessage(state.tab.id, { type: state.hidden ? 'env:show' : 'env:hide' });
          state.hidden = !!res?.data?.hidden;
          render();
        } catch { toast('Reload the page to control its ribbon', { tone: 'warning' }); }
      },
    }, icon(state.hidden ? 'eye' : 'eye-off'), state.hidden ? 'Show ribbon on this tab again' : 'Hide ribbon on this tab');
    wrap.append(hideBtn);
    if (!allowHide) wrap.append(h('p', { class: 'subtle' }, 'Hiding the ribbon is turned off by your settings.'));
    else if (!state.contentReady) wrap.append(h('p', { class: 'subtle' }, 'Reload this page to show or hide its ribbon.'));
  }
  if (m && m.rule.source === 'personal' && perm.ok && (m.pattern === sitePattern() || m.pattern === sitePattern().slice(1))) {
    wrap.append(h('button', { class: 'btn block ghost', type: 'button', onclick: () => unlabel(m) }, icon('x'), 'Remove label from this site'));
  }
  return wrap;
}

function picker(m) {
  const rules = state.data.rules.filter((r) => r.source === 'personal');
  const list = h('div', { class: 'list env-picker', role: 'listbox', 'aria-label': 'Environments' },
    rules.map((r) => h('button', {
      class: `list-item${m?.rule.id === r.id ? ' selected' : ''}`, type: 'button', role: 'option', 'aria-selected': String(m?.rule.id === r.id),
      onclick: () => labelAs(r),
    }, swatch(r, 18), h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, r.label)), h('span', { class: 'li-meta' }, shortLabel(r)))),
    h('button', { class: 'list-item', type: 'button', onclick: () => { state.creating = !state.creating; render(); } },
      h('span', { class: 'li-icon' }, icon('plus')), h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, 'New environment…'))));
  const box = h('div', { class: 'card tight env-pick-card' }, list);
  if (state.creating) box.append(createForm());
  return box;
}

function createForm() {
  let color = COLOR_PRESETS[6].color;
  const input = h('input', { class: 'input', placeholder: 'e.g. SANDBOX', maxlength: 40, 'aria-label': 'Environment name' });
  const sw = h('div', { class: 'swatches' }, COLOR_PRESETS.map((p) => h('button', {
    class: 'swatch env-sw', type: 'button', title: p.name, 'aria-label': p.name, 'aria-pressed': String(p.color === color),
    style: { background: p.color },
    onclick: (e) => { color = p.color; for (const b of sw.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); },
  })));
  const submit = () => {
    const label = input.value.trim().toUpperCase();
    if (!label) { input.classList.add('invalid'); input.focus(); return; }
    labelAs({ id: newRuleId(), label, color, patterns: [], ribbon: 'top', faviconTint: true, titlePrefix: true, border: false, confirmForms: false, enabled: true, source: 'new' });
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  setTimeout(() => input.focus(), 0);
  return h('div', { class: 'stack-sm env-create' }, input, sw,
    h('button', { class: 'btn primary sm block', type: 'button', onclick: submit }, icon('plus'), 'Create and label this site'));
}

function rulesList(m) {
  const rules = state.data.rules;
  if (!rules.length) {
    return h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, icon('layers')), h('h3', {}, 'No rules yet'),
      h('p', { class: 'subtle' }, 'Add your environments in settings.'));
  }
  const max = 6;
  const rows = rules.slice(0, max).map((r) => h('div', { class: `env-row${m?.rule === r ? ' current' : ''}${r.enabled ? '' : ' off'}` },
    swatch(r),
    h('span', { class: 'env-row-label truncate' }, r.label),
    h('span', { class: 'subtle nowrap' }, r.patterns.length ? `${r.patterns.length} pattern${r.patterns.length > 1 ? 's' : ''}` : 'no sites yet'),
    h('span', { class: 'grow' }),
    m?.rule === r ? h('span', { class: 'badge success' }, icon('check'), 'This site') : sourceBadge(r)));
  return h('div', {},
    h('div', { class: 'row between env-list-head' }, h('h4', {}, 'Rules'),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { openOptions(); window.close(); } }, rules.length > max ? `All ${rules.length} rules` : 'Edit rules', icon('arrow-right'))),
    h('div', { class: 'env-rows' }, rows));
}

function render() {
  const m = currentMatch();
  const parts = [];
  if (!state.data.enabled) {
    parts.push(h('div', { class: 'callout warning' }, icon('power'),
      h('div', { class: 'grow' }, h('strong', {}, 'Labels are turned off. '), 'Sites are not marked right now.'),
      ctx.isLocked('enabled') ? null : h('button', { class: 'btn sm', type: 'button', onclick: async () => { await ctx.save({ enabled: true }); await load(); } }, 'Turn on')));
  }
  parts.push(heroCard(m), actions(m), rulesList(m));
  main.replaceChildren(h('div', { class: 'pad stack' }, parts));
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function personalCopy() {
  return normalizeRules(ctx.settings.personalRules);
}

async function labelAs(target) {
  const pattern = sitePattern();
  if (!pattern) return;
  const bare = pattern.slice(1);
  const personal = personalCopy();
  for (const r of personal) r.patterns = r.patterns.filter((p) => p !== pattern && p !== bare);
  let rule = personal.find((r) => r.id === target.id);
  if (!rule) {
    const { source, sourceName, sourceUrl, ...clean } = target;
    rule = { ...clean, id: target.source === 'new' ? clean.id : newRuleId(), patterns: [] };
    personal.unshift(rule);
  }
  rule.patterns.push(pattern);
  rule.enabled = true;
  await ctx.save({ personalRules: personal });
  state.picker = false; state.creating = false;
  state.data = await send('getRules');
  const after = matchRules(state.url, mergeRules(ctx.settings, state.data.remote));
  if (after && after.rule.id !== rule.id) {
    toast(`${after.rule.label} is higher in the list and still matches. Reorder rules in settings.`, { tone: 'warning', timeout: 6000 });
  } else {
    toast(`${hostOf(state.url)} is now labelled ${rule.label}`, { tone: 'success' });
  }
  setTimeout(async () => { await probeContent(); render(); }, 250);
  render();
}

async function unlabel(m) {
  const pattern = sitePattern();
  const personal = personalCopy();
  for (const r of personal) r.patterns = r.patterns.filter((p) => p !== pattern && p !== pattern.slice(1));
  await ctx.save({ personalRules: personal });
  state.data = await send('getRules');
  toast(`Removed the ${m.rule.label} label from ${hostOf(state.url)}`, { tone: 'success' });
  render();
}

ctx.onChange(async () => { state.data = await send('getRules'); render(); });

load().catch((err) => {
  main.replaceChildren(h('div', { class: 'pad' }, h('div', { class: 'callout danger' }, icon('alert'), h('div', {}, `Could not load: ${err.message}`))));
});
