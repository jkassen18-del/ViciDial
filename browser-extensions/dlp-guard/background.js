// Data Leak Guard background service worker.
// - answers content scripts with the effective policy for their page
// - keeps the local incident log (no matched content, ever) and the toolbar badge
// - optionally forwards incidents to a reporting endpoint, batched with retries
import { api, extVersion, uuid } from './shared/browser.js';
import { loadSettings, onSettingsChanged, dataStore, getInstallId, fetchWithTimeout } from './shared/config.js';
import { brandForContent } from './shared/brand.js';
import { handleMessages } from './shared/messaging.js';
import { hostOf } from './shared/domain.js';
import { DEFAULTS, PRODUCT } from './defaults.js';
import { siteStatus, ruleActionsFor, detectorConfig } from './policy.js';

const MAX_INCIDENTS = 500;
const MAX_QUEUE = 1000;
const BATCH = 100;
const REPORT_ALARM = 'dlp-report';
const BADGE_ALARM = 'dlp-badge';
const CHANNELS = ['paste', 'drop', 'upload', 'submit'];
const DECISIONS = new Set(['cancelled', 'proceeded', 'blocked', 'logged']);

// ---------------------------------------------------------------------------
// Settings + brand cache (rebuilt after a service-worker restart)
// ---------------------------------------------------------------------------
let settingsPromise = null;
let brandCache = { key: '', value: null };
const getSettings = () => (settingsPromise ??= loadSettings(DEFAULTS).then((l) => l.values));

async function contentBrand(brand) {
  const key = JSON.stringify(brand || {});
  if (brandCache.key !== key || !brandCache.value) brandCache = { key, value: await brandForContent(brand) };
  return brandCache.value;
}

async function snoozes() {
  const all = await dataStore.get('snoozes', {});
  const now = Date.now();
  let changed = false;
  for (const [d, until] of Object.entries(all)) if (until <= now) { delete all[d]; changed = true; }
  if (changed) await dataStore.set('snoozes', all);
  return all;
}

async function policyFor(url) {
  const s = await getSettings();
  const sn = await snoozes();
  const status = siteStatus(s, url, { snoozedUntil: sn[hostOf(url)] || 0 });
  const actions = ruleActionsFor(s, status.isHighRisk);
  const channels = Object.fromEntries(CHANNELS.map((c) => [c, !!(s.channels?.[c] ?? DEFAULTS.channels[c])]));
  // Typed-text scanning (submit / Enter) only on high-risk destinations, to avoid noise elsewhere.
  if (!status.isHighRisk) channels.submit = false;
  return {
    ...status,
    product: PRODUCT,
    actions,
    detector: detectorConfig(s, actions),
    customRuleMeta: Object.fromEntries((s.customRules || []).map((r) => [`custom:${r.id}`, { name: r.name, description: r.description || '' }])),
    channels,
    requireJustification: !!s.requireJustification,
    maxFileBytes: Math.max(0.1, Number(s.maxFileSizeMB) || 5) * 1024 * 1024,
    fileUploadPolicy: status.isHighRisk ? (s.blockFileUploadsOnHighRisk || 'off') : 'off',
    allowSnooze: !!s.allowSnooze,
    snoozeMinutes: Math.max(1, Number(s.snoozeMinutes) || 15),
  };
}

// ---------------------------------------------------------------------------
// Incidents, stats and badge
// ---------------------------------------------------------------------------
const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

function summarize(incidents) {
  const today = dayKey();
  const s = { total: 0, warned: 0, blocked: 0, cancelled: 0, proceeded: 0, logged: 0 };
  for (const i of incidents) {
    if (dayKey(i.timestamp) !== today) continue;
    s.total++;
    if (i.decision === 'logged') s.logged++;
    else if (i.action === 'block' || i.decision === 'blocked') s.blocked++;
    else s.warned++;
    if (i.decision === 'cancelled') s.cancelled++;
    if (i.decision === 'proceeded') s.proceeded++;
  }
  return s;
}

async function refreshBadge() {
  const incidents = await dataStore.get('incidents', []);
  const s = summarize(incidents);
  const visible = s.warned + s.blocked;
  try {
    await api.action.setBadgeText({ text: visible ? String(Math.min(visible, 999)) : '' });
    await api.action.setBadgeBackgroundColor({ color: s.blocked ? '#DC2626' : '#D97706' });
    api.action.setBadgeTextColor?.({ color: '#FFFFFF' });
    await api.action.setTitle({ title: `${PRODUCT} · ${visible ? `${visible} alert${visible === 1 ? '' : 's'} today` : 'Protecting your data'}` });
  } catch { /* action API unavailable (tests) */ }
}

function sanitizeIncident(data, sender) {
  const pageUrl = data.url && /^https?:/i.test(data.url) ? data.url : sender?.tab?.url || sender?.url || '';
  const decision = DECISIONS.has(data.decision) ? data.decision : 'logged';
  return {
    id: uuid(),
    timestamp: new Date().toISOString(),
    domain: hostOf(pageUrl) || 'unknown',
    channel: CHANNELS.includes(data.channel) ? data.channel : 'paste',
    detections: (Array.isArray(data.detections) ? data.detections : []).slice(0, 30).map((d) => ({
      ruleId: String(d.ruleId || '').slice(0, 80),
      ruleName: String(d.ruleName || '').slice(0, 120),
      count: Math.max(1, Math.min(100000, Number(d.count) || 1)),
    })),
    action: ['log', 'warn', 'block'].includes(data.action) ? data.action : 'log',
    decision,
    justification: decision === 'proceeded' && data.justification ? String(data.justification).slice(0, 500) : '',
    highRisk: !!data.highRisk,
  };
}

async function recordIncident(incident) {
  await dataStore.update('incidents', [], (list) => [incident, ...list].slice(0, MAX_INCIDENTS));
  await refreshBadge();
  const s = await getSettings();
  if (s.reportingEndpoint) {
    await dataStore.update('reportQueue', [], (q) => [...q, incident].slice(-MAX_QUEUE));
    flushReports().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
let flushing = null;
function flushReports(force = false) { return (flushing ??= doFlush(force).finally(() => { flushing = null; })); }

async function buildPayload(events) {
  const s = await getSettings();
  const payload = {
    source: 'dlp-guard',
    installId: await getInstallId(),
    extensionVersion: extVersion(),
    department: s.department || '',
    events,
  };
  if (s.includeUserEmail && s.userEmail) payload.userEmail = s.userEmail;
  return payload;
}

async function post(endpoint, headers, payload) {
  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: JSON.stringify(payload),
  }, 15000);
  if (!res.ok) throw new Error(`Server answered ${res.status} ${res.statusText || ''}`.trim());
}

async function doFlush(force) {
  const s = await getSettings();
  const state = await dataStore.get('reportState', {});
  if (!s.reportingEndpoint) return state;
  if (!force && state.nextAttempt && Date.now() < state.nextAttempt) return state;
  let queue = await dataStore.get('reportQueue', []);
  while (queue.length) {
    const batch = queue.slice(0, BATCH);
    try {
      await post(s.reportingEndpoint, s.reportingHeaders, await buildPayload(batch));
    } catch (err) {
      const failures = (state.failures || 0) + 1;
      const delayMin = Math.min(60, 2 ** Math.min(failures - 1, 6)); // 1, 2, 4 … 60 minutes
      const next = { ...state, failures, lastError: String(err.message || err), lastErrorAt: new Date().toISOString(), nextAttempt: Date.now() + delayMin * 60000 };
      await dataStore.set('reportState', next);
      return next;
    }
    const sentIds = new Set(batch.map((e) => e.id));
    queue = await dataStore.update('reportQueue', [], (q) => q.filter((e) => !sentIds.has(e.id)));
    Object.assign(state, { failures: 0, lastError: '', nextAttempt: 0, lastSuccessAt: new Date().toISOString(), sent: (state.sent || 0) + batch.length });
    await dataStore.set('reportState', state);
  }
  return state;
}

// ---------------------------------------------------------------------------
// Broadcast policy changes to open tabs (all frames)
// ---------------------------------------------------------------------------
async function broadcast() {
  let tabs = [];
  try { tabs = await api.tabs.query({}); } catch { return; }
  for (const t of tabs) {
    if (t.id == null || t.id < 0) continue;
    try { api.tabs.sendMessage(t.id, { type: 'dlp:policyChanged' })?.catch?.(() => {}); } catch { /* no content script */ }
  }
}

// ---------------------------------------------------------------------------
// Listeners (registered synchronously at top level)
// ---------------------------------------------------------------------------
onSettingsChanged(() => {
  settingsPromise = null;
  broadcast();
  getSettings().then((s) => { if (s.reportingEndpoint) flushReports().catch(() => {}); });
});

api.runtime.onInstalled.addListener(() => { refreshBadge(); });
api.runtime.onStartup?.addListener(() => { refreshBadge(); });
api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REPORT_ALARM) flushReports().catch(() => {});
  if (alarm.name === BADGE_ALARM) refreshBadge();
});
(async () => {
  try {
    if (!(await api.alarms.get(REPORT_ALARM))) api.alarms.create(REPORT_ALARM, { periodInMinutes: 1 });
    if (!(await api.alarms.get(BADGE_ALARM))) api.alarms.create(BADGE_ALARM, { periodInMinutes: 30 });
  } catch { /* ignore */ }
})();

handleMessages({
  async getPolicy({ url }, sender) {
    const pageUrl = url && /^(https?|file):/i.test(url) ? url : sender?.tab?.url || url || '';
    const [p, s] = await Promise.all([policyFor(pageUrl), getSettings()]);
    return { ...p, brand: await contentBrand(s.brand) };
  },

  async logIncident(data, sender) {
    const incident = sanitizeIncident(data || {}, sender);
    await recordIncident(incident);
    return { id: incident.id };
  },

  async getPopupData({ url }) {
    const s = await getSettings();
    const incidents = await dataStore.get('incidents', []);
    const status = url ? await policyFor(url) : null;
    return {
      status,
      today: summarize(incidents),
      recent: incidents.slice(0, 6),
      channels: s.channels,
      enabled: s.enabled !== false,
      allowUserDisable: !!s.allowUserDisable,
      allowSnooze: !!s.allowSnooze,
      snoozeMinutes: Math.max(1, Number(s.snoozeMinutes) || 15),
      reporting: !!s.reportingEndpoint,
    };
  },

  async getIncidents() { return dataStore.get('incidents', []); },

  async clearIncidents() {
    await dataStore.set('incidents', []);
    await refreshBadge();
    return true;
  },

  async snooze({ domain, minutes }) {
    const s = await getSettings();
    if (!s.allowSnooze) throw new Error('Snoozing is not allowed by your organization');
    const mins = Math.max(1, Math.min(240, Number(minutes) || Number(s.snoozeMinutes) || 15));
    const until = Date.now() + mins * 60000;
    await dataStore.update('snoozes', {}, (all) => ({ ...all, [String(domain).toLowerCase()]: until }));
    broadcast();
    return { until };
  },

  async unsnooze({ domain }) {
    await dataStore.update('snoozes', {}, (all) => { delete all[String(domain).toLowerCase()]; return all; });
    broadcast();
    return true;
  },

  async getReportStatus() {
    const [state, queue] = await Promise.all([dataStore.get('reportState', {}), dataStore.get('reportQueue', [])]);
    return { ...state, queued: queue.length };
  },

  async flushReports() { return { ...(await flushReports(true)), queued: (await dataStore.get('reportQueue', [])).length }; },

  async sendTestReport() {
    const s = await getSettings();
    if (!s.reportingEndpoint) throw new Error('Set a reporting endpoint first');
    const event = {
      id: uuid(), timestamp: new Date().toISOString(), domain: 'test.data-leak-guard.local', channel: 'paste',
      detections: [{ ruleId: 'card', ruleName: 'Payment card number', count: 1 }], action: 'warn', decision: 'cancelled',
      justification: '', test: true,
    };
    await post(s.reportingEndpoint, s.reportingHeaders, await buildPayload([event]));
    return { ok: true };
  },
});

refreshBadge();
