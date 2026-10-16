// Registry of helpdesk providers. Each provider exports
// { id, label, fields, endpoint(settings), submit({ticket, context, screenshotBlob, settings, onProgress}), test(settings) }.
import webhook from './webhook.js';
import jsm from './jsm.js';
import zendesk from './zendesk.js';
import freshdesk from './freshdesk.js';
import servicenow from './servicenow.js';
import email from './email.js';
import { missingFields } from './common.js';

export const PROVIDERS = [webhook, jsm, zendesk, freshdesk, servicenow, email];

export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) || webhook;
}

/** Labels of required fields still empty for the selected provider. */
export function providerProblems(settings) {
  const p = getProvider(settings.provider);
  const missing = missingFields(p, settings);
  if (p.id === 'email' && !String(settings.emailTo || settings.brand?.supportEmail || '').trim()) missing.push('Send to');
  return missing;
}

/** Host shown to users ("Sends to …"). */
export function providerTarget(settings) {
  const p = getProvider(settings.provider);
  if (p.id === 'email') return String(settings.emailTo || settings.brand?.supportEmail || '');
  try { return new URL(p.endpoint(settings)).host; } catch { return ''; }
}

export { missingFields };
