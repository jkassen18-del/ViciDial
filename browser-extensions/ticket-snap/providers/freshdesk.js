// Freshdesk: one multipart POST /api/v2/tickets with the screenshot in attachments[].
import { request, readJson, basicAuth, normalizeHostUrl, assertConfigured, screenshotName, TicketError } from './common.js';
import { htmlBody } from '../lib/ticket-text.js';

export const PRIORITY_MAP = { low: 1, normal: 2, high: 3, urgent: 4 };
const base = (s) => normalizeHostUrl(s.freshdeskDomain, '.freshdesk.com');
const auth = (s) => ({ Authorization: basicAuth(s.freshdeskApiKey, 'X'), Accept: 'application/json' });
const hints = { service: 'Freshdesk', auth: 'check the API key (Profile settings → View API key)', notFound: 'check the Freshdesk domain' };

export function buildForm({ ticket, context, screenshotBlob }) {
  const form = new FormData();
  form.append('email', ticket.reporter.email);
  if (ticket.reporter.name) form.append('name', ticket.reporter.name);
  form.append('subject', ticket.summary);
  form.append('description', htmlBody(ticket, context));
  form.append('priority', String(PRIORITY_MAP[ticket.priority] || 2));
  form.append('status', '2');
  form.append('tags[]', 'ticket-snap');
  if (screenshotBlob) form.append('attachments[]', screenshotBlob, screenshotName(context));
  return form;
}

export default {
  id: 'freshdesk',
  label: 'Freshdesk',
  description: 'Creates an open Freshdesk ticket from the reporter, screenshot attached.',
  icon: 'ticket',
  color: '#25C16F',
  setup: 'Find your API key under Profile settings → View API key. The reporter email is required: Freshdesk files the ticket under that contact.',
  fields: [
    { key: 'freshdeskDomain', label: 'Freshdesk domain', type: 'text', required: true, placeholder: 'acme  (for acme.freshdesk.com)' },
    { key: 'freshdeskApiKey', label: 'API key', type: 'password', required: true, secret: true },
  ],
  needsReporterEmail: true,
  endpoint: (s) => base(s),

  async submit({ ticket, context, screenshotBlob, settings, onProgress = () => {} }) {
    assertConfigured(this, settings);
    if (!ticket.reporter?.email) throw new TicketError('Freshdesk needs the reporter email. Fill in "Your email" and try again.', { kind: 'config' });
    onProgress(screenshotBlob ? 'Uploading ticket and screenshot…' : 'Creating ticket…');
    const res = await request(`${base(settings)}/api/v2/tickets`, {
      method: 'POST',
      headers: auth(settings),
      body: buildForm({ ticket, context, screenshotBlob }),
    }, hints);
    const data = await readJson(res);
    if (!data.id) throw new TicketError('Freshdesk accepted the request but returned no ticket number.');
    return { id: `#${data.id}`, url: `${base(settings)}/a/tickets/${data.id}` };
  },

  async test(settings) {
    assertConfigured(this, settings);
    const me = await readJson(await request(`${base(settings)}/api/v2/agents/me`, { headers: auth(settings) }, hints));
    return `Connected as ${me.contact?.name || me.contact?.email || 'agent'}.`;
  },
};
