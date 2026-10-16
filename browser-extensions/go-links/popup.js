import { initPage } from './shared/page.js';
import { api, openOptions, openExtensionPage } from './shared/browser.js';
import { send } from './shared/messaging.js';
import { h, icon, $, toast } from './shared/ui.js';
import { DEFAULTS } from './defaults.js';
import * as R from './resolver.js';
import { linkRow, personalLinkFields, deptHue, recordUse } from './components.js';

const ctx = await initPage({ defaults: DEFAULTS, title: 'Go-Links' });
const shortHost = () => ctx.settings.shortHost || 'go';

const q = $('#q');
const results = $('#results');
const chips = $('#chips');
const addPanel = $('#add-panel');
let data = null;
let index = null;
let dept = '';
let selected = 0;
let rows = [];
let webTab = null;

q.focus();
renderSkeleton();

// Which tab is behind the popup? (In tests the popup is opened as a tab itself.)
const tabPromise = api.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
  if (t && t.url && !t.url.startsWith(location.origin)) webTab = t;
  return webTab;
}).catch(() => null);

async function load() {
  try {
    data = await send('getData');
  } catch (err) {
    data = { links: [], usage: {}, sources: [], error: err.message };
  }
  index = R.buildIndex([{ id: 'all', kind: 'source', links: data.links }]);
  const byKey = new Map(data.links.map((l) => [l.key, l]));
  index.full = (l) => byKey.get(l.key) || l;
  renderChips();
  render();
}

function renderSkeleton() {
  results.replaceChildren(...Array.from({ length: 5 }, () => h('div', { class: 'skeleton-row' },
    h('span', { class: 'skeleton a' }), h('span', { class: 'skeleton b', style: { maxWidth: `${50 + Math.random() * 40}%` } }))));
}

function renderChips() {
  const depts = R.departments(data.links.filter((l) => !l.personal));
  if (depts.length < 2) { chips.hidden = true; return; }
  chips.hidden = false;
  const chip = (name, label, count) => h('button', {
    class: 'dept-chip', type: 'button', 'aria-pressed': String(dept === name), style: `--h:${deptHue(name)}`,
    onclick: () => { dept = dept === name ? '' : name; renderChips(); render(); q.focus(); },
  }, name ? h('span', { class: 'dot' }) : null, label, h('span', { class: 'count' }, String(count)));
  chips.replaceChildren(chip('', 'All', data.links.length), ...depts.map((d) => chip(d.name, d.name, d.count)));
}

function section(label, iconName, links, extra) {
  if (!links.length) return null;
  return h('div', { class: 'section' },
    h('div', { class: 'section-label' }, h('span', { class: 'left' }, icon(iconName), label), extra),
    links.map((l) => linkRow(l, { shortHost: shortHost(), onOpen: (link, e) => open(link, { newTab: e?.newTab || e?.metaKey || e?.ctrlKey }) })));
}

function render() {
  if (!data) return;
  const text = q.value.trim();
  const out = [];
  if (!data.links.length) {
    const locked = ctx.isLocked('sources');
    results.replaceChildren(h('div', { class: 'empty' },
      h('div', { class: 'empty-icon' }, icon('link')),
      h('h3', {}, data.sources.length ? 'Loading company links…' : 'No links yet'),
      h('p', {}, data.sources.length
        ? (data.sources.some((s) => s.status === 'error') ? 'A link source could not be reached. Check Settings → Sources.' : 'Your company links will appear here in a moment.')
        : locked ? 'Your organization has not published any links yet.' : 'Add your company’s link source in Settings, or create a personal link.'),
      !locked && !data.sources.length ? h('button', { class: 'btn primary sm mt-12', type: 'button', onclick: () => { openOptions(); window.close(); } }, icon('settings'), 'Add a link source') : null));
    rows = [];
    return;
  }
  const usage = data.usage || {};
  const opts = { usage, department: dept || undefined, shortHost: shortHost() };
  if (text) {
    const res = R.resolve(index, text, { shortHost: shortHost() });
    const found = R.search(index, text, { ...opts, limit: 30 }).map((r) => index.full(r.link));
    if (res.link && !found.some((l) => l.key === res.link.key) && !dept) found.unshift(index.full(res.link));
    if (found.length) {
      out.push(section(dept ? `${dept} · results` : 'Results', 'search', found, h('span', {}, String(found.length))));
    } else {
      out.push(h('div', { class: 'empty' },
        h('div', { class: 'empty-icon' }, icon('search')),
        h('h3', {}, `No links match “${text}”`),
        h('p', {}, 'Try a different word, or create it as a personal link.'),
        ctx.settings.allowPersonalLinks && !ctx.isLocked('personalLinks') && R.isValidKey(R.cleanKey(text))
          ? h('button', { class: 'btn soft sm mt-12', type: 'button', onclick: () => showAdd({ key: R.cleanKey(text) }) }, icon('plus'), `Create ${shortHost()}/${R.cleanKey(text)}`) : null));
    }
  } else if (dept) {
    const list = R.search(index, '', { ...opts, limit: 200 }).map((r) => index.full(r.link)).sort((a, b) => a.title.localeCompare(b.title));
    out.push(section(dept, 'building', list, h('span', {}, String(list.length))));
  } else {
    const featured = ctx.settings.showFeatured ? data.links.filter((l) => l.featured && !l.personal).slice(0, 6) : [];
    const used = Object.entries(usage).sort((a, b) => b[1].count - a[1].count || String(b[1].last).localeCompare(a[1].last))
      .map(([id]) => data.links.find((l) => R.matchKey(l.key) === id)).filter(Boolean).slice(0, 5);
    const mine = data.links.filter((l) => l.personal).slice(0, 5);
    out.push(section('Most used', 'activity', used));
    out.push(section('Featured', 'star', featured.filter((l) => !used.includes(l))));
    out.push(section('My links', 'user', mine.filter((l) => !used.includes(l))));
    if (!out.some(Boolean)) out.push(section('All links', 'list', data.links.slice(0, 12)));
    out.push(h('div', { class: 'popup-hint' }, 'Tip: type ', h('code', {}, `${shortHost()}/payroll`), ' in the address bar, or ', h('code', {}, 'go'), ' + Space.'));
  }
  results.replaceChildren(...out.filter(Boolean));
  rows = [...results.querySelectorAll('.link-row')];
  selected = Math.min(selected, Math.max(0, rows.length - 1));
  if (text) selected = 0;
  paintSelection();
}

function paintSelection() {
  rows.forEach((r, i) => { r.classList.toggle('selected', i === selected); r.setAttribute('aria-selected', String(i === selected)); });
  rows[selected]?.scrollIntoView({ block: 'nearest' });
}

async function open(link, { newTab = false } = {}) {
  const text = q.value.trim();
  // keep extra path/params typed after the key: "jira ABC-1" → go/jira/ABC-1
  const parsed = R.parseInput(text, { shortHost: shortHost() });
  const usesArgs = R.lookup(index, parsed.key)?.key === link.key && (parsed.args.length || parsed.query);
  const url = usesArgs ? R.expand(link, parsed) : R.defaultUrl(link);
  recordUse(link);
  const tab = await tabPromise;
  const inNew = newTab || ctx.settings.openInNewTab || !tab;
  if (inNew) await api.tabs.create({ url, active: !newTab || !tab });
  else await api.tabs.update(tab.id, { url });
  if (tab) window.close();
}

q.addEventListener('input', () => { selected = 0; render(); });
q.addEventListener('keydown', (e) => {
  if (!addPanel.hidden) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); selected = Math.min(rows.length - 1, selected + 1); paintSelection(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); selected = Math.max(0, selected - 1); paintSelection(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const row = rows[selected];
    const newTab = e.metaKey || e.ctrlKey;
    if (row) {
      const link = data.links.find((l) => l.key === row.dataset.key);
      if (link) open(link, { newTab });
    } else if (q.value.trim()) {
      // nothing matched: let go.html show suggestions / the create form
      const url = api.runtime.getURL(`go.html?q=${encodeURIComponent(q.value.trim())}`);
      tabPromise.then((tab) => (tab && !newTab ? api.tabs.update(tab.id, { url }) : api.tabs.create({ url }))).then(() => window.close());
    }
  } else if (e.key === 'Escape' && q.value) { e.preventDefault(); q.value = ''; render(); }
});

// ---- add link for this tab ----
async function showAdd(prefill = {}) {
  if (!ctx.settings.allowPersonalLinks || ctx.isLocked('personalLinks')) {
    toast('Personal links are turned off by your organization', { tone: 'warning' });
    return;
  }
  const tab = await tabPromise;
  const pageUrl = tab && /^https?:/.test(tab.url || '') ? tab.url : '';
  const suggestedKey = prefill.key || (tab?.title ? R.cleanKey(tab.title.split(/[|\-–—:·]/)[0]).slice(0, 24).replace(/[-.]+$/, '') : '');
  const fields = personalLinkFields({
    link: { key: suggestedKey, url: pageUrl, title: tab?.title || '' }, shortHost: shortHost(),
    isTaken: (k) => {
      const c = R.lookup(index, k);
      return c ? `${shortHost()}/${k} already exists (${c.title}).` : null;
    },
  });
  const save = h('button', { class: 'btn primary sm', type: 'submit' }, icon('check'), 'Save link');
  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    const v = fields.validate();
    if (!v) return;
    save.disabled = true;
    try {
      await send('savePersonalLink', { link: v });
      toast(`Saved ${shortHost()}/${v.key}`, { tone: 'success' });
      hideAdd();
      await load();
    } catch (err) { fields.showError(err.message); } finally { save.disabled = false; }
  } },
  h('h3', {}, icon('link', { size: 17, class: 'text-primary' }), 'New personal link'),
  !pageUrl ? h('div', { class: 'callout' }, icon('info'), h('div', {}, 'No web page is open in this tab, so enter the address yourself.')) : null,
  fields.el,
  h('div', { class: 'row end' }, h('button', { class: 'btn ghost sm', type: 'button', onclick: hideAdd }, 'Cancel'), save));
  form.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); hideAdd(); } });
  addPanel.replaceChildren(form);
  addPanel.hidden = false;
  results.hidden = true;
  $('.popup-search').hidden = true;
  $('#add-btn').hidden = true;
  fields.focus();
}
function hideAdd() {
  addPanel.hidden = true;
  results.hidden = false;
  $('.popup-search').hidden = false;
  $('#add-btn').hidden = false;
  q.focus();
}

$('#add-btn').addEventListener('click', () => showAdd());
$('#dir-btn').addEventListener('click', async () => { await openExtensionPage('directory.html'); window.close(); });
$('#settings-btn').addEventListener('click', () => { openOptions(); window.close(); });
if (!ctx.settings.allowPersonalLinks || ctx.isLocked('personalLinks')) $('#add-btn').hidden = true;

ctx.onChange(() => load());
load();
