import { initPage, brandMark } from './shared/page.js';
import { api, openExtensionPage } from './shared/browser.js';
import { send } from './shared/messaging.js';
import { bindSettings, mountBrandingPanel, mountBackupPanel, mountAboutPanel, initSideNav, lockChip } from './shared/settings-ui.js';
import { h, icon, $, render, toast, confirmDialog, downloadFile, relativeTime, formatDateTime, formatNumber } from './shared/ui.js';
import { DEFAULTS, PRODUCT, SLUG } from './defaults.js';
import { CATALOG, CATEGORIES } from './catalog.js';
import { createMatcher, aggregate } from './logic.js';
import { appIcon, statusBadge, daysAgo, fmtSeconds, privacyDialog } from './common.js';

const ctx = await initPage({ defaults: DEFAULTS, title: `${PRODUCT} · Settings`, options: true });

const PRIVACY = 'This extension records which SaaS apps are used in this browser by domain only (for example "slack.com"): the number of visits per day, the minutes the app was in the focused tab while you were active, and the last day it was used. It never stores or sends full web addresses, paths, search terms, page titles, page content or keystrokes, and it does not run in private windows. Data stays in this browser for the retention period. If your organization configures a report endpoint, it periodically receives per-app totals tagged with a random install ID and an optional department; your name or email is only included if IT explicitly enables it. Unapproved-app notices are shown locally and are not reported separately.';

bindSettings(document, ctx);
mountBrandingPanel($('#branding-panel'), ctx);
mountBackupPanel($('#backup-panel'), ctx, { slug: SLUG, secretKeys: ['reportHeaders'] });
mountAboutPanel($('#about-panel'), ctx, { description: 'Shadow-IT discovery and licence optimisation: see which SaaS apps are used, which are approved, and which paid licences sit idle.', privacy: PRIVACY });
initSideNav();

// ---------------------------------------------------------------------------
// Catalog search picker
// ---------------------------------------------------------------------------
function looksLikePattern(s) {
  return /^(=|\*\.)?[a-z0-9*]([a-z0-9*-]*[a-z0-9*])?(\.[a-z0-9*]([a-z0-9*-]*[a-z0-9*])?)+$/i.test(s) || /^localhost$/i.test(s);
}

function appPicker({ placeholder = 'Search the catalog or type a domain', onPick, disabled = false }) {
  const input = h('input', { class: 'input', placeholder, disabled, 'aria-autocomplete': 'list', role: 'combobox', 'aria-expanded': 'false' });
  const results = h('div', { class: 'results', role: 'listbox', hidden: true });
  let items = [], active = -1;
  const pool = () => [...CATALOG, ...(ctx.settings.customApps || []).map((c) => ({ ...c, custom: true }))];

  function update() {
    const q = input.value.trim().toLowerCase();
    if (!q) { close(); return; }
    const matches = pool().filter((e) => e.name.toLowerCase().includes(q) || e.domain.includes(q))
      .sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name))
      .slice(0, 8);
    items = matches.map((e) => ({ domain: e.domain, name: e.name, category: e.category }));
    const raw = q.replace(/^https?:\/\//, '').split('/')[0];
    if (looksLikePattern(raw) && !items.some((i) => i.domain === raw)) items.push({ domain: raw, name: raw, category: 'Use this domain or pattern', raw: true });
    active = items.length ? 0 : -1;
    paint();
  }
  function paint() {
    results.hidden = !items.length;
    input.setAttribute('aria-expanded', String(!!items.length));
    render(results, items.map((it, i) => h('div', {
      class: 'list-item', role: 'option', 'aria-selected': String(i === active),
      onmousedown: (e) => { e.preventDefault(); pick(it); },
      onmouseenter: () => { active = i; for (const [j, n] of [...results.children].entries()) n.setAttribute('aria-selected', String(j === i)); },
    },
    it.raw ? h('span', { class: 'app-icon mono' }, icon('plus')) : appIcon(it.domain, it.name, { size: 26 }),
    h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, it.name), h('div', { class: 'li-sub' }, it.raw ? it.category : `${it.domain} · ${it.category}`)))));
  }
  function close() { items = []; active = -1; paint(); }
  function pick(it) { onPick(it); input.value = ''; close(); input.focus(); }
  input.addEventListener('input', update);
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); active = (active + 1) % items.length; paint(); }
    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); active = (active - 1 + items.length) % items.length; paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) pick(items[active]); }
    else if (e.key === 'Escape' && items.length) { e.preventDefault(); e.stopPropagation(); close(); }
  });
  return h('div', { class: 'picker' }, input, results);
}

// ---------------------------------------------------------------------------
// App list editors
// ---------------------------------------------------------------------------
const editors = { state: {} };

function loadEditorState() {
  const s = ctx.settings;
  editors.state = {
    sanctionedApps: [...(s.sanctionedApps || [])],
    unsanctionedApps: [...(s.unsanctionedApps || [])],
    alternatives: JSON.parse(JSON.stringify(s.alternatives || {})),
    licensedApps: JSON.parse(JSON.stringify(s.licensedApps || [])),
    customApps: JSON.parse(JSON.stringify(s.customApps || [])),
  };
}

function matcherNow() {
  return createMatcher({ ...ctx.settings, customApps: editors.state.customApps });
}

function nameFor(pattern) {
  const bare = pattern.replace(/^[=*.]+/, '');
  const e = matcherNow().lookup(bare);
  return e && (e.domain === bare) ? e : null;
}

function rowShell(pattern, { title, sub, extra, locked, onRemove }) {
  const known = nameFor(pattern);
  return h('div', { class: 'app-row' },
    appIcon(pattern.replace(/^[=*.]+/, ''), title || known?.name || pattern, { size: 28 }),
    h('div', { class: 'main' },
      h('div', { class: 'n truncate' }, title || known?.name || pattern),
      h('div', { class: 'd truncate' }, sub ?? (known ? `${pattern} · ${known.category}` : `${pattern} · pattern`))),
    extra ? h('div', { class: 'extra' }, extra) : null,
    locked ? null : h('button', { class: 'btn ghost icon sm', type: 'button', title: 'Remove', 'aria-label': `Remove ${pattern}`, onclick: onRemove }, icon('trash')));
}

function cardHead(title, ic, desc, key, count) {
  return [
    h('div', { class: 'card-head' },
      h('h3', {}, icon(ic, { size: 18 }), title, count != null ? h('span', { class: 'badge' }, String(count)) : null),
      ctx.isLocked(key) ? lockChip() : null),
    desc ? h('p', { class: 'subtle', style: { marginTop: '-6px', marginBottom: '10px' } }, desc) : null,
  ];
}

function changed() { ctx.markDirty(); drawEditors(); }

function sanctionedCard() {
  const key = 'sanctionedApps';
  const locked = ctx.isLocked(key);
  const list = editors.state[key];
  return h('div', { class: 'card app-editor' },
    cardHead('Approved apps', 'shield-check', 'Apps IT supports. Shown as "Approved" to users and in reports.', key, list.length),
    locked ? null : appPicker({ onPick: (it) => { if (!list.includes(it.domain)) { list.push(it.domain); changed(); } } }),
    h('div', { class: 'rows' }, list.length ? list.map((p, i) => rowShell(p, { locked, onRemove: () => { list.splice(i, 1); changed(); } }))
      : h('div', { class: 'empty-row' }, 'No approved apps yet. Everything is "Unclassified" until you add some.')));
}

function unsanctionedCard() {
  const key = 'unsanctionedApps';
  const locked = ctx.isLocked(key);
  const list = editors.state[key];
  const alts = editors.state.alternatives;
  return h('div', { class: 'card app-editor' },
    cardHead('Not approved apps', 'shield-alert', 'Discouraged or forbidden apps. Users see a notice, and you can suggest an approved alternative for each.', key, list.length),
    locked ? null : appPicker({ onPick: (it) => { if (!list.includes(it.domain)) { list.push(it.domain); changed(); } } }),
    h('div', { class: 'rows' }, list.length ? list.map((p, i) => {
      const altLocked = ctx.isLocked('alternatives') || ctx.isLocked(`alternatives.${p}`);
      const alt = typeof alts[p] === 'string' ? { name: alts[p], url: '' } : (alts[p] || { name: '', url: '' });
      const setAlt = (field, value) => {
        const next = { ...alt, [field]: value.trim() };
        if (!next.name && !next.url) delete alts[p]; else alts[p] = next;
        ctx.markDirty();
      };
      return rowShell(p, {
        locked,
        onRemove: () => { list.splice(i, 1); delete alts[p]; changed(); },
        extra: [
          h('input', { class: 'input', placeholder: 'Alternative, e.g. OneDrive', value: alt.name, disabled: altLocked, style: { width: '170px' }, 'aria-label': `Alternative to ${p}`, oninput: (e) => setAlt('name', e.target.value) }),
          h('input', { class: 'input', type: 'url', placeholder: 'https://…', value: alt.url, disabled: altLocked, style: { width: '190px' }, 'aria-label': `Alternative URL for ${p}`, oninput: (e) => setAlt('url', e.target.value) }),
        ],
      });
    }) : h('div', { class: 'empty-row' }, 'No apps marked as not approved.')));
}

let lastSeenCache = {};
function licensedCard() {
  const key = 'licensedApps';
  const locked = ctx.isLocked(key);
  const list = editors.state[key];
  const used = (pattern) => {
    const p = pattern.replace(/^[=*.]+/, '');
    let best = '';
    for (const [d, day] of Object.entries(lastSeenCache)) if ((d === p || d.endsWith('.' + p)) && day > best) best = day;
    return best;
  };
  return h('div', { class: 'card app-editor' },
    cardHead('Licensed apps', 'key', 'Apps the company pays for. The dashboard and reports flag licences that are not used.', key, list.length),
    h('div', { class: 'row wrap', style: { marginBottom: '10px' } },
      h('span', { class: 'subtle' }, 'Flag as unused after'),
      h('input', { class: 'input', type: 'number', min: 1, max: 365, style: { width: '90px' }, 'aria-label': 'Days without use', value: ctx.settings.licenseUnusedDays, disabled: ctx.isLocked('licenseUnusedDays'),
        oninput: (e) => { editors.unusedDays = Number(e.target.value) || 30; ctx.markDirty(); } }),
      h('span', { class: 'subtle' }, 'days without use'),
      ctx.isLocked('licenseUnusedDays') ? lockChip() : null),
    locked ? null : appPicker({ onPick: (it) => { if (!list.some((l) => l.domain === it.domain)) { list.push({ domain: it.domain, name: it.raw ? '' : it.name }); changed(); } } }),
    h('div', { class: 'rows' }, list.length ? list.map((l, i) => {
      const seen = used(l.domain);
      return rowShell(l.domain, {
        title: l.name || nameFor(l.domain)?.name || l.domain,
        sub: `${l.domain} · ${seen ? `last used here ${daysAgo(seen)}` : 'not used on this browser'}`,
        locked,
        onRemove: () => { list.splice(i, 1); changed(); },
        extra: [
          h('input', { class: 'input', placeholder: 'Display name', value: l.name || '', disabled: locked, style: { width: '150px' }, 'aria-label': `Name for ${l.domain}`, oninput: (e) => { l.name = e.target.value.trim(); ctx.markDirty(); } }),
          h('input', { class: 'input', type: 'number', min: 0, placeholder: 'Seats', value: l.seats ?? '', disabled: locked, style: { width: '84px' }, 'aria-label': `Seats for ${l.domain}`, oninput: (e) => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) l.seats = n; else delete l.seats; ctx.markDirty(); } }),
        ],
      });
    }) : h('div', { class: 'empty-row' }, 'No licensed apps listed.')));
}

function customCard() {
  const key = 'customApps';
  const locked = ctx.isLocked(key);
  const list = editors.state[key];
  const dom = h('input', { class: 'input code', placeholder: 'tools.example.com', 'aria-label': 'Custom app domain' });
  const name = h('input', { class: 'input', placeholder: 'App name', 'aria-label': 'Custom app name' });
  const cat = h('select', { class: 'select', 'aria-label': 'Custom app category' }, CATEGORIES.map((c) => h('option', { value: c }, c)));
  cat.value = 'Other';
  const add = () => {
    const d = dom.value.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
    if (!looksLikePattern(d)) { dom.classList.add('invalid'); toast('Enter a domain like tools.example.com or *.example.com', { tone: 'warning' }); return; }
    dom.classList.remove('invalid');
    const existing = list.find((c) => c.domain === d);
    if (existing) Object.assign(existing, { name: name.value.trim() || d, category: cat.value });
    else list.push({ domain: d, name: name.value.trim() || d, category: cat.value });
    changed();
  };
  for (const el of [dom, name]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  return h('div', { class: 'card app-editor' },
    cardHead('Custom apps', 'plus', 'Add apps that are not in the catalog, such as niche or regional tools. Custom entries override the catalog for the same domain, and may also name internal hosts you want counted.', key, list.length),
    locked ? null : h('div', { class: 'row wrap' }, h('div', { class: 'grow', style: { minWidth: '180px' } }, dom), h('div', { style: { width: '180px' } }, name), h('div', { style: { width: '190px' } }, cat),
      h('button', { class: 'btn', type: 'button', onclick: add }, icon('plus'), 'Add')),
    h('div', { class: 'rows' }, list.length ? list.map((c, i) => rowShell(c.domain, {
      title: c.name || c.domain, sub: `${c.domain} · ${c.category || 'Other'}${c.vendor ? ` · ${c.vendor}` : ''}`, locked,
      onRemove: () => { list.splice(i, 1); changed(); },
    })) : h('div', { class: 'empty-row' }, `The built-in catalog has ${CATALOG.length} apps. Add your own here.`)));
}

function drawEditors() {
  render($('#apps-editors'), sanctionedCard(), unsanctionedCard(), licensedCard(), customCard());
}

loadEditorState();
drawEditors();
ctx.registerCollector(() => {
  const patch = { ...editors.state };
  if (editors.unusedDays != null) patch.licenseUnusedDays = editors.unusedDays;
  return patch;
});
ctx.registerValidator((patch) => {
  if (patch.reportEndpoint && !/^https?:\/\/[^\s]+$/i.test(patch.reportEndpoint)) return 'The report endpoint must be an http(s) URL.';
  if (patch.reportHeaders != null && (typeof patch.reportHeaders !== 'object' || Array.isArray(patch.reportHeaders))) return 'Extra request headers must be a JSON object.';
  if (patch.idleSeconds != null && patch.idleSeconds < 15) return 'Idle time must be at least 15 seconds.';
  if (patch.retentionDays != null && (patch.retentionDays < 1 || patch.retentionDays > 400)) return 'Keep data between 1 and 400 days.';
  if (patch.reportIntervalHours != null && patch.reportIntervalHours < 1) return 'Send reports at most once an hour.';
  return null;
});
ctx.onChange(() => { loadEditorState(); editors.unusedDays = null; drawEditors(); drawStatus(); drawNotices(); drawData(); });
ctx.onSaved(() => { loadEditorState(); editors.unusedDays = null; drawEditors(); drawStatus(); drawNotices(); });

// ---------------------------------------------------------------------------
// Reporting status
// ---------------------------------------------------------------------------
async function drawStatus() {
  const el = $('#report-status-card');
  const st = await send('reportState').catch(() => ({}));
  const s = ctx.settings;
  const r = st.lastResult;
  const configured = s.reportingEnabled && s.reportEndpoint;
  const btn = h('button', { class: 'btn primary', type: 'button', disabled: !configured }, icon('send'), 'Send report now');
  btn.addEventListener('click', async () => {
    if (ctx.dirty) { toast('Save your changes first, then send.', { tone: 'warning' }); return; }
    btn.disabled = true;
    btn.replaceChildren(h('span', { class: 'spinner' }), 'Sending…');
    try {
      const res = await send('sendReportNow');
      toast(`Report sent: ${res.apps} app${res.apps === 1 ? '' : 's'}`, { tone: 'success' });
    } catch (err) {
      toast(`Report failed: ${err.message}`, { tone: 'danger', timeout: 6000 });
    }
    drawStatus();
  });
  render(el,
    h('div', { class: 'row between wrap gap-12' },
      h('div', { class: 'report-status' },
        h('span', { class: `status-dot ${r ? (r.ok ? 'ok' : 'fail') : ''}` }),
        h('div', {},
          h('strong', {}, !configured ? (s.reportingEnabled ? 'No endpoint configured' : 'Reporting is off') : r ? (r.ok ? 'Last report delivered' : 'Last report failed') : 'No report sent yet'),
          h('div', { class: 'subtle' },
            r ? `${r.ok ? `${r.apps} apps · ` : ''}${relativeTime(r.at)} (${formatDateTime(r.at)})${r.ok ? '' : ` · ${r.error}`}` : 'Usage stays on this device until a report is sent.',
            configured && st.nextDueAt ? ` · next ${st.nextDueAt <= Date.now() ? 'within 15 minutes' : relativeTime(st.nextDueAt)}` : '',
            st.failures > 0 && configured ? ` · retrying with backoff (attempt ${st.failures})` : ''))),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => privacyDialog(ctx) }, icon('eye'), 'What is sent?'),
        btn)));
}

// ---------------------------------------------------------------------------
// User notices: banner permission + preview
// ---------------------------------------------------------------------------
const ALL = { origins: ['<all_urls>'] };
async function drawNotices() {
  let granted = false;
  try { granted = await api.permissions.contains(ALL); } catch { /* ignore */ }
  const box = $('#banner-permission');
  const allow = h('button', { class: 'btn soft sm', type: 'button', onclick: async () => {
    let ok = false;
    try { ok = await api.permissions.request(ALL); } catch { /* ignore */ }
    toast(ok ? 'In-page notices enabled' : 'Permission not granted. System notifications will be used.', { tone: ok ? 'success' : 'warning' });
    drawNotices();
  } }, icon('unlock'), 'Allow in-page notices');
  const revoke = h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => { try { await api.permissions.remove(ALL); } catch { /* ignore */ } drawNotices(); } }, 'Use system notifications');
  const test = h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => { try { await send('testNotification'); toast('Test notification sent', { tone: 'success' }); } catch (e) { toast(e.message, { tone: 'danger' }); } } }, icon('alert'), 'Test notification');
  render(box, h('div', { class: `callout ${granted ? 'success' : ''}` }, icon(granted ? 'check' : 'info'), h('div', { class: 'grow' },
    granted
      ? [h('strong', {}, 'In-page notices are on. '), 'A small branded card appears in the corner of the unapproved app\'s tab. The extension reads nothing from the page.']
      : [h('strong', {}, 'Using system notifications. '), 'For a nicer in-page card, allow the extension to show its notice on websites. It is only injected into the tab of an unapproved app, at most once a day.'],
    h('div', { class: 'row wrap mt-8' }, granted ? revoke : allow, test))));

  const exampleApp = (ctx.settings.unsanctionedApps || [])[0];
  const alt = exampleApp ? createMatcher(ctx.settings).alternativeFor(exampleApp) : null;
  const appName = (exampleApp && nameFor(exampleApp)?.name) || exampleApp || 'WeTransfer';
  const altName = alt?.name || 'OneDrive';
  render($('#notice-preview'), h('div', { class: 'notice-mock' },
    h('div', { class: 'bar-top' }),
    h('div', { class: 'who' }, brandMark(ctx.brand, { size: 20 }), `${ctx.brand.companyName} · IT notice`),
    h('div', { class: 'body' }, h('span', { class: 'ico' }, icon('shield-alert')),
      h('div', {}, h('h3', {}, `${appName} isn't approved by ${ctx.brand.companyName}${/[.!]$/.test(ctx.brand.companyName) ? '' : '.'}`),
        h('p', {}, `Try ${altName} instead. It's supported by IT and keeps company data in approved systems.`),
        h('div', { class: 'row end mt-12' }, h('span', { class: 'btn ghost sm', 'aria-hidden': 'true' }, 'Why?'), h('span', { class: 'btn primary sm', 'aria-hidden': 'true' }, `Open ${altName}`))))),
  h('p', { class: 'subtle mt-8' }, granted ? 'Shown in the page, dismissible with × or Escape.' : 'Without the site permission, the same message appears as a system notification.'));
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
async function drawData() {
  const usage = await send('getUsage', { days: 400 }).catch(() => ({ days: {}, lastSeen: {} }));
  lastSeenCache = usage.lastSeen || {};
  const days = Object.keys(usage.days);
  const apps = aggregate(usage.days);
  const total = apps.reduce((s, a) => s + a.activeSeconds, 0);
  const bytes = JSON.stringify(usage).length;
  render($('#data-panel'),
    h('div', { class: 'grid-3' },
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Days stored'), h('div', { class: 'stat-value' }, formatNumber(days.length)), h('div', { class: 'stat-sub' }, days.length ? `since ${days.sort()[0]}` : 'nothing yet')),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Apps'), h('div', { class: 'stat-value' }, formatNumber(apps.length)), h('div', { class: 'stat-sub' }, `${fmtSeconds(total)} active time`)),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Storage'), h('div', { class: 'stat-value' }, `${(bytes / 1024).toFixed(1)} KB`), h('div', { class: 'stat-sub' }, usage.demo ? 'includes demo data' : 'in extension storage'))),
    h('div', { class: 'setting-row mt-16' },
      h('div', { class: 'text' }, h('strong', {}, 'View your data'), h('span', {}, 'The dashboard shows everything recorded, per app and per day.')),
      h('div', { class: 'control' }, h('button', { class: 'btn', type: 'button', onclick: () => openExtensionPage('dashboard.html') }, icon('chart'), 'Open dashboard'))),
    h('div', { class: 'setting-row' },
      h('div', { class: 'text' }, h('strong', {}, 'Export local data'), h('span', {}, 'Download the raw daily totals as JSON.')),
      h('div', { class: 'control' }, h('button', { class: 'btn', type: 'button', disabled: !days.length, onclick: () => downloadFile(`saas-usage-raw-${new Date().toISOString().slice(0, 10)}.json`, { source: 'saas-reporter', exportedAt: new Date().toISOString(), ...usage }) }, icon('download'), 'Export'))),
    h('div', { class: 'setting-row' },
      h('div', { class: 'text' }, h('strong', {}, 'Clear local data'), h('span', {}, 'Deletes all recorded usage on this browser. Reports already sent are not affected.')),
      h('div', { class: 'control' }, h('button', { class: 'btn danger-soft', type: 'button', disabled: !days.length, onclick: async () => {
        if (!(await confirmDialog({ title: 'Clear all local usage data?', message: 'This removes every recorded visit and active time on this browser. It cannot be undone.', confirmLabel: 'Clear data', tone: 'danger' }))) return;
        await send('clearData');
        toast('Local data cleared', { tone: 'success' });
        drawData(); drawEditors();
      } }, icon('trash'), 'Clear data'))));
}

// ---------------------------------------------------------------------------
// About → Advanced (developer options)
// ---------------------------------------------------------------------------
function drawAdvanced() {
  const body = h('div', { class: 'stack', hidden: true },
    h('div', { class: 'callout warning' }, icon('alert'), h('div', {}, h('strong', {}, 'For testing only. '), 'Demo data replaces all local usage with 45 days of generated sample data. It is clearly marked as demo on the dashboard, and would be included in reports if reporting is on.')),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        if (!(await confirmDialog({ title: 'Load demo data?', message: 'Your local usage data is replaced with generated sample data.', confirmLabel: 'Load demo data' }))) return;
        const n = await send('loadDemo');
        toast(`Loaded ${n} days of demo data`, { tone: 'success' });
        drawData(); drawEditors();
      } }, icon('sparkle'), 'Load demo data'),
      h('button', { class: 'btn ghost', type: 'button', onclick: async () => { const n = await send('prune'); toast(`Pruned ${n} expired day${n === 1 ? '' : 's'}`); drawData(); } }, icon('refresh'), 'Prune now')));
  const toggle = h('button', { class: 'btn ghost sm', type: 'button', 'aria-expanded': 'false', onclick: () => {
    body.hidden = !body.hidden;
    toggle.setAttribute('aria-expanded', String(!body.hidden));
    toggle.replaceChildren(icon(body.hidden ? 'chevron-right' : 'chevron-down'), 'Advanced (developer options)');
  } }, icon('chevron-right'), 'Advanced (developer options)');
  render($('#advanced-panel'), h('div', { class: 'card' }, toggle, h('div', { class: 'mt-12' }, body)));
}

drawStatus();
drawNotices();
drawData();
drawAdvanced();
if (location.hash === '#advanced') { $('#advanced-panel button')?.click(); }
