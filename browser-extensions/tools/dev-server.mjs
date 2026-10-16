#!/usr/bin/env node
// Local test backend for the extensions. No dependencies.
//
//   node tools/dev-server.mjs [--port 8787]
//
// Receives:
//   POST /api/tickets         Ticket Snap "Webhook" provider
//   POST /api/dlp/incidents   Data Leak Guard incident reporting
//   POST /api/saas/reports    SaaS Usage Reporter periodic reports
// Serves:
//   GET  /config/go-links.json, /config/go-links-engineering.json, /config/env-rules.json
//   GET  /                    dashboard of everything received
//   GET  /api/data            the same as JSON
// Optional: set DEV_TOKEN=secret to require "Authorization: Bearer secret" on POSTs.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, '.dev-server-data');
const SHOTS = path.join(DATA, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const portArg = process.argv.indexOf('--port');
const PORT = Number(portArg > -1 ? process.argv[portArg + 1] : process.env.PORT || 8787);
const TOKEN = process.env.DEV_TOKEN || '';

const store = {
  file: (name) => path.join(DATA, `${name}.json`),
  read(name) { try { return JSON.parse(fs.readFileSync(this.file(name), 'utf8')); } catch { return []; } },
  push(name, item) { const all = this.read(name); all.unshift(item); fs.writeFileSync(this.file(name), JSON.stringify(all.slice(0, 1000), null, 2)); },
};

const CONFIG_FILES = {
  '/config/go-links.json': 'examples/go-links.json',
  '/config/go-links-engineering.json': 'examples/go-links-engineering.json',
  '/config/env-rules.json': 'examples/env-rules.json',
};

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 2));
}

function readBody(req, limit = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const time = (t) => new Date(t).toLocaleString();

function saasAggregate() {
  const latest = new Map(); // installId -> most recent report
  for (const r of store.read('saas').slice().reverse()) latest.set(r.body.installId || r.id, r.body);
  const apps = new Map();
  for (const rep of latest.values()) {
    for (const a of rep.apps || []) {
      const cur = apps.get(a.domain) || { domain: a.domain, name: a.name || a.domain, category: a.category || '', status: a.status || 'unknown', users: 0, visits: 0, activeMinutes: 0, lastSeen: '' };
      cur.users += 1; cur.visits += a.visits || 0; cur.activeMinutes += a.activeMinutes || 0;
      if ((a.lastSeen || '') > cur.lastSeen) cur.lastSeen = a.lastSeen;
      if (a.status && a.status !== 'unknown') cur.status = a.status;
      apps.set(a.domain, cur);
    }
  }
  return { installs: latest.size, apps: [...apps.values()].sort((a, b) => b.activeMinutes - a.activeMinutes) };
}

function dashboard() {
  const tickets = store.read('tickets');
  const dlp = store.read('dlp');
  const saas = saasAggregate();
  const badge = (s) => `<span class="b ${esc(s)}">${esc(s)}</span>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Extensions dev server</title>
<meta http-equiv="refresh" content="15">
<style>
body{font:14px/1.5 system-ui,sans-serif;margin:0;background:#f5f6fa;color:#0f172a}
header{background:#111827;color:#fff;padding:16px 28px}header h1{margin:0;font-size:18px}header p{margin:2px 0 0;color:#9ca3af;font-size:13px}
main{padding:24px 28px;max-width:1200px}section{background:#fff;border:1px solid #e2e5ee;border-radius:12px;margin-bottom:22px;overflow:hidden}
h2{font-size:15px;margin:0;padding:14px 16px;border-bottom:1px solid #e2e5ee;display:flex;justify-content:space-between}
table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;background:#f8fafc;padding:8px 12px}
td{padding:9px 12px;border-top:1px solid #eef0f5;vertical-align:top}td.n{text-align:right;font-variant-numeric:tabular-nums}.empty{padding:16px;color:#64748b}
.b{display:inline-block;padding:1px 8px;border-radius:99px;font-size:11.5px;font-weight:600;background:#eef0f5}
.b.sanctioned{background:#dcfce7;color:#166534}.b.unsanctioned{background:#fee2e2;color:#991b1b}.b.blocked,.b.cancelled{background:#fee2e2;color:#991b1b}.b.warned,.b.proceeded{background:#fef3c7;color:#92400e}
a{color:#4f46e5}code{background:#f1f5f9;padding:1px 5px;border-radius:4px}
</style></head><body><header><h1>Workplace extensions · dev server</h1><p>Listening on http://localhost:${PORT} · refreshes every 15s · data in <code>.dev-server-data/</code></p></header><main>
<section><h2>Ticket Snap tickets <span>${tickets.length}</span></h2>${tickets.length ? `<table><tr><th>When</th><th>Summary</th><th>Priority</th><th>Reporter</th><th>Page</th><th>Browser</th></tr>${tickets.map((t) => `<tr><td>${time(t.receivedAt)}</td><td><a href="/tickets/${t.id}">${esc(t.body.ticket?.summary)}</a></td><td>${esc(t.body.ticket?.priority)}</td><td>${esc(t.body.ticket?.reporter?.email || t.body.ticket?.reporter?.name)}</td><td>${esc(t.body.context?.url)}</td><td>${esc(t.body.context?.browser)}</td></tr>`).join('')}</table>` : '<div class="empty">No tickets yet. Point Ticket Snap\'s Webhook provider at <code>http://localhost:' + PORT + '/api/tickets</code>.</div>'}</section>
<section><h2>Data Leak Guard incidents <span>${dlp.length}</span></h2>${dlp.length ? `<table><tr><th>When</th><th>Site</th><th>Channel</th><th>Detections</th><th>Action</th><th>User decision</th><th>Justification</th></tr>${dlp.map((e) => `<tr><td>${time(e.timestamp || e.receivedAt)}</td><td>${esc(e.domain)}</td><td>${esc(e.channel)}</td><td>${(e.detections || []).map((d) => `${esc(d.ruleName || d.ruleId)}${d.count > 1 ? ' ×' + d.count : ''}`).join(', ')}</td><td>${badge(e.action)}</td><td>${badge(e.decision)}</td><td>${esc(e.justification)}</td></tr>`).join('')}</table>` : '<div class="empty">No incidents yet. Set the reporting endpoint to <code>http://localhost:' + PORT + '/api/dlp/incidents</code>.</div>'}</section>
<section><h2>SaaS usage (latest report from each of ${saas.installs} browser${saas.installs === 1 ? '' : 's'}) <span>${saas.apps.length} apps</span></h2>${saas.apps.length ? `<table><tr><th>App</th><th>Domain</th><th>Category</th><th>Status</th><th class="n">Users</th><th class="n">Visits</th><th class="n">Active min</th><th>Last seen</th></tr>${saas.apps.map((a) => `<tr><td>${esc(a.name)}</td><td>${esc(a.domain)}</td><td>${esc(a.category)}</td><td>${badge(a.status)}</td><td class="n">${a.users}</td><td class="n">${a.visits}</td><td class="n">${Math.round(a.activeMinutes)}</td><td>${esc(a.lastSeen)}</td></tr>`).join('')}</table>` : '<div class="empty">No reports yet. Set the report endpoint to <code>http://localhost:' + PORT + '/api/saas/reports</code> and click "Send report now".</div>'}</section>
<section><h2>Config files served</h2><table>${Object.keys(CONFIG_FILES).map((p) => `<tr><td><a href="${p}">http://localhost:${PORT}${p}</a></td></tr>`).join('')}</table></section>
</main></body></html>`;
}

function ticketPage(t) {
  const b = t.body;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(b.ticket?.summary)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:0;background:#f5f6fa;color:#0f172a}main{max-width:1000px;margin:0 auto;padding:24px}
.card{background:#fff;border:1px solid #e2e5ee;border-radius:12px;padding:18px;margin-bottom:16px}img{max-width:100%;border:1px solid #e2e5ee;border-radius:8px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px}dt{color:#64748b}dd{margin:0;overflow-wrap:anywhere}pre{white-space:pre-wrap;margin:0}</style></head>
<body><main><p><a href="/">← All tickets</a></p><div class="card"><h1 style="margin:0 0 6px;font-size:20px">${esc(b.ticket?.summary)}</h1>
<p style="color:#64748b;margin:0 0 12px">${esc(b.ticket?.category)} · ${esc(b.ticket?.priority)} · ${time(t.receivedAt)}</p><pre>${esc(b.ticket?.description)}</pre></div>
${t.screenshot ? `<div class="card"><img src="/tickets/${t.id}/screenshot.png" alt="Screenshot"></div>` : ''}
<div class="card"><h3 style="margin-top:0">Context</h3><dl>${Object.entries(b.context || {}).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</dd>`).join('')}</dl></div>
<div class="card"><h3 style="margin-top:0">Reporter</h3><dl>${Object.entries(b.ticket?.reporter || {}).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div></main></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname.replace(/\/+$/, '') || '/';
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (req.method === 'POST' && TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: 'Unauthorized' });

    if (req.method === 'GET' && p === '/') return send(res, 200, dashboard(), 'text/html; charset=utf-8');
    if (req.method === 'GET' && CONFIG_FILES[p]) return send(res, 200, fs.readFileSync(path.join(ROOT, CONFIG_FILES[p])));
    if (req.method === 'GET' && p === '/api/data') return send(res, 200, { tickets: store.read('tickets').map(({ body, ...t }) => ({ ...t, ticket: body.ticket, context: body.context })), dlp: store.read('dlp'), saas: saasAggregate() });

    let m;
    if (req.method === 'GET' && (m = p.match(/^\/tickets\/([\w-]+)$/))) {
      const t = store.read('tickets').find((x) => x.id === m[1]);
      return t ? send(res, 200, ticketPage(t), 'text/html; charset=utf-8') : send(res, 404, { error: 'Not found' });
    }
    if (req.method === 'GET' && (m = p.match(/^\/tickets\/([\w-]+)\/screenshot\.png$/))) {
      const f = path.join(SHOTS, `${m[1]}.png`);
      return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f), 'image/png') : send(res, 404, { error: 'Not found' });
    }

    if (req.method === 'POST' && p === '/api/tickets') {
      const body = JSON.parse(await readBody(req));
      if (!body?.ticket?.summary) return send(res, 400, { error: 'ticket.summary is required' });
      const id = `T-${Date.now().toString(36).toUpperCase()}`;
      let screenshot = false;
      if (body.screenshot?.dataBase64) {
        fs.writeFileSync(path.join(SHOTS, `${id}.png`), Buffer.from(body.screenshot.dataBase64, 'base64'));
        screenshot = true;
        body.screenshot = { filename: body.screenshot.filename, mime: body.screenshot.mime, bytes: Buffer.byteLength(body.screenshot.dataBase64, 'base64') };
      }
      store.push('tickets', { id, receivedAt: new Date().toISOString(), screenshot, body });
      console.log(`🎫 ticket ${id}: ${body.ticket.summary}`);
      return send(res, 201, { id, url: `http://localhost:${PORT}/tickets/${id}` });
    }
    if (req.method === 'POST' && p === '/api/dlp/incidents') {
      const body = JSON.parse(await readBody(req));
      const events = Array.isArray(body.events) ? body.events : [body];
      for (const e of events) store.push('dlp', { ...e, installId: body.installId, receivedAt: new Date().toISOString() });
      console.log(`🛡  ${events.length} DLP incident(s) from ${body.installId || 'unknown'}`);
      return send(res, 200, { received: events.length });
    }
    if (req.method === 'POST' && p === '/api/saas/reports') {
      const body = JSON.parse(await readBody(req));
      store.push('saas', { id: crypto.randomUUID(), receivedAt: new Date().toISOString(), body });
      console.log(`📊 SaaS report: ${body.apps?.length ?? 0} apps from ${body.installId || 'unknown'}`);
      return send(res, 200, { received: true });
    }
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    send(res, 400, { error: String(err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`\nDev server running at http://localhost:${PORT}\n`);
  console.log(`  Ticket Snap webhook     POST http://localhost:${PORT}/api/tickets`);
  console.log(`  DLP incident endpoint   POST http://localhost:${PORT}/api/dlp/incidents`);
  console.log(`  SaaS report endpoint    POST http://localhost:${PORT}/api/saas/reports`);
  console.log(`  Go-links sources        GET  http://localhost:${PORT}/config/go-links.json  (+ go-links-engineering.json)`);
  console.log(`  Environment rules       GET  http://localhost:${PORT}/config/env-rules.json\n`);
});
