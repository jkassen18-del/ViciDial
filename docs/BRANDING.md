# Branding and personalization

The UI reads its identity from one place, so you can make the system look
and feel like your own business without touching code.

## Quick start

1. Log into Administration as a level-9 user.
2. Open **Admin → Branding** (`/vicidial/admin_branding.php`).
3. Set the company name, product name, tagline, upload a logo, pick a
   theme and accent colour, and write the greeting your agents should see.
4. Save. The agent login, agent console, every admin/report page and the
   welcome page pick the new look up on their next load.

Settings are written to `www/xf_brand_custom.json` and uploaded logos to
`www/agc/images/brand/`. Both must be writable by the web server user
(usually `apache` or `www-data`):

```
touch /srv/www/htdocs/xf_brand_custom.json
chown apache /srv/www/htdocs/xf_brand_custom.json /srv/www/htdocs/agc/images/brand
```

(adjust the path to wherever `www/` is deployed). The Branding page warns
you if it cannot write.

## What you can personalise

| Setting | Where it shows |
|---------|----------------|
| Company name, product name | Browser titles, login card, console brand bar, admin sidebar, welcome page |
| Tagline | Welcome page |
| Logo (+ height) | Login card, console brand bar, admin sidebar, logout screen, welcome page |
| Theme preset | Whole UI: Midnight Gold, Royal Navy, Emerald, Ruby, Platinum |
| Accent colour | Buttons, highlights, selected navigation, badges. Text on the accent flips between dark and light automatically for contrast |
| Corner style | Rounded, soft or sharp cards and controls |
| Headline typeface | Editorial serif or modern sans for names and headings |
| Login message | Under the sign-in button |
| Agent greeting | "Good morning, Alexandra. <your text>" on the console, using the agent's first name and the server's local time |
| Today's focus | A pinned highlight on the console for a target or floor note. Blank hides it |
| Support line | Pill in the console brand bar and in footers |
| Footer text, Powered-by toggle | Login, console and welcome footers |

## Editing by hand

`www/xf_brand_defaults.php` lists every key with its default. To override
without the admin page, create `www/xf_brand_custom.json` with only the keys
you want to change:

```json
{
  "company_name": "Meridian Capital",
  "product_name": "Client Desk",
  "logo": "agc/images/brand/meridian.svg",
  "theme": "royal",
  "accent_color": "#7fd1ff",
  "greeting_suffix": "Thank you for being here today."
}
```

## How it works

* `www/xf_brand.php` loads defaults + overrides and exposes helpers
  (`xf_brand()`, `xf_brand_logo_tag()`, `xf_brand_greeting()`, …).
* `www/xf_brand_css.php` serves the chosen theme as CSS custom properties.
  Both `agc/css/custom.css` and `vicidial/css/xf-admin.css` `@import` it
  after the base theme, so brand values win without editing the theme.
* Every brand change is logged to `vicidial_admin_log` with record id
  `BRANDING`.
* If the JSON file is missing or invalid the defaults apply, so a bad edit
  can never take the console down.

## Adding a theme preset

Add an entry to `xf_brand_presets()` in `www/xf_brand.php` with the accent
and the five surface colours. It appears in the Branding page automatically.
