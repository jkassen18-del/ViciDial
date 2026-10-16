import { initPage, brandMark } from './shared/page.js';
import { openOptions } from './shared/browser.js';
import { send } from './shared/messaging.js';
import { h, icon, $, $$, toast, debounce, confirmDialog, downloadFile, pickFile, readFile, relativeTime, formatNumber } from './shared/ui.js';
import { DEFAULTS } from './defaults.js';
import * as R from './resolver.js';
import { linkCard, deptHue, goLabel, editPersonalLink, copyButton } from './components.js';

const settingsBtn = h('button', { class: 'btn ghost sm', type: 'button', onclick: () => openOptions() }, icon('settings'), 'Settings');
const ctx = await initPage({ defaults: DEFAULTS, title: 'Company directory', headerActions: [settingsBtn] });
const shortHost = () => ctx.settings.shortHost || 'go';
const params = new URLSearchParams(location.search);

let data = null;
let index = null;
let full = (l) => l;
let dept = '';
let tab = location.hash === '#mine' ? 'mine' : 'all';

const searchInput = h('input', { class: 'input', type: 'search', placeholder: 'What are you looking for? Try “payroll”, “vpn” or “holiday”', 'aria-label': 'Search the directory', value: params.get('q') || '', autocomplete: 'off' });
const viewAll = $('#view-all');
const viewMine = $('#view-mine');

function renderHero() {
  const hadFocus = document.activeElement === searchInput;
  queueMicrotask(() => { if (hadFocus) searchInput.focus(); });
  const b = ctx.brand;
  const links = data?.links.filter((l) => !l.personal) || [];
  const depts = R.departments(links);
  $('#hero').replaceChildren(h('div', { class: 'hero-inner' },
    h('div', { class: 'eyebrow' }, brandMark(b), `${b.companyName} directory`),
    h('h1', {}, 'What are you looking for?'),
    h('p', { class: 'lead' }, ctx.settings.welcomeMessage || `Every ${b.companyName} link in one place, from HR to Engineering. Type ${shortHost()}/ followed by a name in your address bar to jump straight there.`),
    h('div', { class: 'search-box' }, icon('search'), searchInput, h('kbd', {}, '/')),
    h('div', { class: 'hero-hints' },
      h('span', {}, h('code', {}, `${shortHost()}/payroll`), ' opens a link'),
      h('span', {}, h('code', {}, `${shortHost()}/jira/ABC-123`), ' passes a value'),
      h('span', {}, h('code', {}, 'go'), ' + ', h('code', {}, 'Space'), ' searches from the address bar')),
    data ? h('div', { class: 'hero-stats' },
      h('div', {}, h('strong', {}, formatNumber(links.length)), h('span', {}, 'company links')),
      h('div', {}, h('strong', {}, formatNumber(depts.length)), h('span', {}, 'departments')),
      h('div', {}, h('strong', {}, formatNumber(data.links.filter((l) => l.personal).length)), h('span', {}, 'of your own'))) : null));
}

async function load() {
  try {
    data = await send('getData');
  } catch (err) {
    data = { links: [], shadowed: [], sources: [], usage: {}, error: err.message };
  }
  index = R.buildIndex([{ id: 'all', kind: 'source', links: data.links }]);
  const byKey = new Map(data.links.map((l) => [l.key, l]));
  full = (l) => byKey.get(l.key) || l;
  $('#mine-count').textContent = String(data.links.filter((l) => l.personal).length + (data.shadowed?.length || 0));
  renderHero();
  render();
}

// ---------------------------------------------------------------------------
// Company directory
// ---------------------------------------------------------------------------
function cards(list, opts = {}) {
  return h('div', { class: 'card-grid' }, list.map((l) => linkCard(l, { shortHost: shortHost(), newTab: ctx.settings.openInNewTab, ...opts,
    onEdit: l.personal && canEditMine() ? editLink : null })));
}

function deptNav(depts, total) {
  const btn = (name, label, count) => h('button', {
    type: 'button', 'aria-pressed': String(dept === name), style: `--h:${deptHue(name)}`,
    onclick: () => { dept = name; render(); window.scrollTo({ top: $('#tabs').offsetTop - 10, behavior: 'smooth' }); },
  }, name ? h('span', { class: 'dot' }) : icon('grid', { size: 15 }), label, h('span', { class: 'count' }, String(count)));
  const chip = (name, label, count) => h('button', {
    class: 'dept-chip', type: 'button', 'aria-pressed': String(dept === name), style: `--h:${deptHue(name)}`,
    onclick: () => { dept = dept === name ? '' : name; render(); },
  }, name ? h('span', { class: 'dot' }) : null, label, h('span', { class: 'count' }, String(count)));
  return h('nav', { class: 'dept-nav', 'aria-label': 'Departments' },
    h('div', { class: 'nav-label' }, 'Departments'),
    btn('', 'All links', total),
    depts.map((d) => btn(d.name, d.name, d.count)),
    h('div', { class: 'dept-chips' }, chip('', 'All', total), depts.map((d) => chip(d.name, d.name, d.count))));
}

function render() {
  if (tab === 'mine') { renderMine(); return; }
  if (!data) { viewAll.replaceChildren(h('div', { class: 'card-grid' }, Array.from({ length: 6 }, () => h('div', { class: 'skeleton', style: { height: '120px', borderRadius: 'var(--radius-lg)' } })))); return; }
  const links = data.links;
  if (!links.length) {
    viewAll.replaceChildren(h('div', { class: 'empty' },
      h('div', { class: 'empty-icon' }, icon('link')),
      h('h3', {}, data.sources.length ? 'Company links are on their way' : 'No company links yet'),
      h('p', {}, data.sources.length ? 'The link sources have not loaded yet. Check Settings → Sources if this persists.' : 'Your IT team publishes the directory as a link source. Add it in Settings, or create personal links in “My links”.'),
      h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '14px' } },
        h('button', { class: 'btn primary', type: 'button', onclick: () => openOptions() }, icon('settings'), 'Open settings'))),
    tipsCard());
    return;
  }
  const text = searchInput.value.trim();
  const companyLinks = links.filter((l) => !l.personal);
  const myLinks = links.filter((l) => l.personal);
  const depts = R.departments(companyLinks);
  const main = [];
  if (params.get('welcome') && !text && !dept) {
    main.push(h('div', { class: 'callout success welcome-banner' }, icon('rocket'), h('div', {},
      h('strong', {}, `Welcome to ${ctx.brand.companyName} go-links! `),
      `From now on, type ${shortHost()}/ and a name in the address bar, e.g. ${shortHost()}/handbook. This page is always one click away from the toolbar icon.`)));
  }
  if (text) {
    const res = R.search(index, text, { usage: data.usage, department: dept || undefined, limit: 60, shortHost: shortHost() }).map((r) => full(r.link));
    main.push(h('div', { class: 'group' },
      h('div', { class: 'group-head' }, h('h2', {}, icon('search', { size: 18 }), `Results for “${text}”`), h('span', { class: 'count' }, `${res.length}${dept ? ` in ${dept}` : ''}`)),
      res.length ? cards(res) : h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, icon('search')), h('h3', {}, 'Nothing found'),
        h('p', {}, dept ? `No ${dept} link matches. ` : 'No link matches that. ', 'Try another word or ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); dept = ''; searchInput.value = ''; render(); } }, 'browse everything'), '.'))));
  } else {
    const featured = links.filter((l) => l.featured && !l.personal && (!dept || (l.department || 'Other') === dept));
    if (featured.length && !dept) {
      main.push(h('div', { class: 'featured-wrap' },
        h('div', { class: 'group-head' }, h('h2', {}, icon('rocket', { size: 18, class: 'text-primary' }), 'New here? Start with these')),
        cards(featured, { featured: true })));
    }
    const groups = dept ? depts.filter((d) => d.name === dept) : depts;
    for (const g of groups) {
      const list = companyLinks.filter((l) => (l.department || 'Other') === g.name).sort((a, b) => a.title.localeCompare(b.title));
      main.push(h('div', { class: 'group' },
        h('div', { class: 'group-head', style: `--h:${deptHue(g.name)}` }, h('h2', {}, h('span', { class: 'dot' }), g.name), h('span', { class: 'count' }, `${list.length} link${list.length === 1 ? '' : 's'}`)),
        cards(list)));
    }
    if (!dept && myLinks.length) {
      main.push(h('div', { class: 'group' },
        h('div', { class: 'group-head' }, h('h2', {}, icon('user', { size: 18, class: 'text-primary' }), 'Your links'),
          h('span', { class: 'count' }, `${myLinks.length} personal`),
          h('a', { href: '#mine', class: 'small', onclick: (e) => { e.preventDefault(); setTab('mine'); } }, 'Manage')),
        cards(myLinks.sort((a, b) => a.key.localeCompare(b.key)))));
    }
  }
  main.push(tipsCard(), sourcesInfo());
  viewAll.replaceChildren(h('div', { class: 'dir-layout' }, deptNav(depts, companyLinks.length), h('div', {}, main)));
}

function tipsCard() {
  const tip = (ic, title, body) => h('div', { class: 'tip' }, h('span', { class: 'tip-icon' }, icon(ic)), h('div', {}, h('strong', {}, title), h('p', {}, body)));
  return h('div', { class: 'card tips' },
    h('div', { class: 'card-head' }, h('h3', {}, icon('zap', { size: 18, class: 'text-primary' }), 'Using go-links')),
    h('div', { class: 'grid-3' },
      tip('globe', 'In the address bar', [h('code', {}, `${shortHost()}/handbook`), ' takes you straight there. The very first time, some browsers need ', h('code', {}, `http://${shortHost()}/handbook`), '.']),
      tip('search', 'Keyword search', ['Type ', h('code', {}, 'go'), ', press Space, then start typing to see suggestions as you type.']),
      tip('code', 'Pass values', [h('code', {}, `${shortHost()}/jira/ABC-123`), ' or ', h('code', {}, `${shortHost()}/wiki/vpn setup`), ' fill in links that take a parameter.'])));
}

function sourcesInfo() {
  const items = [];
  if (data.managedCount) items.push(h('div', { class: 'src' }, icon('lock', { size: 14 }), h('strong', {}, 'Managed by IT'), `${data.managedCount} links pushed by policy`));
  for (const s of data.sources) {
    items.push(h('div', { class: 'src' },
      h('span', { class: `dot ${s.status === 'ok' ? 'text-success' : s.status === 'error' ? 'text-danger' : 'text-warning'}` }),
      h('strong', {}, s.name), `${s.count} links`,
      s.updated ? h('span', {}, `· updated ${s.updated}`) : null,
      s.lastSuccessAt ? h('span', {}, `· checked ${relativeTime(s.lastSuccessAt)}`) : null,
      s.status === 'error' ? h('span', { class: 'text-danger' }, `· ${s.error}`) : null));
  }
  if (!items.length) return null;
  return h('div', { class: 'sources-info' }, h('div', { class: 'section-label' }, h('span', { class: 'left' }, icon('layers'), 'Link sources')), items);
}

// ---------------------------------------------------------------------------
// My links
// ---------------------------------------------------------------------------
const canEditMine = () => ctx.settings.allowPersonalLinks && !ctx.isLocked('personalLinks');

async function editLink(link) {
  const saved = await editPersonalLink({
    link, shortHost: shortHost(),
    companyLookup: (k) => { const c = R.lookup(index, k); return c && !full(c).personal ? c : null; },
    existingKeys: (ctx.settings.personalLinks || []).map((l) => l.key),
  });
  if (saved) { toast(`Saved ${shortHost()}/${saved.key}`, { tone: 'success' }); await ctx.reload(); await load(); }
}

async function deleteLink(link) {
  const ok = await confirmDialog({ title: `Delete ${shortHost()}/${link.key}?`, message: 'This removes the personal link from this browser.', confirmLabel: 'Delete', tone: 'danger' });
  if (!ok) return;
  await send('deletePersonalLink', { key: link.key });
  toast('Link deleted', { tone: 'success' });
  await ctx.reload();
  await load();
}

async function importLinks() {
  const file = await pickFile('application/json,.json');
  if (!file) return;
  try {
    const json = JSON.parse(await readFile(file));
    const v = R.validateSource(json);
    if (!v.ok) throw new Error(v.errors.join('; '));
    const replace = (ctx.settings.personalLinks || []).length
      ? await confirmDialog({ title: `Import ${v.links.length} links`, message: 'Merge them with your existing personal links? Links with the same name are replaced. Choose “Replace all” to discard your current links first.', confirmLabel: 'Merge', cancelLabel: 'Replace all' }) === false
      : false;
    const r = await send('importPersonal', { links: json.links || json, mode: replace ? 'replace' : 'merge' });
    toast(`Imported ${r.count} link${r.count === 1 ? '' : 's'}${r.warnings.length ? ` (${r.warnings.length} skipped)` : ''}`, { tone: 'success' });
    await ctx.reload();
    await load();
  } catch (err) {
    toast(`Could not import: ${err.message}`, { tone: 'danger', timeout: 6000 });
  }
}

function exportLinks() {
  const links = ctx.settings.personalLinks || [];
  downloadFile(`go-links-personal-${new Date().toISOString().slice(0, 10)}.json`, { name: 'My go-links', updated: new Date().toISOString().slice(0, 10), links });
}

function renderMine() {
  if (!data) return;
  const mine = data.links.filter((l) => l.personal);
  const shadowed = data.shadowed || [];
  const editable = canEditMine();
  const toolbar = h('div', { class: 'mine-toolbar' },
    editable ? h('button', { class: 'btn primary', type: 'button', onclick: () => editLink(null) }, icon('plus'), 'New link') : null,
    editable ? h('button', { class: 'btn', type: 'button', onclick: importLinks }, icon('upload'), 'Import') : null,
    h('button', { class: 'btn', type: 'button', onclick: exportLinks, disabled: !(mine.length + shadowed.length) }, icon('download'), 'Export'),
    h('span', { class: 'grow' }),
    h('span', { class: 'subtle' }, 'Personal links live only in this browser profile. Same JSON format as company sources.'));
  const out = [];
  if (!ctx.settings.allowPersonalLinks) {
    out.push(h('div', { class: 'callout' }, icon('lock'), h('div', {}, 'Personal links are turned off', ctx.isLocked('allowPersonalLinks') ? ' by your organization.' : '. Turn them on in Settings → Personal links.')));
  } else if (ctx.isLocked('personalLinks')) {
    out.push(h('div', { class: 'callout' }, icon('lock'), h('div', {}, 'Personal links are managed by your organization.')));
  }
  if (shadowed.length) {
    out.push(h('div', { class: 'callout warning' }, icon('alert'), h('div', {},
      h('strong', {}, `${shadowed.length} of your links ${shadowed.length === 1 ? 'is' : 'are'} hidden by company links. `),
      'Company links always win, so rename these to use them.')));
  }
  const all = [...mine.map((l) => ({ link: l })), ...shadowed.map((l) => ({ link: l, conflict: l.conflictWith }))].sort((a, b) => a.link.key.localeCompare(b.link.key));
  if (!all.length) {
    out.push(h('div', { class: 'empty' },
      h('div', { class: 'empty-icon' }, icon('user')),
      h('h3', {}, 'No personal links yet'),
      h('p', {}, `Create shortcuts only you use, like ${shortHost()}/standup for your team call or ${shortHost()}/1on1 for your notes.`),
      editable ? h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '14px' } }, h('button', { class: 'btn primary', type: 'button', onclick: () => editLink(null) }, icon('plus'), 'Create your first link')) : null));
  } else {
    const rows = all.map(({ link, conflict }) => h('tr', {},
      h('td', {}, goLabel(link.key, shortHost())),
      h('td', {}, h('div', { style: { fontWeight: 600 } }, link.title), h('a', { class: 'url', href: R.defaultUrl(link), target: '_blank', rel: 'noopener' }, link.url)),
      h('td', {}, conflict
        ? h('span', { class: 'badge warning', title: `${shortHost()}/${conflict.key} is a company link from ${conflict.sourceName}` }, icon('alert'), `Hidden by ${conflict.sourceName}`)
        : h('span', { class: 'badge success' }, icon('check'), 'Active')),
      h('td', { class: 'actions' },
        copyButton(link, shortHost()),
        editable ? h('button', { class: 'btn ghost sm icon', type: 'button', title: 'Edit', 'aria-label': `Edit ${link.key}`, onclick: () => editLink(link) }, icon('edit')) : null,
        editable ? h('button', { class: 'btn ghost sm icon', type: 'button', title: 'Delete', 'aria-label': `Delete ${link.key}`, onclick: () => deleteLink(link) }, icon('trash')) : null)));
    out.push(h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Link'), h('th', {}, 'Destination'), h('th', {}, 'Status'), h('th', {}, ''))),
      h('tbody', {}, rows))));
  }
  viewMine.replaceChildren(toolbar, h('div', { class: 'stack' }, out));
}

// ---------------------------------------------------------------------------
// Tabs, search, keyboard
// ---------------------------------------------------------------------------
function setTab(next) {
  tab = next;
  for (const b of $$('#tabs [role="tab"]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  viewAll.hidden = tab !== 'all';
  viewMine.hidden = tab !== 'mine';
  history.replaceState(null, '', tab === 'mine' ? '#mine' : location.pathname + location.search);
  render();
}
for (const b of $$('#tabs [role="tab"]')) b.addEventListener('click', () => setTab(b.dataset.tab));

searchInput.addEventListener('input', debounce(() => { if (tab !== 'all') setTab('all'); else render(); }, 60));
searchInput.addEventListener('keydown', (e) => {
  if (e.key === '/' && !searchInput.value) { e.preventDefault(); return; }
  if (e.key === 'Escape') { searchInput.value = ''; render(); }
  if (e.key === 'Enter') {
    const first = viewAll.querySelector('.link-card');
    if (first) { e.preventDefault(); if (e.metaKey || e.ctrlKey) window.open(first.href, '_blank', 'noopener'); else first.click(); }
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') && !document.querySelector('dialog[open]')) {
    e.preventDefault(); searchInput.focus(); searchInput.select();
  }
});

ctx.onChange(() => load());
renderHero();
setTab(tab);
await load();
if (!params.get('welcome')) searchInput.focus();
