// Cross-browser WebExtension namespace.
// Firefox exposes the promise-based `browser.*`; Chrome and Edge (MV3) expose
// `chrome.*`, whose methods also return promises when no callback is passed.
export const api = globalThis.browser ?? globalThis.chrome;

export const IS_FIREFOX = typeof globalThis.browser !== 'undefined' &&
  /firefox/i.test(globalThis.navigator?.userAgent ?? '');

/** Absolute URL of a file packaged with the extension. */
export function extUrl(path) {
  return api.runtime.getURL(path);
}

/** The manifest version string, e.g. "1.0.0". */
export function extVersion() {
  return api.runtime.getManifest().version;
}

/** Opens (or focuses) the options page. */
export function openOptions() {
  return api.runtime.openOptionsPage();
}

/** Opens an extension page in a new tab, reusing an existing tab if one is open. */
export async function openExtensionPage(path, { reuse = true } = {}) {
  const url = extUrl(path);
  if (reuse) {
    const base = url.split('#')[0].split('?')[0];
    const tabs = await api.tabs.query({});
    const existing = tabs.find((t) => t.url && t.url.split('#')[0].split('?')[0] === base);
    if (existing) {
      await api.tabs.update(existing.id, { active: true, url });
      if (existing.windowId != null) await api.windows.update(existing.windowId, { focused: true });
      return existing;
    }
  }
  return api.tabs.create({ url });
}

/** Random UUID that works in pages and service workers. */
export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
