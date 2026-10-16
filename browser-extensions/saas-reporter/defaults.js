// Every setting with its default. Admins can override any of these through
// managed policy (see schema.json and README.md).
export const DEFAULTS = {
  // Tracking
  trackingEnabled: true,
  trackingScope: 'catalog',          // 'catalog' | 'all-domains'
  ignoreDomains: [],                 // internal/company domains never recorded
  retentionDays: 90,
  idleSeconds: 60,                   // stop counting active time after this much inactivity

  // App lists
  customApps: [],                    // [{ domain, name, category, vendor? }]
  sanctionedApps: [],                // domains / patterns IT approves
  unsanctionedApps: [],              // domains / patterns IT discourages or forbids
  alternatives: {},                  // { 'wetransfer.com': { name: 'OneDrive', url: 'https://…' } }
  licensedApps: [],                  // [{ domain, name, seats? }]
  licenseUnusedDays: 30,

  // Reporting
  reportingEnabled: true,            // only sends when reportEndpoint is set
  reportEndpoint: '',
  reportHeaders: {},
  reportIntervalHours: 24,
  reportPeriodDays: 30,              // rolling window included in each report
  department: '',
  includeUnknownDomains: false,
  includeUserEmail: false,
  userEmail: '',

  // User notices
  notifyOnUnsanctioned: 'notice',    // 'off' | 'notice'
  noticeLearnMoreUrl: '',

  brand: {},
};

export const SLUG = 'saas-reporter';
export const PRODUCT = 'SaaS Usage Reporter';
