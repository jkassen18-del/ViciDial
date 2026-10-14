# X Frontline UI revamp — what changed and how to tune it

The revamp is almost entirely CSS. No call-flow, AJAX, database or Asterisk
code was touched, so every feature behaves exactly as before.

## Files

| File | Role |
|------|------|
| `www/agc/css/xf-theme.css` | Shared design system: colour tokens, typography, form controls, buttons, scrollbars, and the mapping of ViciDial's legacy `BGCOLOR`/`<FONT>` palette onto the dark theme. Edit the `:root` tokens here to re-brand (gold accent, surfaces, state colours). |
| `www/agc/css/custom.css` | Agent console (login screen, header card, action rails, contact/transfer/script/options panels, modals). Imports `xf-theme.css`. |
| `www/agc/css/custom_legacy.css` | The previous agent stylesheet, kept for reference. |
| `www/vicidial/css/xf-admin.css` | Administration and reports. Imports `xf-theme.css` and restyles the table-driven admin header into a sidebar + content layout. |
| `www/agc/images/xf-logo.svg` | New wordmark used on the login screen, agent console and admin sidebar. Replace this file to brand the system. |
| `www/vicidial/welcome.php` | Landing page rebuilt as a premium card. Links are unchanged. |
| `docs/X-LITE_SOFTPHONE_SETUP.md` | How to pair X-Lite (or any SIP softphone) with the system. |
| `www/xf_brand.php`, `www/xf_brand_defaults.php`, `www/xf_brand_css.php` | Branding layer: company identity, logo, theme preset, accent colour and personal messages. See `docs/BRANDING.md`. |
| `www/vicidial/admin_branding.php` | Admin → Branding editor with live preview. |

## PHP touch points

* `www/agc/vicidial.php` — viewport meta tag, logo path, and the four panel
  colour constants (`$MAIN_COLOR`, `$SCRIPT_COLOR`, `$FORM_COLOR`,
  `$SIDEBAR_COLOR`) switched to dark surfaces.
* `www/vicidial/admin_header.php` — logo path.
* Every admin / report page and the agent sub-pages (timeclock, script and
  form displays, call-log popups) got a single `<link rel=stylesheet ...>`
  tag injected before `</head>` so they pick up the theme. Pure AJAX
  responders were deliberately left alone.

## Design language

* Dark graphite surfaces, champagne-gold accent, ivory type.
* Display serif for names and headings, system sans for UI, mono for timers.
* Live-call state is colour coded: emerald (on call, pulsing), amber (hold),
  rose (dead/dropped).
* No web fonts are fetched: the stacks fall back to system fonts, so agent
  desktops on an isolated LAN render identically and nothing blocks on the
  network.

## Browser support

Modern Chrome, Edge, Firefox and Safari. Two selectors use `:has()`
(hiding empty transfer rows and a divider in the admin nav); older browsers
simply show those as thin empty strips.
