// Helpers shared by the helpdesk providers: HTTP with readable errors,
// auth headers, URL normalisation and binary encoding.

import { fetchWithTimeout } from '../shared/config.js';

export class TicketError extends Error {
  constructor(message, { status = 0, detail = '', kind = 'http' } = {}) {
    super(message);
    this.name = 'TicketError';
    this.status = status;
    this.detail = detail;
    this.kind = kind;
  }
}

export function hostOf(url) {
  try { return new URL(url).host; } catch { return String(url || ''); }
}

/** "Basic …" header value; UTF-8 safe. */
export function basicAuth(user, pass) {
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `Basic ${btoa(bin)}`;
}

/** Turns "acme", "acme.zendesk.com" or "https://acme.zendesk.com/x" into "https://acme.zendesk.com". */
export function normalizeHostUrl(input, suffix = '') {
  let v = String(input || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) {
    if (suffix && !v.includes('.')) v = `${v}${suffix}`;
    v = `https://${v}`;
  }
  try {
    const u = new URL(v);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

/** Base URL that keeps a path prefix (e.g. Jira Data Center behind /jira). */
export function normalizeBaseUrl(input) {
  let v = String(input || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

/** Pulls a human message out of the many JSON error shapes helpdesks return. */
export function extractMessage(text) {
  if (!text) return '';
  let j;
  try { j = JSON.parse(text); } catch { return String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200); }
  const parts = [];
  const push = (v) => { if (v && typeof v === 'string') parts.push(v); };
  push(j.errorMessage);
  if (Array.isArray(j.errorMessages)) j.errorMessages.forEach(push);
  if (j.errors && typeof j.errors === 'object' && !Array.isArray(j.errors)) {
    for (const [k, v] of Object.entries(j.errors)) push(typeof v === 'string' ? `${k}: ${v}` : Array.isArray(v) ? `${k}: ${v.map((x) => x?.description || x?.message || x).join(', ')}` : '');
  }
  if (Array.isArray(j.errors)) j.errors.forEach((e) => push(e?.message ? `${e.field ? e.field + ': ' : ''}${e.message}` : typeof e === 'string' ? e : ''));
  if (j.error && typeof j.error === 'object') { push(j.error.message); push(j.error.detail); push(j.error.title); }
  push(typeof j.error === 'string' ? j.error : '');
  push(j.description);
  push(j.details?.base?.[0]?.description);
  push(j.message);
  return [...new Set(parts)].join(' · ').slice(0, 300);
}

/**
 * Maps an HTTP failure to a readable message.
 * @param {number} status
 * @param {string} body
 * @param {{service:string, host:string, auth?:string, notFound?:string}} hints
 */
export function httpError(status, body, { service = 'The helpdesk', host = '', auth = 'check the API token and account email', notFound = 'check the URL and IDs in settings' } = {}) {
  const detail = extractMessage(body);
  const suffix = detail ? ` (${detail})` : '';
  let msg;
  if (status === 401) msg = `${service} rejected the credentials — ${auth}.`;
  else if (status === 403) msg = `${service} says this account isn't allowed to do that — check the account's permissions${suffix}.`;
  else if (status === 404) msg = `${service} couldn't find that resource — ${notFound}${suffix}.`;
  else if (status === 400 || status === 422) msg = `${service} rejected the ticket${suffix || ' — check the configuration'}.`;
  else if (status === 413) msg = `The screenshot is too large for ${service}. Crop it or untick "Include screenshot".`;
  else if (status === 429) msg = `${service} is rate limiting requests. Wait a minute and try again.`;
  else if (status >= 500) msg = `${service} had a server error (HTTP ${status}). Try again shortly${suffix}.`;
  else msg = `${service} returned HTTP ${status}${suffix}.`;
  return new TicketError(msg, { status, detail });
}

/**
 * fetch() that throws TicketError with a readable message on network or HTTP errors.
 * @returns {Promise<Response>}
 */
export async function request(url, options = {}, hints = {}) {
  const host = hostOf(url);
  let res;
  try {
    res = await fetchWithTimeout(url, options, hints.timeout || 45000);
  } catch (err) {
    const m = String(err?.message || err);
    if (/timed out/i.test(m)) throw new TicketError(`${hints.service || hostOf(url)} didn't respond in time. Try again, or check your connection.`, { kind: 'timeout' });
    throw new TicketError(`Can't reach ${host}. Check the address in settings and your network or VPN connection.`, { kind: 'network', detail: m });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw httpError(res.status, body, { host, ...hints });
  }
  return res;
}

export async function readJson(res) {
  const text = await res.text().catch(() => '');
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Required-field check from a provider's `fields` definition. */
export function missingFields(provider, settings) {
  return (provider.fields || [])
    .filter((f) => f.required && (!f.showIf || f.showIf(settings)))
    .filter((f) => {
      const v = settings[f.key];
      return v === undefined || v === null || String(v).trim() === '';
    })
    .map((f) => f.label);
}

export function assertConfigured(provider, settings) {
  const missing = missingFields(provider, settings);
  if (missing.length) {
    throw new TicketError(`${provider.label} isn't set up yet: ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} missing. Ask IT or open Ticket Snap settings.`, { kind: 'config' });
  }
  for (const f of provider.fields || []) {
    if (f.type !== 'url' || !settings[f.key]) continue;
    const v = String(settings[f.key]).trim();
    if (!/^https?:\/\/[^\s/]+/i.test(v)) throw new TicketError(`"${f.label}" must be a full address starting with https:// (got "${v}").`, { kind: 'config' });
  }
}

export function screenshotName(context = {}) {
  const d = new Date(context.capturedAt || Date.now());
  const stamp = Number.isNaN(d.getTime()) ? 'capture' : d.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `screenshot-${stamp}.png`;
}
