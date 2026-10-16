// Hostname helpers and a small pattern language shared by the extensions.
//
// Pattern forms accepted by matchHost / matchUrl:
//   example.com          the domain and any subdomain (www.example.com, a.b.example.com)
//   =example.com         exactly this host
//   *.example.com        subdomains only
//   app-*.example.com    glob on the host ("*" = any run of characters)
//   example.com/admin*   host pattern plus a path glob (matchUrl only)
//   re:^https://.+\.prod\.  a JavaScript regular expression tested against the full URL

// Multi-label public suffixes common in business use. Not the full Public
// Suffix List, but enough to group app usage by organisation domain.
const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'ltd.uk', 'plc.uk', 'me.uk', 'net.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'org.nz', 'co.za', 'org.za', 'co.in', 'net.in', 'org.in', 'co.jp', 'ne.jp', 'or.jp',
  'com.br', 'com.mx', 'com.ar', 'com.co', 'com.sg', 'com.hk', 'com.tw', 'com.cn', 'com.tr',
  'co.kr', 'co.il', 'com.my', 'com.ph', 'com.pk', 'com.ng', 'com.eg', 'com.sa', 'co.id', 'co.th',
  'github.io', 'gitlab.io', 'herokuapp.com', 'azurewebsites.net', 'cloudfront.net',
  'appspot.com', 'web.app', 'firebaseapp.com', 'vercel.app', 'netlify.app', 'pages.dev',
  'workers.dev', 'onrender.com', 'fly.dev', 'blob.core.windows.net', 'sharepoint.com',
  'my.salesforce.com', 'lightning.force.com', 'atlassian.net', 'zendesk.com', 'freshdesk.com',
  'service-now.com', 'slack.com', 'notion.site', 'myshopify.com', 'okta.com', 'onelogin.com',
]);

/** Lower-cased hostname of a URL, or '' if it cannot be parsed. */
export function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/\.$/, ''); } catch { return ''; }
}

export function isIp(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

/**
 * Registrable ("organisation") domain: mail.google.com -> google.com,
 * news.bbc.co.uk -> bbc.co.uk, acme.atlassian.net -> acme.atlassian.net.
 */
export function registrableDomain(host) {
  host = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!host || isIp(host) || !host.includes('.')) return host;
  const labels = host.split('.');
  for (let n = Math.min(4, labels.length - 1); n >= 2; n--) {
    const suffix = labels.slice(-n).join('.');
    if (MULTI_PART_SUFFIXES.has(suffix)) return labels.slice(-(n + 1)).join('.');
  }
  return labels.slice(-2).join('.');
}

function escapeRe(s) { return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'); }

/** Converts a glob ("*" wildcard) to an anchored RegExp. */
export function globToRegExp(glob, flags = 'i') {
  return new RegExp('^' + glob.split('*').map(escapeRe).join('.*') + '$', flags);
}

const reCache = new Map();
function cachedRe(key, make) {
  let re = reCache.get(key);
  if (!re) { try { re = make(); } catch { re = /$^/; } reCache.set(key, re); }
  return re;
}

/** Tests a hostname against a host pattern (see the header comment). */
export function matchHost(host, pattern) {
  host = String(host || '').toLowerCase();
  let p = String(pattern || '').trim().toLowerCase();
  if (!p || !host) return false;
  p = p.replace(/^[a-z]+:\/\//, '').split('/')[0].replace(/:\d+$/, '');
  if (p.startsWith('=')) return host === p.slice(1);
  if (p.includes('*')) return cachedRe('h:' + p, () => globToRegExp(p)).test(host);
  return host === p || host.endsWith('.' + p);
}

/** Tests a full URL against a pattern (host pattern, optional path glob, or re:). */
export function matchUrl(url, pattern) {
  const p = String(pattern || '').trim();
  if (!p) return false;
  if (p.startsWith('re:')) return cachedRe('r:' + p, () => new RegExp(p.slice(3), 'i')).test(url);
  let u;
  try { u = new URL(url); } catch { return false; }
  const stripped = p.replace(/^[a-z]+:\/\//i, '');
  const slash = stripped.indexOf('/');
  const hostPart = slash === -1 ? stripped : stripped.slice(0, slash);
  const pathPart = slash === -1 ? '' : stripped.slice(slash);
  const portMatch = hostPart.match(/:(\d+)$/);
  if (portMatch && u.port !== portMatch[1]) return false;
  if (!matchHost(u.hostname, hostPart)) return false;
  if (!pathPart) return true;
  return cachedRe('p:' + pathPart, () => globToRegExp(pathPart)).test(u.pathname + u.search);
}

/** True if the URL matches any pattern in the list. Returns the matching pattern or null. */
export function firstMatch(url, patterns) {
  for (const p of patterns || []) if (matchUrl(url, p)) return p;
  return null;
}

/** True for pages extensions cannot script (browser UI, stores, other extensions). */
export function isRestrictedUrl(url) {
  return !/^(https?|file):/i.test(url || '') ||
    /^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com|microsoftedge\.microsoft\.com\/addons|addons\.mozilla\.org)/i.test(url);
}
