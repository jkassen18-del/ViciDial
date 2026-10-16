// Email: opens the user's mail app with everything filled in and downloads the
// annotated PNG so it can be attached (mailto: cannot carry attachments).
import { assertConfigured, TicketError } from './common.js';
import { plainBody } from '../lib/ticket-text.js';

const MAX_MAILTO = 1900;

export function recipient(settings) {
  return String(settings.emailTo || settings.brand?.supportEmail || '').trim();
}

export function buildMailto({ ticket, context, settings, attachmentName }) {
  const to = recipient(settings);
  let body = plainBody(ticket, context);
  if (attachmentName) body = `${body}\n\n[Please attach the screenshot: ${attachmentName}]`;
  const make = (b) => `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?subject=${encodeURIComponent(ticket.summary)}&body=${encodeURIComponent(b)}`;
  let href = make(body);
  if (href.length > MAX_MAILTO) {
    while (href.length > MAX_MAILTO && body.length > 200) {
      body = body.slice(0, Math.floor(body.length * 0.9));
      href = make(`${body}\n…(shortened — use "Copy details" to paste the rest)`);
    }
  }
  return href;
}

export default {
  id: 'email',
  label: 'Email',
  description: 'Opens a pre-filled email to the help desk. The screenshot is downloaded to attach.',
  icon: 'mail',
  color: '#0EA5E9',
  setup: 'No server needed. The user’s email app opens with the summary, description and diagnostics filled in; the annotated screenshot is saved to Downloads so they can attach it.',
  fields: [
    { key: 'emailTo', label: 'Send to', type: 'email', placeholder: 'Leave empty to use the brand support email', help: 'Defaults to the support email from Branding.' },
  ],
  endpoint: () => '',
  local: true,

  async submit({ ticket, context, screenshotBlob, settings, attachmentName }) {
    assertConfigured(this, settings);
    if (!recipient(settings)) throw new TicketError('No help desk email address is configured. Set "Send to" or the support email in Branding.', { kind: 'config' });
    return { id: null, url: null, mailto: buildMailto({ ticket, context, settings, attachmentName: screenshotBlob ? attachmentName : '' }), downloadScreenshot: !!screenshotBlob };
  },

  async test(settings) {
    const to = recipient(settings);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new TicketError(to ? `“${to}” doesn't look like an email address.` : 'No email address configured.');
    return `Tickets will be emailed to ${to}.`;
  },
};
