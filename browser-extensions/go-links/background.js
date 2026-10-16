// Go-Links background: fetches link sources, keeps the index, answers pages,
// drives the omnibox keyword and keeps the declarativeNetRequest rules in sync.
// All listeners are registered synchronously at the top level (MV3).

import { api, IS_FIREFOX, extUrl } from './shared/browser.js';
import { loadSettings, saveSettings, onSettingsChanged, dataStore, fetchWithTimeout, originPattern } from './shared/config.js';
import { handleMessages } from './shared/messaging.js';
import { DEFAULTS, MIN_REFRESH, MAX_REFRESH } from './defaults.js';
import * as R from './resolver.js';
import { buildRules, ruleSummary, validShortHost } from './rules.js';

const ALARM = 'go-links-refresh';
const SOURCES_KEY = 'sources';      // dataStore: { [url]: cache entry }
const USAGE_KEY = 'usage';          // dataStore: { [linkId]: { count, last } }
const RULES_KEY = 'rulesStatus';    // dataStore: last DNR sync result

// ---------------------------------------------------------------------------
// State (rebuilt lazily; the service worker can be stopped at any time)
// ---------------------------------------------------------------------------
let statePromise = null;
let refreshPromise = null;

function invalidate() { statePromise = null; }

function getState() {
  statePromise ??= (async () => {
    const { values, isLocked } = await loadSettings(DEFAULTS);
    const cache = await dataStore.get(SOURCES_KEY, {});
    const layers = buildLayers(values, cache);
    return { settings: values, isLocked, cache, layers, index: R.buildIndex(layers) };
  })().catch((err) => { statePromise = null; throw err; });
  return statePromise;
}

const hostLabel = (url) => { try { return new URL(url).host; } catch { return url; } };

function cleanSources(list) {
  return (Array.isArray(list) ? list : [])
    .map((s) => (typeof s === 'string' ? { url: s } : s))
    .filter((s) => s && typeof s.url === 'string' && /^https?:\/\//i.test(s.url.trim()))
    .map((s) => ({ url: s.url.trim(), name: String(s.name || '').trim(), department: String(s.department || '').trim() }));
}

function buildLayers(settings, cache) {
  const layers = [];
  if (Array.isArray(settings.links) && settings.links.length) {
    layers.push({ id: 'managed', name: 'Managed by IT', kind: 'policy', links: settings.links });
  }
  for (const src of cleanSources(settings.sources)) {
    const c = cache[src.url];
    layers.push({ id: src.url, name: src.name || c?.name || hostLabel(src.url), kind: 'source', department: src.department, links: c?.links || [] });
  }
  if (settings.allowPersonalLinks) {
    layers.push({ id: 'personal', name: 'My links', kind: 'personal', links: Array.isArray(settings.personalLinks) ? settings.personalLinks : [] });
  }
  return layers;
}

// ---------------------------------------------------------------------------
// Fetching sources
// ---------------------------------------------------------------------------
async function hasHostAccess(url) {
  try { return await api.permissions.contains({ origins: [originPattern(url)] }); } catch { return false; }
}

/** Fetches and validates one source. `prev` is the cached entry (for conditional requests). */
async function fetchSource(src, prev = {}) {
  const headers = {};
  // Conditional headers are not CORS-safelisted: only send them when we have host access,
  // otherwise they would trigger a preflight that a plain static host may reject.
  if (await hasHostAccess(src.url)) {
    if (prev.etag) headers['If-None-Match'] = prev.etag;
    if (prev.lastModified) headers['If-Modified-Since'] = prev.lastModified;
  }
  // With host access the request is not subject to CORS, so cookies (intranet SSO) can be sent.
  // Without it, a credentialed request would fail against "Access-Control-Allow-Origin: *".
  const access = await hasHostAccess(src.url);
  const res = await fetchWithTimeout(src.url, { headers, cache: 'no-store', credentials: access ? 'include' : 'omit' }, 15000);
  if (res.status === 304 && prev.links) return { notModified: true, etag: prev.etag, lastModified: prev.lastModified };
  if (!res.ok) throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
  const text = await res.text();
  const v = R.validateSource(text, { department: src.department });
  if (!v.ok) throw new Error(v.errors.join('; '));
  return { ...v, etag: res.headers.get('ETag') || '', lastModified: res.headers.get('Last-Modified') || '' };
}

async function refreshSources({ force = false } = {}) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const { values } = await loadSettings(DEFAULTS);
    const sources = cleanSources(values.sources);
    const cache = await dataStore.get(SOURCES_KEY, {});
    const next = {};
    const minAge = force ? 0 : 60 * 1000;
    await Promise.all(sources.map(async (src) => {
      const prev = cache[src.url] || {};
      if (!force && prev.fetchedAt && Date.now() - Date.parse(prev.fetchedAt) < minAge && prev.status === 'ok') { next[src.url] = prev; return; }
      const now = new Date().toISOString();
      try {
        const r = await fetchSource(src, prev);
        if (r.notModified) {
          next[src.url] = { ...prev, status: 'ok', error: '', fetchedAt: now, lastSuccessAt: now, notModified: true };
        } else {
          next[src.url] = {
            url: src.url, name: r.name, updated: r.updated, links: r.links, count: r.links.length,
            warnings: r.warnings.slice(0, 20), status: 'ok', error: '', fetchedAt: now, lastSuccessAt: now,
            etag: r.etag, lastModified: r.lastModified, notModified: false,
          };
        }
      } catch (err) {
        // keep serving the last good copy
        next[src.url] = { ...prev, url: src.url, links: prev.links || [], count: prev.links?.length || 0, status: 'error', error: String(err.message || err), fetchedAt: now };
      }
    }));
    await dataStore.set(SOURCES_KEY, next);
    invalidate();
    return sourceStatus(sources, next);
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

function sourceStatus(sources, cache) {
  return sources.map((s) => {
    const c = cache[s.url] || {};
    return {
      url: s.url, name: s.name || c.name || hostLabel(s.url), department: s.department,
      docName: c.name || '', updated: c.updated || '', status: c.status || 'pending', error: c.error || '',
      count: c.count ?? 0, fetchedAt: c.fetchedAt || '', lastSuccessAt: c.lastSuccessAt || '', warnings: c.warnings || [],
    };
  });
}

/** Makes sure every configured source has been fetched at least once. */
async function ensureFetched() {
  const { settings, cache } = await getState();
  const missing = cleanSources(settings.sources).some((s) => !cache[s.url]);
  if (missing) await refreshSources({ force: true });
}

// ---------------------------------------------------------------------------
// Alarm + declarativeNetRequest rules
// ---------------------------------------------------------------------------
async function scheduleAlarm(settings) {
  const period = Math.min(MAX_REFRESH, Math.max(MIN_REFRESH, Number(settings.refreshMinutes) || DEFAULTS.refreshMinutes));
  const existing = await api.alarms.get(ALARM);
  if (!existing || existing.periodInMinutes !== period) {
    await api.alarms.create(ALARM, { periodInMinutes: period, delayInMinutes: Math.min(period, 1) });
  }
}

async function isSupported(regex) {
  const dnr = api.declarativeNetRequest;
  if (typeof dnr.isRegexSupported !== 'function') return { isSupported: true };
  try { return await dnr.isRegexSupported({ regex, isCaseSensitive: false, requireCapturing: true }); } catch (err) { return { isSupported: true, reason: String(err) }; }
}

async function syncRules(settings) {
  const dnr = api.declarativeNetRequest;
  const shortHost = validShortHost(settings.shortHost) ? settings.shortHost.toLowerCase() : DEFAULTS.shortHost;
  const wanted = buildRules({
    shortHost,
    literal: settings.literalRedirect !== false,
    searches: settings.catchSearches !== false,
    goPage: extUrl('go.html'),
  });
  const accepted = [];
  const rejected = [];
  for (const rule of wanted) {
    const res = await isSupported(rule.condition.regexFilter);
    if (res.isSupported) accepted.push(rule);
    else rejected.push({ id: rule.id, reason: res.reason || 'unsupported regex' });
  }
  const existing = await dnr.getDynamicRules();
  let error = '';
  try {
    await dnr.updateDynamicRules({ removeRuleIds: existing.map((r) => r.id), addRules: accepted });
  } catch (err) {
    // fall back to adding rules one at a time so a single bad rule doesn't disable everything
    error = String(err.message || err);
    await dnr.updateDynamicRules({ removeRuleIds: (await dnr.getDynamicRules()).map((r) => r.id) }).catch(() => {});
    for (const rule of accepted) {
      try { await dnr.updateDynamicRules({ addRules: [rule] }); } catch (e) { rejected.push({ id: rule.id, reason: String(e.message || e) }); }
    }
  }
  const active = await dnr.getDynamicRules();
  const status = { at: new Date().toISOString(), shortHost, active: active.length, rules: ruleSummary(active), rejected, error };
  await dataStore.set(RULES_KEY, status);
  return status;
}

const APPLIED_KEY = 'applied';      // dataStore: fingerprints of what was last applied

/**
 * Re-applies everything that depends on settings. Fingerprints are persisted so a
 * worker that was asleep while settings changed still notices the change.
 */
async function applySettings({ initial = false } = {}) {
  invalidate();
  const { settings } = await getState();
  api.omnibox.setDefaultSuggestion({ description: defaultDescription('') });
  const prev = await dataStore.get(APPLIED_KEY, {});
  const now = {
    rules: JSON.stringify([settings.shortHost, settings.literalRedirect, settings.catchSearches, extUrl('go.html')]),
    alarm: String(settings.refreshMinutes),
    sources: JSON.stringify(cleanSources(settings.sources)),
  };
  if (initial || now.rules !== prev.rules) await syncRules(settings).catch((e) => console.warn('DNR sync failed', e));
  if (initial || now.alarm !== prev.alarm) await scheduleAlarm(settings).catch((e) => console.warn('alarm failed', e));
  await dataStore.set(APPLIED_KEY, now);
  if (initial || now.sources !== prev.sources) {
    await refreshSources({ force: true }).catch((e) => console.warn('refresh failed', e));
  }
}

// ---------------------------------------------------------------------------
// Usage (local only)
// ---------------------------------------------------------------------------
async function recordUse(link) {
  const { settings } = await getState();
  if (!link || settings.trackUsage === false) return;
  await dataStore.update(USAGE_KEY, {}, (u) => {
    const cur = u[link.id] || { count: 0 };
    u[link.id] = { count: cur.count + 1, last: new Date().toISOString() };
    return u;
  });
}

// ---------------------------------------------------------------------------
// Omnibox
// ---------------------------------------------------------------------------
const xml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
/** Chrome/Edge render <match>/<dim>/<url>; Firefox shows plain text, so strip the markup there. */
const markup = (s) => (IS_FIREFOX ? s.replace(/<\/?(match|dim|url)>/g, '').replace(/&(amp|lt|gt|quot|apos);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e])) : s);

function defaultDescription(text, found) {
  if (!text) return markup('Type a go-link, e.g. <match>payroll</match> <dim>or search the company directory</dim>');
  if (found) return markup(`Open <match>go/${xml(found.link.key)}</match> <dim>· ${xml(found.link.title)}</dim> <url>${xml(shortUrl(found.url))}</url>`);
  return markup(`Search go-links for <match>${xml(text)}</match>`);
}

function shortUrl(url) { return String(url).replace(/^https?:\/\//, '').replace(/\/$/, ''); }

api.omnibox.onInputStarted.addListener(() => { getState().catch(() => {}); });

api.omnibox.onInputChanged.addListener(async (text, suggest) => {
  try {
    const { index, settings } = await getState();
    const usage = await dataStore.get(USAGE_KEY, {});
    const res = R.resolve(index, text, { shortHost: settings.shortHost });
    api.omnibox.setDefaultSuggestion({ description: defaultDescription(text.trim(), res.link ? res : null) });
    const parsed = res.parsed;
    const extra = parsed.style === 'space' ? parsed.star : parsed.args.join('/');
    const results = R.search(index, parsed.key || text, { limit: 7, usage, shortHost: settings.shortHost })
      .filter((r) => !res.link || r.link !== res.link).slice(0, 6);
    suggest(results.map(({ link }) => {
      const content = extra ? `${link.key} ${extra}` : link.key;
      const target = R.expand(link, parsed.style === 'space' ? R.parseInput(content) : { ...parsed, key: link.key });
      const dept = link.department ? ` · ${xml(link.department)}` : '';
      return {
        content: content === text ? `${content} ` : content,
        description: markup(`<match>go/${xml(link.key)}</match> <dim>· ${xml(link.title)}${dept}</dim> <url>${xml(shortUrl(target))}</url>`),
      };
    }));
  } catch (err) {
    console.warn('omnibox', err);
  }
});

api.omnibox.onInputEntered.addListener(async (text, disposition) => {
  const { index, settings } = await getState();
  const res = R.resolve(index, text, { shortHost: settings.shortHost });
  let url;
  if (res.link) { url = res.url; recordUse(res.link).catch(() => {}); }
  else if (res.empty) url = extUrl('directory.html');
  else url = extUrl(`go.html?q=${encodeURIComponent(text.trim())}`);
  if (disposition === 'newForegroundTab') await api.tabs.create({ url, active: true });
  else if (disposition === 'newBackgroundTab') await api.tabs.create({ url, active: false });
  else {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null) await api.tabs.update(tab.id, { url }); else await api.tabs.create({ url });
  }
});

// ---------------------------------------------------------------------------
// Fallback: the browser tried to load http://go/… and failed (DNS) before/without DNR
// ---------------------------------------------------------------------------
api.webNavigation.onErrorOccurred.addListener(async (details) => {
  if (details.frameId !== 0) return;
  let u;
  try { u = new URL(details.url); } catch { return; }
  if (!/^https?:$/.test(u.protocol)) return;
  const { settings } = await getState();
  if (settings.literalRedirect === false) return;
  const host = (validShortHost(settings.shortHost) ? settings.shortHost : DEFAULTS.shortHost).toLowerCase();
  if (u.hostname.toLowerCase() !== host) return;
  const path = `${u.pathname.replace(/^\//, '')}${u.search}${u.hash}`;
  await api.tabs.update(details.tabId, { url: path ? extUrl(`go.html#${path}`) : extUrl('directory.html') });
});

// ---------------------------------------------------------------------------
// Messages from pages
// ---------------------------------------------------------------------------
function publicLink(e) {
  const { order, aliasIds, ...rest } = e;
  return rest;
}

async function getData() {
  await ensureFetched().catch(() => {});
  const { settings, index, cache, isLocked } = await getState();
  const usage = await dataStore.get(USAGE_KEY, {});
  return {
    links: index.links.map(publicLink),
    shadowed: index.shadowed.map(publicLink),
    conflicts: index.conflicts,
    sources: sourceStatus(cleanSources(settings.sources), cache),
    managedCount: Array.isArray(settings.links) ? settings.links.length : 0,
    usage,
    rules: await dataStore.get(RULES_KEY, null),
    personalLocked: isLocked('personalLinks') || isLocked('allowPersonalLinks'),
  };
}

async function resolveInput({ input = '', record = true } = {}) {
  let { index, settings } = await getState();
  let res = R.resolve(index, input, { shortHost: settings.shortHost });
  if (!res.link && !res.empty) {
    // maybe this is the very first use and sources haven't been fetched yet
    const before = index;
    await ensureFetched().catch(() => {});
    ({ index, settings } = await getState());
    if (index !== before) res = R.resolve(index, input, { shortHost: settings.shortHost });
  }
  if (res.link) {
    if (record) await recordUse(res.link).catch(() => {});
    return { found: true, url: res.url, key: res.link.key, link: publicLink(res.link) };
  }
  return {
    found: false, empty: !!res.empty, key: R.cleanKey(res.parsed.key), input,
    suggestions: (res.suggestions || []).map((s) => ({ ...publicLink(s.link), score: Math.round(s.score) })),
  };
}

async function savePersonalLink({ link, originalKey } = {}) {
  const { settings, isLocked, index } = await getState();
  if (!settings.allowPersonalLinks) throw new Error('Personal links are turned off by your organization.');
  if (isLocked('personalLinks')) throw new Error('Personal links are managed by your organization.');
  const { link: clean, errors } = R.cleanLink(link);
  if (!clean) throw new Error(errors.join(', '));
  const list = (settings.personalLinks || []).filter((l) => R.matchKey(l.key) !== R.matchKey(originalKey || clean.key));
  if (list.some((l) => R.matchKey(l.key) === R.matchKey(clean.key))) throw new Error(`You already have go/${clean.key}.`);
  const company = R.lookup(index, clean.key);
  if (company && !company.personal) throw new Error(`go/${clean.key} is already a company link (${company.title}). Pick another name.`);
  const { featured, ...stored } = clean;
  list.push(stripEmpty(stored));
  list.sort((a, b) => a.key.localeCompare(b.key));
  await saveSettings({ personalLinks: list });
  invalidate();
  return { ok: true, link: stored };
}

function stripEmpty(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (!(v === '' || (Array.isArray(v) && !v.length) || v == null)) out[k] = v;
  return out;
}

async function deletePersonalLink({ key } = {}) {
  const { settings, isLocked } = await getState();
  if (isLocked('personalLinks')) throw new Error('Personal links are managed by your organization.');
  const list = (settings.personalLinks || []).filter((l) => R.matchKey(l.key) !== R.matchKey(key));
  await saveSettings({ personalLinks: list });
  invalidate();
  return { ok: true };
}

async function importPersonal({ links = [], mode = 'merge' } = {}) {
  const { settings, isLocked } = await getState();
  if (!settings.allowPersonalLinks || isLocked('personalLinks')) throw new Error('Personal links are managed by your organization.');
  const v = R.validateSource({ links });
  if (!v.ok) throw new Error(v.errors.join('; '));
  const map = new Map(mode === 'replace' ? [] : (settings.personalLinks || []).map((l) => [R.matchKey(l.key), l]));
  for (const l of v.links) { const { featured, ...rest } = l; map.set(R.matchKey(l.key), stripEmpty(rest)); }
  const list = [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  await saveSettings({ personalLinks: list });
  invalidate();
  return { ok: true, count: v.links.length, warnings: v.warnings };
}

async function testSource({ url, department } = {}) {
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('Enter a URL starting with https://');
  try {
    const r = await fetchSource({ url, department });
    return { ok: true, name: r.name, updated: r.updated, count: r.links.length, warnings: r.warnings.slice(0, 10), departments: R.departments(r.links) };
  } catch (err) {
    const msg = String(err.message || err);
    const access = await hasHostAccess(url);
    return { ok: false, error: msg, hint: access ? '' : 'If the server does not send CORS headers (Access-Control-Allow-Origin), allow Go-Links to access the site when asked.' };
  }
}

handleMessages({
  getData,
  resolve: resolveInput,
  recordUse: async ({ key }) => { const { index } = await getState(); await recordUse(R.lookup(index, key)); return true; },
  refresh: async ({ force = true } = {}) => ({ sources: await refreshSources({ force }) }),
  testSource,
  savePersonalLink,
  deletePersonalLink,
  importPersonal,
  syncRules: async () => syncRules((await getState()).settings),
  getRules: async () => ({ status: await dataStore.get(RULES_KEY, null), rules: await api.declarativeNetRequest.getDynamicRules() }),
  clearUsage: async () => { await dataStore.set(USAGE_KEY, {}); return true; },
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
api.runtime.onInstalled.addListener((details) => {
  applySettings({ initial: true }).catch((e) => console.warn(e));
  if (details.reason === 'install') {
    // Open the directory on first install so people discover what's there.
    loadSettings(DEFAULTS).then(({ values }) => {
      if (cleanSources(values.sources).length || (values.links || []).length) api.tabs.create({ url: extUrl('directory.html?welcome=1') }).catch(() => {});
    });
  }
});
api.runtime.onStartup.addListener(() => { applySettings({ initial: true }).catch((e) => console.warn(e)); });
api.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) refreshSources({ force: false }).catch(() => {}); });
onSettingsChanged(() => { applySettings().catch((e) => console.warn(e)); });
api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && `data:${SOURCES_KEY}` in changes) invalidate();
});
