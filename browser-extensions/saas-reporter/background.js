// SaaS Usage Reporter: background service worker.
//
// Records which SaaS apps are used, by domain only, as daily aggregates:
//   data:usage:YYYY-MM-DD -> { [appDomain]: { visits, activeSeconds } }
//   data:lastSeen         -> { [appDomain]: 'YYYY-MM-DD' }
// The service worker can be stopped at any time, so the "current focus"
// segment lives in storage.session and every listener is registered at the
// top level.

import { api, IS_FIREFOX, extVersion } from './shared/browser.js';
import { loadSettings, onSettingsChanged, dataStore, getInstallId, fetchWithTimeout } from './shared/config.js';
import { brandForContent, normalizeBrand } from './shared/brand.js';
import { handleMessages } from './shared/messaging.js';
import { DEFAULTS, PRODUCT } from './defaults.js';
import {
  createMatcher, webHost, dayKey, lastDays, splitByDay, addUsage, expiredDays, pruneLastSeen,
  buildReport, nextReportDue, demoDays,
} from './logic.js';

const SESSION_GAP_MS = 30 * 60000;   // navigations within 30 min in the same tab+app = one visit
const MAX_FLUSH_MS = 3 * 60000;      // never credit more than this between two flushes
const USAGE_PREFIX = 'data:usage:';  // dataStore key prefix used for day buckets

// ---------------------------------------------------------------------------
// Settings cache
// ---------------------------------------------------------------------------
let settingsPromise = null;
function getConfig() {
  settingsPromise ??= loadSettings(DEFAULTS).then((loaded) => ({ settings: loaded.values, matcher: createMatcher(loaded.values) }));
  return settingsPromise;
}

// ---------------------------------------------------------------------------
// Session state (survives service-worker restarts, cleared when the browser closes)
// ---------------------------------------------------------------------------
const memSession = {};
const sessionArea = api.storage.session;
async function sget(key, fallback) {
  if (!sessionArea) return memSession[key] ?? fallback;
  try { return (await sessionArea.get(key))[key] ?? fallback; } catch { return memSession[key] ?? fallback; }
}
async function sset(obj) {
  Object.assign(memSession, obj);
  if (sessionArea) try { await sessionArea.set(obj); } catch { /* memory fallback */ }
}

// One operation at a time, so concurrent events cannot lose updates.
let chain = Promise.resolve();
function serial(fn) {
  const p = chain.then(fn);
  chain = p.catch((err) => console.warn('[saas-reporter]', err));
  return p;
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------
async function record(day, domain, usage) {
  const key = USAGE_PREFIX + day;
  const got = await api.storage.local.get([key, 'data:lastSeen']);
  const bucket = addUsage(got[key] || {}, domain, usage);
  const lastSeen = got['data:lastSeen'] || {};
  if (!lastSeen[domain] || lastSeen[domain] < day) lastSeen[domain] = day;
  await api.storage.local.set({ [key]: bucket, 'data:lastSeen': lastSeen });
}

/** Credits the time since the last flush to the app in focus. */
async function flush(now = Date.now()) {
  const f = await sget('focus', null);
  if (!f?.domain) return;
  const end = Math.min(now, f.lastFlush + MAX_FLUSH_MS);
  for (const chunk of splitByDay(f.lastFlush, end)) {
    if (chunk.seconds >= 0.5) await record(chunk.day, f.domain, { seconds: chunk.seconds });
  }
  await sset({ focus: { ...f, lastFlush: now } });
}

async function activeTab(windowId) {
  try {
    const q = windowId != null && windowId >= 0 ? { active: true, windowId } : { active: true, lastFocusedWindow: true };
    const [tab] = await api.tabs.query(q);
    return tab || null;
  } catch { return null; }
}

/** Flushes the running segment and starts a new one for whatever is in focus now. */
async function recompute(now = Date.now()) {
  await flush(now);
  const { settings, matcher } = await getConfig();
  const win = await sget('window', { focused: true, id: null });
  const idle = await sget('idle', 'active');
  const prev = await sget('focus', null);
  let next = null;
  if (settings.trackingEnabled && win.focused && idle === 'active') {
    const tab = await activeTab(win.id);
    if (tab && !tab.incognito) {
      const app = matcher.resolve(webHost(tab.url || tab.pendingUrl || ''));
      if (app) {
        const same = prev && prev.tabId === tab.id && prev.domain === app.domain;
        next = { tabId: tab.id, windowId: tab.windowId, domain: app.domain, since: same ? prev.since : now, lastFlush: now };
      }
    }
  }
  await sset({ focus: next });
}

async function onCommitted(d) {
  if (d.frameId !== 0 || d.tabId < 0 || d.documentLifecycle === 'prerender') return;
  const now = Date.now();
  const { settings, matcher } = await getConfig();
  if (!settings.trackingEnabled) return;
  let tab = null;
  try { tab = await api.tabs.get(d.tabId); } catch { /* tab gone */ }
  if (tab?.incognito) return;
  const host = webHost(d.url);
  const app = matcher.resolve(host);
  const visits = await sget('visitTabs', {});
  if (app) {
    const prev = visits[d.tabId];
    const isNewVisit = !(prev && prev.domain === app.domain && now - prev.at < SESSION_GAP_MS);
    visits[d.tabId] = { domain: app.domain, at: now };
    await sset({ visitTabs: visits });
    if (isNewVisit) {
      await record(dayKey(now), app.domain, { visits: 1 });
      if (app.status === 'unsanctioned') maybeNotify(d.tabId, d.url, app, settings, matcher).catch((e) => console.warn('[saas-reporter] notice', e));
    }
  } else if (visits[d.tabId]) {
    delete visits[d.tabId];
    await sset({ visitTabs: visits });
  }
  if (tab?.active) await recompute(now);
}

// ---------------------------------------------------------------------------
// Unsanctioned app notice
// ---------------------------------------------------------------------------
async function maybeNotify(tabId, url, app, settings, matcher) {
  if (settings.notifyOnUnsanctioned !== 'notice') return;
  const today = dayKey();
  const shown = await dataStore.get('noticesShown', {});
  if (shown[app.domain] === today) return;
  for (const k of Object.keys(shown)) if (shown[k] !== today) delete shown[k];
  shown[app.domain] = today;
  await dataStore.set('noticesShown', shown);

  const brand = normalizeBrand(settings.brand);
  const alt = matcher.alternativeFor(app.domain, webHost(url));
  const data = {
    appName: app.name,
    company: brand.companyName,
    product: PRODUCT,
    alternative: alt,
    learnMoreUrl: settings.noticeLearnMoreUrl || brand.supportUrl || '',
  };

  let origin = '';
  try { origin = `${new URL(url).origin}/*`; } catch { /* ignore */ }
  let canInject = false;
  try { canInject = !!origin && await api.permissions.contains({ origins: [origin] }); } catch { /* no */ }
  if (canInject) {
    try {
      await api.scripting.executeScript({ target: { tabId }, files: ['shared/content-ui.js', 'notice.js'] });
      const content = await brandForContent(settings.brand);
      await api.scripting.executeScript({ target: { tabId }, func: (d, b) => globalThis.__saasNotice?.(d, b), args: [data, content] });
      return;
    } catch (err) {
      console.warn('[saas-reporter] banner injection failed, falling back to a notification', err);
    }
  }
  await showNotification(data);
}

async function showNotification(data) {
  const alt = data.alternative;
  const id = `saas-${Date.now()}`;
  const opts = {
    type: 'basic',
    iconUrl: api.runtime.getURL('icons/icon-128.png'),
    title: `${data.appName} isn't approved by ${data.company}`,
    message: alt?.name ? `Try ${alt.name} instead.` : `Please use a company-approved tool instead.`,
    contextMessage: `${data.company} · ${data.product}`,
  };
  if (!IS_FIREFOX && (alt?.url || data.learnMoreUrl)) opts.buttons = [{ title: alt?.url ? `Open ${alt.name || 'alternative'}` : 'Learn more' }];
  if (IS_FIREFOX) delete opts.contextMessage;
  const urls = await sget('notifUrls', {});
  urls[id] = alt?.url || data.learnMoreUrl || '';
  await sset({ notifUrls: urls });
  await api.notifications.create(id, opts);
}

async function openNotificationTarget(id) {
  const urls = await sget('notifUrls', {});
  const url = urls[id];
  delete urls[id];
  await sset({ notifUrls: urls });
  if (url && /^https?:/i.test(url)) await api.tabs.create({ url });
  api.notifications.clear(id);
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------
async function getDays(n) {
  const keys = lastDays(n).map((d) => USAGE_PREFIX + d);
  const got = await api.storage.local.get(keys);
  const days = {};
  for (const k of keys) if (got[k]) days[k.slice(USAGE_PREFIX.length)] = got[k];
  return days;
}

async function allUsageKeys() {
  const all = await api.storage.local.get(null);
  return Object.keys(all).filter((k) => k.startsWith(USAGE_PREFIX));
}

async function prune() {
  const { settings } = await getConfig();
  const retention = Math.max(1, Number(settings.retentionDays) || DEFAULTS.retentionDays);
  const keys = await allUsageKeys();
  const expired = expiredDays(keys.map((k) => k.slice(USAGE_PREFIX.length)), retention);
  if (expired.length) await api.storage.local.remove(expired.map((d) => USAGE_PREFIX + d));
  const lastSeen = await dataStore.get('lastSeen', {});
  await dataStore.set('lastSeen', pruneLastSeen(lastSeen, retention));
  return expired.length;
}

async function clearData() {
  const keys = await allUsageKeys();
  await api.storage.local.remove([...keys, 'data:lastSeen', 'data:noticesShown', 'data:demo']);
  await sset({ visitTabs: {} });
  const f = await sget('focus', null);
  if (f) await sset({ focus: { ...f, lastFlush: Date.now() } });
}

async function loadDemo() {
  await clearData();
  const days = demoDays(45);
  const lastSeen = {};
  const set = { 'data:demo': true };
  for (const [day, bucket] of Object.entries(days)) {
    set[USAGE_PREFIX + day] = bucket;
    for (const d of Object.keys(bucket)) if (!lastSeen[d] || lastSeen[d] < day) lastSeen[d] = day;
  }
  set['data:lastSeen'] = lastSeen;
  await api.storage.local.set(set);
  return Object.keys(days).length;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
function cleanHeaders(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) if (k && v != null && typeof v !== 'object') out[k] = String(v);
  return out;
}

async function sendReport({ manual = false } = {}) {
  const { settings, matcher } = await getConfig();
  if (!settings.reportingEnabled) throw new Error('Reporting is turned off');
  if (!settings.reportEndpoint) throw new Error('No report endpoint is configured');
  await flush();
  const periodDays = Math.max(1, Math.min(Number(settings.reportPeriodDays) || 30, Number(settings.retentionDays) || 90));
  const range = lastDays(periodDays);
  const payload = buildReport({
    days: await getDays(periodDays),
    settings, matcher,
    installId: await getInstallId(),
    extensionVersion: extVersion(),
    from: range[0], to: range.at(-1),
  });
  const state = await dataStore.get('reportState', {});
  state.lastAttemptAt = Date.now();
  try {
    const res = await fetchWithTimeout(settings.reportEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cleanHeaders(settings.reportHeaders) },
      body: JSON.stringify(payload),
    }, 20000);
    if (!res.ok) throw new Error(`Server answered ${res.status} ${res.statusText || ''}`.trim());
    state.lastSuccessAt = state.lastAttemptAt;
    state.failures = 0;
    state.lastResult = { ok: true, at: state.lastAttemptAt, apps: payload.apps.length, status: res.status, manual };
    await dataStore.set('reportState', state);
    return state.lastResult;
  } catch (err) {
    state.failures = (state.failures || 0) + 1;
    state.lastResult = { ok: false, at: state.lastAttemptAt, error: String(err.message || err), manual };
    await dataStore.set('reportState', state);
    throw err;
  }
}

async function reportIfDue() {
  const { settings } = await getConfig();
  if (!settings.reportingEnabled || !settings.reportEndpoint) return;
  const state = await dataStore.get('reportState', {});
  if (Date.now() < nextReportDue(state, Number(settings.reportIntervalHours) || 24)) return;
  try { await sendReport(); } catch (err) { console.warn('[saas-reporter] report failed:', err.message); }
}

// ---------------------------------------------------------------------------
// Alarms & idle
// ---------------------------------------------------------------------------
async function ensureAlarms() {
  const want = { flush: 1, report: 15, prune: 720 };
  for (const [name, period] of Object.entries(want)) {
    const existing = await api.alarms.get(name);
    if (!existing || existing.periodInMinutes !== period) api.alarms.create(name, { periodInMinutes: period, delayInMinutes: name === 'flush' ? 1 : 2 });
  }
}

async function applyIdleSettings() {
  const { settings } = await getConfig();
  const secs = Math.max(15, Math.round(Number(settings.idleSeconds) || 60));
  try { api.idle.setDetectionInterval(secs); } catch { /* ignore */ }
  try { await sset({ idle: await api.idle.queryState(secs) }); } catch { /* ignore */ }
}

async function init() {
  await ensureAlarms();
  await applyIdleSettings();
  const state = await dataStore.get('reportState', {});
  if (!state.firstSeenAt) await dataStore.set('reportState', { ...state, firstSeenAt: Date.now() });
  await getInstallId();
  if (!(await sget('window', null))) {
    try {
      const w = await api.windows.getLastFocused();
      await sset({ window: { id: w?.id ?? null, focused: w ? w.focused !== false : true } });
    } catch { await sset({ window: { id: null, focused: true } }); }
  }
  await recompute();
}

// ---------------------------------------------------------------------------
// Listeners (top level, synchronous registration)
// ---------------------------------------------------------------------------
api.runtime.onInstalled.addListener(() => serial(async () => { await init(); await prune(); }));
api.runtime.onStartup.addListener(() => serial(async () => { await init(); await prune(); }));

api.webNavigation.onCommitted.addListener((d) => serial(() => onCommitted(d)));
api.tabs.onActivated.addListener(({ windowId }) => serial(async () => {
  const win = await sget('window', { focused: true, id: null });
  await sset({ window: { ...win, id: windowId } });
  await recompute();
}));
api.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!tab.active || !(info.url || info.status === 'complete')) return;
  serial(() => recompute());
});
api.tabs.onRemoved.addListener((tabId) => serial(async () => {
  const visits = await sget('visitTabs', {});
  if (visits[tabId]) { delete visits[tabId]; await sset({ visitTabs: visits }); }
  const f = await sget('focus', null);
  if (f?.tabId === tabId) await recompute();
}));
api.windows.onFocusChanged.addListener((windowId) => serial(async () => {
  const none = windowId === api.windows.WINDOW_ID_NONE;
  const win = await sget('window', { focused: true, id: null });
  await sset({ window: none ? { ...win, focused: false } : { id: windowId, focused: true } });
  await recompute();
}));
api.idle.onStateChanged.addListener((state) => serial(async () => {
  await sset({ idle: state });
  await recompute();
}));

api.alarms.onAlarm.addListener((alarm) => serial(async () => {
  if (alarm.name === 'flush') await recompute();
  else if (alarm.name === 'prune') await prune();
  else if (alarm.name === 'report') await reportIfDue();
}));

api.notifications?.onClicked.addListener((id) => { if (id.startsWith('saas-')) openNotificationTarget(id); });
api.notifications?.onButtonClicked?.addListener((id) => { if (id.startsWith('saas-')) openNotificationTarget(id); });

onSettingsChanged(() => {
  settingsPromise = null;
  serial(async () => { await applyIdleSettings(); await recompute(); });
});

handleMessages({
  /** Flushes the running segment and returns raw local data for the pages. */
  async getUsage({ days = 90 } = {}) {
    return serial(async () => {
      await flush();
      return {
        days: await getDays(Math.min(Math.max(1, days), 400)),
        lastSeen: await dataStore.get('lastSeen', {}),
        demo: await dataStore.get('demo', false),
      };
    });
  },
  /** Status of the app in a given tab, for the popup. */
  async tabStatus({ tabId }) {
    const { settings, matcher } = await getConfig();
    let tab = null;
    try { tab = tabId != null ? await api.tabs.get(tabId) : await activeTab(null); } catch { /* none */ }
    const host = webHost(tab?.url || '');
    if (!tab || !host) return { kind: 'none' };
    if (tab.incognito) return { kind: 'private', host };
    const app = matcher.resolve(host);
    const focus = await sget('focus', null);
    return {
      kind: app ? 'app' : 'untracked',
      host,
      app,
      tracking: settings.trackingEnabled,
      ignored: matcher.isIgnored(host),
      inFocus: !!(focus && focus.tabId === tab.id),
      alternative: app ? matcher.alternativeFor(app.domain, host) : null,
    };
  },
  async reportState() {
    const { settings } = await getConfig();
    const state = await dataStore.get('reportState', {});
    return { ...state, nextDueAt: settings.reportingEnabled && settings.reportEndpoint ? nextReportDue(state, Number(settings.reportIntervalHours) || 24) : null };
  },
  sendReportNow: () => serial(() => sendReport({ manual: true })),
  clearData: () => serial(clearData),
  loadDemo: () => serial(loadDemo),
  prune: () => serial(prune),
  brand: async () => brandForContent((await getConfig()).settings.brand),
  /** Shows a sample system notification (used by "Test notification" in options). */
  async testNotification() {
    const { settings } = await getConfig();
    const brand = normalizeBrand(settings.brand);
    await showNotification({ appName: 'Example App', company: brand.companyName, product: PRODUCT, alternative: { name: 'an approved tool', url: '' }, learnMoreUrl: settings.noticeLearnMoreUrl || brand.supportUrl || '' });
    return true;
  },
});

// Wake-up path (service worker restarted by an event or alarm).
serial(async () => { await ensureAlarms(); await applyIdleSettings(); });
