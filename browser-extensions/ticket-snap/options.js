// Ticket Snap options page.
import { initPage } from './shared/page.js';
import { api, IS_FIREFOX, extVersion } from './shared/browser.js';
import { ensureHostPermission } from './shared/config.js';
import { bindSettings, mountBrandingPanel, mountBackupPanel, mountAboutPanel, initSideNav, lockChip } from './shared/settings-ui.js';
import { getEnvironmentInfo } from './shared/env-info.js';
import { h, $, $$, icon, toast, confirmDialog, relativeTime, formatDateTime } from './shared/ui.js';
import { DEFAULTS, SECRET_KEYS, PRIORITY_LABELS } from './defaults.js';
import { PROVIDERS, getProvider } from './providers/index.js';
import { DIAGNOSTIC_ITEMS, collectDiagnostics, filterDiagnostics } from './lib/diagnostics.js';
import { diagnosticEntries } from './lib/ticket-text.js';
import { getHistory, clearHistory, HISTORY_LIMIT } from './lib/history.js';

const ctx = await initPage({ defaults: DEFAULTS, title: 'Ticket Snap · Settings', options: true });

// ---------------------------------------------------------------------------
// Helpdesk: provider cards + provider-specific fields rendered from `fields`
// ---------------------------------------------------------------------------
let selectedProvider = getProvider(ctx.settings.provider).id;
const grid = $('#provider-grid');
const configCard = $('#provider-config');
const fieldEls = {};      // key -> bound input element
const panels = {};        // provider id -> panel element
const showIfRows = [];    // [{ field, el }]

function renderCards() {
  const locked = ctx.isLocked('provider');
  grid.replaceChildren(...PROVIDERS.map((p) => h('button', {
    class: 'provider-card', type: 'button', role: 'radio', 'aria-checked': String(p.id === selectedProvider),
    disabled: locked && p.id !== selectedProvider,
    onclick: () => { if (locked || selectedProvider === p.id) return; selectedProvider = p.id; ctx.markDirty(); renderCards(); showPanel(); },
  },
  h('span', { class: 'tick' }, icon('check')),
  h('span', { class: 'top' }, h('span', { class: 'logo', style: { background: p.color } }, icon(p.icon)), h('span', { class: 'name' }, p.label)),
  h('span', { class: 'desc' }, p.description),
  p.recommended ? h('span', { class: 'badge primary' }, icon('star'), 'Recommended') : null,
  locked && p.id === selectedProvider ? lockChip() : null)));
}

function inputFor(f) {
  const id = `f-${f.key}`;
  const common = { id, dataset: { setting: f.key }, placeholder: f.placeholder || '' };
  if (f.type === 'select') return h('select', { class: 'select', id, dataset: { setting: f.key } }, f.options.map(([v, l]) => h('option', { value: v }, l)));
  if (f.type === 'json') return h('textarea', { class: 'textarea code', rows: 3, ...common, dataset: { setting: f.key, type: 'json' }, spellcheck: false });
  if (f.type === 'password') return h('input', { class: 'input', type: 'password', autocomplete: 'off', spellcheck: false, ...common });
  return h('input', { class: 'input', type: f.type === 'url' ? 'url' : f.type === 'email' ? 'email' : 'text', spellcheck: false, autocomplete: 'off', ...common });
}

function fieldNode(f) {
  if (f.type === 'bool') {
    const input = h('input', { type: 'checkbox', dataset: { setting: f.key } });
    fieldEls[f.key] = input;
    return h('div', { class: 'setting-row' },
      h('div', { class: 'text' }, h('strong', {}, f.label), f.help ? h('span', {}, f.help) : null),
      h('div', { class: 'control' }, h('label', { class: 'switch' }, input, h('span', { class: 'track' }))));
  }
  const input = inputFor(f);
  fieldEls[f.key] = input;
  let control = input;
  if (f.type === 'password') {
    const reveal = h('button', { class: 'btn', type: 'button', title: 'Show or hide', 'aria-label': `Show ${f.label}`, onclick: () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      reveal.replaceChildren(icon(show ? 'eye-off' : 'eye'));
    } }, icon('eye'));
    control = h('div', { class: 'input-group' }, input, reveal);
  }
  return h('div', { class: 'field' },
    h('label', { for: input.id }, f.label, f.required ? h('span', { class: 'text-danger', 'aria-hidden': 'true' }, '*') : null),
    control,
    f.help ? h('div', { class: 'help' }, f.help) : null,
    f.secret ? h('div', { class: 'help' }, icon('lock', { size: 12 }), ' Stored only in this browser; never included in exports.') : null);
}

function buildPanels() {
  for (const p of PROVIDERS) {
    const body = [];
    let pendingHalf = null;
    for (const f of p.fields) {
      const node = fieldNode(f);
      if (f.showIf) showIfRows.push({ field: f, el: node });
      if (f.half) {
        if (pendingHalf) { pendingHalf.append(node); pendingHalf = null; continue; }
        pendingHalf = h('div', { class: 'grid-2' }, node);
        body.push(pendingHalf);
        continue;
      }
      pendingHalf = null;
      body.push(node);
    }
    const result = h('div', { class: 'test-result', 'aria-live': 'polite' });
    const testBtn = h('button', { class: 'btn', type: 'button', onclick: (e) => testConnection(p, e.currentTarget, result) }, icon('zap'), 'Test connection');
    panels[p.id] = h('div', { class: 'provider-panel hidden', dataset: { provider: p.id } },
      h('div', { class: 'card-head' }, h('h3', {}, h('span', { class: 'row' }, icon(p.icon, { size: 18, class: 'text-primary' }), `${p.label} settings`))),
      h('div', { class: 'callout setup-note' }, icon('info'), h('div', {}, p.setup)),
      body,
      h('div', { class: 'test-row' }, testBtn, result));
  }
  configCard.classList.add('provider-config');
  configCard.replaceChildren(...Object.values(panels));
}

function showPanel() {
  for (const [id, el] of Object.entries(panels)) el.classList.toggle('hidden', id !== selectedProvider);
  syncShowIf();
}

/** Values currently typed into the form (unsaved), merged over saved settings. */
function draftValues() {
  const values = { ...ctx.settings, provider: selectedProvider };
  for (const [key, el] of Object.entries(fieldEls)) {
    try { values[key] = bound.read(el); } catch { values[key] = ctx.settings[key]; }
  }
  return values;
}

function syncShowIf() {
  const values = draftValues();
  for (const { field, el } of showIfRows) el.classList.toggle('hidden', !field.showIf(values));
}

async function testConnection(provider, btn, result) {
  let values;
  try { values = draftValues(); } catch (err) { result.replaceChildren(h('div', { class: 'callout danger' }, icon('alert'), h('div', {}, err.message))); return; }
  // Request host permission first, synchronously inside the click.
  let endpoint = '';
  try { endpoint = provider.endpoint(values); } catch { endpoint = ''; }
  const permission = endpoint && /^https?:/i.test(endpoint) ? ensureHostPermission(endpoint) : Promise.resolve(true);
  btn.disabled = true;
  const spinner = h('span', { class: 'spinner' });
  btn.prepend(spinner);
  result.replaceChildren(h('span', { class: 'subtle' }, 'Testing…'));
  try {
    const granted = await permission;
    try {
      const msg = await provider.test(values);
      result.replaceChildren(h('div', { class: 'callout success' }, icon('check'), h('div', {}, msg)));
    } catch (err) {
      const text = !granted && err.kind === 'network'
        ? `Permission to contact ${new URL(endpoint).host} was not granted. Click "Test connection" again and choose Allow.`
        : err.message || String(err);
      result.replaceChildren(h('div', { class: 'callout danger' }, icon('alert'), h('div', {}, text)));
    }
  } finally {
    spinner.remove();
    btn.disabled = false;
  }
}

renderCards();
buildPanels();

// ---------------------------------------------------------------------------
// Ticket form: categories, default category, required fields
// ---------------------------------------------------------------------------
let categories = [...(ctx.settings.categories || [])];
const catEditor = $('#categories-editor');
const defaultCategorySelect = $('#defaultCategory');

function fillCategoryOptions() {
  const current = defaultCategorySelect.value || ctx.settings.defaultCategory;
  defaultCategorySelect.replaceChildren(...categories.map((c) => h('option', { value: c }, c)));
  defaultCategorySelect.value = categories.includes(current) ? current : categories[0] || '';
}

function renderCategories() {
  const locked = ctx.isLocked('categories');
  const input = h('input', { class: 'input', placeholder: 'Add a category, e.g. Printers', maxlength: 60, 'aria-label': 'New category', disabled: locked });
  const add = () => {
    const v = input.value.trim();
    if (!v) return;
    if (categories.some((c) => c.toLowerCase() === v.toLowerCase())) { toast('That category already exists', { tone: 'warning' }); return; }
    categories.push(v);
    ctx.markDirty();
    renderCategories();
    fillCategoryOptions();
    $('#categories-editor input')?.focus();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  catEditor.replaceChildren(...[
    locked ? h('div', { style: { marginBottom: '8px' } }, lockChip()) : null,
    categories.length
      ? h('div', { class: 'chip-list', role: 'list' }, categories.map((c, i) => h('span', { class: `chip${locked ? ' locked' : ''}`, role: 'listitem' }, c,
        locked ? null : h('button', { type: 'button', title: `Remove ${c}`, 'aria-label': `Remove ${c}`, onclick: () => {
          categories.splice(i, 1); ctx.markDirty(); renderCategories(); fillCategoryOptions();
        } }, icon('x')))))
      : h('p', { class: 'subtle' }, 'No categories: the category field is hidden from the form.'),
    locked ? null : h('div', { class: 'cat-add' }, input, h('button', { class: 'btn', type: 'button', onclick: add }, icon('plus'), 'Add'))].filter(Boolean));
}

const REQUIRED_OPTIONS = [['description', 'Description'], ['category', 'Category'], ['reporterName', 'Reporter name'], ['reporterEmail', 'Reporter email']];
let requiredFields = new Set(ctx.settings.requiredFields || []);
function renderRequired() {
  const locked = ctx.isLocked('requiredFields');
  $('#required-editor').replaceChildren(...REQUIRED_OPTIONS.map(([k, label]) => h('label', { class: locked ? 'disabled' : '' },
    h('input', { type: 'checkbox', checked: requiredFields.has(k), disabled: locked, onchange: (e) => {
      if (e.target.checked) requiredFields.add(k); else requiredFields.delete(k);
      ctx.markDirty();
    } }), label)), ...(locked ? [h('div', {}, lockChip())] : []));
}

renderCategories();
fillCategoryOptions();
renderRequired();

// ---------------------------------------------------------------------------
// Diagnostics toggles + live preview
// ---------------------------------------------------------------------------
const env = await getEnvironmentInfo().catch(() => ({}));
const sampleDiag = collectDiagnostics({
  url: 'https://intranet.example.com/payroll/edit?id=1042', title: 'Payroll · Edit employee',
  viewport: `${innerWidth}×${innerHeight}`, zoom: '100%', capturedAt: new Date().toISOString(),
}, env, extVersion());

$('#diag-toggles').replaceChildren(
  h('div', { class: 'card-head' }, h('h3', {}, icon('activity', { size: 18 }), 'Attached items')),
  ...DIAGNOSTIC_ITEMS.map((d) => h('div', { class: 'setting-row' },
    h('div', { class: 'text' }, h('strong', {}, d.label), h('span', {}, d.help)),
    h('div', { class: 'control' }, h('label', { class: 'switch' }, h('input', { type: 'checkbox', dataset: { setting: `diagnostics.${d.key}` }, onchange: renderDiagPreview }), h('span', { class: 'track' }))))));

function renderDiagPreview() {
  const enabled = {};
  for (const el of $$('#diag-toggles input[data-setting]')) enabled[el.dataset.setting.split('.')[1]] = el.checked;
  const entries = diagnosticEntries(filterDiagnostics(sampleDiag, enabled));
  $('#diag-count').textContent = `${entries.length} of ${DIAGNOSTIC_ITEMS.length}`;
  $('#diag-preview').replaceChildren(entries.length
    ? h('dl', { class: 'kv' }, entries.map((e) => [h('dt', {}, e.label), h('dd', {}, e.value)]))
    : h('p', { class: 'muted' }, 'Nothing is attached apart from what people type.'),
  h('p', { class: 'subtle mt-12' }, 'Sample values from this browser; the URL and title are examples.'));
}

// ---------------------------------------------------------------------------
// Capture: keyboard shortcut
// ---------------------------------------------------------------------------
async function renderShortcut() {
  const cmds = await api.commands?.getAll?.().catch(() => []) ?? [];
  const sc = cmds.find((c) => c.name === 'capture-tab')?.shortcut;
  const isEdge = /Edg\//.test(navigator.userAgent);
  const control = $('#shortcut-control');
  control.replaceChildren(...[
    sc ? h('kbd', { style: { fontSize: '13px', padding: '4px 8px' } }, sc) : h('span', { class: 'badge warning' }, 'Not set'),
    IS_FIREFOX ? null : h('button', { class: 'btn sm', type: 'button', onclick: () => api.tabs.create({ url: `${isEdge ? 'edge' : 'chrome'}://extensions/shortcuts` }) }, icon('edit'), 'Change')].filter(Boolean));
  if (IS_FIREFOX) $('#shortcut-text').textContent = 'Captures the current tab straight away. Change it in about:addons → ⚙ → Manage Extension Shortcuts.';
}
renderShortcut();

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
async function renderHistory() {
  const list = await getHistory();
  const panel = $('#history-panel');
  if (!list.length) {
    panel.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, icon('ticket')), h('h3', {}, 'No tickets yet'),
      h('p', {}, ctx.settings.keepHistory === false ? 'History is turned off in Capture settings.' : `The last ${HISTORY_LIMIT} tickets you submit are listed here, with links when the helpdesk returns one.`)));
    return;
  }
  panel.replaceChildren(
    h('div', { class: 'history-actions' }, h('span', { class: 'subtle' }, `${list.length} ticket${list.length > 1 ? 's' : ''} · kept in this browser only`),
      h('button', { class: 'btn sm danger-soft', type: 'button', onclick: async () => {
        if (!await confirmDialog({ title: 'Clear ticket history?', message: 'This only removes the local list. Tickets in your helpdesk are not affected.', confirmLabel: 'Clear history', tone: 'danger' })) return;
        await clearHistory();
        renderHistory();
        toast('History cleared', { tone: 'success' });
      } }, icon('trash'), 'Clear history')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table history-table' },
      h('thead', {}, h('tr', {}, ['When', 'Summary', 'Helpdesk', 'Ticket', 'Priority'].map((t) => h('th', {}, t)))),
      h('tbody', {}, list.map((t) => h('tr', {},
        h('td', { class: 'nowrap', title: formatDateTime(t.time) }, relativeTime(t.time)),
        h('td', { class: 'summary' }, h('strong', { title: t.summary }, t.summary), h('span', { class: 'subtle' }, [t.category, t.page].filter(Boolean).join(' · '))),
        h('td', { class: 'nowrap' }, t.providerLabel || t.provider),
        h('td', { class: 'nowrap' }, t.url ? h('a', { href: t.url, target: '_blank', rel: 'noopener' }, t.id || 'Open', ' ', icon('external', { size: 12 })) : (t.id || h('span', { class: 'subtle' }, '—'))),
        h('td', {}, h('span', { class: `badge${t.priority === 'urgent' ? ' danger' : t.priority === 'high' ? ' warning' : ''}` }, PRIORITY_LABELS[t.priority] || t.priority || '—')))))),
    ));
}
renderHistory();
api.storage.onChanged.addListener((changes, area) => { if (area === 'local' && 'data:history' in changes) renderHistory(); });

// ---------------------------------------------------------------------------
// Binding, collectors, validators, standard panels
// ---------------------------------------------------------------------------
const bound = bindSettings(document, ctx);
showPanel();
renderDiagPreview();
configCard.addEventListener('input', syncShowIf);
configCard.addEventListener('change', syncShowIf);

ctx.registerCollector(() => {
  const patch = {};
  if (!ctx.isLocked('provider')) patch.provider = selectedProvider;
  if (!ctx.isLocked('categories')) patch.categories = [...categories];
  if (!ctx.isLocked('requiredFields')) patch.requiredFields = REQUIRED_OPTIONS.map(([k]) => k).filter((k) => requiredFields.has(k));
  return patch;
});
ctx.registerValidator((patch) => {
  const url = patch.webhookUrl;
  if ((patch.provider ?? selectedProvider) === 'webhook' && url && !/^https?:\/\/[^\s/]+/i.test(url)) return 'Webhook URL must start with https:// (or http:// for local testing).';
  if (patch.webhookHeaders != null && (typeof patch.webhookHeaders !== 'object' || Array.isArray(patch.webhookHeaders))) return 'Extra headers must be a JSON object like { "Authorization": "Bearer …" }.';
  if (patch.reporterEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.reporterEmail)) return 'The default reporter email doesn’t look like an email address.';
  return null;
});
ctx.onChange(() => {
  selectedProvider = getProvider(ctx.settings.provider).id;
  categories = [...(ctx.settings.categories || [])];
  requiredFields = new Set(ctx.settings.requiredFields || []);
  renderCards(); showPanel(); renderCategories(); fillCategoryOptions(); renderRequired(); renderDiagPreview(); renderHistory();
});

mountBrandingPanel($('#branding-panel'), ctx);
mountBackupPanel($('#backup-panel'), ctx, { slug: 'ticket-snap', secretKeys: SECRET_KEYS });
mountAboutPanel($('#about-panel'), ctx, {
  description: 'Ticket Snap captures the current tab, lets you annotate and redact it, and sends a pre-filled ticket with diagnostics to your IT helpdesk.',
  privacy: 'Nothing is collected in the background. A screenshot is only taken when you click Capture, use the shortcut or the right-click menu, and it stays in this browser until you press Submit. Tickets are sent directly to the helpdesk configured above — no other server is involved. You see every diagnostic item before it is sent, redaction boxes permanently remove what is under them, and API tokens never leave this browser except to authenticate with your helpdesk.',
});
initSideNav();
if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
