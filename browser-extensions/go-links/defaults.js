// Default settings for Go-Links. Every key here is also described in schema.json
// so IT can enforce it (top-level key) or suggest it (inside "defaults").

export const DEFAULTS = {
  /** Remote JSON link sources, in precedence order: [{ url, name?, department? }] */
  sources: [],
  /** Inline links (usually pushed by managed policy). Highest precedence. */
  links: [],
  /** Let people create their own personal go-links. */
  allowPersonalLinks: true,
  /** The person's own links (same format as a source's `links`). */
  personalLinks: [],
  /** How often sources are re-fetched, in minutes (5 – 1440). */
  refreshMinutes: 60,
  /** Host name typed before the slash: go/payroll, to/payroll, l/payroll … */
  shortHost: 'go',
  /** Redirect http://go/… navigations to the resolver (declarativeNetRequest). */
  literalRedirect: true,
  /** Catch "go/…" searches on Google, Bing, DuckDuckGo, Yahoo, Ecosia and Brave Search. */
  catchSearches: true,
  /** Open links picked in the popup/directory in a new tab instead of the current one. */
  openInNewTab: false,
  /** Show the Featured section in the popup. */
  showFeatured: true,
  /** Count how often you open each link (stored only on this device) to rank results. */
  trackUsage: true,
  /** Optional message shown under the directory headline (e.g. "Welcome to Acme!"). */
  welcomeMessage: '',
};

export const PRODUCT = 'Go-Links';
export const MIN_REFRESH = 5;
export const MAX_REFRESH = 1440;
