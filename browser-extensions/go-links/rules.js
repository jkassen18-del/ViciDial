// declarativeNetRequest rules for the address bar. Pure (no browser APIs) so it can be tested.
//
// 1. Literal short links:  http(s)://go/<anything>  →  go.html#<anything>
// 2. Searches for "go/<key>" that the browser sent to a search engine because it did not
//    recognise "go/payroll" as a URL  →  go.html?s=<form-encoded query>
//
// All regexes are RE2-compatible (no look-around, no backreferences) as Chrome requires.

export const LITERAL_RULE_ID = 1;
export const SEARCH_RULE_BASE = 10;

/** Search engines whose result URLs are watched. The host list must match manifest host_permissions. */
export const SEARCH_ENGINES = [
  { id: 'google', name: 'Google', host: 'www.google.com', path: '/search\\?', param: 'q' },
  { id: 'bing', name: 'Bing', host: 'www.bing.com', path: '/search\\?', param: 'q' },
  { id: 'duckduckgo', name: 'DuckDuckGo', host: 'duckduckgo.com', path: '/(?:html/?)?\\?', param: 'q' },
  { id: 'yahoo', name: 'Yahoo', host: 'search.yahoo.com', path: '/search[^?#]*\\?', param: 'p' },
  { id: 'ecosia', name: 'Ecosia', host: 'www.ecosia.org', path: '/search\\?', param: 'q' },
  { id: 'brave', name: 'Brave Search', host: 'search.brave.com', path: '/search\\?', param: 'q' },
];

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function validShortHost(host) {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(String(host || ''));
}

/**
 * @param {{ shortHost:string, literal:boolean, searches:boolean, goPage:string }} opts
 *   goPage = runtime.getURL('go.html')
 */
export function buildRules({ shortHost = 'go', literal = true, searches = true, goPage }) {
  const rules = [];
  const host = esc(shortHost.toLowerCase());
  if (literal) {
    rules.push({
      id: LITERAL_RULE_ID,
      priority: 2,
      action: { type: 'redirect', redirect: { regexSubstitution: `${goPage}#\\1` } },
      condition: { regexFilter: `^https?://${host}/(.*)$`, resourceTypes: ['main_frame'] },
    });
  }
  if (searches) {
    SEARCH_ENGINES.forEach((e, i) => {
      rules.push({
        id: SEARCH_RULE_BASE + i,
        priority: 1,
        action: { type: 'redirect', redirect: { regexSubstitution: `${goPage}?s=\\1` } },
        condition: {
          // q=go%2Fpayroll… or q=go/payroll…  (first char after the slash must look like a key)
          regexFilter: `^https://${esc(e.host)}${e.path}(?:[^#]*&)?${e.param}=${host}(?:%2[fF]|/)([a-zA-Z0-9][^&#]*).*$`,
          resourceTypes: ['main_frame'],
        },
      });
    });
  }
  return rules;
}

/** Short human-readable description of active rules (for the options page). */
export function ruleSummary(rules) {
  return rules.map((r) => {
    const engine = SEARCH_ENGINES[r.id - SEARCH_RULE_BASE];
    return { id: r.id, label: r.id === LITERAL_RULE_ID ? 'Literal short links' : `${engine?.name || 'Search'} searches`, regex: r.condition?.regexFilter };
  });
}
