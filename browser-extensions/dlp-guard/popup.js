import { api, openOptions } from './shared/browser.js';
import { initPage } from './shared/page.js';
import { send } from './shared/messaging.js';
import { h, icon, $, relativeTime, debounce } from './shared/ui.js';
import { DEFAULTS, PRODUCT, CHANNEL_LABELS } from './defaults.js';
import { ruleActionsFor, detectorConfig, overallAction } from './policy.js';
import { decisionBadge, incidentRules, detectionList, CHANNEL_ICON, actionBadge } from './dlp-ui.js';

const settingsBtn = h('button', { class: 'btn ghost icon sm', type: 'button', title: 'Settings', 'aria-label': 'Open settings', onclick: () => { openOptions(); window.close(); } }, icon('settings'));
const ctx = await initPage({ defaults: DEFAULTS, title: PRODUCT, headerActions: [settingsBtn] });

let tab = null;
try { [tab] = await api.tabs.query({ active: true, currentWindow: true }); } catch { /* no tabs API */ }
const tabUrl = tab?.url && /^(https?|file):/i.test(tab.url) ? tab.url : '';

let last = null;
async function refresh() {
  let data;
  try { data = await send('getPopupData', { url: tabUrl }); } catch (err) {
    $('#site-card').replaceWith(h('div', { class: 'callout danger', id: 'site-card' }, icon('alert'), h('div', {}, `Could not load status: ${err.message}`)));
    return;
  }
  last = data;
  renderSite(data);
  renderWatching(data);
  renderStats(data);
  renderRecent(data);
}

// ---------------------------------------------------------------------------
function renderSite(data) {
  const st = data.status;
  let tone, ic, title, text;
  if (!st || st.reason === 'restricted') {
    tone = 'neutral'; ic = 'globe'; title = 'No website open';
    text = 'Open a website to see whether it is protected. Protection works in every tab automatically.';
  } else if (st.reason === 'trusted') {
    tone = 'trusted'; ic = 'building'; title = 'Trusted site — not scanned';
    text = 'This is an approved company destination, so pastes and uploads are not checked here.';
  } else if (st.reason === 'not-listed') {
    tone = 'neutral'; ic = 'globe'; title = 'Not monitored';
    text = 'Your organization only protects listed high-risk destinations, and this site is not one of them.';
  } else if (st.reason === 'disabled') {
    tone = 'off'; ic = 'power'; title = 'Protection is off';
    text = 'You switched protection off. Sensitive data is not being checked on any site.';
  } else if (st.reason === 'snoozed') {
    tone = 'off'; ic = 'clock'; title = 'Paused on this site';
    text = `Protection resumes ${relativeTime(st.snoozedUntil)}.`;
  } else if (st.isHighRisk) {
    tone = 'risk'; ic = 'shield-alert'; title = 'High-risk destination';
    text = 'Public AI tools, personal e-mail and file-sharing sites get the strictest checks. Sensitive data may be blocked.';
  } else {
    tone = 'ok'; ic = 'shield-check'; title = 'Protected';
    text = 'Pastes and uploads on this site are checked for sensitive data before they reach the page.';
  }

  const actions = [];
  if (st && data.allowSnooze && st.reason !== 'restricted' && st.reason !== 'trusted' && st.reason !== 'not-listed' && st.reason !== 'disabled') {
    actions.push(st.reason === 'snoozed'
      ? h('button', { class: 'btn sm soft', type: 'button', onclick: async () => { await send('unsnooze', { domain: st.domain }); refresh(); } }, icon('refresh'), 'Resume now')
      : h('button', { class: 'btn sm', type: 'button', onclick: async () => { await send('snooze', { domain: st.domain, minutes: data.snoozeMinutes }); refresh(); } }, icon('clock'), `Pause ${data.snoozeMinutes} min`));
  }
  if (data.allowUserDisable) {
    const input = h('input', { type: 'checkbox', checked: data.enabled, 'aria-label': 'Protection enabled', onchange: async (e) => { await ctx.save({ enabled: e.target.checked }); setTimeout(refresh, 150); } });
    actions.push(h('label', { class: 'switch small-switch', title: 'Protection on/off' }, input, h('span', { class: 'track' }), h('span', { class: 'subtle' }, data.enabled ? 'On' : 'Off')));
  }

  const card = h('section', { class: `site-card tone-${tone}`, id: 'site-card', 'aria-live': 'polite' },
    h('div', { class: 'site-icon' }, icon(ic)),
    h('div', { class: 'grow' },
      h('div', { class: 'row between top' },
        h('div', { class: 'grow' },
          h('div', { class: 'site-title' }, title),
          st?.domain && st.reason !== 'restricted' ? h('div', { class: 'site-domain truncate' }, st.domain) : null)),
      h('p', { class: 'site-text' }, text),
      actions.length ? h('div', { class: 'row wrap mt-8' }, actions) : null));
  $('#site-card').replaceWith(card);
}

function renderWatching(data) {
  const st = data.status;
  const active = st?.active;
  const ch = st?.channels || data.channels || {};
  const chips = Object.keys(CHANNEL_LABELS).map((k) => {
    let on = active ? !!ch[k] : !!data.channels?.[k];
    let hint = on ? 'Watched' : 'Not watched';
    if (k === 'submit' && data.channels?.submit && !st?.isHighRisk) { on = false; hint = 'Watched on high-risk sites only'; }
    const dim = st && !active && st.reason !== 'restricted';
    return h('span', { class: `watch-chip${on && !dim ? ' on' : ''}`, title: hint }, icon(CHANNEL_ICON[k]), CHANNEL_LABELS[k]);
  });
  $('#watching').replaceChildren(
    h('div', { class: 'section-label' }, active ? 'Watching on this site' : 'Watched channels'),
    h('div', { class: 'chip-list' }, chips));
}

function renderStats(data) {
  const t = data.today;
  const stat = (label, value, tone) => h('div', { class: `mini-stat ${tone}` }, h('div', { class: 'v' }, String(value)), h('div', { class: 'l' }, label));
  $('#stats').replaceChildren(
    h('div', { class: 'section-label' }, 'Today'),
    h('div', { class: 'mini-stats' },
      stat('Warnings', t.warned, t.warned ? 'warning' : ''),
      stat('Blocked', t.blocked, t.blocked ? 'danger' : ''),
      stat('Cancelled', t.cancelled, t.cancelled ? 'success' : '')));
}

function renderRecent(data) {
  const list = data.recent.filter((i) => i.decision !== 'logged').slice(0, 4);
  const body = list.length
    ? h('div', { class: 'list recent-list' }, list.map((i) => h('div', { class: 'list-item static', title: new Date(i.timestamp).toLocaleString() },
      h('span', { class: `li-icon dec-${i.decision}` }, icon(CHANNEL_ICON[i.channel] || 'shield')),
      h('div', { class: 'li-main' },
        h('div', { class: 'li-title' }, incidentRules(i)),
        h('div', { class: 'li-sub' }, `${i.domain} · ${relativeTime(i.timestamp)}`)),
      decisionBadge(i.decision))))
    : h('div', { class: 'empty compact' },
      h('div', { class: 'empty-icon' }, icon('shield-check')),
      h('h3', {}, 'No alerts yet'),
      h('p', { class: 'subtle' }, 'You will see a note here whenever sensitive data is caught.'));
  $('#recent').replaceChildren(
    h('div', { class: 'section-label row between' }, h('span', {}, 'Recent alerts'),
      data.recent.length ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); api.tabs.create({ url: api.runtime.getURL('options.html#incidents') }); window.close(); } }, 'View all') : null),
    body);
}

// ---------------------------------------------------------------------------
function renderTester(isHighRisk) {
  const result = h('div', { class: 'test-result', 'aria-live': 'polite' });
  const ta = h('textarea', { class: 'textarea tester-input', rows: 3, placeholder: 'Paste text here to see what would be detected…', spellcheck: false });
  const run = () => {
    const text = ta.value;
    if (!text.trim()) { result.replaceChildren(); return; }
    const actions = ruleActionsFor(ctx.settings, isHighRisk);
    const dets = globalThis.DLPDetectors.scan(text, detectorConfig(ctx.settings, actions));
    if (!dets.length) {
      result.replaceChildren(h('div', { class: 'callout success' }, icon('check'), h('div', {}, 'Nothing sensitive found.')));
      return;
    }
    const a = overallAction(dets, actions);
    result.replaceChildren(
      h('div', { class: 'row between mt-8' }, h('strong', {}, `${dets.length} finding${dets.length === 1 ? '' : 's'}`), h('span', { class: 'row gap-4 subtle' }, 'Result here:', actionBadge(a))),
      detectionList(dets, actions));
  };
  ta.addEventListener('input', debounce(run, 150));
  $('#tester').replaceChildren(
    h('details', { class: 'tester' },
      h('summary', {}, icon('zap'), h('span', { class: 'grow' }, 'Test detection'), icon('chevron-down', { class: 'chev' })),
      h('div', { class: 'tester-body' },
        ta,
        h('div', { class: 'subtle row gap-4' }, icon('lock', { size: 12 }), 'Checked right here in your browser. Nothing is sent or saved.'),
        result)));
}

await refresh();
renderTester(!!last?.status?.isHighRisk);
ctx.onChange(refresh);
