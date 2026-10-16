// Default settings for Environment Labeler (shared by background and pages).
//
// Rule sources, merged in this order (first matching enabled rule wins):
//   1. `rules`          company rules from managed policy (always read-only here)
//   2. remote rules     fetched from `rulesUrls` and cached by the background
//   3. `personalRules`  the user's own rules (when `allowPersonalRules` is on)

export const RIBBON_POSITIONS = ['top', 'bottom', 'left', 'right', 'corner', 'none'];

export const COLOR_PRESETS = [
  { name: 'Red', color: '#DC2626' },
  { name: 'Orange', color: '#EA580C' },
  { name: 'Amber', color: '#D97706' },
  { name: 'Green', color: '#16A34A' },
  { name: 'Teal', color: '#0D9488' },
  { name: 'Blue', color: '#2563EB' },
  { name: 'Violet', color: '#7C3AED' },
  { name: 'Pink', color: '#DB2777' },
  { name: 'Slate', color: '#475569' },
];

// Host globs are anchored on the whole host name, so "*staging*" matches any
// host containing "staging" and "*.stg.*" needs labels on both sides.
export const DEFAULT_RULES = [
  {
    id: 'prod', label: 'PRODUCTION', color: '#DC2626', patterns: [],
    ribbon: 'top', faviconTint: true, titlePrefix: true, border: true, confirmForms: true, enabled: true,
  },
  {
    id: 'staging', label: 'STAGING', color: '#D97706',
    patterns: ['*staging*', 'stg.*', '*.stg.*', '*-stg.*', 'uat.*', '*.uat.*', '*-uat.*', '*preprod*'],
    ribbon: 'top', faviconTint: true, titlePrefix: true, border: false, confirmForms: false, enabled: true,
  },
  {
    id: 'qa', label: 'QA', color: '#2563EB',
    patterns: ['qa.*', '*.qa.*', '*-qa.*', 'test.*', '*.test.*'],
    ribbon: 'corner', faviconTint: true, titlePrefix: true, border: false, confirmForms: false, enabled: true,
  },
  {
    id: 'dev', label: 'DEV', color: '#16A34A',
    patterns: ['localhost', '127.0.0.1', '0.0.0.0', '*.local', '*.test', 'dev.*', '*.dev.*', '*-dev.*'],
    ribbon: 'corner', faviconTint: true, titlePrefix: false, border: false, confirmForms: false, enabled: true,
  },
];

export const DEFAULTS = {
  enabled: true,
  rules: [],
  personalRules: DEFAULT_RULES,
  allowPersonalRules: true,
  rulesUrls: [],
  refreshMinutes: 60,
  confirmDestructiveClicks: false,
  ribbonHeight: 26,
  ribbonOpacity: 0.95,
  allowHideRibbon: true,
  ribbonPushesContent: false,
  showHostname: true,
  showBadge: true,
  brand: {},
};
