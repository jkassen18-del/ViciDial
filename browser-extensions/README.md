# Workplace browser extensions

Five branded extensions for **Chrome, Edge and Firefox**, built from one
Manifest V3 codebase. Each company that uses them gets its own name, logo,
colours and support links through a single brand kit file, and IT can manage
and lock any setting through browser policy.

| Extension | What it does | Docs |
|---|---|---|
| **Ticket Snap** | Screenshot the tab, annotate it (arrows, boxes, highlights, redaction, crop), attach browser/OS diagnostics automatically and submit a ticket to Jira Service Management, Zendesk, Freshdesk, ServiceNow, a webhook or email. | [ticket-snap/](ticket-snap/README.md) |
| **Data Leak Guard** | Detects card numbers, national ID numbers, secrets/API keys, "Confidential" markers and custom patterns being pasted, dropped, uploaded or submitted to unapproved sites (AI chatbots, personal email, file sharing), then warns or blocks according to policy. Content never leaves the browser. | [dlp-guard/](dlp-guard/README.md) |
| **SaaS Usage Reporter** | Records which SaaS apps are used, **by domain only**, against a 330-app catalog. Shows approved, unapproved and unused-licence apps on a dashboard and reports anonymous totals to IT. | [saas-reporter/](saas-reporter/README.md) |
| **Environment Labeler** | Red/amber/green ribbons, tinted favicons, title prefixes, toolbar badges and an "are you sure?" before submitting forms on production. | [env-labeler/](env-labeler/README.md) |
| **Go-Links** | Type `go/payroll`, `go/vpn`, `go/jira/ABC-123` in the address bar. Company-wide and per-department link lists are managed centrally, and a searchable directory doubles as the onboarding hub. Staff can add personal links. | [go-links/](go-links/README.md) |

## Quick start (testing)

Requires Node 18+. No `npm install` is needed: the build has no dependencies.

```bash
cd browser-extensions
npm run build          # builds all 5 extensions for chrome, edge and firefox
npm run dev-server     # optional: local backend for tickets, DLP incidents, SaaS reports and sample config
```

Then load an unpacked build:

| Browser | How |
|---|---|
| **Chrome** | `chrome://extensions` → enable *Developer mode* → **Load unpacked** → `dist/chrome/<extension>` |
| **Edge** | `edge://extensions` → enable *Developer mode* → **Load unpacked** → `dist/edge/<extension>` |
| **Firefox** | `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick `dist/firefox/<extension>/manifest.json` |

Store-ready zips are written next to each folder (`dist/<browser>/<extension>-<version>.zip`).

### Trying each one with the dev server

`npm run dev-server` starts http://localhost:8787 with a dashboard that shows everything it receives.

* **Ticket Snap**: Settings → Helpdesk → *Webhook* → `http://localhost:8787/api/tickets`. Then click the toolbar icon (or press Alt+Shift+S) on any page.
* **Data Leak Guard**: works out of the box. Paste `4111 1111 1111 1111` into any text box. For reporting, set Settings → Reporting → `http://localhost:8787/api/dlp/incidents`.
* **SaaS Usage Reporter**: browse a few SaaS sites, then open the dashboard from the popup. Settings → Reporting → `http://localhost:8787/api/saas/reports` → *Send report now*. About → Advanced can load demo data.
* **Environment Labeler**: open `http://localhost:<any port>` to see the DEV label, or add your own production host in Settings → Rules. Remote rules: `http://localhost:8787/config/env-rules.json`.
* **Go-Links**: Settings → Sources → add `http://localhost:8787/config/go-links.json` (and `go-links-engineering.json`). Then type `go/payroll` in the address bar, or `go` + space + `payroll`.

## Branding (per company)

Every page, popup, in-page dialog and toolbar icon takes its look from the brand kit.

```jsonc
// brand/brand.json
{
  "companyName": "Acme Inc.",
  "productPrefix": "Acme",              // store name becomes "Acme Go-Links"
  "logo": "logo.svg",                   // path relative to this file (SVG/PNG), URL or data: URI
  "primary": "#4F46E5",                 // buttons, highlights and toolbar icon colour
  "accent": "#0EA5E9",                  // gradients and secondary actions
  "theme": "auto",                      // auto | light | dark
  "radius": 10,                         // corner roundness in px
  "supportUrl": "https://intranet.acme.example/it-help",
  "supportEmail": "it-help@acme.example",
  "footerText": "Managed by Acme IT",
  "extensionIdDomain": "acme.example"   // Firefox add-on IDs become <extension>@acme.example
}
```

There are three ways to apply a brand:

1. **At build time**: edit `brand/brand.json` or pass another kit, for example
   `node tools/build.mjs --brand brand/examples/summit-logistics.json`
   (two sample kits are included). Icons are re-coloured automatically.
2. **By policy**: push a `brand` object (or just some of its fields) to every browser. Enforced fields are locked in the UI.
3. **In the UI**: every extension has a Settings → **Branding** page with a live preview, logo upload,
   colour presets and theme. It can export the result as a brand kit file to drop into `brand/brand.json`.

## Managing with policy

Every extension reads `storage.managed`, which is configured through Chrome or Edge policy, macOS profiles
or Firefox `policies.json`:

* keys inside `defaults` are suggestions that users can change
* every other key is enforced and shows as **Managed** (locked) in Settings

Each extension's `schema.json` documents its keys, and its README has a policy example.
Settings → **Backup & policy → Generate policy** turns a configured browser into ready-to-deploy JSON.
See [examples/policies/](examples/policies/README.md) for Windows registry, macOS, Linux and Firefox
examples and for force-installing the extensions.

## Repository layout

```
browser-extensions/
├── brand/                 brand kit (brand.json + logo) and example kits
├── shared/                shared UI, settings/policy layer, branding, helpers (see shared/README.md)
├── ticket-snap/  dlp-guard/  saas-reporter/  env-labeler/  go-links/
├── examples/              sample go-links / env-rules JSON and enterprise policy files
├── tools/
│   ├── build.mjs          builds dist/<browser>/<extension> + zips, generates brand icons
│   ├── check.mjs          syntax check + full build with reference validation (npm run check)
│   ├── dev-server.mjs     local backend for testing
│   └── screenshot.mjs     headless Chromium screenshots of any extension page
└── dist/                  build output (git-ignored)
```

How the build handles each browser:

* **Chrome and Edge**: the manifest is used as is.
* **Firefox**: the service worker becomes `background.scripts`, and the build adds a gecko ID and a `strict_min_version` of 128. It also removes keys Firefox doesn't support.
* **Per-browser differences**: anything else that differs lives under `browser_overrides` in each `manifest.json`.

## Checks

```bash
npm run check                                                   # syntax, JSON, build and file references
npx --yes web-ext@8 lint --source-dir dist/firefox/<extension>  # Firefox linter (0 errors, 0 warnings)
node tools/screenshot.mjs --ext go-links --page directory.html --out shot.png --wait 3000
```

## Publishing

* **Chrome Web Store / Edge Add-ons**: upload `dist/chrome/<ext>-<version>.zip` or `dist/edge/…`. Publish as *unlisted* or private to your organization, then force-install by policy.
* **Firefox**: release Firefox installs only signed add-ons. Sign the Firefox build with
  `npx web-ext sign --channel unlisted --source-dir dist/firefox/<ext>` (needs AMO API keys), host the `.xpi` and force-install it with `ExtensionSettings`.
