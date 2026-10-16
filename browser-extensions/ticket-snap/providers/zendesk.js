// Zendesk Support: uploads the screenshot, then creates a request (end user) or ticket (agent).
import { request, readJson, basicAuth, normalizeHostUrl, assertConfigured, screenshotName, TicketError } from './common.js';
import { plainBody } from '../lib/ticket-text.js';

const base = (s) => normalizeHostUrl(s.zendeskSubdomain, '.zendesk.com');
const auth = (s) => ({ Authorization: basicAuth(`${s.zendeskEmail}/token`, s.zendeskApiToken), Accept: 'application/json' });
const hints = { service: 'Zendesk', auth: 'check the email and API token (Admin Center → Apps and integrations → Zendesk API)', notFound: 'check the subdomain' };

export function buildBody({ ticket, context, settings, uploads = [] }) {
  const endpoint = settings.zendeskEndpoint === 'tickets' ? 'tickets' : 'requests';
  const item = {
    subject: ticket.summary,
    comment: { body: plainBody(ticket, context), ...(uploads.length ? { uploads } : {}) },
    priority: ticket.priority === 'normal' ? 'normal' : ticket.priority || 'normal',
    tags: ['ticket-snap'],
  };
  if (endpoint === 'tickets' && ticket.reporter?.email) item.requester = { name: ticket.reporter.name || ticket.reporter.email, email: ticket.reporter.email };
  return endpoint === 'tickets' ? { ticket: item } : { request: item };
}

export default {
  id: 'zendesk',
  label: 'Zendesk',
  description: 'Creates a Zendesk request or ticket with the screenshot as an attachment.',
  icon: 'help',
  color: '#03363D',
  setup: 'Turn on token access in Admin Center → Apps and integrations → APIs → Zendesk API and add a token. "Requests" creates the ticket as the authenticated user (end-user view); "Tickets" needs an agent and sets the reporter as requester.',
  fields: [
    { key: 'zendeskSubdomain', label: 'Subdomain', type: 'text', required: true, placeholder: 'acme  (for acme.zendesk.com)' },
    { key: 'zendeskEmail', label: 'Account email', type: 'email', required: true, placeholder: 'helpdesk-bot@acme.com', half: true },
    { key: 'zendeskApiToken', label: 'API token', type: 'password', required: true, secret: true, half: true },
    { key: 'zendeskEndpoint', label: 'Create as', type: 'select', options: [['requests', 'Request (end user, /api/v2/requests)'], ['tickets', 'Ticket (agent, /api/v2/tickets)']] },
  ],
  endpoint: (s) => base(s),

  async submit({ ticket, context, screenshotBlob, settings, onProgress = () => {} }) {
    assertConfigured(this, settings);
    const root = base(settings);
    const uploads = [];
    if (screenshotBlob) {
      onProgress('Uploading screenshot…');
      const res = await request(`${root}/api/v2/uploads?filename=${encodeURIComponent(screenshotName(context))}`, {
        method: 'POST',
        headers: { ...auth(settings), 'Content-Type': 'image/png' },
        body: screenshotBlob,
      }, hints);
      const data = await readJson(res);
      if (data.upload?.token) uploads.push(data.upload.token);
    }
    onProgress('Creating ticket…');
    const endpoint = settings.zendeskEndpoint === 'tickets' ? 'tickets' : 'requests';
    const res = await request(`${root}/api/v2/${endpoint}`, {
      method: 'POST',
      headers: { ...auth(settings), 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBody({ ticket, context, settings, uploads })),
    }, hints);
    const data = await readJson(res);
    const id = (data.request || data.ticket || {}).id;
    if (!id) throw new TicketError('Zendesk accepted the request but returned no ticket number.');
    const url = endpoint === 'tickets' ? `${root}/agent/tickets/${id}` : `${root}/hc/requests/${id}`;
    return { id: `#${id}`, url };
  },

  async test(settings) {
    assertConfigured(this, settings);
    const data = await readJson(await request(`${base(settings)}/api/v2/users/me.json`, { headers: auth(settings) }, hints));
    if (!data.user?.id) throw new TicketError('Zendesk answered, but the credentials were not accepted (anonymous user). Check the email and API token.', { status: 401 });
    return `Connected as ${data.user.name || data.user.email} (${data.user.role}).`;
  },
};
