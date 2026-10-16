// Environment Labeler background (MV3 service worker / Firefox event page).
// Keeps no critical state in memory: settings come from storage, remote rules
// are cached in dataStore and per-tab state lives in storage.session.

import { api } from './shared/browser.js';
import { loadSettings, onSettingsChanged, dataStore, fetchWithTimeout } from './shared/config.js';
import { handleMessages } from './shared/messaging.js';
import { brandForContent } from './shared/brand.js';
import { hostOf } from './shared/domain.js';
import { DEFAULTS } from './defaults.js';
import { mergeRules, matchRules, explainMatch, parseRemotePayload, shortLabel, textColorFor, normalizeRules } from './rules.js';

const ALARM = 'env-remote-refresh';
const REMOTE_KEY = 'remoteRules';
const sessionArea = api.storage.session || null;

// ---------------------------------------------------------------------------
// State helpers (short-lived memo, invalidated on every relevant change)
// ---------------------------------------------------------------------------
let statePromise = null;
let brandPromise = null;

function invalidate() { statePromise = null; brandPromise = null; }

function getState() {
  statePromise ??= (async () => {
    const loaded = await loadSettings(DEFAULTS);
    const remote = await dataStore.get(REMOTE_KEY, {});
    const settings = loaded.values;
    return { loaded, settings, remote, rules: mergeRules(settings, remote) };
  })().catch((err) => { statePromise = null; throw err; });
  return statePromise;
}

async function getBrand() {
  brandPromise ??= getState().then((s) => brandForContent(s.settings.brand));
  return brandPromise;
}

function publicRule(rule, pattern) {
  return { ...rule, pattern, short: shortLabel(rule), textColor: textColorFor(rule) };
}

function prefsFrom(settings) {
  return {
    ribbonHeight: Math.max(16, Math.min(48, Number(settings.ribbonHeight) || 26)),
    ribbonOpacity: Math.max(0.3, Math.min(1, Number(settings.ribbonOpacity) || 0.95)),
    allowHideRibbon: settings.allowHideRibbon !== false,
    ribbonPushesContent: !!settings.ribbonPushesContent,
    showHostname: settings.showHostname !== false,
    confirmDestructiveClicks: !!settings.confirmDestructiveClicks,
  };
}

async function matchFor(url) {
  const { settings, rules } = await getState();
  if (settings.enabled === false) return null;
  const m = matchRules(url, rules);
  return m ? publicRule(m.rule, m.pattern) : null;
}

// ---------------------------------------------------------------------------
// Toolbar badge
// ---------------------------------------------------------------------------
const call = async (fn, ...args) => { try { await fn?.(...args); } catch { /* tab closed or unsupported */ } };

async function setBadge(tabId, rule) {
  if (tabId == null || tabId < 0) return;
  const { settings } = await getState();
  const a = api.action;
  if (!rule || settings.showBadge === false) {
    await call(a.setBadgeText.bind(a), { tabId, text: '' });
    await call(a.setTitle.bind(a), { tabId, title: rule ? `${rule.label} · Environment Labeler` : 'Environment Labeler · no label for this site' });
    return;
  }
  await call(a.setBadgeText.bind(a), { tabId, text: rule.short.slice(0, 4) });
  await call(a.setBadgeBackgroundColor.bind(a), { tabId, color: rule.color });
  if (a.setBadgeTextColor) await call(a.setBadgeTextColor.bind(a), { tabId, color: rule.textColor });
  await call(a.setTitle.bind(a), { tabId, title: `${rule.label} · ${hostOf(rule.url || '') || 'this site'} · Environment Labeler` });
}

async function rememberTab(tabId, info) {
  if (!sessionArea || tabId == null) return;
  try { await sessionArea.set({ [`tab:${tabId}`]: info }); } catch { /* ignore */ }
}

async function recallTab(tabId) {
  if (!sessionArea || tabId == null) return null;
  try { return (await sessionArea.get(`tab:${tabId}`))[`tab:${tabId}`] || null; } catch { return null; }
}

// ---------------------------------------------------------------------------
// Remote rule sources
// ---------------------------------------------------------------------------
async function fetchSource(url) {
  const res = await fetchWithTimeout(url, { cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json' } }, 15000);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${hostOf(url) || url}`);
  let json;
  try { json = await res.json(); } catch { throw new Error('Response is not valid JSON'); }
  return parseRemotePayload(json);
}

async function refreshRemote(urls) {
  const { settings } = await getState();
  const list = (urls || settings.rulesUrls || []).filter((u) => /^https?:\/\//i.test(u));
  const cache = await dataStore.get(REMOTE_KEY, {});
  const next = {};
  await Promise.all(list.map(async (url) => {
    const prev = cache[url] || {};
    try {
      const { name, rules } = await fetchSource(url);
      next[url] = { name, rules, ok: true, error: '', fetchedAt: Date.now(), lastSuccess: Date.now() };
    } catch (err) {
      // Keep the last good copy so a flaky server never removes labels.
      next[url] = { ...prev, rules: prev.rules || null, ok: false, error: String(err?.message || err), fetchedAt: Date.now() };
    }
  }));
  // Keep cache entries for configured URLs that were not part of this refresh.
  for (const url of settings.rulesUrls || []) if (!(url in next) && cache[url]) next[url] = cache[url];
  await dataStore.set(REMOTE_KEY, next);
  invalidate();
  await broadcast();
  return next;
}

async function scheduleRefresh() {
  const { settings } = await getState();
  const minutes = Math.max(1, Number(settings.refreshMinutes) || 60);
  if (!(settings.rulesUrls || []).length) { await call(api.alarms.clear.bind(api.alarms), ALARM); return; }
  const existing = await api.alarms.get(ALARM).catch(() => null);
  if (!existing || existing.periodInMinutes !== minutes) {
    await api.alarms.create(ALARM, { delayInMinutes: minutes, periodInMinutes: minutes });
  }
}

// ---------------------------------------------------------------------------
// Push updates to open tabs (content scripts re-run their match)
// ---------------------------------------------------------------------------
async function broadcast() {
  let tabs = [];
  try { tabs = await api.tabs.query({}); } catch { return; }
  await Promise.all(tabs.map((t) => api.tabs.sendMessage(t.id, { type: 'env:refresh' }).catch(() => {})));
}

// ---------------------------------------------------------------------------
// Listeners (registered synchronously at top level)
// ---------------------------------------------------------------------------
handleMessages({
  async match({ url }, sender) {
    const { settings } = await getState();
    const rule = await matchFor(url);
    const tabId = sender?.tab?.id;
    if (tabId != null && sender?.frameId === 0) {
      await setBadge(tabId, rule && { ...rule, url });
      await rememberTab(tabId, { url, ruleId: rule?.id || null, source: rule?.source || null, at: Date.now() });
    }
    return { rule, brand: await getBrand(), prefs: prefsFrom(settings) };
  },

  async getRules() {
    const { loaded, settings, remote, rules } = await getState();
    return {
      rules,
      remote,
      company: normalizeRules(settings.rules),
      personal: normalizeRules(settings.personalRules),
      allowPersonalRules: settings.allowPersonalRules !== false,
      personalLocked: loaded.isLocked('personalRules'),
      enabled: settings.enabled !== false,
    };
  },

  async testUrl({ url, rules }) {
    const list = rules ? rules : (await getState()).rules;
    return explainMatch(url, list);
  },

  async refreshRemote({ urls } = {}) {
    return refreshRemote(urls);
  },

  async tabState({ tabId }) {
    const info = await recallTab(tabId);
    if (!info?.url) return null;
    return { url: info.url, rule: await matchFor(info.url) };
  },

  async matchUrl({ url }) {
    return matchFor(url);
  },
});

api.runtime.onInstalled.addListener(() => { invalidate(); refreshRemote().then(scheduleRefresh).catch(() => {}); });
api.runtime.onStartup?.addListener(() => { refreshRemote().then(scheduleRefresh).catch(() => {}); });

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) refreshRemote().catch(() => {});
});

onSettingsChanged(async () => {
  invalidate();
  const { settings, remote } = await getState();
  // Fetch any newly added source straight away; others follow the alarm.
  const missing = (settings.rulesUrls || []).filter((u) => !remote[u]);
  if (missing.length) await refreshRemote(missing).catch(() => {});
  else await broadcast();
  await scheduleRefresh().catch(() => {});
});

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && `data:${REMOTE_KEY}` in changes) invalidate();
});

api.tabs.onRemoved.addListener((tabId) => { sessionArea?.remove(`tab:${tabId}`).catch?.(() => {}); });
