import { api, extUrl } from './browser.js';

// Brand fields (all optional; missing ones fall back to DEFAULT_BRAND):
//   companyName, productPrefix, logo, primary, accent, theme ("auto"|"light"|"dark"),
//   radius (px), supportUrl, supportEmail, footerText

export const DEFAULT_BRAND = {
  companyName: 'Your Company',
  productPrefix: '',
  logo: '',
  primary: '#4F46E5',
  accent: '#0EA5E9',
  theme: 'auto',
  radius: 10,
  supportUrl: '',
  supportEmail: '',
  footerText: '',
};

export const BRAND_PRESETS = [
  { name: 'Indigo', primary: '#4F46E5', accent: '#0EA5E9' },
  { name: 'Ocean', primary: '#0369A1', accent: '#14B8A6' },
  { name: 'Forest', primary: '#15803D', accent: '#CA8A04' },
  { name: 'Teal', primary: '#0F766E', accent: '#84CC16' },
  { name: 'Crimson', primary: '#BE123C', accent: '#F59E0B' },
  { name: 'Sunset', primary: '#EA580C', accent: '#7C3AED' },
  { name: 'Violet', primary: '#7C3AED', accent: '#EC4899' },
  { name: 'Graphite', primary: '#1F2937', accent: '#3B82F6' },
];

export function normalizeBrand(brand) {
  const b = { ...DEFAULT_BRAND, ...(brand || {}) };
  if (!isHex(b.primary)) b.primary = DEFAULT_BRAND.primary;
  if (!isHex(b.accent)) b.accent = DEFAULT_BRAND.accent;
  b.radius = Math.max(0, Math.min(24, Number(b.radius) || 0));
  if (!['auto', 'light', 'dark'].includes(b.theme)) b.theme = 'auto';
  return b;
}

export function isHex(c) { return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(c || '')); }

export function hexToRgb(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Readable text colour (#fff or near-black) on top of `hex`. */
export function contrastText(hex) {
  const L = luminance(hex);
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.05) * 0.62 ? '#FFFFFF' : '#0B1020';
}

/** Absolute URL for the brand logo, or '' when none is set. */
export function logoUrl(brand) {
  const logo = brand?.logo;
  if (!logo) return '';
  if (/^(data:|https?:|blob:)/i.test(logo)) return logo;
  return extUrl(logo.replace(/^\/+/, ''));
}

/** Two-letter monogram used when no logo is configured. */
export function monogram(name) {
  const words = String(name || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
  return ((words[0]?.[0] || '?') + (words[1]?.[0] || '')).toUpperCase();
}

export function resolveTheme(theme) {
  if (theme === 'light' || theme === 'dark') return theme;
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** CSS custom properties describing a brand (for pages and shadow roots). */
export function brandCssVars(brand) {
  const b = normalizeBrand(brand);
  return {
    '--brand-primary': b.primary,
    '--brand-on-primary': contrastText(b.primary),
    '--brand-accent': b.accent,
    '--brand-on-accent': contrastText(b.accent),
    '--radius': `${b.radius}px`,
    '--radius-sm': `${Math.max(2, Math.round(b.radius * 0.6))}px`,
    '--radius-lg': `${Math.round(b.radius * 1.4)}px`,
  };
}

let themeQuery;
/** Applies brand colours, radius and theme to a page. */
export function applyBrand(brand, root = document.documentElement) {
  const b = normalizeBrand(brand);
  for (const [k, v] of Object.entries(brandCssVars(b))) root.style.setProperty(k, v);
  const set = () => root.setAttribute('data-theme', resolveTheme(b.theme));
  set();
  themeQuery?.removeEventListener?.('change', themeQuery._h);
  if (b.theme === 'auto' && globalThis.matchMedia) {
    themeQuery = matchMedia('(prefers-color-scheme: dark)');
    themeQuery._h = set;
    themeQuery.addEventListener('change', set);
  }
  return b;
}

/** Brand logo as a data: URL, for content scripts that cannot load extension URLs. */
export async function logoDataUrl(brand) {
  const url = logoUrl(brand);
  if (!url || url.startsWith('data:')) return url;
  try {
    const res = await fetch(url);
    if (!res.ok) return '';
    const type = res.headers.get('content-type') || (url.endsWith('.svg') ? 'image/svg+xml' : 'image/png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${type.split(';')[0]};base64,${btoa(bin)}`;
  } catch {
    return '';
  }
}

/** Brand prepared for content scripts: normalized, with the logo inlined. */
export async function brandForContent(brand) {
  const b = normalizeBrand(brand);
  return { ...b, logo: await logoDataUrl(b), cssVars: brandCssVars(b) };
}

export { api };
