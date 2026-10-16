// Pure logic shared by the background, the pages and the Node unit tests.
// No browser APIs in here: only data in, data out.

import { registrableDomain, matchHost, isIp } from './shared/domain.js';
import { CATALOG } from './catalog.js';

export const DAY_MS = 86400000;

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Local calendar day "YYYY-MM-DD" for a timestamp. */
export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local midnight (ms) of the day containing ts. */
export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The last `n` day keys ending today, oldest first. */
export function lastDays(n, now = Date.now()) {
  const out = [];
  const base = new Date(startOfDay(now));
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    out.push(dayKey(d.getTime()));
  }
  return out;
}

/** Splits [startMs, endMs) into per-day chunks: [{ day, seconds }]. */
export function splitByDay(startMs, endMs) {
  const out = [];
  let t = startMs;
  while (t < endMs) {
    const next = new Date(startOfDay(t));
    next.setDate(next.getDate() + 1);
    const end = Math.min(endMs, next.getTime());
    out.push({ day: dayKey(t), seconds: (end - t) / 1000 });
    t = end;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Host filtering
// ---------------------------------------------------------------------------

const INTRANET_SUFFIXES = ['local', 'localhost', 'internal', 'intranet', 'corp', 'lan', 'home', 'home.arpa', 'localdomain', 'test', 'example', 'invalid'];

/** Hosts that are never SaaS: localhost, IP addresses, single-label and private-TLD names. */
export function isIntranetHost(host) {
  host = String(host || '').toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || isIp(host) || host.startsWith('[')) return true;
  if (!host.includes('.')) return true;
  return INTRANET_SUFFIXES.some((s) => host === s || host.endsWith('.' + s));
}

/** Lower-case hostname of an http(s) URL, or '' for anything else (extension pages, file:, about:, ...). */
export function webHost(url) {
  if (!/^https?:\/\//i.test(url || '')) return '';
  try { return new URL(url).hostname.toLowerCase().replace(/\.$/, ''); } catch { return ''; }
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const cleanPattern = (p) => String(p || '').trim().toLowerCase()
  .replace(/^[a-z]+:\/\//, '').split('/')[0].replace(/:\d+$/, '');
const isPlainDomain = (p) => !!p && !p.includes('*') && !p.startsWith('=');
/** Specificity of a host pattern: more labels = more specific; exact (=) beats wildcard. */
function specificity(p) {
  const bare = p.replace(/^=/, '').replace(/^\*\./, '');
  const labels = bare.split('.').filter((l) => l && l !== '*').length;
  return labels * 10 + (p.startsWith('=') ? 5 : 0) + (p.startsWith('*.') ? -1 : 0);
}

/**
 * Builds a matcher from the catalog plus admin settings.
 * settings: { customApps, sanctionedApps, unsanctionedApps, alternatives, licensedApps, ignoreDomains, trackingScope }
 */
export function createMatcher(settings = {}, catalog = CATALOG) {
  const exact = new Map();  // plain domain -> entry (custom apps override catalog)
  const globs = [];         // entries with wildcard / exact patterns
  const add = (e, source) => {
    const p = cleanPattern(e.domain);
    if (!p) return;
    const entry = {
      domain: p.replace(/^=/, '').replace(/^\*\./, ''),
      pattern: p,
      name: String(e.name || '').trim() || p.replace(/^[=*.]+/, ''),
      category: e.category || 'Other',
      vendor: e.vendor || '',
      source,
    };
    if (isPlainDomain(p)) exact.set(p, entry);
    else globs.push(entry);
  };
  for (const e of catalog) add(e, 'catalog');
  for (const e of settings.customApps || []) add(e, 'custom');

  const sanctioned = (settings.sanctionedApps || []).map(cleanPattern).filter(Boolean);
  const unsanctioned = (settings.unsanctionedApps || []).map(cleanPattern).filter(Boolean);
  const licensed = (settings.licensedApps || []).map((l) => ({ ...l, pattern: cleanPattern(l.domain) })).filter((l) => l.pattern);
  const ignore = (settings.ignoreDomains || []).map(cleanPattern).filter(Boolean);
  const alternatives = settings.alternatives || {};
  const scope = settings.trackingScope === 'all-domains' ? 'all-domains' : 'catalog';

  /** Most specific catalog/custom entry for a host, or null. */
  function lookup(host) {
    host = String(host || '').toLowerCase();
    if (!host) return null;
    let best = null, bestScore = -1;
    // plain domains: walk the host's suffixes from most to least specific
    const labels = host.split('.');
    for (let i = 0; i < labels.length; i++) {
      const suffix = labels.slice(i).join('.');
      const e = exact.get(suffix);
      if (e) { best = e; bestScore = specificity(suffix); break; }
    }
    for (const g of globs) {
      if (!matchHost(host, g.pattern)) continue;
      const s = specificity(g.pattern);
      if (s > bestScore || (s === bestScore && g.source === 'custom')) { best = g; bestScore = s; }
    }
    return best;
  }

  /** Best matching pattern from a list (most specific), or null. */
  function bestPattern(list, host, appDomain) {
    let best = null;
    for (const p of list) {
      if (!(matchHost(host, p) || (appDomain && matchHost(appDomain, p)))) continue;
      if (!best || specificity(p) > specificity(best)) best = p;
    }
    return best;
  }

  /** sanctioned | unsanctioned | unknown for a host (and its app key). */
  function statusOf(host, appDomain = host) {
    const s = bestPattern(sanctioned, host, appDomain);
    const u = bestPattern(unsanctioned, host, appDomain);
    if (s && u) return specificity(s) > specificity(u) ? 'sanctioned' : 'unsanctioned';
    if (u) return 'unsanctioned';
    if (s) return 'sanctioned';
    return 'unknown';
  }

  function licenseOf(host, appDomain = host) {
    let best = null;
    for (const l of licensed) {
      if (!(matchHost(host, l.pattern) || matchHost(appDomain, l.pattern))) continue;
      if (!best || specificity(l.pattern) > specificity(best.pattern)) best = l;
    }
    return best;
  }

  function alternativeFor(appDomain, host = appDomain) {
    const keys = Object.keys(alternatives);
    const hit = bestPattern(keys.map(cleanPattern), host, appDomain);
    if (!hit) return null;
    const key = keys.find((k) => cleanPattern(k) === hit);
    const alt = alternatives[key];
    if (!alt) return null;
    return typeof alt === 'string' ? { name: alt, url: '' } : { name: alt.name || '', url: alt.url || '' };
  }

  function isIgnored(host) {
    return ignore.some((p) => matchHost(host, p));
  }

  /**
   * Resolves a hostname to the app it should be recorded under, or null if it
   * must not be recorded. Result: { domain, name, category, vendor, status, catalog, licensed }
   */
  function resolve(host) {
    host = String(host || '').toLowerCase().replace(/\.$/, '');
    if (!host || isIgnored(host)) return null;
    const entry = lookup(host);
    const explicitCustom = entry?.source === 'custom';
    // Internal hosts are skipped unless an admin explicitly listed them as a custom app.
    if (isIntranetHost(host) && !explicitCustom) return null;

    let domain, name, category, vendor = '', known = !!entry;
    if (entry) {
      ({ domain, name, category, vendor } = entry);
    } else {
      const classified = bestPattern([...sanctioned, ...unsanctioned, ...licensed.map((l) => l.pattern)], host, '');
      if (!classified && scope !== 'all-domains') return null;
      domain = classified && isPlainDomain(classified) ? classified : registrableDomain(host);
      const lic = licenseOf(host, domain);
      name = lic?.name || domain;
      category = 'Other';
      known = !!classified;
    }
    const status = statusOf(host, domain);
    const lic = licenseOf(host, domain);
    return { domain, name, category, vendor, status, catalog: known, licensed: !!lic, seats: lic?.seats ?? null };
  }

  /** Describes a stored app key (re-resolved so classification changes apply to history). */
  function describe(domain) {
    const r = resolve(domain);
    if (r && r.domain === domain) return r;
    // Stored key no longer resolves the same way (e.g. scope changed): describe it as-is.
    const entry = lookup(domain);
    return {
      domain,
      name: entry?.domain === domain ? entry.name : (licenseOf(domain)?.name || domain),
      category: entry?.domain === domain ? entry.category : 'Other',
      vendor: entry?.domain === domain ? entry.vendor : '',
      status: statusOf(domain, domain),
      catalog: !!entry || statusOf(domain) !== 'unknown',
      licensed: !!licenseOf(domain),
      seats: licenseOf(domain)?.seats ?? null,
    };
  }

  return { resolve, describe, lookup, statusOf, alternativeFor, licenseOf, isIgnored, scope };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** Adds usage to a day bucket in place. */
export function addUsage(bucket, domain, { visits = 0, seconds = 0 } = {}) {
  const cur = bucket[domain] || { visits: 0, activeSeconds: 0 };
  cur.visits += visits;
  cur.activeSeconds = Math.round((cur.activeSeconds + seconds) * 10) / 10;
  bucket[domain] = cur;
  return bucket;
}

/**
 * Totals per app over a set of day buckets.
 * days: { 'YYYY-MM-DD': { [domain]: { visits, activeSeconds } } }
 * Returns [{ domain, visits, activeSeconds, lastSeen, daysActive, daily: {day: seconds} }]
 */
export function aggregate(days) {
  const apps = new Map();
  for (const [day, bucket] of Object.entries(days || {})) {
    for (const [domain, u] of Object.entries(bucket || {})) {
      const cur = apps.get(domain) || { domain, visits: 0, activeSeconds: 0, lastSeen: '', daysActive: 0, daily: {} };
      cur.visits += u.visits || 0;
      cur.activeSeconds += u.activeSeconds || 0;
      if ((u.visits || 0) > 0 || (u.activeSeconds || 0) > 0) {
        cur.daysActive += 1;
        if (day > cur.lastSeen) cur.lastSeen = day;
      }
      cur.daily[day] = (cur.daily[day] || 0) + (u.activeSeconds || 0);
      apps.set(domain, cur);
    }
  }
  return [...apps.values()].sort((a, b) => b.activeSeconds - a.activeSeconds || b.visits - a.visits);
}

/** Usage keys ("usage:YYYY-MM-DD") older than the retention window. */
export function expiredDays(dayKeys, retentionDays, now = Date.now()) {
  const keep = new Set(lastDays(Math.max(1, retentionDays), now));
  const oldest = [...keep][0];
  return dayKeys.filter((d) => d < oldest && !keep.has(d));
}

/** Drops lastSeen entries older than the retention window. */
export function pruneLastSeen(lastSeen, retentionDays, now = Date.now()) {
  const oldest = lastDays(Math.max(1, retentionDays), now)[0];
  return Object.fromEntries(Object.entries(lastSeen || {}).filter(([, d]) => d >= oldest));
}

/** Licensed apps not seen in `unusedDays` (or never seen). */
export function licensedUnused(licensedApps, lastSeen, unusedDays, now = Date.now(), matcher = null) {
  const cutoff = lastDays(Math.max(1, unusedDays), now)[0];
  return (licensedApps || []).map((l) => {
    const pattern = cleanPattern(l.domain);
    let seen = '';
    for (const [domain, day] of Object.entries(lastSeen || {})) {
      if (matchHost(domain, pattern) && day > seen) seen = day;
    }
    const name = l.name || matcher?.describe(pattern)?.name || pattern;
    return { domain: pattern, name, seats: l.seats ?? null, lastSeen: seen, unused: !seen || seen < cutoff };
  }).filter((l) => l.unused);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * Builds the report payload.
 * ctx: { days, settings, matcher, installId, extensionVersion, now, from, to }
 */
export function buildReport({ days, settings, matcher, installId, extensionVersion, now = Date.now(), from, to }) {
  const apps = aggregate(days)
    .map((a) => ({ ...a, info: matcher.describe(a.domain) }))
    .filter((a) => settings.includeUnknownDomains || a.info.catalog)
    .map((a) => ({
      domain: a.domain,
      name: a.info.name,
      category: a.info.category,
      status: a.info.status,
      visits: a.visits,
      activeMinutes: Math.round(a.activeSeconds / 6) / 10,
      lastSeen: a.lastSeen,
    }));
  const payload = {
    source: 'saas-reporter',
    schema: 1,
    installId,
    department: settings.department || '',
    extensionVersion,
    generatedAt: new Date(now).toISOString(),
    period: { from, to },
    apps,
  };
  if (settings.includeUserEmail && settings.userEmail) payload.user = { email: settings.userEmail };
  return payload;
}

/** Exponential backoff for failed reports: 2, 4, 8, ... minutes, capped at 6 hours. */
export function backoffMinutes(failures) {
  return Math.min(360, 2 ** Math.max(1, failures));
}

/** When the next report is due (ms), given the stored report state. */
export function nextReportDue(state = {}, intervalHours = 24) {
  const interval = Math.max(1, intervalHours) * 3600000;
  if (state.failures > 0 && state.lastAttemptAt) {
    return state.lastAttemptAt + Math.min(backoffMinutes(state.failures) * 60000, interval);
  }
  if (!state.lastSuccessAt) return state.firstSeenAt ? state.firstSeenAt + Math.min(interval, 3600000) : 0;
  return state.lastSuccessAt + interval;
}

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

export function toCsv(rows, columns) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // keep spreadsheets from evaluating formulas
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => cell(c.label)).join(','), ...rows.map((r) => columns.map((c) => cell(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','))].join('\r\n');
}

// ---------------------------------------------------------------------------
// Demo data (developer option; clearly labelled in the UI)
// ---------------------------------------------------------------------------

export function demoDays(n = 45, now = Date.now()) {
  const apps = [
    ['slack.com', 95, 9], ['mail.google.com', 70, 12], ['docs.google.com', 55, 6], ['github.com', 80, 10],
    ['figma.com', 35, 3], ['zoom.us', 30, 4], ['atlassian.net', 40, 7], ['chatgpt.com', 25, 5],
    ['notion.so', 18, 3], ['drive.google.com', 15, 4], ['wetransfer.com', 4, 1], ['dropbox.com', 6, 1],
    ['canva.com', 8, 1], ['linkedin.com', 10, 2], ['claude.ai', 14, 3], ['salesforce.com', 12, 2],
  ];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out = {};
  for (const [i, day] of lastDays(n, now).entries()) {
    const date = new Date(day + 'T12:00:00');
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const bucket = {};
    for (const [domain, minutes, visits] of apps) {
      if (domain === 'dropbox.com' && i > n - 35) continue;     // licensed but unused lately
      if (rand() < (weekend ? 0.75 : 0.12)) continue;
      const m = minutes * (0.4 + rand() * 1.2) * (weekend ? 0.3 : 1);
      addUsage(bucket, domain, { visits: Math.max(1, Math.round(visits * (0.5 + rand()))), seconds: Math.round(m * 60) });
    }
    out[day] = bucket;
  }
  return out;
}
