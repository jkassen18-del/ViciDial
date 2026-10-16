// ServiceNow: Table API incident + Attachment API upload.
import { request, readJson, basicAuth, normalizeHostUrl, assertConfigured, screenshotName, TicketError } from './common.js';
import { plainBody } from '../lib/ticket-text.js';

// urgency / impact → ServiceNow's default priority matrix (1 = critical … 5 = planning)
export const PRIORITY_MAP = {
  urgent: { urgency: '1', impact: '1' }, // P1
  high: { urgency: '1', impact: '2' },   // P2
  normal: { urgency: '2', impact: '2' }, // P3
  low: { urgency: '3', impact: '2' },    // P4
};
const CATEGORY_MAP = { hardware: 'hardware', software: 'software', network: 'network' };

const base = (s) => normalizeHostUrl(s.servicenowInstance, '.service-now.com');
const auth = (s) => ({
  Authorization: s.servicenowAuth === 'bearer' ? `Bearer ${s.servicenowToken}` : basicAuth(s.servicenowUsername, s.servicenowPassword),
  Accept: 'application/json',
});
const hints = { service: 'ServiceNow', auth: 'check the username and password (or OAuth token)', notFound: 'check the instance URL' };

export function buildIncident({ ticket, context, settings }) {
  const body = {
    short_description: ticket.summary,
    description: plainBody(ticket, context),
    ...(PRIORITY_MAP[ticket.priority] || PRIORITY_MAP.normal),
    contact_type: 'self-service',
  };
  const cat = CATEGORY_MAP[String(ticket.category || '').toLowerCase()];
  body.category = cat || 'inquiry';
  if (settings.servicenowSetCaller && ticket.reporter?.email) body.caller_id = ticket.reporter.email;
  if (settings.servicenowAssignmentGroup) body.assignment_group = settings.servicenowAssignmentGroup;
  return body;
}

export default {
  id: 'servicenow',
  label: 'ServiceNow',
  description: 'Opens an incident and uploads the screenshot as an attachment.',
  icon: 'server',
  color: '#293E40',
  setup: 'Use an integration user with the itil role (or rest_api_explorer + incident create). Priority is set through urgency and impact: Urgent = 1/1, High = 1/2, Normal = 2/2, Low = 3/2.',
  fields: [
    { key: 'servicenowInstance', label: 'Instance URL', type: 'text', required: true, placeholder: 'https://acme.service-now.com' },
    { key: 'servicenowAuth', label: 'Authentication', type: 'select', options: [['basic', 'Username and password'], ['bearer', 'OAuth bearer token']] },
    { key: 'servicenowUsername', label: 'Username', type: 'text', required: true, half: true, showIf: (s) => s.servicenowAuth !== 'bearer' },
    { key: 'servicenowPassword', label: 'Password', type: 'password', required: true, secret: true, half: true, showIf: (s) => s.servicenowAuth !== 'bearer' },
    { key: 'servicenowToken', label: 'Bearer token', type: 'password', required: true, secret: true, showIf: (s) => s.servicenowAuth === 'bearer' },
    { key: 'servicenowSetCaller', label: 'Set caller from reporter email', type: 'bool', help: 'Fills caller_id with the reporter email (the instance resolves it to a user).' },
    { key: 'servicenowAssignmentGroup', label: 'Assignment group (optional)', type: 'text', placeholder: 'sys_id or name of the group' },
  ],
  endpoint: (s) => base(s),

  async submit({ ticket, context, screenshotBlob, settings, onProgress = () => {} }) {
    assertConfigured(this, settings);
    const root = base(settings);
    onProgress('Creating incident…');
    const res = await request(`${root}/api/now/table/incident?sysparm_fields=sys_id,number`, {
      method: 'POST',
      headers: { ...auth(settings), 'Content-Type': 'application/json' },
      body: JSON.stringify(buildIncident({ ticket, context, settings })),
    }, hints);
    const data = (await readJson(res)).result || {};
    if (!data.sys_id) throw new TicketError('ServiceNow accepted the request but returned no incident.');
    const warnings = [];
    if (screenshotBlob) {
      onProgress('Attaching screenshot…');
      const q = new URLSearchParams({ table_name: 'incident', table_sys_id: data.sys_id, file_name: screenshotName(context) });
      try {
        await request(`${root}/api/now/attachment/file?${q}`, {
          method: 'POST',
          headers: { ...auth(settings), 'Content-Type': 'image/png' },
          body: screenshotBlob,
        }, hints);
      } catch (err) {
        warnings.push(`The incident was created but the screenshot could not be attached: ${err.message}`);
      }
    }
    return { id: data.number || data.sys_id, url: `${root}/nav_to.do?uri=${encodeURIComponent(`incident.do?sys_id=${data.sys_id}`)}`, warnings };
  },

  async test(settings) {
    assertConfigured(this, settings);
    await request(`${base(settings)}/api/now/table/incident?sysparm_limit=1&sysparm_fields=sys_id`, { headers: auth(settings) }, hints);
    return `Connected to ${new URL(base(settings)).host}; the account can read incidents.`;
  },
};
