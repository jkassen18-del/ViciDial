# Go-Links

Type `go/payroll`, `go/handbook` or `go/vpn` in the address bar and land on the right page.
Go-Links is also the company's onboarding directory: every department's links (HR, IT,
Marketing, Sales, Finance, Engineering, Facilities…) in one branded, searchable place.
Links are published centrally as JSON files. People can add their own personal links on top.

Works in Chrome, Edge and Firefox (128+) from one Manifest V3 source tree.

## Features

- **Address bar, three ways**
  - `go/payroll` or `http://go/payroll`: a declarativeNetRequest rule redirects `http(s)://go/…`
    to the resolver before the browser looks up the host name. It also works when "go"
    does not resolve in DNS.
  - Searches for `go/payroll` are caught when the browser sends them to Google, Bing,
    DuckDuckGo, Yahoo, Ecosia or Brave Search.
  - **Omnibox keyword:** type `go`, then Space or Tab, then a name. You get up to 6 live
    suggestions. Chrome and Edge show them with highlighting; Firefox shows plain text.
    "current tab", "new tab" and "background tab" dispositions are all respected.
  - Fallback: if a navigation to `http://go/…` fails anyway (for example with DNR turned off
    by the browser), `webNavigation.onErrorOccurred` sends the tab to the resolver.
- **Resolver page (`go.html`)** resolves through the background and calls `location.replace()`.
  The page shows nothing unless resolution takes more than 350 ms. When a link doesn't exist,
  it shows a branded "go/xyz isn't a link yet" page with:
  - fuzzy suggestions (they keep any extra path and query you typed)
  - live search
  - an inline "Create go/xyz" form for a personal link
  - a link to the directory
- **Popup:**
  - The search box is focused when the popup opens. Use ↑ ↓ to move, Enter to open and
    Ctrl/⌘+Enter to open in a new tab.
  - Department chips filter the list.
  - Sections: Most used, Featured and My links.
  - Copy-link buttons.
  - "Add link for this tab" fills in the URL and title of the current page.
  - Empty, loading and "no web tab" states are handled.
- **Directory (`directory.html`):**
  - Hero with the company brand and a big search box. Press `/` to focus it.
  - "New here? Start with these" shows featured links.
  - Department sidebar with counts (chips on narrow screens).
  - Responsive card grid. Each card shows the favicon, title, go-key, description, tags and
    aliases, with copy and open buttons.
  - "Using go-links" tips.
  - The date each source was last updated.
  - **My links** tab: add, edit and delete personal links, and import/export them as JSON in
    the same format as a source. Conflicts with company links are flagged.
- **Options:**
  - Sources: add a source (it is tested first, and access to the host is requested if
    needed), remove, reorder, status badges, link counts, last fetch time, skipped entries,
    duplicate-key warnings, "Refresh now", and help on the file format.
  - Address bar: short host, literal redirect, catching searches, a note on the keyword, the
    live list of active redirect rules, and granting access to a custom host.
  - Personal links: allow them, and edit the list.
  - Behaviour.
  - Branding, Backup & policy, and About.
  - Every setting respects policy locks.
- **Branding** applies to every page through `initPage()`: logo, colours, theme, radius and footer.
  The hero gradient follows the brand colours.

## Try it

```bash
node tools/build.mjs --browsers chrome,edge,firefox --only go-links
node tools/dev-server.mjs --port 8787     # serves the example link files with CORS
```

1. Load `dist/chrome/go-links` as an unpacked extension (or use `about:debugging` in Firefox
   with `dist/firefox/go-links`).
2. Open **Settings → Sources** and add both of these sources:
   - `http://localhost:8787/config/go-links.json`
   - `http://localhost:8787/config/go-links-engineering.json`
3. Save.
4. Type `go/payroll`, `go/jira/ABC-123` or `go/wiki/vpn setup` in the address bar. You can
   also type `go`, then Space, then `pay`.

> **First-time tip.** Chrome and Edge may treat a bare `go/payroll` as a search until they
> know that "go" is a host. The search-engine rules catch this case. Typing
> `http://go/payroll` once, or using the `go` keyword, also teaches the browser.

## Link file format

```json
{
  "name": "Acme company links",
  "updated": "2026-10-01",
  "links": [
    { "key": "payroll", "url": "https://payroll.acme.example", "title": "Payroll & payslips",
      "description": "View payslips and tax forms.", "department": "HR",
      "tags": ["pay"], "aliases": ["pay", "salary"], "featured": true, "owner": "hr@acme.example" },
    { "key": "jira", "url": "https://acme.atlassian.net/browse/{1}", "home": "https://acme.atlassian.net/jira", "title": "Jira" },
    { "key": "wiki", "url": "https://wiki.acme.example/search?q={*}", "home": "https://wiki.acme.example", "title": "Wiki" }
  ]
}
```

A bare array of links is also accepted. Invalid entries are skipped and listed in the
options page. Only `http:` and `https:` targets are allowed.

### Resolution rules

The logic lives in `resolver.js`, a pure module that is unit-tested in Node.

| Rule | Behaviour |
|---|---|
| Case | Keys are case-insensitive. Allowed characters: `a-z 0-9 . - _`. |
| `-` vs `_` | They are equivalent: `go/time_off` = `go/time-off`. If nothing matches exactly, an unambiguous match that ignores separators is tried, so `go/orgchart` finds `org-chart`. |
| Aliases | Aliases resolve to the same link. A key always beats an alias. |
| `{1}`, `{2}`… | Positional path segments, each URL-encoded: `go/pr/web/42` → `…/web/pull/42`. In the omnibox, spaces also separate them: `go jira ABC-1`. |
| `{*}` | Everything after the positional segments. In the URL path, `/` is kept between segments. In the query string the value is fully encoded (`go/wiki/vpn setup` → `?q=vpn%20setup`). |
| No arguments | Goes to `home` if the link has one. Otherwise the placeholders are removed and the URL is tidied (empty parameters and trailing slashes dropped). |
| Extra path | Extra segments are appended to the path of a link that has no placeholders, or not enough of them: `go/handbook/benefits` → `…/handbook/benefits`. |
| Query and hash | Both are forwarded: `go/handbook?section=leave#pto`. |
| Precedence | Policy `links` come first, then sources in list order, then personal links. A personal link can never replace a company key or alias. It is shown as "Hidden by …" in My links. Duplicate keys across sources are reported in options. |
| Suggestions | Ranked by key/alias exact match, then prefix, then substring; title words, tags and department; typo tolerance (Levenshtein distance with adjacent swaps); subsequence matching. Featured links and your own usage counts get a boost. |

## Settings

| Key | Type | Default | Description |
|---|---|---|---|
| `sources` | array of `{url, name?, department?}` | `[]` | Remote JSON link files, in precedence order. `department` is applied to links that don't set one. |
| `links` | array of links | `[]` | Inline links, usually pushed by policy. They have the highest precedence. |
| `allowPersonalLinks` | boolean | `true` | Lets people create personal links. |
| `personalLinks` | array of links | `[]` | The user's own links. Enforcing this key by policy locks the list. |
| `refreshMinutes` | integer | `60` | Minutes between source refreshes (5 – 1440). Sources are also refreshed on install and at browser startup. |
| `shortHost` | string | `"go"` | The word before the slash (`to/`, `l/`…). The redirect rules are rebuilt when it changes. |
| `literalRedirect` | boolean | `true` | Redirect `http(s)://<shortHost>/…`. |
| `catchSearches` | boolean | `true` | Redirect `<shortHost>/…` searches on Google, Bing, DuckDuckGo, Yahoo, Ecosia and Brave Search. |
| `openInNewTab` | boolean | `false` | Open links picked in the popup or directory in a new tab. |
| `showFeatured` | boolean | `true` | Show the Featured section in the popup. |
| `trackUsage` | boolean | `true` | Count opens locally to rank results and fill "Most used". |
| `welcomeMessage` | string | `""` | Text shown under the directory headline. |
| `brand` | object | build brand kit | `companyName`, `logo`, `primary`, `accent`, `theme`, `radius`, `supportUrl`, `supportEmail`, `footerText`. |

## Managed policy example

Top-level keys are enforced and locked in the UI. Keys inside `defaults` are suggestions
that users can change.

```json
{
  "sources": [
    { "url": "https://intranet.acme.example/go-links.json", "name": "Company" },
    { "url": "https://intranet.acme.example/go-links-engineering.json", "name": "Engineering", "department": "Engineering" }
  ],
  "links": [
    { "key": "benefits", "url": "https://hr.acme.example/benefits-2027", "title": "Benefits (2027 enrolment)", "department": "HR", "featured": true }
  ],
  "brand": { "companyName": "Acme Inc.", "primary": "#4F46E5", "accent": "#0EA5E9" },
  "defaults": { "openInNewTab": false, "refreshMinutes": 30 }
}
```

The Chrome/Edge managed-storage schema is in `schema.json`. Firefox reads the same object from
`policies.json` → `3rdparty.Extensions["go-links@<your id domain>"]`. More examples are in
`examples/policies/`.

**Hosting sources for a policy deployment:** serve the JSON with
`Access-Control-Allow-Origin: *`. Every browser can then fetch it without asking anyone for
a host permission. Sending an `ETag` or `Last-Modified` header is recommended. When Go-Links
has host access to a source, it makes conditional requests (`If-None-Match` /
`If-Modified-Since`) and includes cookies, which is useful for SSO-protected intranets.
Without host access it makes plain CORS requests without credentials, so no preflight
request is needed.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Settings, cached sources, usage counts and managed policy. |
| `alarms` | Periodic source refresh. |
| `activeTab` | "Add link for this tab" reads the URL and title of the current tab when you open the popup. |
| `declarativeNetRequestWithHostAccess` | The redirect rules for `http://go/…` and for caught `go/…` searches. |
| `webNavigation` | Fallback when a `http://go/…` navigation fails before a rule can catch it. Only failed navigations to the short host are acted on. |
| `favicon` (Chrome/Edge only) | Shows site icons from the browser's own favicon cache. The build removes it for Firefox, where `/favicon.ico` is loaded instead. |
| Host `*://go/*` | Required to redirect the short host. |
| Hosts `www.google.com`, `www.bing.com`, `duckduckgo.com`, `search.yahoo.com`, `www.ecosia.org`, `search.brave.com` | Required to redirect `go/…` searches. Only result URLs whose query starts with `go/` are matched. |
| Optional `https://*/*`, `http://*/*` | Requested for a single host only, from Settings, when a source can't be fetched with CORS or when you choose a custom short host. |

`omnibox` registers the `go` keyword. A manifest key cannot change at runtime, so the keyword
is fixed. Chrome and Edge let users rename it under Settings → Search engine → Manage →
Extensions.

## Privacy

- Go-Links only downloads the link files that are configured.
- It does not send browsing history, searches or usage anywhere. Usage counts and personal
  links stay in local extension storage.
- The redirect rules only match the short host, plus search-engine URLs whose query starts
  with `go/`.
- The Firefox build declares `data_collection_permissions: none`.
- In Firefox, favicons are loaded from each link's own site.

## Known limitations

- Keys cannot contain `/`. Hierarchical keys such as `go/eng/oncall` are treated as
  key `eng` with argument `oncall`.
- Search-engine catching only covers the main domains listed above. Country domains such as
  `google.de` are not covered.
- The omnibox keyword is fixed in the manifest. In Firefox, omnibox suggestions show plain
  text without highlighting.
- A custom `shortHost` other than `go` needs a one-time grant from Settings (Address bar →
  Grant access). A policy-enforced custom host still needs that grant, or a build with the
  host added to `host_permissions`.
- Firefox may let users withhold host permissions for MV3 extensions in about:addons. If
  they do, the redirect rules don't fire. The omnibox keyword and the popup still work.
- Usage counts are kept per browser profile and are not synced.
