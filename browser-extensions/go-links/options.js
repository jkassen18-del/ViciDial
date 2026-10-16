import { initPage } from './shared/page.js';
import { api } from './shared/browser.js';
import { ensureHostPermission } from './shared/config.js';
import { send } from './shared/messaging.js';
import { h, icon, $, toast, render, confirmDialog, relativeTime, formatDateTime, downloadFile, pickFile, readFile } from './shared/ui.js';
import { bindSettings, mountBrandingPanel, mountBackupPanel, mountAboutPanel, initSideNav, lockChip } from './shared/settings-ui.js';
import { DEFAULTS, MIN_REFRESH, MAX_REFRESH } from './defaults.js';
import * as R from './resolver.js';
import { validShortHost } from './rules.js';
import { deptBadge, goLabel, editPersonalLink } from './components.js';

const ctx = await initPage({ defaults: DEFAULTS, title: 'Go-Links · Settings', options: true });
const clone = (v) => JSON.parse(JSON.stringify(v ?? null));

let data = await send('getData').catch(() => ({ links: [], sources: [], shadowed: [], managedCount: 0 }));
let sources = clone(ctx.settings.sources) || [];
let personal = clone(ctx.settings.personalLinks) || [];

bindSettings(document, ctx);

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------
const sourcesPanel = $('#sources-panel');
const statusFor = (url) => data.sources.find((s) => s.url === url);

function statusBadge(st) {
  if (!st || st.status === 'pending') return h('span', { class: 'badge' }, icon('clock'), 'Not fetched yet');
  if (st.status === 'error') return h('span', { class: 'badge danger', title: st.error }, icon('alert'), st.count ? 'Error · using last copy' : 'Error');
  return h('span', { class: 'badge success' }, icon('check'), 'OK');
}

function renderSources() {
  const locked = ctx.isLocked('sources');
  const list = h('div', { class: 'source-list' });
  if (!sources.length) {
    list.append(h('div', { class: 'empty' },
      h('div', { class: 'empty-icon' }, icon('layers')),
      h('h3', {}, 'No link sources yet'),
      h('p', {}, 'Add the URL of your company’s go-links JSON file below. Ask IT if you don’t know it.')));
  }
  sources.forEach((src, i) => {
    const st = statusFor(src.url);
    const move = (d) => { const j = i + d; [sources[i], sources[j]] = [sources[j], sources[i]]; ctx.markDirty(); renderSources(); };
    list.append(h('div', { class: 'source-row' },
      h('span', { class: 'source-order', title: 'Precedence' }, String(i + 1)),
      h('div', { class: 'grow' },
        h('div', { class: 'row wrap gap-4' },
          h('strong', {}, src.name || st?.docName || hostOf(src.url)),
          src.department ? deptBadge(src.department, { small: true }) : null,
          statusBadge(st)),
        h('div', { class: 'subtle mono truncate', title: src.url }, src.url),
        st && st.status !== 'pending' ? h('div', { class: 'subtle mt-4' },
          `${st.count} link${st.count === 1 ? '' : 's'}`,
          st.updated ? ` · file updated ${st.updated}` : '',
          st.fetchedAt ? ` · checked ${relativeTime(st.fetchedAt)}` : '',
          st.lastSuccessAt && st.status === 'error' ? ` · last success ${formatDateTime(st.lastSuccessAt)}` : '') : null,
        st?.status === 'error' ? h('div', { class: 'error mt-4' }, st.error) : null,
        st?.warnings?.length ? h('details', { class: 'mt-4 subtle' }, h('summary', {}, `${st.warnings.length} skipped entr${st.warnings.length === 1 ? 'y' : 'ies'}`), h('ul', { class: 'warn-list' }, st.warnings.map((w) => h('li', {}, w)))) : null),
      locked ? null : h('div', { class: 'row gap-4' },
        h('button', { class: 'btn ghost sm icon', type: 'button', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(-1) }, icon('chevron-down', { class: 'rot-180' })),
        h('button', { class: 'btn ghost sm icon', type: 'button', title: 'Move down', 'aria-label': 'Move down', disabled: i === sources.length - 1, onclick: () => move(1) }, icon('chevron-down')),
        h('button', { class: 'btn ghost sm icon', type: 'button', title: 'Remove', 'aria-label': `Remove ${src.url}`, onclick: () => { sources.splice(i, 1); ctx.markDirty(); renderSources(); } }, icon('trash')))));
  });

  const head = h('div', { class: 'card-head' },
    h('h3', {}, icon('layers', { size: 18 }), 'Sources', locked ? lockChip() : null),
    h('button', { class: 'btn sm', type: 'button', onclick: refreshNow, disabled: !sources.length }, icon('refresh'), 'Refresh now'));

  const card = h('div', { class: 'card' }, head,
    locked ? h('div', { class: 'callout mb-12' }, icon('lock'), h('div', {}, 'Your organization manages these sources. Contact IT to change them.')) : null,
    list,
    locked ? null : addSourceForm());

  const managed = data.managedCount ? h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', {}, icon('lock', { size: 18 }), 'Links pushed by policy', lockChip())),
    h('p', { class: 'muted' }, `${data.managedCount} link${data.managedCount === 1 ? '' : 's'} set directly by your IT team. They take priority over every source.`)) : null;

  const conflicts = (data.conflicts || []).filter((c) => c.loser.kind !== 'personal');
  const conflictCard = conflicts.length ? h('div', { class: 'callout warning mt-12' }, icon('alert'), h('div', {},
    h('strong', {}, `${conflicts.length} duplicate go-link${conflicts.length === 1 ? '' : 's'} across sources. `),
    'The higher source wins: ',
    conflicts.slice(0, 6).map((c, i) => [i ? ', ' : '', h('code', {}, `${ctx.settings.shortHost}/${c.key}`), ` (${c.winner.sourceName} over ${c.loser.sourceName})`]),
    conflicts.length > 6 ? ` and ${conflicts.length - 6} more` : '')) : null;

  sourcesPanel.replaceChildren(...[card, conflictCard, managed, formatHelp()].filter(Boolean));
}

function addSourceForm() {
  const url = h('input', { class: 'input', type: 'url', placeholder: 'https://intranet.example.com/go-links.json', 'aria-label': 'Source URL' });
  const name = h('input', { class: 'input', placeholder: 'e.g. Company', 'aria-label': 'Source name' });
  const dept = h('input', { class: 'input', placeholder: 'Optional, e.g. Engineering', 'aria-label': 'Default department' });
  const result = h('div', { class: 'add-result' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, icon('plus'), 'Test & add');

  async function test(u) {
    btn.disabled = true;
    result.replaceChildren(h('div', { class: 'row subtle' }, h('span', { class: 'spinner' }), 'Checking the source…'));
    try {
      return await send('testSource', { url: u, department: dept.value.trim() });
    } finally { btn.disabled = false; }
  }

  async function add(e) {
    e.preventDefault();
    const u = url.value.trim();
    if (!/^https?:\/\/[^\s]+$/i.test(u)) { result.replaceChildren(h('div', { class: 'error' }, 'Enter the full address of the JSON file, starting with https://')); url.classList.add('invalid'); return; }
    url.classList.remove('invalid');
    if (sources.some((s) => s.url === u)) { result.replaceChildren(h('div', { class: 'error' }, 'That source is already in the list.')); return; }
    const r = await test(u);
    if (!r.ok) {
      const grant = h('button', { class: 'btn soft sm', type: 'button', onclick: async () => {
        // must run straight from the click (user gesture)
        const ok = await ensureHostPermission(u);
        if (!ok) { toast('Access was not granted', { tone: 'warning' }); return; }
        const again = await test(u);
        if (again.ok) accept(u, again); else showError(again);
      } }, icon('unlock'), `Allow access to ${hostOf(u)}`);
      showError(r, grant);
      return;
    }
    accept(u, r);
  }
  function showError(r, grant) {
    result.replaceChildren(h('div', { class: 'callout danger' }, icon('alert'), h('div', { class: 'stack-sm' },
      h('strong', {}, 'This source can’t be used yet'), h('div', {}, r.error), r.hint ? h('div', { class: 'subtle' }, r.hint) : null, grant || null)));
  }
  function accept(u, r) {
    sources.push({ url: u, ...(name.value.trim() || r.name ? { name: name.value.trim() || r.name } : {}), ...(dept.value.trim() ? { department: dept.value.trim() } : {}) });
    ctx.markDirty();
    data.sources = [...data.sources.filter((s) => s.url !== u), { url: u, status: 'ok', count: r.count, updated: r.updated, docName: r.name, fetchedAt: new Date().toISOString(), warnings: r.warnings }];
    toast(`Found ${r.count} links${r.name ? ` in “${r.name}”` : ''}. Save to start using them.`, { tone: 'success', timeout: 4500 });
    renderSources();
  }
  return h('form', { class: 'add-source', onsubmit: add },
    h('h4', {}, 'Add a source'),
    h('div', { class: 'add-grid' },
      h('div', { class: 'field' }, h('label', {}, 'JSON URL'), url),
      h('div', { class: 'field' }, h('label', {}, 'Name'), name),
      h('div', { class: 'field' }, h('label', {}, 'Default department'), dept),
      h('div', { class: 'field add-btn' }, h('label', { 'aria-hidden': 'true' }, ' '), btn)),
    result);
}

function formatHelp() {
  const example = JSON.stringify({ name: 'Acme company links', updated: '2026-10-01', links: [
    { key: 'payroll', url: 'https://payroll.acme.example', title: 'Payroll & payslips', department: 'HR', aliases: ['pay'], tags: ['money'], featured: true },
    { key: 'jira', url: 'https://acme.atlassian.net/browse/{1}', home: 'https://acme.atlassian.net/jira', title: 'Jira' },
  ] }, null, 2);
  return h('details', { class: 'card mt-12 format-help' },
    h('summary', {}, icon('code', { size: 16 }), h('strong', {}, 'Source file format and hosting tips')),
    h('div', { class: 'stack mt-12' },
      h('p', { class: 'muted' }, 'A source is a JSON file with a ', h('code', {}, 'links'), ' array. Each link needs ', h('code', {}, 'key'), ' and ', h('code', {}, 'url'), '; ', h('code', {}, 'title'), ', ', h('code', {}, 'description'), ', ', h('code', {}, 'department'), ', ', h('code', {}, 'tags'), ', ', h('code', {}, 'aliases'), ', ', h('code', {}, 'featured'), ', ', h('code', {}, 'owner'), ' and ', h('code', {}, 'home'), ' are optional. Use ', h('code', {}, '{1}'), ', ', h('code', {}, '{2}'), ' for path segments and ', h('code', {}, '{*}'), ' for “everything else”.'),
      h('pre', { class: 'textarea code', style: { whiteSpace: 'pre', overflow: 'auto', margin: 0, maxHeight: '260px' } }, example),
      h('div', { class: 'callout' }, icon('server'), h('div', {}, h('strong', {}, 'Deploying with policy? '), 'Serve the file with ', h('code', {}, 'Access-Control-Allow-Origin: *'), ' so every browser can fetch it without asking people for permission. Add ', h('code', {}, 'ETag'), ' or ', h('code', {}, 'Last-Modified'), ' headers to make refreshes cheap.'))));
}

async function refreshNow() {
  const btn = sourcesPanel.querySelector('.card-head .btn');
  if (btn) { btn.disabled = true; btn.replaceChildren(h('span', { class: 'spinner' }), 'Refreshing…'); }
  try {
    if (ctx.dirty && !ctx.isLocked('sources')) toast('Save first to refresh newly added sources', { tone: 'info' });
    await send('refresh', { force: true });
    data = await send('getData');
    const errors = data.sources.filter((s) => s.status === 'error').length;
    toast(errors ? `${errors} source${errors === 1 ? '' : 's'} failed to refresh` : `Refreshed · ${data.links.filter((l) => !l.personal).length} company links`, { tone: errors ? 'warning' : 'success' });
  } catch (err) {
    toast(err.message, { tone: 'danger' });
  }
  renderSources();
  renderPersonal();
}

ctx.registerCollector(() => (ctx.isLocked('sources') ? {} : { sources }));

// ---------------------------------------------------------------------------
// Address bar
// ---------------------------------------------------------------------------
const hostInput = $('#shortHost');
async function checkHostAccess() {
  const host = hostInput.value.trim().toLowerCase();
  const row = $('#host-access-row');
  if (!validShortHost(host)) { row.hidden = false; $('#host-access-text').textContent = 'Use a single word: letters, digits and dashes (no dots or slashes).'; $('#grant-host').hidden = true; return; }
  $('#grant-host').hidden = false;
  let ok = true;
  try { ok = await api.permissions.contains({ origins: [`*://${host}/*`] }); } catch { ok = true; }
  row.hidden = ok;
  $('#host-access-text').textContent = `Go-Links needs permission to redirect http://${host}/… addresses. Click to allow it, then save.`;
}
hostInput.addEventListener('input', checkHostAccess);
$('#grant-host').addEventListener('click', async () => {
  const host = hostInput.value.trim().toLowerCase();
  let ok = false;
  try { ok = await api.permissions.request({ origins: [`*://${host}/*`] }); } catch { ok = false; }
  toast(ok ? `Access to http://${host}/ granted` : 'Access was not granted', { tone: ok ? 'success' : 'warning' });
  checkHostAccess();
});
checkHostAccess();
ctx.registerValidator((patch) => ('shortHost' in patch && !validShortHost(patch.shortHost) ? 'The short host must be one word: letters, digits and dashes.' : null));
ctx.registerValidator((patch) => {
  if (!('refreshMinutes' in patch)) return null;
  const n = Number(patch.refreshMinutes);
  return n >= MIN_REFRESH && n <= MAX_REFRESH ? null : `Refresh interval must be between ${MIN_REFRESH} and ${MAX_REFRESH} minutes.`;
});

async function renderRules() {
  const card = $('#rules-card');
  let info;
  try { info = await send('getRules'); } catch (err) { info = { status: null, rules: [], error: err.message }; }
  const st = info.status;
  const rows = (st?.rules || []).map((r) => h('div', { class: 'rule-row' }, icon('check', { size: 15, class: 'text-success' }), h('span', {}, r.label), h('code', { class: 'rule-regex truncate', title: r.regex }, r.regex)));
  render(card,
    h('div', { class: 'card-head' },
      h('h3', {}, icon('shield-check', { size: 18 }), 'Redirect rules'),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { await send('syncRules'); toast('Rules re-applied', { tone: 'success' }); renderRules(); } }, icon('refresh'), 'Re-apply')),
    st ? h('p', { class: 'subtle' }, `${info.rules.length} active rule${info.rules.length === 1 ? '' : 's'} for http://${st.shortHost}/ · applied ${relativeTime(st.at)}`) : h('p', { class: 'subtle' }, 'Rules have not been applied yet.'),
    rows.length ? h('div', { class: 'stack-sm mt-8' }, rows) : null,
    st?.rejected?.length ? h('div', { class: 'callout warning mt-12' }, icon('alert'), h('div', {}, 'Some rules were rejected by the browser: ', st.rejected.map((r) => `#${r.id} ${r.reason}`).join('; '))) : null,
    h('p', { class: 'help mt-12' }, 'Tip: the first time, some browsers treat go/payroll as a search. Typing http://go/payroll once, or using the go keyword, teaches the browser that it is an address.'));
}
renderRules();
ctx.onSaved(async () => { await new Promise((r) => setTimeout(r, 400)); renderRules(); });

$('#clear-usage').addEventListener('click', async () => {
  if (!(await confirmDialog({ title: 'Clear usage counts?', message: '“Most used” and personal ranking start from scratch.', confirmLabel: 'Clear' }))) return;
  await send('clearUsage');
  toast('Usage counts cleared', { tone: 'success' });
});

// ---------------------------------------------------------------------------
// Personal links
// ---------------------------------------------------------------------------
const personalPanel = $('#personal-panel');
function companyIndex() {
  return R.buildIndex([{ id: 'company', kind: 'source', links: data.links.filter((l) => !l.personal) }]);
}

function renderPersonal() {
  const locked = ctx.isLocked('personalLinks');
  const company = companyIndex();
  const host = ctx.settings.shortHost || 'go';
  const savePersonal = (v, original) => {
    const others = personal.filter((l) => R.matchKey(l.key) !== R.matchKey(original?.key ?? '\u0000'));
    if (others.some((l) => R.matchKey(l.key) === R.matchKey(v.key))) throw new Error(`You already have ${host}/${v.key}.`);
    const { link } = R.cleanLink(v);
    const out = { key: link.key, url: link.url, title: link.title };
    if (link.description) out.description = link.description;
    personal = [...others, out].sort((a, b) => a.key.localeCompare(b.key));
    ctx.markDirty();
    renderPersonal();
  };
  const edit = (link) => editPersonalLink({
    link, shortHost: host, save: savePersonal,
    companyLookup: (k) => R.lookup(company, k),
    existingKeys: personal.map((l) => l.key),
  });
  const rows = personal.map((l, i) => {
    const conflict = R.lookup(company, l.key);
    return h('tr', {},
      h('td', {}, goLabel(l.key, host)),
      h('td', {}, h('div', { style: { fontWeight: 600 } }, l.title || l.key), h('div', { class: 'subtle truncate', style: { maxWidth: '340px' } }, l.url)),
      h('td', {}, conflict ? h('span', { class: 'badge warning', title: `Company link: ${conflict.title}` }, icon('alert'), 'Hidden by company link') : h('span', { class: 'badge success' }, 'Active')),
      h('td', { class: 'actions' }, locked ? null : [
        h('button', { class: 'btn ghost sm icon', type: 'button', title: 'Edit', 'aria-label': `Edit ${l.key}`, onclick: () => edit(l) }, icon('edit')),
        h('button', { class: 'btn ghost sm icon', type: 'button', title: 'Delete', 'aria-label': `Delete ${l.key}`, onclick: () => { personal.splice(i, 1); ctx.markDirty(); renderPersonal(); } }, icon('trash'))]));
  });
  personalPanel.replaceChildren(h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h3', {}, icon('user', { size: 18 }), `My links (${personal.length})`, locked ? lockChip() : null),
      h('div', { class: 'row gap-4' },
        locked ? null : h('button', { class: 'btn sm', type: 'button', onclick: async () => {
          const file = await pickFile('application/json,.json');
          if (!file) return;
          try {
            const v = R.validateSource(await readFile(file));
            if (!v.ok) throw new Error(v.errors.join('; '));
            const map = new Map(personal.map((l) => [R.matchKey(l.key), l]));
            for (const l of v.links) map.set(R.matchKey(l.key), { key: l.key, url: l.url, title: l.title, ...(l.description ? { description: l.description } : {}) });
            personal = [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
            ctx.markDirty(); renderPersonal();
            toast(`Imported ${v.links.length} links. Save to keep them.`, { tone: 'success' });
          } catch (err) { toast(`Could not import: ${err.message}`, { tone: 'danger' }); }
        } }, icon('upload'), 'Import'),
        h('button', { class: 'btn sm', type: 'button', disabled: !personal.length, onclick: () => downloadFile('go-links-personal.json', { name: 'My go-links', updated: new Date().toISOString().slice(0, 10), links: personal }) }, icon('download'), 'Export'),
        locked ? null : h('button', { class: 'btn sm primary', type: 'button', onclick: () => edit(null) }, icon('plus'), 'Add'))),
    personal.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Link'), h('th', {}, 'Destination'), h('th', {}, 'Status'), h('th', {}, ''))), h('tbody', {}, rows)))
      : h('p', { class: 'subtle' }, 'No personal links yet. Add one here, from the popup (“Add link for this tab”) or from the directory.')));
}
ctx.registerCollector(() => (ctx.isLocked('personalLinks') ? {} : { personalLinks: personal }));

// ---------------------------------------------------------------------------
// Standard sections
// ---------------------------------------------------------------------------
mountBrandingPanel($('#branding-panel'), ctx);
mountBackupPanel($('#backup-panel'), ctx, { slug: 'go-links' });
mountAboutPanel($('#about-panel'), ctx, {
  description: 'Go-Links turns short names like go/payroll into the right company page, from the address bar, the toolbar popup or the company directory. Links are published centrally by each department; you can add personal ones.',
  privacy: 'Go-Links only downloads the link files configured above. It does not send your browsing history, searches or usage anywhere: usage counts and personal links stay in this browser. It only looks at addresses starting with the short host (http://go/…) and at search-engine queries that start with “go/”.',
});
initSideNav();

ctx.onSaved(async () => {
  // the background refetches when sources change; show fresh status afterwards
  await new Promise((r) => setTimeout(r, 300));
  try { await send('refresh', { force: false }); data = await send('getData'); } catch { /* ignore */ }
  sources = clone(ctx.settings.sources) || [];
  personal = clone(ctx.settings.personalLinks) || [];
  renderSources();
  renderPersonal();
  checkHostAccess();
});
ctx.onChange(async () => {
  data = await send('getData').catch(() => data);
  sources = clone(ctx.settings.sources) || [];
  personal = clone(ctx.settings.personalLinks) || [];
  renderSources();
  renderPersonal();
});

function hostOf(u) { try { return new URL(u).host; } catch { return u; } }

renderSources();
renderPersonal();
