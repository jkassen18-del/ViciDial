// Unit tests for the helpdesk providers' request building, with fetch stubbed.
// Run after building:  node tools/build.mjs --browsers chrome --only ticket-snap
//                      node --test ticket-snap/.tests/providers.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/chrome/ticket-snap');
const load = (p) => import(pathToFileURL(path.join(DIST, p)).href);
const { PROVIDERS, getProvider, providerProblems } = await load('providers/index.js');
const { extractMessage, httpError } = await load('providers/common.js');
const { buildMailto } = await load('providers/email.js');

const ticket = { summary: 'VPN drops every 5 minutes', description: 'It disconnects.', category: 'Network', priority: 'urgent', reporter: { name: 'Jo Ex', email: 'jo@acme.example' } };
const context = { url: 'https://intranet.acme.example/x', title: 'Intranet', browser: 'Chrome 130', os: 'Windows 11', capturedAt: '2026-10-16T10:00:00.000Z' };
const png = new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' });

let calls = [];
let responder = () => new Response('{}', { status: 200 });
beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => { calls.push({ url: String(url), opts }); return responder(String(url), opts, calls.length); };
});
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const header = (c, name) => Object.entries(c.opts.headers || {}).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
const b64 = (s) => Buffer.from(s).toString('base64');

test('every provider exposes id, label, fields, endpoint, submit, test', () => {
  assert.deepEqual(PROVIDERS.map((p) => p.id), ['webhook', 'jsm', 'zendesk', 'freshdesk', 'servicenow', 'email']);
  for (const p of PROVIDERS) {
    assert.ok(p.label && Array.isArray(p.fields) && typeof p.submit === 'function' && typeof p.test === 'function' && typeof p.endpoint === 'function', p.id);
  }
});

test('webhook: JSON payload contract + headers + {id,url}', async () => {
  responder = () => json({ id: 'T-1', url: 'https://hd/T-1' }, 201);
  const settings = { webhookUrl: 'https://hd.example/api/tickets', webhookHeaders: { Authorization: 'Bearer abc' } };
  const r = await getProvider('webhook').submit({ ticket, context, screenshotBlob: png, settings });
  assert.deepEqual(r, { id: 'T-1', url: 'https://hd/T-1' });
  const c = calls[0];
  assert.equal(c.url, settings.webhookUrl);
  assert.equal(c.opts.method, 'POST');
  assert.equal(header(c, 'authorization'), 'Bearer abc');
  const body = JSON.parse(c.opts.body);
  assert.equal(body.source, 'ticket-snap');
  assert.deepEqual(body.ticket, { summary: ticket.summary, description: ticket.description, category: 'Network', priority: 'urgent', reporter: ticket.reporter });
  assert.equal(body.context.url, context.url);
  assert.equal(body.screenshot.mime, 'image/png');
  assert.equal(body.screenshot.dataBase64, Buffer.from([137, 80, 78, 71, 1, 2, 3]).toString('base64'));
  assert.match(body.screenshot.filename, /^screenshot-2026-10-16-10-00-00\.png$/);
});

test('webhook: screenshot null when not included; missing URL is a config error', async () => {
  responder = () => json({});
  await getProvider('webhook').submit({ ticket, context, screenshotBlob: null, settings: { webhookUrl: 'https://hd.example/t' } });
  assert.equal(JSON.parse(calls[0].opts.body).screenshot, null);
  await assert.rejects(getProvider('webhook').submit({ ticket, context, settings: { webhookUrl: '' } }), /isn't set up yet: Webhook URL/);
});

test('jsm: temp attachment → request → attach, basic auth, URL', async () => {
  const s = { jsmBaseUrl: 'acme.atlassian.net/', jsmEmail: 'bot@acme.com', jsmApiToken: 'tok', jsmServiceDeskId: '4', jsmRequestTypeId: '17', jsmSetPriority: true, jsmRaiseOnBehalf: true };
  responder = (url) => url.includes('attachTemporaryFile') ? json({ temporaryAttachments: [{ temporaryAttachmentId: 'tmp-1' }] })
    : url.endsWith('/rest/servicedeskapi/request') ? json({ issueKey: 'IT-42', _links: {} }, 201) : json({}, 201);
  const r = await getProvider('jsm').submit({ ticket, context, screenshotBlob: png, settings: s });
  assert.equal(r.id, 'IT-42');
  assert.equal(r.url, 'https://acme.atlassian.net/servicedesk/customer/portal/4/IT-42');
  assert.equal(calls.length, 3);
  const [up, create, attach] = calls;
  assert.equal(up.url, 'https://acme.atlassian.net/rest/servicedeskapi/servicedesk/4/attachTemporaryFile');
  assert.equal(header(up, 'X-ExperimentalApi'), 'opt-in');
  assert.equal(header(up, 'X-Atlassian-Token'), 'no-check');
  assert.ok(up.opts.body instanceof FormData && up.opts.body.get('file') instanceof Blob);
  assert.equal(header(create, 'Authorization'), `Basic ${b64('bot@acme.com:tok')}`);
  const body = JSON.parse(create.opts.body);
  assert.equal(body.serviceDeskId, '4');
  assert.equal(body.requestTypeId, '17');
  assert.equal(body.requestFieldValues.summary, ticket.summary);
  assert.match(body.requestFieldValues.description, /It disconnects\.[\s\S]*Page URL: https:\/\/intranet/);
  assert.deepEqual(body.requestFieldValues.priority, { name: 'Highest' });
  assert.equal(body.raiseOnBehalfOf, 'jo@acme.example');
  assert.equal(attach.url, 'https://acme.atlassian.net/rest/servicedeskapi/request/IT-42/attachment');
  assert.deepEqual(JSON.parse(attach.opts.body), { temporaryAttachmentIds: ['tmp-1'], public: true });
});

test('jsm: agent link + readable 401/404 errors', async () => {
  const s = { jsmBaseUrl: 'https://acme.atlassian.net', jsmEmail: 'a@b.c', jsmApiToken: 'x', jsmServiceDeskId: '1', jsmRequestTypeId: '2', jsmLinkTarget: 'agent' };
  responder = () => json({ issueKey: 'IT-7' }, 201);
  assert.equal((await getProvider('jsm').submit({ ticket, context, settings: s })).url, 'https://acme.atlassian.net/browse/IT-7');
  responder = () => json({ errorMessage: 'Client must be authenticated' }, 401);
  await assert.rejects(getProvider('jsm').submit({ ticket, context, settings: s }), /rejected the credentials — check the account email and API token/);
  responder = () => json({ errorMessage: 'Service desk does not exist' }, 404);
  await assert.rejects(getProvider('jsm').submit({ ticket, context, settings: s }), /check the site URL, service desk ID and request type ID \(Service desk does not exist\)/);
});

test('zendesk: upload token then request; tickets endpoint sets requester', async () => {
  const s = { zendeskSubdomain: 'acme', zendeskEmail: 'bot@acme.com', zendeskApiToken: 'zt', zendeskEndpoint: 'requests' };
  responder = (url) => url.includes('/uploads') ? json({ upload: { token: 'up-9' } }, 201) : json({ request: { id: 555 } }, 201);
  const r = await getProvider('zendesk').submit({ ticket, context, screenshotBlob: png, settings: s });
  assert.deepEqual(r, { id: '#555', url: 'https://acme.zendesk.com/hc/requests/555' });
  assert.match(calls[0].url, /^https:\/\/acme\.zendesk\.com\/api\/v2\/uploads\?filename=screenshot-.*\.png$/);
  assert.equal(header(calls[0], 'Content-Type'), 'image/png');
  assert.equal(calls[0].opts.body, png);
  assert.equal(header(calls[0], 'Authorization'), `Basic ${b64('bot@acme.com/token:zt')}`);
  const body = JSON.parse(calls[1].opts.body);
  assert.equal(calls[1].url, 'https://acme.zendesk.com/api/v2/requests');
  assert.equal(body.request.subject, ticket.summary);
  assert.deepEqual(body.request.comment.uploads, ['up-9']);
  assert.equal(body.request.priority, 'urgent');
  assert.equal(body.request.requester, undefined);

  calls = [];
  responder = () => json({ ticket: { id: 77 } }, 201);
  const r2 = await getProvider('zendesk').submit({ ticket, context, settings: { ...s, zendeskEndpoint: 'tickets' } });
  assert.equal(r2.url, 'https://acme.zendesk.com/agent/tickets/77');
  const tb = JSON.parse(calls[0].opts.body);
  assert.deepEqual(tb.ticket.requester, { name: 'Jo Ex', email: 'jo@acme.example' });
});

test('freshdesk: multipart with priority mapping and attachment', async () => {
  const s = { freshdeskDomain: 'acme.freshdesk.com', freshdeskApiKey: 'fk' };
  responder = () => json({ id: 31 }, 201);
  const r = await getProvider('freshdesk').submit({ ticket: { ...ticket, priority: 'high' }, context, screenshotBlob: png, settings: s });
  assert.deepEqual(r, { id: '#31', url: 'https://acme.freshdesk.com/a/tickets/31' });
  const c = calls[0];
  assert.equal(c.url, 'https://acme.freshdesk.com/api/v2/tickets');
  assert.equal(header(c, 'Authorization'), `Basic ${b64('fk:X')}`);
  const f = c.opts.body;
  assert.equal(f.get('email'), 'jo@acme.example');
  assert.equal(f.get('subject'), ticket.summary);
  assert.equal(f.get('priority'), '3');
  assert.equal(f.get('status'), '2');
  assert.match(f.get('description'), /<p>It disconnects\.<\/p>.*<table>/);
  assert.ok(f.get('attachments[]') instanceof Blob);
  await assert.rejects(getProvider('freshdesk').submit({ ticket: { ...ticket, reporter: { name: 'x', email: '' } }, context, settings: s }), /needs the reporter email/);
});

test('servicenow: incident with urgency/impact, attachment upload, nav_to URL', async () => {
  const s = { servicenowInstance: 'acme', servicenowAuth: 'basic', servicenowUsername: 'svc', servicenowPassword: 'pw', servicenowSetCaller: true };
  responder = (url) => url.includes('/table/incident') ? json({ result: { sys_id: 'abc123', number: 'INC0010001' } }, 201) : json({ result: {} }, 201);
  const r = await getProvider('servicenow').submit({ ticket, context, screenshotBlob: png, settings: s });
  assert.equal(r.id, 'INC0010001');
  assert.equal(r.url, `https://acme.service-now.com/nav_to.do?uri=${encodeURIComponent('incident.do?sys_id=abc123')}`);
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.short_description, ticket.summary);
  assert.equal(body.urgency, '1');
  assert.equal(body.impact, '1');
  assert.equal(body.category, 'network');
  assert.equal(body.caller_id, 'jo@acme.example');
  assert.equal(header(calls[0], 'Authorization'), `Basic ${b64('svc:pw')}`);
  const att = new URL(calls[1].url);
  assert.equal(att.pathname, '/api/now/attachment/file');
  assert.equal(att.searchParams.get('table_name'), 'incident');
  assert.equal(att.searchParams.get('table_sys_id'), 'abc123');
  assert.equal(header(calls[1], 'Content-Type'), 'image/png');

  calls = [];
  await getProvider('servicenow').submit({ ticket: { ...ticket, priority: 'low' }, context, settings: { ...s, servicenowAuth: 'bearer', servicenowToken: 'tkn' } });
  assert.equal(header(calls[0], 'Authorization'), 'Bearer tkn');
  assert.equal(JSON.parse(calls[0].opts.body).urgency, '3');
});

test('servicenow: attachment failure becomes a warning, not a failure', async () => {
  const s = { servicenowInstance: 'https://acme.service-now.com', servicenowUsername: 'u', servicenowPassword: 'p' };
  responder = (url) => url.includes('/table/incident') ? json({ result: { sys_id: 's1', number: 'INC1' } }, 201) : json({ error: { message: 'File too big' } }, 413);
  const r = await getProvider('servicenow').submit({ ticket, context, screenshotBlob: png, settings: s });
  assert.equal(r.id, 'INC1');
  assert.match(r.warnings[0], /screenshot could not be attached/);
});

test('network failures are human readable', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(getProvider('webhook').submit({ ticket, context, settings: { webhookUrl: 'https://down.example/x' } }), /Can't reach down\.example/);
});

test('email: mailto with subject/body + defaults to brand support email', async () => {
  const s = { emailTo: '', brand: { supportEmail: 'it@acme.example' } };
  const r = await getProvider('email').submit({ ticket, context, screenshotBlob: png, settings: s, attachmentName: 'shot.png' });
  assert.ok(r.mailto.startsWith('mailto:it@acme.example?subject=VPN%20drops'));
  assert.match(decodeURIComponent(r.mailto), /Please attach the screenshot: shot\.png/);
  assert.equal(r.downloadScreenshot, true);
  const long = buildMailto({ ticket: { ...ticket, description: 'x'.repeat(5000) }, context, settings: s });
  assert.ok(long.length <= 1900);
  assert.deepEqual(providerProblems({ provider: 'email', emailTo: '', brand: {} }), ['Send to']);
});

test('error message extraction', () => {
  assert.equal(extractMessage('{"errors":{"email":"is invalid"}}'), 'email: is invalid');
  assert.equal(extractMessage('{"description":"Validation failed","errors":[{"field":"email","message":"It should be a valid email"}]}'), 'email: It should be a valid email · Validation failed');
  assert.match(httpError(429, '').message, /rate limiting/);
  assert.match(httpError(503, '').message, /server error \(HTTP 503\)/);
});
