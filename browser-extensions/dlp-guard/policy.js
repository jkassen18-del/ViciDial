// Effective-policy computation, shared by the background, popup and options page.
import { hostOf, firstMatch, isRestrictedUrl } from './shared/domain.js';
import { DEFAULT_RULE_ACTIONS } from './defaults.js';

export const RANK = { off: 0, log: 1, warn: 2, block: 3 };
const VALID = new Set(['off', 'log', 'warn', 'block']);

const resolve = (action, fallback) => {
  if (action === 'default') return VALID.has(fallback) ? fallback : 'warn';
  return VALID.has(action) ? action : (VALID.has(fallback) ? fallback : 'warn');
};

/** Applies the high-risk escalation to one action. */
export function escalate(action, highRiskAction) {
  if (highRiskAction !== 'warn' && highRiskAction !== 'block') return action;
  if (RANK[action] >= RANK.warn && RANK[highRiskAction] > RANK[action]) return highRiskAction;
  return action;
}

/**
 * Per-rule actions for a destination.
 * @returns {{ [ruleId]: 'off'|'log'|'warn'|'block' }} keys include "custom:<id>"
 */
export function ruleActionsFor(settings, isHighRisk) {
  const out = {};
  const fallback = resolve(settings.defaultAction, 'warn');
  const configured = { ...DEFAULT_RULE_ACTIONS, ...(settings.ruleActions || {}) };
  for (const [id, a] of Object.entries(configured)) out[id] = resolve(a, fallback);
  for (const r of settings.customRules || []) {
    if (!r?.id || r.enabled === false) continue;
    out[`custom:${r.id}`] = resolve(r.action || 'default', fallback);
  }
  if (isHighRisk) for (const id of Object.keys(out)) out[id] = escalate(out[id], settings.highRiskAction);
  return out;
}

/** Config object for DLPDetectors.scan() matching a set of rule actions. */
export function detectorConfig(settings, actions) {
  return {
    rules: Object.keys(actions).filter((id) => !id.startsWith('custom:') && actions[id] !== 'off'),
    keywords: settings.classificationKeywords || [],
    bulkEmailThreshold: settings.bulkEmailThreshold,
    customRules: (settings.customRules || []).filter((r) => r?.id && r.enabled !== false && actions[`custom:${r.id}`] !== 'off')
      .map(({ id, name, pattern, flags, minCount }) => ({ id, name, pattern, flags, minCount })),
  };
}

/**
 * Site status for a URL.
 * @returns {{ active, reason, domain, isHighRisk, trustedMatch, highRiskMatch }}
 *  reason: 'restricted' | 'trusted' | 'not-listed' | 'disabled' | 'snoozed' | 'protected' | 'high-risk'
 */
export function siteStatus(settings, url, { snoozedUntil = 0, now = Date.now() } = {}) {
  const domain = hostOf(url);
  const base = { domain, isHighRisk: false, trustedMatch: null, highRiskMatch: null };
  if (!url || isRestrictedUrl(url) || !domain) return { ...base, active: false, reason: 'restricted' };
  const highRiskMatch = firstMatch(url, settings.highRiskSites || []);
  const trustedMatch = firstMatch(url, settings.trustedSites || []);
  const s = { ...base, isHighRisk: !!highRiskMatch && !trustedMatch, highRiskMatch, trustedMatch };
  if (trustedMatch) return { ...s, active: false, reason: 'trusted' };
  if (settings.mode === 'listed' && !highRiskMatch) return { ...s, active: false, reason: 'not-listed' };
  if (settings.allowUserDisable && settings.enabled === false) return { ...s, active: false, reason: 'disabled' };
  if (settings.allowSnooze && snoozedUntil > now) return { ...s, active: false, reason: 'snoozed', snoozedUntil };
  return { ...s, active: true, reason: highRiskMatch ? 'high-risk' : 'protected' };
}

/** Highest action among detections. */
export function overallAction(detections, actions) {
  let best = 'off';
  for (const d of detections) {
    const a = actions[d.ruleId] || 'off';
    if (RANK[a] > RANK[best]) best = a;
  }
  return best;
}
