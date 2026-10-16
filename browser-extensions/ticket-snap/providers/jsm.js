// Jira Service Management (Cloud or Data Center) via the Service Desk REST API.
import { request, readJson, basicAuth, normalizeBaseUrl, assertConfigured, screenshotName } from './common.js';
import { plainBody } from '../lib/ticket-text.js';

const PRIORITY_NAMES = { low: 'Low', normal: 'Medium', high: 'High', urgent: 'Highest' };

const base = (s) => normalizeBaseUrl(s.jsmBaseUrl);
const auth = (s) => ({ Authorization: basicAuth(s.jsmEmail, s.jsmApiToken), Accept: 'application/json' });
const hints = { service: 'Jira Service Management', auth: 'check the account email and API token', notFound: 'check the site URL, service desk ID and request type ID' };

export function buildRequestBody({ ticket, context, settings }) {
  const body = {
    serviceDeskId: String(settings.jsmServiceDeskId).trim(),
    requestTypeId: String(settings.jsmRequestTypeId).trim(),
    requestFieldValues: {
      summary: ticket.summary,
      description: plainBody(ticket, context),
    },
  };
  if (settings.jsmSetPriority && ticket.priority) body.requestFieldValues.priority = { name: PRIORITY_NAMES[ticket.priority] || 'Medium' };
  if (settings.jsmRaiseOnBehalf && ticket.reporter?.email) body.raiseOnBehalfOf = ticket.reporter.email;
  return body;
}

export function ticketUrl(settings, key, links) {
  if (settings.jsmLinkTarget === 'agent') return `${base(settings)}/browse/${key}`;
  return links?.web || `${base(settings)}/servicedesk/customer/portal/${String(settings.jsmServiceDeskId).trim()}/${key}`;
}

export default {
  id: 'jsm',
  label: 'Jira Service Management',
  short: 'Jira SM',
  description: 'Creates a customer request in a service desk, with the screenshot attached.',
  icon: 'layers',
  color: '#0052CC',
  setup: 'Create an API token at id.atlassian.com → Security → API tokens. The service desk ID and request type ID are in the portal URL: …/servicedesk/customer/portal/{serviceDeskId}/create/{requestTypeId}.',
  fields: [
    { key: 'jsmBaseUrl', label: 'Site URL', type: 'text', required: true, placeholder: 'https://acme.atlassian.net' },
    { key: 'jsmEmail', label: 'Account email', type: 'email', required: true, placeholder: 'helpdesk-bot@acme.com' },
    { key: 'jsmApiToken', label: 'API token', type: 'password', required: true, secret: true },
    { key: 'jsmServiceDeskId', label: 'Service desk ID', type: 'text', required: true, placeholder: '1', half: true },
    { key: 'jsmRequestTypeId', label: 'Request type ID', type: 'text', required: true, placeholder: '10', half: true },
    { key: 'jsmRaiseOnBehalf', label: 'Raise on behalf of the reporter', type: 'bool', help: 'Uses the reporter email as the customer. The account needs agent permissions.' },
    { key: 'jsmSetPriority', label: 'Send priority', type: 'bool', help: 'Only if the request type has a Priority field (Low/Medium/High/Highest).' },
    { key: 'jsmLinkTarget', label: 'Ticket link opens', type: 'select', options: [['portal', 'Customer portal'], ['agent', 'Agent view (/browse/KEY)']] },
  ],
  endpoint: (s) => base(s),

  async submit({ ticket, context, screenshotBlob, settings, onProgress = () => {} }) {
    assertConfigured(this, settings);
    const root = base(settings);
    const sd = encodeURIComponent(String(settings.jsmServiceDeskId).trim());
    const warnings = [];
    let tempIds = [];

    if (screenshotBlob) {
      onProgress('Uploading screenshot…');
      try {
        const form = new FormData();
        form.append('file', screenshotBlob, screenshotName(context));
        const res = await request(`${root}/rest/servicedeskapi/servicedesk/${sd}/attachTemporaryFile`, {
          method: 'POST',
          headers: { ...auth(settings), 'X-ExperimentalApi': 'opt-in', 'X-Atlassian-Token': 'no-check' },
          body: form,
        }, hints);
        const data = await readJson(res);
        tempIds = (data.temporaryAttachments || []).map((a) => a.temporaryAttachmentId).filter(Boolean);
      } catch (err) {
        if (err.status === 401) throw err;
        warnings.push(`The screenshot could not be uploaded: ${err.message}`);
      }
    }

    onProgress('Creating request…');
    const res = await request(`${root}/rest/servicedeskapi/request`, {
      method: 'POST',
      headers: { ...auth(settings), 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRequestBody({ ticket, context, settings })),
    }, hints);
    const created = await readJson(res);
    const key = created.issueKey || created.issueId;

    if (tempIds.length && key) {
      onProgress('Attaching screenshot…');
      try {
        await request(`${root}/rest/servicedeskapi/request/${encodeURIComponent(key)}/attachment`, {
          method: 'POST',
          headers: { ...auth(settings), 'Content-Type': 'application/json', 'X-ExperimentalApi': 'opt-in' },
          body: JSON.stringify({ temporaryAttachmentIds: tempIds, public: true }),
        }, hints);
      } catch (err) {
        warnings.push(`The request was created but the screenshot could not be attached: ${err.message}`);
      }
    }
    return { id: key || null, url: key ? ticketUrl(settings, key, created._links) : null, warnings };
  },

  async test(settings) {
    assertConfigured(this, settings);
    const sd = encodeURIComponent(String(settings.jsmServiceDeskId).trim());
    const rt = encodeURIComponent(String(settings.jsmRequestTypeId).trim());
    const desk = await readJson(await request(`${base(settings)}/rest/servicedeskapi/servicedesk/${sd}`, { headers: auth(settings) }, hints));
    const type = await readJson(await request(`${base(settings)}/rest/servicedeskapi/servicedesk/${sd}/requesttype/${rt}`, { headers: auth(settings) }, hints));
    return `Connected to “${desk.projectName || desk.projectKey || 'service desk ' + sd}”, request type “${type.name || rt}”.`;
  },
};
