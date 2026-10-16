// Default settings for Data Leak Guard. Every key here is also described in schema.json.

export const PRODUCT = 'Data Leak Guard';

export const HIGH_RISK_DEFAULTS = [
  // Public AI assistants
  'chatgpt.com', 'chat.openai.com', 'claude.ai', 'gemini.google.com', 'bard.google.com', 'aistudio.google.com',
  'copilot.microsoft.com', 'perplexity.ai', 'poe.com', 'deepseek.com', 'chat.mistral.ai', 'huggingface.co',
  'character.ai', 'you.com', 'pi.ai', 'grok.com', 'meta.ai', 'chat.qwen.ai',
  // Personal e-mail
  'mail.google.com', 'outlook.live.com', 'mail.yahoo.com', 'proton.me', 'mail.proton.me', 'mail.aol.com', 'icloud.com/mail*', 'gmx.com', 'tutanota.com',
  // File sharing and paste sites
  'wetransfer.com', 'dropbox.com', 'drive.google.com', 'onedrive.live.com', 'box.com', 'mega.nz', 'mediafire.com', 'sendspace.com',
  'pastebin.com', 'gist.github.com', 'paste.ee', 'hastebin.com', 'justpaste.it', 'transfer.sh', 'file.io',
  // Personal messaging / social
  'discord.com', 'web.whatsapp.com', 'web.telegram.org', 'messenger.com', 'web.skype.com',
  // Online converters / formatters that receive whatever you paste
  'jsonformatter.org', 'codebeautify.org', 'jwt.io', 'base64decode.org', 'smallpdf.com', 'ilovepdf.com',
];

export const DEFAULT_RULE_ACTIONS = {
  card: 'warn',
  iban: 'warn',
  'us-ssn': 'warn',
  'uk-nino': 'warn',
  'ca-sin': 'warn',
  'au-tfn': 'off',
  'private-key': 'block',
  'aws-key': 'block',
  'github-token': 'block',
  'slack-token': 'block',
  'google-api-key': 'block',
  'stripe-key': 'block',
  jwt: 'warn',
  'password-assignment': 'log',
  classification: 'warn',
  'bulk-email': 'warn',
};

export const DEFAULTS = {
  // --- protection scope ---
  enabled: true,                          // user switch; only honoured when allowUserDisable is true
  mode: 'all-except-trusted',             // 'all-except-trusted' | 'listed'
  trustedSites: [],                       // company domains where nothing is scanned, e.g. "acme.com", "acme.sharepoint.com"
  highRiskSites: HIGH_RISK_DEFAULTS,      // unapproved destinations (always protected, stricter action)

  // --- actions ---
  defaultAction: 'warn',                  // used by custom rules and by any rule set to "default"
  ruleActions: { ...DEFAULT_RULE_ACTIONS }, // per built-in rule: off | log | warn | block | default
  highRiskAction: 'block',                // on high-risk sites rules at warn level become: 'same' | 'warn' | 'block'
  requireJustification: false,            // "Continue anyway" needs a typed reason
  blockFileUploadsOnHighRisk: 'off',      // 'off' | 'warn' | 'block' any file upload to high-risk sites

  // --- channels ---
  channels: { paste: true, drop: true, upload: true, submit: false },
  maxFileSizeMB: 5,                       // text-like files larger than this are scanned up to this size

  // --- detector tuning ---
  classificationKeywords: ['CONFIDENTIAL', 'STRICTLY CONFIDENTIAL', 'INTERNAL ONLY', 'RESTRICTED', 'DO NOT DISTRIBUTE'],
  bulkEmailThreshold: 10,
  customRules: [],                        // [{ id, name, pattern, flags, minCount, action, description }]

  // --- user controls ---
  allowUserDisable: false,
  allowSnooze: false,
  snoozeMinutes: 15,

  // --- reporting ---
  reportingEndpoint: '',                  // e.g. http://localhost:8787/api/dlp/incidents
  reportingHeaders: {},                   // e.g. { "Authorization": "Bearer …" }
  department: '',
  includeUserEmail: false,
  userEmail: '',

  brand: {},
};

export const ACTIONS = ['off', 'log', 'warn', 'block'];
export const ACTION_LABELS = { off: 'Off', log: 'Log only', warn: 'Warn', block: 'Block', default: 'Default' };
export const CHANNEL_LABELS = { paste: 'Paste', drop: 'Drag & drop', upload: 'File uploads', submit: 'Send' };
