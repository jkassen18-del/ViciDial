// Generic JSON webhook: POSTs the ticket, diagnostics and screenshot as one JSON body.
import { request, readJson, blobToBase64, assertConfigured, screenshotName, TicketError } from './common.js';
import { plainBody } from '../lib/ticket-text.js';

const VERSION = () => globalThis.chrome?.runtime?.getManifest?.().version || globalThis.browser?.runtime?.getManifest?.().version || '';

function headers(settings) {
  const out = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const extra = settings.webhookHeaders;
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    for (const [k, v] of Object.entries(extra)) if (k && v != null) out[k] = String(v);
  }
  return out;
}

export function buildPayload({ ticket, context, screenshotBase64, version = VERSION() }) {
  return {
    source: 'ticket-snap',
    version,
    ticket: {
      summary: ticket.summary,
      description: ticket.description || '',
      category: ticket.category || '',
      priority: ticket.priority || 'normal',
      reporter: { name: ticket.reporter?.name || '', email: ticket.reporter?.email || '' },
    },
    context: { ...context },
    text: plainBody(ticket, context),
    screenshot: screenshotBase64 ? { filename: screenshotName(context), mime: 'image/png', dataBase64: screenshotBase64 } : null,
  };
}

function hints() {
  return { service: 'The webhook', auth: 'check the Authorization header in settings', notFound: 'check the webhook URL' };
}

export default {
  id: 'webhook',
  label: 'Webhook',
  description: 'POST JSON to any URL: your own service, an automation tool or the dev server.',
  icon: 'zap',
  color: '#7C3AED',
  recommended: true,
  setup: 'Ticket Snap sends one JSON document per ticket: { source, version, ticket: { summary, description, category, priority, reporter }, context: { …diagnostics }, text, screenshot: { filename, mime, dataBase64 } | null }. Reply with JSON { "id": "…", "url": "…" } and the user sees a link to the ticket.',
  fields: [
    { key: 'webhookUrl', label: 'Webhook URL', type: 'url', required: true, placeholder: 'https://helpdesk.example.com/api/tickets', help: 'For local testing run node tools/dev-server.mjs and use http://localhost:8787/api/tickets' },
    { key: 'webhookHeaders', label: 'Extra headers (JSON)', type: 'json', secret: true, placeholder: '{ "Authorization": "Bearer …" }', help: 'Optional. Sent with every request, e.g. an API key. Never exported with settings.' },
  ],
  endpoint: (s) => s.webhookUrl || '',

  async submit({ ticket, context, screenshotBlob, settings, onProgress = () => {} }) {
    assertConfigured(this, settings);
    let screenshotBase64 = null;
    if (screenshotBlob) { onProgress('Preparing screenshot…'); screenshotBase64 = await blobToBase64(screenshotBlob); }
    onProgress('Sending ticket…');
    const res = await request(settings.webhookUrl, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify(buildPayload({ ticket, context, screenshotBase64 })),
    }, hints());
    const data = await readJson(res);
    const t = data.ticket && typeof data.ticket === 'object' ? data.ticket : data;
    return { id: String(t.id ?? t.key ?? t.number ?? '') || null, url: t.url || t.link || t.html_url || null };
  },

  async test(settings) {
    assertConfigured(this, settings);
    let res;
    try {
      res = await fetch(settings.webhookUrl, { method: 'OPTIONS', headers: headers(settings) });
    } catch {
      throw new TicketError(`Can't reach ${new URL(settings.webhookUrl).host}. Check the URL and your network or VPN connection.`, { kind: 'network' });
    }
    if (res.status === 401 || res.status === 403) throw new TicketError(`The webhook answered HTTP ${res.status} — check the Authorization header.`, { status: res.status });
    if (res.status >= 500) throw new TicketError(`The webhook answered HTTP ${res.status} (server error).`, { status: res.status });
    return `Reached ${new URL(settings.webhookUrl).host} (HTTP ${res.status}). No ticket was created.`;
  },
};
