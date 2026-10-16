import { api, extUrl } from './browser.js';

// Settings live in storage.local under one key and are layered like this
// (later layers win):
//
//   1. extension defaults (passed by the caller)
//   2. company brand kit baked in at build time (shared/brand.json) -> settings.brand
//   3. managed policy  "defaults"  object   (IT-suggested values, user may change)
//   4. the user's own saved values           (storage.local "settings")
//   5. managed policy, every other key       (IT-enforced, locked in the UI)
//
// Keys whose default is a plain object (e.g. `brand`) are merged one level
// deep, so a policy can enforce brand.primary while the user still sets
// brand.theme. Locked paths are reported as "key" or "key.sub".

const KEY = 'settings';
let bakedBrandPromise;

export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** The brand kit compiled into this build. */
export function getBakedBrand() {
  bakedBrandPromise ??= fetch(extUrl('shared/brand.json'))
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  return bakedBrandPromise.then(clone);
}

/** Raw managed-policy object ({} when no policy is installed or the browser lacks support). */
export async function readManaged() {
  try { return (await api.storage.managed.get(null)) || {}; } catch { return {}; }
}

export async function readLocalSettings() {
  const got = await api.storage.local.get(KEY);
  return got?.[KEY] || {};
}

function layer(target, source, lockedOut, prefix = '') {
  for (const [k, v] of Object.entries(source || {})) {
    if (v === undefined) continue;
    if (isPlainObject(v) && isPlainObject(target[k])) {
      target[k] = { ...target[k], ...clone(v) };
      if (lockedOut) for (const sub of Object.keys(v)) lockedOut.add(`${prefix}${k}.${sub}`);
    } else {
      target[k] = clone(v);
      if (lockedOut) lockedOut.add(prefix + k);
    }
  }
}

/**
 * Loads effective settings.
 * @returns {{ values, base, locked:Set<string>, isLocked(path):boolean, managed, local }}
 *   values – what the extension should use
 *   base   – the same without the user's layer (what "Reset" restores)
 */
export async function loadSettings(defaults = {}) {
  const [brand, managed, local] = await Promise.all([getBakedBrand(), readManaged(), readLocalSettings()]);
  const { defaults: managedDefaults, ...enforced } = managed;

  const base = clone(defaults);
  base.brand = { ...(isPlainObject(base.brand) ? base.brand : {}), ...brand };
  layer(base, managedDefaults);

  const values = clone(base);
  layer(values, local);
  const locked = new Set();
  layer(values, enforced, locked);
  // A user value must never hide an enforced value; re-applying enforced last guarantees it.
  const isLocked = (path) => {
    if (locked.has(path)) return true;
    const top = path.split('.')[0];
    return locked.has(top);
  };
  return { values, base: (layer(base, enforced), base), locked, isLocked, managed, local };
}

/**
 * Saves top-level keys into the user layer (each key is replaced, not merged).
 * Pass `undefined` for a key to remove the user's override.
 */
export async function saveSettings(patch) {
  const local = await readLocalSettings();
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete local[k];
    else local[k] = clone(v);
  }
  await api.storage.local.set({ [KEY]: local });
  return local;
}

/** Replaces the whole user layer (used by import / reset). */
export async function replaceLocalSettings(obj) {
  await api.storage.local.set({ [KEY]: clone(obj || {}) });
}

/** Calls `cb()` whenever user settings or managed policy change. Returns an unsubscribe function. */
export function onSettingsChanged(cb) {
  const listener = (changes, area) => {
    if (area === 'managed' || (area === 'local' && KEY in changes)) cb();
  };
  api.storage.onChanged.addListener(listener);
  return () => api.storage.onChanged.removeListener(listener);
}

/**
 * Small typed key/value store for extension *data* (logs, caches, counters),
 * kept separate from settings so exports/imports never touch it.
 */
export const dataStore = {
  async get(key, fallback) {
    const got = await api.storage.local.get(`data:${key}`);
    return got[`data:${key}`] ?? fallback;
  },
  set(key, value) { return api.storage.local.set({ [`data:${key}`]: value }); },
  remove(key) { return api.storage.local.remove(`data:${key}`); },
  async update(key, fallback, fn) {
    const next = await fn(await this.get(key, fallback));
    await this.set(key, next);
    return next;
  },
};

/** Stable anonymous identifier for this browser profile (no personal data). */
export async function getInstallId() {
  let id = await dataStore.get('installId');
  if (!id) {
    id = (globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2)).toString();
    await dataStore.set('installId', id);
  }
  return id;
}

/** fetch() with a timeout that rejects with a readable message. */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`Request to ${new URL(url).host} timed out`);
    throw new Error(`Could not reach ${safeHost(url)}: ${err?.message || err}`);
  } finally {
    clearTimeout(timer);
  }
}

function safeHost(url) { try { return new URL(url).host; } catch { return url; } }

/** Origin match pattern for permissions.request, e.g. "https://acme.zendesk.com/*". */
export function originPattern(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.hostname}/*`;
}

/**
 * Ensures the extension may call `url` without CORS limits. Must be called
 * from a user gesture (click handler) BEFORE any other await.
 */
export async function ensureHostPermission(url) {
  if (!url) return true;
  let origins;
  try { origins = [originPattern(url)]; } catch { return false; }
  try { return await api.permissions.request({ origins }); } catch { return false; }
}
