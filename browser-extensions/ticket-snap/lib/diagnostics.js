// Diagnostics attached to tickets. Admins switch items off with the
// `diagnostics` setting; users may drop the page URL when `allowRemoveUrl` is on.

export const DIAGNOSTIC_ITEMS = [
  { key: 'url', label: 'Page URL', help: 'Full address of the page the problem happened on.' },
  { key: 'title', label: 'Page title', help: 'Title of the tab.' },
  { key: 'browser', label: 'Browser', help: 'Browser name and full version.' },
  { key: 'os', label: 'Operating system', help: 'OS name and version.' },
  { key: 'arch', label: 'Architecture', help: 'CPU architecture, e.g. x86-64 or arm-64.' },
  { key: 'language', label: 'Language', help: 'Browser UI language.' },
  { key: 'timeZone', label: 'Time zone', help: 'Helps correlate with server logs.' },
  { key: 'screen', label: 'Screen', help: 'Screen resolution and pixel ratio.' },
  { key: 'viewport', label: 'Viewport', help: 'Size of the page area when it was captured.' },
  { key: 'zoom', label: 'Page zoom', help: 'Zoom level of the tab.' },
  { key: 'capturedAt', label: 'Captured at', help: 'Date and time of the capture.' },
  { key: 'extensionVersion', label: 'Extension version', help: 'Version of Ticket Snap.' },
  { key: 'userAgent', label: 'User agent', help: 'Raw user-agent string (usually not needed).' },
];

export const DIAGNOSTIC_LABELS = Object.fromEntries(DIAGNOSTIC_ITEMS.map((d) => [d.key, d.label]));

/**
 * Builds the full diagnostics object from the capture context and environment info.
 * @param {object} capture  context stored by the background (url, title, viewport, zoom, capturedAt)
 * @param {object} env      result of getEnvironmentInfo()
 * @param {string} version  extension version
 */
export function collectDiagnostics(capture = {}, env = {}, version = '') {
  const os = [env.os, env.osVersion].filter(Boolean).join(' ');
  const ratio = Number(env.pixelRatio) || 1;
  return {
    url: capture.url || '',
    title: capture.title || '',
    browser: [env.browser, env.browserVersion].filter(Boolean).join(' '),
    os,
    arch: env.arch || '',
    language: env.language || '',
    timeZone: env.timeZone || '',
    screen: env.screen ? `${env.screen}${ratio !== 1 ? ` @${Math.round(ratio * 100) / 100}x` : ''}` : '',
    viewport: capture.viewport || '',
    zoom: capture.zoom || '',
    capturedAt: capture.capturedAt || new Date().toISOString(),
    extensionVersion: version || '',
    userAgent: env.userAgent || '',
  };
}

/** Keeps only the items enabled by settings (and drops empty values). */
export function filterDiagnostics(full, enabled = {}, { includeUrl = true } = {}) {
  const out = {};
  for (const { key } of DIAGNOSTIC_ITEMS) {
    if (enabled[key] === false) continue;
    if (key === 'url' && !includeUrl) continue;
    const v = full[key];
    if (v !== undefined && v !== null && v !== '') out[key] = v;
  }
  return out;
}

/** Human-friendly value (dates formatted). */
export function displayValue(key, value) {
  if (key === 'capturedAt') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return `${d.toLocaleString()} (${d.toISOString()})`;
  }
  return String(value);
}
