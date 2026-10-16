import { initPage } from './shared/page.js';
import { openOptions } from './shared/browser.js';
import { send } from './shared/messaging.js';
import { h, icon, $, render, toast, formatNumber, downloadFile, debounce, sortableHeaders, confirmDialog } from './shared/ui.js';
import { DEFAULTS } from './defaults.js';
import { CATEGORIES } from './catalog.js';
import { createMatcher, aggregate, lastDays, licensedUnused, toCsv } from './logic.js';
import { STATUS, statusBadge, appIcon, fmtSeconds, fmtDay, daysAgo, privacyDialog } from './common.js';

const ctx = await initPage({
  defaults: DEFAULTS,
  title: 'SaaS usage dashboard',
  headerActions: [
    h('button', { class: 'btn ghost sm', type: 'button', onclick: () => privacyDialog(ctx) }, icon('shield'), 'What is collected?'),
    h('button', { class: 'btn sm', type: 'button', onclick: () => openOptions() }, icon('settings'), 'Settings'),
  ],
});

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

const state = {
  period: Number(store.get('saas.period', 30)) || 30,
  search: '',
  status: 'all',
  category: 'all',
  sort: { key: 'activeSeconds', dir: 'desc' },
  usage: null,
};

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)'];

async function refresh() {
  state.usage = await send('getUsage', { days: 90 }).catch((err) => { toast(err.message, { tone: 'danger' }); return { days: {}, lastSeen: {} }; });
  draw();
}

function model() {
  const matcher = createMatcher(ctx.settings);
  const range = lastDays(state.period);
  const inRange = new Set(range);
  const days = Object.fromEntries(Object.entries(state.usage.days).filter(([d]) => inRange.has(d)));
  const apps = aggregate(days).map((a) => {
    const info = matcher.describe(a.domain);
    return { ...a, name: info.name, category: info.category, status: info.status, licensed: info.licensed, alternative: info.status === 'unsanctioned' ? matcher.alternativeFor(a.domain) : null };
  });
  const unused = licensedUnused(ctx.settings.licensedApps, state.usage.lastSeen, Number(ctx.settings.licenseUnusedDays) || 30, Date.now(), matcher);
  return { range, apps, unused, matcher };
}

function draw() {
  const main = $('#main');
  main.removeAttribute('aria-busy');
  const m = model();
  const total = m.apps.reduce((s, a) => s + a.activeSeconds, 0);
  const hasAny = Object.keys(state.usage.days).length > 0;

  const periodSeg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Period' },
    [7, 30, 90].map((n) => h('button', { type: 'button', 'aria-pressed': String(state.period === n), onclick: () => { state.period = n; store.set('saas.period', n); draw(); } }, `${n} days`)));

  const toolbar = h('div', { class: 'dash-toolbar' },
    h('div', {},
      h('h1', {}, 'App usage'),
      h('div', { class: 'sub' }, `${fmtDay(m.range[0])} – ${fmtDay(m.range.at(-1))} · from this browser only · domains, never page addresses`)),
    h('div', { class: 'row wrap' },
      periodSeg,
      h('button', { class: 'btn', type: 'button', disabled: !m.apps.length, onclick: () => exportCsv(m) }, icon('download'), 'CSV'),
      h('button', { class: 'btn', type: 'button', disabled: !m.apps.length, onclick: () => exportJson(m) }, icon('download'), 'JSON'),
      h('button', { class: 'btn ghost icon', type: 'button', title: 'Refresh', 'aria-label': 'Refresh', onclick: refresh }, icon('refresh'))));

  const demo = state.usage.demo ? h('div', { class: 'callout warning demo-banner' }, icon('alert'), h('div', { class: 'grow' },
    h('strong', {}, 'Demo data. '), 'This dashboard is showing generated sample data for testing, not real usage.'),
  h('button', { class: 'btn sm', type: 'button', onclick: clearDemo }, icon('trash'), 'Clear demo data')) : null;

  if (!hasAny) {
    render(main, toolbar, emptyHero());
    return;
  }

  const unsApps = m.apps.filter((a) => a.status === 'unsanctioned');
  const tiles = h('div', { class: 'grid-4' },
    tile('Apps used', formatNumber(m.apps.length), `${m.apps.filter((a) => a.status === 'sanctioned').length} approved · ${m.apps.filter((a) => a.status === 'unknown').length} unclassified`, 'grid'),
    tile('Active time', total >= 360000 ? `${Math.round(total / 3600)}h` : fmtSeconds(total), `≈ ${fmtSeconds(total / Math.max(1, m.range.length))} per day`, 'clock'),
    tile('Not approved', formatNumber(unsApps.length), unsApps.length ? `${fmtSeconds(unsApps.reduce((s, a) => s + a.activeSeconds, 0))} spent in them` : 'Nothing risky used', 'shield-alert', unsApps.length ? 'danger' : ''),
    tile('Licences unused', formatNumber(m.unused.length), ctx.settings.licensedApps.length ? `of ${ctx.settings.licensedApps.length} licensed · ${ctx.settings.licenseUnusedDays}+ days` : 'No licensed apps set', 'key', m.unused.length ? 'warning' : ''));

  render(main, toolbar, demo, tiles,
    h('div', { class: 'dash-grid' },
      h('div', { class: 'dash-col' }, chartCard(m), tableCard(m)),
      h('div', { class: 'dash-col' }, unsanctionedCard(unsApps), licensedCard(m.unused), categoryCard(m.apps, total))));
}

function tile(label, value, sub, iconName, tone = '') {
  return h('div', { class: 'stat' },
    h('div', { class: 'stat-head' }, h('span', { class: 'stat-label' }, label), icon(iconName)),
    h('div', { class: `stat-value ${tone}` }, value),
    h('div', { class: 'stat-sub' }, sub));
}

function emptyHero() {
  const step = (ic, title, text) => h('div', { class: 'step' }, h('strong', {}, icon(ic), title), h('span', { class: 'subtle' }, text));
  return h('div', { class: 'empty hero-empty' },
    h('div', { class: 'empty-icon' }, icon('chart')),
    h('h2', {}, 'No app usage recorded yet'),
    h('p', {}, ctx.settings.trackingEnabled
      ? 'Keep browsing as usual. When you open a SaaS app, the time you spend in it shows up here, grouped by app and category.'
      : 'Tracking is turned off, so nothing is being recorded. Turn it on in Settings to see your app usage here.'),
    h('div', { class: 'steps' },
      step('globe', 'Use your apps', 'Visits and focused time are counted per app domain.'),
      step('shield-check', 'See what is approved', `Each app shows whether ${ctx.brand.companyName} approves it.`),
      step('lock', 'Private by design', 'No page addresses, titles or content are ever stored.')),
    h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '22px' } },
      h('button', { class: 'btn primary', type: 'button', onclick: () => privacyDialog(ctx) }, icon('shield'), 'What is collected?'),
      h('button', { class: 'btn', type: 'button', onclick: () => openOptions() }, icon('settings'), 'Settings')));
}

// ---------------------------------------------------------------------------
// Daily active time chart (hand-rolled SVG, stacked bars)
// ---------------------------------------------------------------------------
function chartCard(m) {
  const top = m.apps.filter((a) => a.activeSeconds > 0).slice(0, 5);
  const topSet = new Set(top.map((a) => a.domain));
  const series = [...top.map((a, i) => ({ key: a.domain, name: a.name, color: SERIES[i] })), { key: '__other', name: 'Other apps', color: 'var(--series-other)' }];
  const rows = m.range.map((day) => {
    const vals = Object.fromEntries(series.map((s) => [s.key, 0]));
    for (const a of m.apps) {
      const sec = a.daily[day] || 0;
      if (!sec) continue;
      vals[topSet.has(a.domain) ? a.domain : '__other'] += sec;
    }
    return { day, vals, total: Object.values(vals).reduce((s, v) => s + v, 0) };
  });
  const hasOther = rows.some((r) => r.vals.__other > 0);
  const shown = hasOther ? series : series.slice(0, -1);
  const maxSec = Math.max(20, ...rows.map((r) => r.total));
  const [unit, suffix] = maxSec >= 2 * 3600 ? [3600, 'h'] : maxSec >= 120 ? [60, 'm'] : [1, 's'];
  const niceStep = (max) => { const raw = max / 4; const p = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 5, 10].map((x) => x * p).find((x) => x >= raw); };
  const step = niceStep(maxSec / unit);
  const yMax = Math.ceil(maxSec / unit / step) * step;

  const W = 760, H = 230, L = 40, R = 8, T = 10, B = 26;
  const pw = W - L - R, ph = H - T - B;
  const slot = pw / rows.length;
  const bw = Math.max(3, Math.min(28, slot * 0.68));
  const NS = 'http://www.w3.org/2000/svg';
  const s = (tag, attrs = {}, text) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    return el;
  };
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Daily active time for the last ${rows.length} days` });
  for (let v = 0; v <= yMax + 1e-9; v += step) {
    const y = T + ph - (v / yMax) * ph;
    svg.append(s('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'grid-line' }));
    svg.append(s('text', { x: L - 8, y: y + 4, 'text-anchor': 'end', class: 'axis-label' }, `${+v.toFixed(1)}${suffix}`));
  }
  const labelEvery = rows.length <= 7 ? 1 : rows.length <= 31 ? 5 : 15;
  const wrap = h('div', { class: 'chart-wrap viz' });
  const tip = h('div', { class: 'chart-tip', hidden: true });

  rows.forEach((r, i) => {
    const cx = L + slot * i + slot / 2;
    const x = cx - bw / 2;
    let y = T + ph;
    const segs = shown.filter((sr) => r.vals[sr.key] > 0);
    segs.forEach((sr, si) => {
      const hgt = (r.vals[sr.key] / unit / yMax) * ph;
      const yTop = y - hgt;
      const yBot = si > 0 && hgt > 3 ? y - 2 : y; // 2px surface gap between stacked segments
      const rad = si === segs.length - 1 ? Math.min(4, bw / 2, yBot - yTop) : 0;
      const d = rad
        ? `M${x},${yBot} V${yTop + rad} Q${x},${yTop} ${x + rad},${yTop} H${x + bw - rad} Q${x + bw},${yTop} ${x + bw},${yTop + rad} V${yBot} Z`
        : `M${x},${yBot} V${yTop} H${x + bw} V${yBot} Z`;
      svg.append(s('path', { d, fill: sr.color }));
      y = yTop;
    });
    const fromEnd = rows.length - 1 - i;
    if (fromEnd % labelEvery === 0) svg.append(s('text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: 'axis-label' }, fmtDay(r.day)));
    const hit = s('rect', { x: L + slot * i, y: T, width: slot, height: ph, class: 'hit' });
    hit.addEventListener('mouseenter', () => {
      tip.replaceChildren(h('div', { class: 't' }, `${new Date(`${r.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmtSeconds(r.total)}`),
        ...(r.total ? shown.filter((sr) => r.vals[sr.key] > 0).reverse().map((sr) => h('div', { class: 'r' },
          h('span', {}, h('i', { class: 'swatch-dot', style: { background: sr.color } }), h('span', { class: 'truncate' }, sr.name)),
          h('span', {}, fmtSeconds(r.vals[sr.key])))) : [h('div', { class: 'subtle' }, 'No active time')]));
      tip.hidden = false;
      const box = wrap.getBoundingClientRect();
      const sx = box.width / W;
      tip.style.left = `${Math.min(box.width - 90, Math.max(90, cx * sx))}px`;
      tip.style.top = `${Math.max(40, (T + ph - (r.total / unit / yMax) * ph) * sx)}px`;
    });
    hit.addEventListener('mouseleave', () => { tip.hidden = true; });
    svg.append(hit);
  });
  svg.append(s('line', { x1: L, x2: W - R, y1: T + ph, y2: T + ph, stroke: 'var(--border-strong)', 'stroke-width': 1 }));
  wrap.append(svg, tip);

  const legend = h('div', { class: 'legend' }, shown.map((sr) => h('span', {}, h('i', { class: 'swatch-dot', style: { background: sr.color } }), sr.name)));
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', {}, icon('activity', { size: 18 }), 'Daily active time'), h('span', { class: 'subtle' }, 'Time in the focused tab while active')),
    wrap, h('div', { class: 'viz' }, legend));
}

// ---------------------------------------------------------------------------
// Apps table
// ---------------------------------------------------------------------------
function tableCard(m) {
  const cats = [...new Set(m.apps.map((a) => a.category))].sort((a, b) => CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b));
  const tbody = h('tbody');
  const count = h('span');
  const maxSec = Math.max(1, ...m.apps.map((a) => a.activeSeconds));

  function rowsFiltered() {
    const q = state.search.trim().toLowerCase();
    const list = m.apps.filter((a) =>
      (state.status === 'all' || a.status === state.status) &&
      (state.category === 'all' || a.category === state.category) &&
      (!q || a.name.toLowerCase().includes(q) || a.domain.includes(q) || a.category.toLowerCase().includes(q)));
    const { key, dir } = state.sort;
    const mul = dir === 'asc' ? 1 : -1;
    const order = { unsanctioned: 0, unknown: 1, sanctioned: 2 };
    list.sort((a, b) => {
      let x = a[key], y = b[key];
      if (key === 'status') { x = order[x]; y = order[y]; }
      if (typeof x === 'string') return x.localeCompare(y) * mul || b.activeSeconds - a.activeSeconds;
      return ((x ?? 0) - (y ?? 0)) * mul;
    });
    return list;
  }

  function fill() {
    const list = rowsFiltered();
    count.textContent = `${list.length} of ${m.apps.length} apps`;
    render(tbody, list.length ? list.map((a) => h('tr', {},
      h('td', {}, h('div', { class: 'app-cell' }, appIcon(a.domain, a.name), h('div', { class: 'grow' }, h('div', { class: 'n' }, a.name), h('div', { class: 'd' }, a.domain)))),
      h('td', {}, a.category),
      h('td', {}, statusBadge(a.status), a.licensed ? [' ', h('span', { class: 'badge info', title: 'The company pays for this app' }, icon('key'), 'Licensed')] : null),
      h('td', { class: 'num' }, formatNumber(a.visits)),
      h('td', { class: 'num nowrap' }, h('span', { class: 'bar thin' }, h('span', { style: { width: `${Math.max(2, (a.activeSeconds / maxSec) * 100)}%` } })), fmtSeconds(a.activeSeconds)),
      h('td', { class: 'nowrap', title: a.lastSeen }, daysAgo(a.lastSeen))))
      : h('tr', {}, h('td', { colspan: 6, class: 'center subtle', style: { padding: '28px' } }, 'No apps match these filters.')));
  }

  const table = h('table', { class: 'table' },
    h('thead', {}, h('tr', {},
      h('th', { 'data-sort': 'name' }, 'App'),
      h('th', { 'data-sort': 'category' }, 'Category'),
      h('th', { 'data-sort': 'status' }, 'Status'),
      h('th', { 'data-sort': 'visits', class: 'num' }, 'Visits'),
      h('th', { 'data-sort': 'activeSeconds', class: 'num', 'aria-sort': 'descending' }, 'Active time'),
      h('th', { 'data-sort': 'lastSeen' }, 'Last seen'))),
    tbody);
  sortableHeaders(table, (key, dir) => { state.sort = { key, dir }; fill(); }, state.sort);

  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search apps, domains or categories', value: state.search, 'aria-label': 'Search apps',
    oninput: debounce((e) => { state.search = e.target.value; fill(); }, 120) });
  const statusSel = h('select', { class: 'select', 'aria-label': 'Filter by status', value: state.status, onchange: (e) => { state.status = e.target.value; fill(); } },
    h('option', { value: 'all' }, 'All statuses'),
    Object.entries(STATUS).map(([k, v]) => h('option', { value: k }, v.label)));
  const catSel = h('select', { class: 'select', 'aria-label': 'Filter by category', value: cats.includes(state.category) ? state.category : 'all', onchange: (e) => { state.category = e.target.value; fill(); } },
    h('option', { value: 'all' }, 'All categories'), cats.map((c) => h('option', { value: c }, c)));
  if (!cats.includes(state.category)) state.category = 'all';
  fill();
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', {}, icon('list', { size: 18 }), 'Apps')),
    h('div', { class: 'table-tools' }, h('div', { class: 'input-icon' }, icon('search'), search), statusSel, catSel),
    h('div', { class: 'table-wrap tall' }, table),
    h('div', { class: 'table-foot' }, count, h('span', {}, 'Click a column to sort')));
}

// ---------------------------------------------------------------------------
// Side panels
// ---------------------------------------------------------------------------
function unsanctionedCard(apps) {
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', {}, icon('shield-alert', { size: 18, class: 'text-danger' }), 'Not approved apps used')),
    apps.length
      ? h('div', { class: 'panel-list' }, apps.map((a) => h('div', { class: 'list-item static' },
        appIcon(a.domain, a.name),
        h('div', { class: 'li-main' },
          h('div', { class: 'li-title' }, a.name),
          h('div', { class: 'li-sub' }, a.alternative?.name
            ? ['Use ', a.alternative.url ? h('a', { href: a.alternative.url, target: '_blank', rel: 'noopener' }, a.alternative.name) : a.alternative.name, ' instead']
            : `${a.visits} visits · ${fmtSeconds(a.activeSeconds)}`)),
        h('span', { class: 'li-meta mono' }, fmtSeconds(a.activeSeconds)))))
      : h('p', { class: 'muted row' }, icon('shield-check', { class: 'text-success icon-16' }), 'No unapproved apps in this period.'));
}

function licensedCard(unused) {
  const configured = (ctx.settings.licensedApps || []).length;
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', {}, icon('key', { size: 18 }), 'Licensed but unused'), h('span', { class: 'subtle' }, `${ctx.settings.licenseUnusedDays}+ days`)),
    !configured
      ? h('p', { class: 'muted' }, 'IT has not listed any licensed apps yet. Add them under Settings → App lists to spot unused licences.')
      : unused.length
        ? h('div', { class: 'panel-list' }, unused.map((l) => h('div', { class: 'list-item static' },
          appIcon(l.domain, l.name),
          h('div', { class: 'li-main' },
            h('div', { class: 'li-title' }, l.name),
            h('div', { class: 'li-sub' }, l.lastSeen ? `Last used ${daysAgo(l.lastSeen)}` : 'Not used on this browser')),
          l.seats ? h('span', { class: 'badge' }, `${l.seats} seats`) : null)))
        : h('p', { class: 'muted row' }, icon('check', { class: 'text-success icon-16' }), 'Every licensed app was used recently.'));
}

function categoryCard(apps, total) {
  const by = new Map();
  for (const a of apps) {
    const c = by.get(a.category) || { name: a.category, sec: 0, apps: 0 };
    c.sec += a.activeSeconds; c.apps += 1;
    by.set(a.category, c);
  }
  const list = [...by.values()].sort((a, b) => b.sec - a.sec);
  const max = Math.max(1, ...list.map((c) => c.sec));
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', {}, icon('layers', { size: 18 }), 'By category')),
    list.length ? list.map((c) => h('div', { class: 'cat-row' },
      h('span', { class: 'n truncate' }, c.name, h('span', { class: 'subtle' }, ` · ${c.apps} app${c.apps === 1 ? '' : 's'}`)),
      h('span', { class: 'v' }, `${fmtSeconds(c.sec)}${total ? ` · ${Math.round((c.sec / total) * 100)}%` : ''}`),
      h('div', { class: 'bar' }, h('span', { style: { width: `${Math.max(2, (c.sec / max) * 100)}%` } }))))
      : h('p', { class: 'muted' }, 'No data in this period.'));
}

// ---------------------------------------------------------------------------
// Export & demo
// ---------------------------------------------------------------------------
const stamp = () => new Date().toISOString().slice(0, 10);
function exportCsv(m) {
  const csv = toCsv(m.apps, [
    { label: 'App', key: 'name' }, { label: 'Domain', key: 'domain' }, { label: 'Category', key: 'category' },
    { label: 'Status', key: 'status' }, { label: 'Visits', key: 'visits' },
    { label: 'Active minutes', value: (a) => (a.activeSeconds / 60).toFixed(1) }, { label: 'Days active', key: 'daysActive' },
    { label: 'Last seen', key: 'lastSeen' },
  ]);
  downloadFile(`saas-usage-${state.period}d-${stamp()}.csv`, csv, 'text/csv');
}
function exportJson(m) {
  downloadFile(`saas-usage-${state.period}d-${stamp()}.json`, {
    source: 'saas-reporter', exportedAt: new Date().toISOString(), demo: !!state.usage.demo,
    period: { from: m.range[0], to: m.range.at(-1) },
    apps: m.apps.map(({ daily, alternative, ...a }) => ({ ...a, activeMinutes: Math.round(a.activeSeconds / 6) / 10, daily: Object.fromEntries(Object.entries(daily).map(([d, s]) => [d, Math.round(s)])) })),
    licensedUnused: m.unused,
  });
}
async function clearDemo() {
  if (!(await confirmDialog({ title: 'Clear demo data?', message: 'All local usage data on this browser is removed, including the demo data.', confirmLabel: 'Clear data', tone: 'danger' }))) return;
  await send('clearData');
  toast('Demo data cleared', { tone: 'success' });
  refresh();
}

document.title = `SaaS usage dashboard · ${ctx.brand.companyName}`;
ctx.onChange(() => draw());
await refresh();
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60000);
