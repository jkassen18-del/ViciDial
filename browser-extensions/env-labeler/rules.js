// Rule normalisation, merging and matching. Pure functions: used by the
// background, the popup, the options page (live "Test a URL") and unit tests.

import { matchUrl, hostOf } from './shared/domain.js';
import { contrastText, isHex } from './shared/brand.js';
import { RIBBON_POSITIONS } from './defaults.js';

export const SOURCES = {
  company: { label: 'Company', icon: 'building', tone: 'primary' },
  remote: { label: 'Remote', icon: 'cloud', tone: 'info' },
  personal: { label: 'Personal', icon: 'user', tone: '' },
};

const SHORT = {
  PRODUCTION: 'PROD', PROD: 'PROD', PRD: 'PROD', LIVE: 'LIVE',
  STAGING: 'STG', STAGE: 'STG', STG: 'STG',
  DEVELOPMENT: 'DEV', DEV: 'DEV', LOCAL: 'LOCAL', LOCALHOST: 'LOCAL',
  QA: 'QA', TEST: 'TEST', TESTING: 'TEST', UAT: 'UAT',
  SANDBOX: 'SBX', PREPROD: 'PRE', 'PRE-PROD': 'PRE', PREPRODUCTION: 'PRE', DEMO: 'DEMO', TRAINING: 'TRN',
};

/** Short tag used for the toolbar badge and the title prefix: PRODUCTION -> PROD. */
export function shortLabel(rule) {
  if (rule?.short) return String(rule.short).trim().slice(0, 5).toUpperCase();
  const label = String(rule?.label || '').trim().toUpperCase();
  if (!label) return '';
  if (SHORT[label]) return SHORT[label];
  const first = label.split(/[\s/_]+/)[0];
  if (SHORT[first]) return SHORT[first];
  return first.replace(/[^\p{L}\p{N}-]/gu, '').slice(0, 4);
}

/** Cleans up a pattern a user typed or pasted (full URLs become host[/path]). */
export function normalizePattern(p) {
  let s = String(p ?? '').trim();
  if (!s || s.startsWith('re:')) return s;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !s.includes('*')) {
    try {
      const u = new URL(s);
      const path = u.pathname === '/' ? '' : u.pathname;
      return `${u.hostname}${u.port ? ':' + u.port : ''}${path}${u.search}`.toLowerCase();
    } catch { /* keep as typed */ }
  }
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  if (s.endsWith('/') && s.indexOf('/') === s.length - 1) s = s.slice(0, -1);
  return s;
}

/** Returns a problem description for an invalid pattern, or null. */
export function patternProblem(p) {
  const s = String(p || '').trim();
  if (!s) return 'Pattern is empty';
  if (s.startsWith('re:')) {
    try { new RegExp(s.slice(3), 'i'); return null; } catch (err) { return `Invalid regular expression: ${err.message}`; }
  }
  if (/\s/.test(s)) return 'Patterns cannot contain spaces';
  return null;
}

/** Describes a pattern in plain words (for the pattern help and match explanations). */
export function describePattern(p) {
  const s = String(p || '').trim();
  if (s.startsWith('re:')) return 'regular expression on the full URL';
  const slash = s.indexOf('/');
  const host = slash === -1 ? s : s.slice(0, slash);
  const path = slash === -1 ? '' : s.slice(slash);
  const port = host.match(/:(\d+)$/)?.[1];
  const bare = host.replace(/:\d+$/, '');
  let d;
  if (bare.startsWith('=')) d = `exactly ${bare.slice(1)}`;
  else if (bare.startsWith('*.') && !bare.slice(2).includes('*')) d = `any subdomain of ${bare.slice(2)}`;
  else if (bare.includes('*')) d = `hosts like ${bare}`;
  else d = `${bare} and its subdomains`;
  if (port) d += ` on port ${port}`;
  if (path) d += `, path ${path}`;
  return d;
}

let idCounter = 0;
export function newRuleId() {
  return `r${Date.now().toString(36)}${(idCounter++).toString(36)}`;
}

/** Fills in defaults and drops anything unusable. */
export function normalizeRule(raw, i = 0) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const color = isHex(r.color) ? String(r.color).toUpperCase() : '#475569';
  const rule = {
    id: String(r.id || `rule-${i + 1}`),
    label: String(r.label || r.name || 'ENVIRONMENT').slice(0, 40),
    color,
    textColor: isHex(r.textColor) ? String(r.textColor).toUpperCase() : '',
    patterns: (Array.isArray(r.patterns) ? r.patterns : typeof r.patterns === 'string' ? r.patterns.split(/[\n,]/) : [])
      .map((p) => String(p).trim()).filter(Boolean),
    ribbon: RIBBON_POSITIONS.includes(r.ribbon) ? r.ribbon : 'top',
    faviconTint: r.faviconTint !== false,
    titlePrefix: r.titlePrefix !== false,
    border: !!r.border,
    confirmForms: !!r.confirmForms,
    enabled: r.enabled !== false,
  };
  if (r.short) rule.short = String(r.short).slice(0, 5);
  return rule;
}

export function normalizeRules(list) {
  return (Array.isArray(list) ? list : []).map(normalizeRule);
}

/** Text colour actually used on the rule colour. */
export function textColorFor(rule) {
  return rule.textColor || contrastText(rule.color);
}

/** Accepts `{ rules: [...] }`, `{ environments: [...] }` or a bare array. */
export function parseRemotePayload(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.rules) ? json.rules : Array.isArray(json?.environments) ? json.environments : null;
  if (!list) throw new Error('Expected a JSON object with a "rules" array');
  return { name: typeof json?.name === 'string' ? json.name : '', rules: normalizeRules(list) };
}

/**
 * Builds the ordered rule list.
 * @param {object} settings  effective settings
 * @param {object} remoteCache  { [url]: { rules, name, ok, fetchedAt, error } }
 */
export function mergeRules(settings, remoteCache = {}) {
  const out = [];
  normalizeRules(settings.rules).forEach((r) => out.push({ ...r, source: 'company', sourceName: 'Your organization' }));
  for (const url of settings.rulesUrls || []) {
    const entry = remoteCache[url];
    if (!entry?.rules) continue;
    normalizeRules(entry.rules).forEach((r) => out.push({ ...r, source: 'remote', sourceName: entry.name || hostOf(url) || url, sourceUrl: url }));
  }
  if (settings.allowPersonalRules !== false) {
    normalizeRules(settings.personalRules).forEach((r) => out.push({ ...r, source: 'personal', sourceName: 'You' }));
  }
  return out;
}

/** First matching enabled rule: { rule, pattern } or null. */
export function matchRules(url, rules) {
  if (!/^(https?|file):/i.test(url || '')) return null;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    for (const p of rule.patterns) if (matchUrl(url, p)) return { rule, pattern: p };
  }
  return null;
}

/**
 * Explains the decision for the "Test a URL" box: every rule with the pattern
 * that matched (if any), whether it is disabled, and which one wins.
 */
export function explainMatch(url, rules) {
  const steps = [];
  let winner = null;
  for (const rule of rules) {
    const pattern = rule.patterns.find((p) => matchUrl(url, p)) || null;
    const step = { rule, pattern, disabled: !rule.enabled, shadowed: false };
    if (pattern && rule.enabled && !winner) winner = step;
    else if (pattern && rule.enabled) step.shadowed = true;
    steps.push(step);
  }
  return { url, host: hostOf(url), winner, steps };
}
