// Temporary storage for captures handed from the background to the annotator.
// Prefers storage.session (memory only, cleared when the browser closes) and
// falls back to storage.local, which is pruned regularly.

import { api } from '../shared/browser.js';

const PREFIX = 'capture:';
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

const areas = () => [api.storage.session, api.storage.local].filter(Boolean);

/** Saves a capture. Returns the storage area name used. */
export async function putCapture(id, data) {
  const item = { ...data, createdAt: Date.now() };
  if (api.storage.session) {
    try {
      await api.storage.session.set({ [PREFIX + id]: item });
      return 'session';
    } catch { /* quota exceeded or unsupported: fall back */ }
  }
  await pruneCaptures(15 * 60 * 1000); // make room: drop captures older than 15 minutes
  await api.storage.local.set({ [PREFIX + id]: item });
  return 'local';
}

export async function getCapture(id) {
  for (const area of areas()) {
    try {
      const got = await area.get(PREFIX + id);
      if (got?.[PREFIX + id]) return got[PREFIX + id];
    } catch { /* area unavailable */ }
  }
  return null;
}

export async function removeCapture(id) {
  await Promise.all(areas().map((a) => a.remove(PREFIX + id).catch(() => {})));
}

/** Removes captures older than `maxAgeMs`. */
export async function pruneCaptures(maxAgeMs = MAX_AGE_MS) {
  const now = Date.now();
  for (const area of areas()) {
    try {
      const all = await area.get(null);
      const stale = Object.entries(all || {})
        .filter(([k, v]) => k.startsWith(PREFIX) && now - (v?.createdAt || 0) > maxAgeMs)
        .map(([k]) => k);
      if (stale.length) await area.remove(stale);
    } catch { /* ignore */ }
  }
}
