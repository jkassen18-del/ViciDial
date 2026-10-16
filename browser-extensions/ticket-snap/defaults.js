// Default settings for Ticket Snap. Every key here can be enforced or
// suggested by managed policy (see schema.json and README.md).

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
export const PRIORITY_LABELS = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };

export const DEFAULTS = {
  // ---- where tickets go ----
  provider: 'webhook',

  webhookUrl: '',
  webhookHeaders: {},

  jsmBaseUrl: '',
  jsmEmail: '',
  jsmApiToken: '',
  jsmServiceDeskId: '',
  jsmRequestTypeId: '',
  jsmRaiseOnBehalf: false,
  jsmSetPriority: false,
  jsmLinkTarget: 'portal',

  zendeskSubdomain: '',
  zendeskEmail: '',
  zendeskApiToken: '',
  zendeskEndpoint: 'requests',

  freshdeskDomain: '',
  freshdeskApiKey: '',

  servicenowInstance: '',
  servicenowAuth: 'basic',
  servicenowUsername: '',
  servicenowPassword: '',
  servicenowToken: '',
  servicenowSetCaller: true,
  servicenowAssignmentGroup: '',

  emailTo: '',

  // ---- ticket form ----
  categories: ['Hardware', 'Software', 'Access & accounts', 'Network', 'Other'],
  defaultCategory: 'Software',
  defaultPriority: 'normal',
  requiredFields: [],
  summaryPrefix: '',
  descriptionTemplate: 'What happened?\n\nWhat did you expect to happen?\n\nSteps to reproduce:\n1. \n2. ',
  descriptionPrefill: false,
  reporterName: '',
  reporterEmail: '',
  includeScreenshotDefault: true,

  // ---- diagnostics ----
  diagnostics: {
    url: true,
    title: true,
    browser: true,
    os: true,
    arch: true,
    language: true,
    timeZone: true,
    screen: true,
    viewport: true,
    zoom: true,
    capturedAt: true,
    extensionVersion: true,
    userAgent: false,
  },
  allowRemoveUrl: true,

  // ---- capture & history ----
  showContextMenu: true,
  keepHistory: true,
};

/** Settings that hold credentials: never exported, and masked in the UI. */
export const SECRET_KEYS = ['webhookHeaders', 'jsmApiToken', 'zendeskApiToken', 'freshdeskApiKey', 'servicenowPassword', 'servicenowToken'];
