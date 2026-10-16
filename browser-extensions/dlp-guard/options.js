import { ensureHostPermission } from './shared/config.js';
import { initPage } from './shared/page.js';
import { send } from './shared/messaging.js';
import { h, icon, $, $$, toast, confirmDialog, downloadFile, relativeTime, formatDateTime, formatNumber, debounce, sortableHeaders } from './shared/ui.js';
import { bindSettings, mountBrandingPanel, mountBackupPanel, mountAboutPanel, initSideNav, lockChip } from './shared/settings-ui.js';
import { DEFAULTS, PRODUCT, DEFAULT_RULE_ACTIONS, HIGH_RISK_DEFAULTS, ACTION_LABELS } from './defaults.js';
import { ruleActionsFor, detectorConfig, overallAction, siteStatus } from './policy.js';
import { actionBadge, decisionBadge, incidentRules, detectionList, highlighted, channelLabel } from './dlp-ui.js';

const D = globalThis.DLPDetectors;
const ctx = await initPage({ defaults: DEFAULTS, title: `${PRODUCT} · Settings`, options: true });
const bound = bindSettings(document, ctx);

// Draft state for the custom editors (saved through collectors).
const draft = {};
function loadDraft() {
  draft.ruleActions = { ...DEFAULT_RULE_ACTIONS, ...(ctx.settings.ruleActions || {}) };
  draft.customRules = structuredClone(ctx.settings.customRules || []);
  draft.trustedSites = [...(ctx.settings.trustedSites || [])];
  draft.highRiskSites = [...(ctx.settings.highRiskSites || [])];
}
loadDraft();

/** Settings as they would be after saving (bound fields + editors), for previews. */
function draftSettings() {
  const s = structuredClone(ctx.settings);
  for (const el of $$('[data-setting]')) {
    let v;
    try { v = bound.read(el); } catch { continue; }
    const [top, sub] = el.dataset.setting.split('.');
    if (sub) { s[top] = { ...(s[top] || {}), [sub]: v }; } else s[top] = v;
  }
  return { ...s, ...structuredClone(draft) };
}
const changed = () => { ctx.markDirty(); refreshPreviews(); };
const refreshPreviews = debounce(() => { renderStatus(); renderRuleTable(); runLab(); runUrlTest(); }, 120);
document.addEventListener('input', (e) => { if (e.target.closest('[data-setting]')) refreshPreviews(); });
document.addEventListener('change', (e) => { if (e.target.closest('[data-setting]')) refreshPreviews(); });

// ---------------------------------------------------------------------------
// Status summary
// ---------------------------------------------------------------------------
function renderStatus() {
  const s = draftSettings();
  const everywhere = s.mode !== 'listed';
  const channels = ['paste', 'drop', 'upload', 'submit'].filter((c) => s.channels?.[c]).map(channelLabel);
  const actions = ruleActionsFor(s, false);
  const activeRules = Object.values(actions).filter((a) => a !== 'off').length;
  $('#status-callout').replaceChildren(h('div', { class: `callout ${channels.length ? 'success' : 'warning'}` },
    icon(channels.length ? 'shield-check' : 'alert'),
    h('div', {},
      h('strong', {}, channels.length ? (everywhere ? 'Protecting every site' : 'Protecting listed high-risk sites') : 'No channels are being watched'),
      everywhere ? ` except ${s.trustedSites.length} trusted pattern${s.trustedSites.length === 1 ? '' : 's'}` : ` (${s.highRiskSites.length} patterns)`,
      `. ${activeRules} detector${activeRules === 1 ? '' : 's'} active · watching ${channels.join(', ') || 'nothing'}`,
      s.reportingEndpoint ? ' · reporting on.' : ' · incidents stay on this device.')));
}

// ---------------------------------------------------------------------------
// Detector table
// ---------------------------------------------------------------------------
function actionSelect(value, { includeDefault = true, disabled, onChange } = {}) {
  const fallback = ctx.settings.defaultAction || 'warn';
  const opts = ['off', 'log', 'warn', 'block'].map((a) => h('option', { value: a }, ACTION_LABELS[a]));
  if (includeDefault) opts.push(h('option', { value: 'default' }, `Default (${ACTION_LABELS[fallback] || fallback})`));
  return h('select', { class: 'select', value, disabled, onchange: (e) => onChange(e.target.value) }, opts);
}

function renderRuleTable() {
  const s = draftSettings();
  const normal = ruleActionsFor(s, false);
  const risk = ruleActionsFor(s, true);
  const rows = [];
  let cat = '';
  for (const r of D.BUILTINS) {
    if (r.category !== cat) { cat = r.category; rows.push(h('tr', { class: 'cat' }, h('td', { colspan: 3 }, cat))); }
    const locked = ctx.isLocked(`ruleActions.${r.id}`);
    rows.push(h('tr', { class: normal[r.id] === 'off' ? 'is-off' : '' },
      h('td', {},
        h('div', { class: 'rule-name row gap-4' }, r.name, locked ? lockChip() : null),
        h('div', { class: 'rule-desc' }, r.description),
        h('div', { class: 'rule-example' }, h('span', { class: 'subtle' }, 'Example: '), h('code', {}, r.example))),
      h('td', {}, actionSelect(draft.ruleActions[r.id] || 'default', { disabled: locked, onChange: (v) => { draft.ruleActions[r.id] = v; changed(); } })),
      h('td', {}, actionBadge(risk[r.id]))));
  }
  const table = $('#rule-table');
  const focused = document.activeElement && table.contains(document.activeElement) ? [...table.querySelectorAll('select')].indexOf(document.activeElement) : -1;
  table.replaceChildren(
    h('thead', {}, h('tr', {}, h('th', {}, 'Detector'), h('th', {}, 'Action'), h('th', {}, 'On high-risk sites'))),
    h('tbody', {}, rows));
  if (focused >= 0) table.querySelectorAll('select')[focused]?.focus();
}

// ---------------------------------------------------------------------------
// Custom rules
// ---------------------------------------------------------------------------
const slug = (s) => String(s || 'rule').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'rule';

function renderCustomRules() {
  const locked = ctx.isLocked('customRules');
  const el = $('#custom-rules');
  const addBtn = h('button', { class: 'btn primary', type: 'button', disabled: locked, onclick: () => editRule() }, icon('plus'), 'Add rule');
  if (!draft.customRules.length) {
    el.replaceChildren(h('div', { class: 'empty' },
      h('div', { class: 'empty-icon' }, icon('code')),
      h('h3', {}, 'No custom rules yet'),
      h('p', { class: 'subtle' }, 'Example: an employee ID like EMP-123456, or a code name such as "Project Falcon".'),
      h('div', { class: 'mt-12' }, locked ? lockChip() : addBtn)));
    return;
  }
  el.replaceChildren(h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', {}, `${draft.customRules.length} rule${draft.customRules.length === 1 ? '' : 's'}`), locked ? lockChip() : addBtn),
    draft.customRules.map((r, i) => {
      const valid = D.compileCustom(r);
      const enabled = r.enabled !== false;
      return h('div', { class: 'custom-rule' },
        h('label', { class: 'switch', title: enabled ? 'Enabled' : 'Disabled' },
          h('input', { type: 'checkbox', checked: enabled, disabled: locked, 'aria-label': `Enable ${r.name}`, onchange: (e) => { r.enabled = e.target.checked; changed(); renderCustomRules(); } }),
          h('span', { class: 'track' })),
        h('div', { class: 'grow' },
          h('div', { class: 'row gap-4 wrap' }, h('strong', {}, r.name || 'Untitled'), actionBadge(r.action === 'default' || !r.action ? (ctx.settings.defaultAction || 'warn') : r.action),
            (r.minCount || 1) > 1 ? h('span', { class: 'badge' }, `≥ ${r.minCount} matches`) : null,
            valid.ok ? null : h('span', { class: 'badge danger' }, icon('alert'), 'Invalid pattern')),
          h('div', { class: 'mt-4 truncate' }, h('code', {}, `/${r.pattern}/${r.flags || ''}`)),
          r.description ? h('div', { class: 'subtle mt-4' }, r.description) : null),
        locked ? null : h('div', { class: 'row gap-4' },
          h('button', { class: 'btn ghost icon sm', type: 'button', title: 'Edit', 'aria-label': `Edit ${r.name}`, onclick: () => editRule(i) }, icon('edit')),
          h('button', { class: 'btn ghost icon sm', type: 'button', title: 'Delete', 'aria-label': `Delete ${r.name}`, onclick: async () => {
            if (!(await confirmDialog({ title: 'Delete rule?', message: `"${r.name}" will be removed when you save.`, confirmLabel: 'Delete', tone: 'danger' }))) return;
            draft.customRules.splice(i, 1); changed(); renderCustomRules();
          } }, icon('trash'))));
    })));
}

function editRule(index) {
  const existing = index != null ? draft.customRules[index] : null;
  const r = existing ? { ...existing } : { id: '', name: '', description: '', pattern: '', flags: 'i', minCount: 1, action: 'default', enabled: true };
  return new Promise((resolve) => {
    const name = h('input', { class: 'input', value: r.name, placeholder: 'Employee ID', maxlength: 80 });
    const desc = h('input', { class: 'input', value: r.description || '', placeholder: 'Shown in the warning (optional)', maxlength: 200 });
    const pattern = h('input', { class: 'input code', value: r.pattern, placeholder: 'EMP-\\d{6}', spellcheck: false });
    const ci = h('input', { type: 'checkbox', checked: (r.flags || '').includes('i') });
    const minCount = h('input', { class: 'input', type: 'number', min: 1, max: 1000, value: r.minCount || 1, style: { width: '100px' } });
    const action = actionSelect(r.action || 'default', { onChange: () => {} });
    const sample = h('textarea', { class: 'textarea code', rows: 3, placeholder: 'Paste sample text to test the pattern…', spellcheck: false });
    const status = h('div', { class: 'regex-status' });
    const preview = h('div', {});
    const saveBtn = h('button', { class: 'btn primary', type: 'submit' }, icon('check'), existing ? 'Update rule' : 'Add rule');

    const current = () => ({ ...r, name: name.value.trim(), description: desc.value.trim(), pattern: pattern.value, flags: ci.checked ? 'i' : '', minCount: Math.max(1, Number(minCount.value) || 1), action: action.value });
    const validate = () => {
      const c = current();
      const res = c.pattern ? D.compileCustom(c) : { ok: false, error: 'Enter a pattern' };
      status.className = `regex-status ${res.ok ? 'ok' : 'bad'}`;
      status.replaceChildren(icon(res.ok ? 'check' : 'alert', { size: 14 }), ' ', res.ok ? 'Valid regular expression' : res.error);
      pattern.classList.toggle('invalid', !res.ok && !!c.pattern);
      saveBtn.disabled = !res.ok || !c.name;
      if (res.ok && sample.value) {
        const dets = D.scan(sample.value, { rules: [], customRules: [{ ...c, id: 'preview' }] });
        const n = D.scan(sample.value, { rules: [], customRules: [{ ...c, id: 'preview', minCount: 1 }] })[0]?.count || 0;
        preview.replaceChildren(dets.length
          ? h('div', {}, h('div', { class: 'subtle' }, `${n} distinct match${n === 1 ? '' : 'es'} — rule triggers`), detectionList(dets, { 'custom:preview': c.action === 'default' ? (ctx.settings.defaultAction || 'warn') : c.action }))
          : h('div', { class: 'subtle' }, n ? `${n} match${n === 1 ? '' : 'es'}, below the minimum of ${c.minCount}` : 'No matches in the sample.'));
      } else preview.replaceChildren();
    };
    for (const el of [name, pattern, ci, minCount, sample]) el.addEventListener('input', validate);

    const field = (label, control, help) => h('div', { class: 'field' }, h('label', {}, label), control, help && h('div', { class: 'help' }, help));
    const dlg = h('dialog', { class: 'dialog wide' },
      h('form', { method: 'dialog', class: 'dialog-form', onsubmit: (e) => { e.preventDefault(); if (!saveBtn.disabled) finish(current()); } },
        h('div', { class: 'dialog-body' },
          h('h2', {}, icon('code'), existing ? 'Edit custom rule' : 'New custom rule'),
          h('div', { class: 'grid-2' }, field('Name', name), field('Action', action)),
          field('Description', desc),
          field('Pattern (regular expression)', pattern, h('span', {}, status)),
          h('div', { class: 'row gap-16 mt-12' },
            h('label', { class: 'row gap-4' }, ci, 'Case-insensitive'),
            h('label', { class: 'row gap-4' }, 'Trigger after', minCount, 'distinct matches')),
          field('Test it', sample, 'Matches are shown masked, exactly as users will see them.'),
          preview),
        h('div', { class: 'dialog-actions' },
          h('button', { class: 'btn ghost', type: 'button', onclick: () => finish(null) }, 'Cancel'),
          saveBtn)));
    function finish(value) {
      dlg.close(); dlg.remove();
      if (value) {
        if (!value.id) {
          let id = slug(value.name); let n = 2;
          while (draft.customRules.some((x) => x.id === id)) id = `${slug(value.name)}-${n++}`;
          value.id = id;
        }
        if (existing) draft.customRules[index] = value; else draft.customRules.push(value);
        changed(); renderCustomRules();
      }
      resolve(value);
    }
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    document.body.append(dlg);
    dlg.showModal();
    validate();
    name.focus();
  });
}

// ---------------------------------------------------------------------------
// Site lists
// ---------------------------------------------------------------------------
function chipEditor(el, { key, title, iconName, help, tone, placeholder, resetTo }) {
  const locked = ctx.isLocked(key);
  const input = h('input', { class: 'input code', placeholder, spellcheck: false, disabled: locked });
  const filter = h('input', { class: 'input', placeholder: 'Filter…', style: { width: '140px', height: '30px' } });
  const list = h('div', { class: 'chip-list mt-12' });
  const counter = h('span', { class: 'badge' });
  const add = () => {
    const values = input.value.split(/[\s,]+/).map((v) => v.trim()).filter(Boolean);
    let added = 0;
    for (const v of values) if (!draft[key].includes(v)) { draft[key].push(v); added++; }
    input.value = '';
    if (added) { changed(); paint(); }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  filter.addEventListener('input', () => paint());
  function paint() {
    counter.textContent = String(draft[key].length);
    const q = filter.value.trim().toLowerCase();
    const items = draft[key].filter((v) => !q || v.toLowerCase().includes(q));
    list.replaceChildren(...(items.length ? items.map((v) => h('span', { class: `chip mono ${tone}` }, v,
      locked ? null : h('button', { type: 'button', title: `Remove ${v}`, 'aria-label': `Remove ${v}`, onclick: () => { draft[key] = draft[key].filter((x) => x !== v); changed(); paint(); } }, icon('x'))))
      : [h('span', { class: 'subtle' }, q ? 'No matches.' : 'Nothing here yet.')]));
  }
  el.replaceChildren(...[
    h('div', { class: 'card-head' }, h('h3', {}, icon(iconName, { size: 18 }), title, counter, locked ? lockChip() : null), filter),
    h('p', { class: 'subtle' }, help),
    locked ? null : h('div', { class: 'input-group mt-12' }, input, h('button', { class: 'btn', type: 'button', onclick: add }, icon('plus'), 'Add')),
    list,
    resetTo && !locked ? h('div', { class: 'mt-12' }, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { draft[key] = [...resetTo]; changed(); paint(); } }, icon('refresh'), 'Restore recommended list')) : null,
  ].filter(Boolean));
  paint();
}
function renderSiteEditors() {
  chipEditor($('#trusted-editor'), { key: 'trustedSites', title: 'Trusted sites', iconName: 'building', tone: 'trusted', placeholder: 'acme.com, acme.sharepoint.com', help: 'Company-approved destinations, e.g. your own domains, corporate Microsoft 365 or Google Workspace tenant. Nothing is scanned there.' });
  chipEditor($('#risk-editor'), { key: 'highRiskSites', title: 'High-risk sites', iconName: 'shield-alert', tone: 'risk', placeholder: 'chat.example.ai', help: 'Public AI chatbots, personal e-mail, file sharing, paste sites and messaging.', resetTo: HIGH_RISK_DEFAULTS });
}

function runUrlTest() {
  const raw = $('#url-test').value.trim();
  const out = $('#url-test-result');
  if (!raw) { out.replaceChildren(); return; }
  const url = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
  const s = draftSettings();
  const st = siteStatus(s, url);
  const map = {
    restricted: ['globe', '', 'Not a web page — nothing to protect.'],
    trusted: ['building', 'info', `Trusted (matches "${st.trustedMatch}") — not scanned.`],
    'not-listed': ['globe', '', 'Not on the high-risk list — not scanned in "listed only" mode.'],
    disabled: ['power', 'danger', 'Protection is switched off by the user.'],
    snoozed: ['clock', 'warning', 'Paused.'],
    protected: ['shield-check', 'success', 'Protected with the normal actions.'],
    'high-risk': ['shield-alert', 'warning', `High-risk (matches "${st.highRiskMatch}") — stricter actions apply.`],
  };
  const [ic, tone, text] = map[st.reason] || map.protected;
  const actions = ruleActionsFor(s, st.isHighRisk);
  const blocks = Object.entries(actions).filter(([, a]) => a === 'block').length;
  out.replaceChildren(h('div', { class: `callout ${tone}` }, icon(ic), h('div', {},
    h('strong', {}, st.domain || url), ' — ', text,
    st.active ? h('div', { class: 'subtle mt-4' }, `${blocks} detector${blocks === 1 ? '' : 's'} block here; others warn or log.`) : null)));
}
$('#url-test').addEventListener('input', debounce(runUrlTest, 150));
$('#url-test-btn').addEventListener('click', runUrlTest);

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
async function renderReportStatus() {
  const el = $('#report-status');
  try {
    const st = await send('getReportStatus');
    const parts = [];
    if (!ctx.settings.reportingEndpoint) parts.push('Reporting is off.');
    else {
      parts.push(`${st.queued || 0} queued`);
      if (st.lastSuccessAt) parts.push(`last delivered ${relativeTime(st.lastSuccessAt)}`);
      if (st.lastError) parts.push(`last error: ${st.lastError}${st.nextAttempt ? ` (retry ${relativeTime(st.nextAttempt)})` : ''}`);
    }
    el.replaceChildren(h('span', { class: st.lastError ? 'text-danger' : '' }, parts.join(' · ')));
  } catch (err) { el.textContent = err.message; }
}
$('#report-test').addEventListener('click', async () => {
  const endpoint = $('[data-setting="reportingEndpoint"]').value.trim();
  if (!endpoint) return toast('Enter a reporting endpoint first', { tone: 'warning' });
  await ensureHostPermission(endpoint);
  if (ctx.dirty && !(await ctx.saveAll())) return;
  try { await send('sendTestReport'); toast('Test event delivered', { tone: 'success' }); } catch (err) { toast(err.message, { tone: 'danger', timeout: 6000 }); }
  renderReportStatus();
});
$('#report-retry').addEventListener('click', async () => {
  const endpoint = ctx.settings.reportingEndpoint;
  if (endpoint) await ensureHostPermission(endpoint);
  try {
    const st = await send('flushReports');
    toast(st.lastError ? `Could not deliver: ${st.lastError}` : 'Queue delivered', { tone: st.lastError ? 'danger' : 'success' });
  } catch (err) { toast(err.message, { tone: 'danger' }); }
  renderReportStatus();
});

// ---------------------------------------------------------------------------
// Test lab
// ---------------------------------------------------------------------------
let labRisk = false;
const SAMPLE = `Hi! Can you summarise this customer escalation? STRICTLY CONFIDENTIAL

Customer: Jane Doe, card 4111 1111 1111 1111 (exp 04/27), refund to IBAN GB82 WEST 1234 5698 7654 32
SSN on file: 123-45-6789 · NI number AB 12 34 56 C
Order #100045678923 placed 2024-03-15, call back on +1 415-555-0123.

Debug config from the server:
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
db_password=Tr0ub4dor&3
`;
for (const b of $$('#lab-dest button')) b.addEventListener('click', () => {
  labRisk = b.dataset.v === 'risk';
  for (const x of $$('#lab-dest button')) x.setAttribute('aria-pressed', String(x === b));
  runLab();
});
$('#lab-input').addEventListener('input', debounce(() => runLab(), 120));
$('#lab-sample').addEventListener('click', () => { $('#lab-input').value = SAMPLE; runLab(); });
$('#lab-clear').addEventListener('click', () => { $('#lab-input').value = ''; runLab(); });

function runLab() {
  const text = $('#lab-input').value;
  const out = $('#lab-result');
  if (!text.trim()) {
    out.replaceChildren(h('div', { class: 'empty compact' }, h('div', { class: 'empty-icon' }, icon('zap')), h('h3', {}, 'Paste something to test'), h('p', { class: 'subtle' }, 'Or use "Insert sample data".')));
    return;
  }
  const s = draftSettings();
  const actions = ruleActionsFor(s, labRisk);
  const t0 = performance.now();
  const dets = D.scan(text, { ...detectorConfig(s, actions), withSpans: true });
  const ms = performance.now() - t0;
  if (!dets.length) {
    out.replaceChildren(h('div', { class: 'callout success' }, icon('check'), h('div', {}, h('strong', {}, 'Nothing sensitive found. '), `Scanned ${formatNumber(text.length)} characters in ${ms.toFixed(1)} ms.`)));
    return;
  }
  const a = overallAction(dets, actions);
  const outcome = { block: ['danger', 'lock', 'Users would be blocked.'], warn: ['warning', 'alert', 'Users would see a warning and could cancel or continue.'], log: ['', 'list', 'Logged silently; users see nothing.'], off: ['', 'info', 'No action.'] }[a];
  out.replaceChildren(
    h('div', { class: `callout ${outcome[0]}` }, icon(outcome[1]), h('div', {}, h('strong', {}, `${dets.length} detector${dets.length === 1 ? '' : 's'} matched. `), outcome[2], h('div', { class: 'subtle mt-4' }, `${ms.toFixed(1)} ms on ${labRisk ? 'a high-risk' : 'a normal'} site.`))),
    detectionList(dets, actions),
    h('h4', { class: 'mt-16' }, 'Where'),
    h('div', { class: 'mt-8' }, highlighted(text, dets, actions)));
}

// ---------------------------------------------------------------------------
// Incident log
// ---------------------------------------------------------------------------
let incidents = [];
let sortState = { key: 'timestamp', dir: 'desc' };
async function loadIncidents() {
  try { incidents = await send('getIncidents'); } catch { incidents = []; }
  renderIncidents();
}
function filteredIncidents() {
  const q = $('#inc-search').value.trim().toLowerCase();
  const dec = $('#inc-decision').value;
  const list = incidents.filter((i) => (!dec || i.decision === dec) && (!q || i.domain.includes(q) || incidentRules(i).toLowerCase().includes(q) || i.channel.includes(q)));
  const { key, dir } = sortState;
  const val = (i) => (key === 'rules' ? incidentRules(i) : i[key] || '');
  list.sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * (dir === 'asc' ? 1 : -1));
  return list;
}
function renderIncidents() {
  const today = new Date().toDateString();
  const count = (fn) => incidents.filter(fn).length;
  const stat = (label, value, sub) => h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, formatNumber(value)), h('div', { class: 'stat-sub' }, sub));
  $('#incident-stats').replaceChildren(
    stat('Today', count((i) => new Date(i.timestamp).toDateString() === today), 'alerts on this device'),
    stat('Cancelled', count((i) => i.decision === 'cancelled'), 'user stopped the share'),
    stat('Continued', count((i) => i.decision === 'proceeded'), 'user chose to share'),
    stat('Blocked', count((i) => i.decision === 'blocked'), 'stopped by policy'));
  const list = filteredIncidents();
  const wrap = $('#incident-table');
  if (!incidents.length) {
    wrap.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, icon('shield-check')), h('h3', {}, 'No incidents yet'), h('p', { class: 'subtle' }, 'When sensitive data is caught, a record appears here.')));
    return;
  }
  const table = h('table', { class: 'table incident-table' },
    h('thead', {}, h('tr', {},
      h('th', { 'data-sort': 'timestamp' }, 'When'), h('th', { 'data-sort': 'domain' }, 'Site'), h('th', { 'data-sort': 'channel' }, 'Channel'),
      h('th', { 'data-sort': 'rules' }, 'Detected'), h('th', { 'data-sort': 'action' }, 'Action'), h('th', { 'data-sort': 'decision' }, 'Decision'), h('th', {}, 'Reason'))),
    h('tbody', {}, list.slice(0, 500).map((i) => h('tr', {},
      h('td', { class: 'nowrap', title: formatDateTime(i.timestamp) }, relativeTime(i.timestamp)),
      h('td', { class: 'mono' }, i.domain, i.highRisk ? h('span', { class: 'badge warning', style: { marginLeft: '6px' } }, 'high-risk') : null),
      h('td', {}, channelLabel(i.channel)),
      h('td', { class: 'rules' }, incidentRules(i)),
      h('td', {}, actionBadge(i.action)),
      h('td', {}, decisionBadge(i.decision)),
      h('td', { class: 'why' }, i.justification || h('span', { class: 'subtle' }, '—'))))));
  sortableHeaders(table, (key, dir) => { sortState = { key, dir }; renderIncidents(); }, sortState);
  const th = table.querySelector(`th[data-sort="${sortState.key}"]`);
  th?.setAttribute('aria-sort', sortState.dir === 'asc' ? 'ascending' : 'descending');
  wrap.replaceChildren(list.length ? h('div', { class: 'table-wrap', style: { maxHeight: '520px' } }, table) : h('div', { class: 'empty compact' }, h('p', {}, 'No incidents match the filter.')));
}
$('#inc-search').addEventListener('input', debounce(renderIncidents, 120));
$('#inc-decision').addEventListener('change', renderIncidents);
$('#inc-export').addEventListener('click', () => {
  const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [['timestamp', 'domain', 'channel', 'detections', 'action', 'decision', 'justification', 'highRisk']]
    .concat(filteredIncidents().map((i) => [i.timestamp, i.domain, i.channel, incidentRules(i), i.action, i.decision, i.justification, i.highRisk ? 'yes' : 'no']));
  downloadFile(`dlp-incidents-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((r) => r.map(cell).join(',')).join('\n'), 'text/csv');
});
$('#inc-clear').addEventListener('click', async () => {
  if (!(await confirmDialog({ title: 'Clear the incident log?', message: 'All incidents stored on this device are removed. Reports already sent to your server are not affected.', confirmLabel: 'Clear log', tone: 'danger' }))) return;
  await send('clearIncidents');
  loadIncidents();
});

// ---------------------------------------------------------------------------
// Collectors, validation, standard panels
// ---------------------------------------------------------------------------
ctx.registerCollector(() => {
  const patch = {};
  const actions = {};
  for (const [id, a] of Object.entries(draft.ruleActions)) if (!ctx.isLocked(`ruleActions.${id}`)) actions[id] = a;
  if (!ctx.isLocked('ruleActions')) patch.ruleActions = { ...ctx.settings.ruleActions, ...actions };
  for (const k of ['customRules', 'trustedSites', 'highRiskSites']) if (!ctx.isLocked(k)) patch[k] = draft[k];
  return patch;
});
ctx.registerValidator((patch) => {
  const bad = (patch.customRules || []).find((r) => !D.compileCustom(r).ok);
  if (bad) return `Custom rule "${bad.name}" has an invalid pattern`;
  if (patch.reportingEndpoint && !/^https?:\/\/[^\s]+$/i.test(patch.reportingEndpoint)) return 'Reporting endpoint must be an http(s) URL';
  if (patch.reportingHeaders != null && (typeof patch.reportingHeaders !== 'object' || Array.isArray(patch.reportingHeaders))) return 'Extra headers must be a JSON object';
  return null;
});
ctx.onSaved(() => { renderReportStatus(); });
ctx.onChange(() => { loadDraft(); renderAll(); });

function renderAll() {
  renderStatus();
  renderRuleTable();
  renderCustomRules();
  renderSiteEditors();
  runLab();
  runUrlTest();
  renderReportStatus();
}
renderAll();
loadIncidents();
setInterval(() => { if (!document.hidden) loadIncidents(); }, 15000);

mountBrandingPanel($('#branding-panel'), ctx);
mountBackupPanel($('#backup-panel'), ctx, { slug: 'dlp-guard', secretKeys: ['reportingHeaders', 'userEmail'] });
await mountAboutPanel($('#about-panel'), ctx, {
  description: `${PRODUCT} checks what you paste, drop, upload or send into websites for card numbers, national ID numbers, secrets, confidential markers and your organization's own patterns, and warns or blocks before it reaches unapproved destinations.`,
  privacy: 'All scanning happens inside your browser. The content you paste, drop or upload is never stored and never transmitted: not to your organization, not to the extension developer, not to anyone. The incident log keeps only the rule names, how many matches, the website\'s hostname (no path), the channel, the time and your decision. If your organization configures reporting, only those same fields are sent.',
});
$('#about-panel .card')?.append(h('div', { class: 'privacy-points' },
  h('div', { class: 'pp' }, icon('lock'), h('div', {}, h('strong', {}, 'Scanned locally'), 'Detection runs on your device, in the page you are using.')),
  h('div', { class: 'pp' }, icon('eye-off'), h('div', {}, h('strong', {}, 'Content never kept'), 'Warnings show masked samples such as •••• 4242; nothing is saved.')),
  h('div', { class: 'pp' }, icon('list'), h('div', {}, h('strong', {}, 'Minimal records'), 'Only rule names, counts, hostname, channel and decision.'))));
initSideNav();

