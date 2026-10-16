// Local history of submitted tickets (last 50), shown in the popup and options page.
import { dataStore } from '../shared/config.js';

const KEY = 'history';
export const HISTORY_LIMIT = 50;

export function getHistory() {
  return dataStore.get(KEY, []);
}

export function addHistory(entry) {
  return dataStore.update(KEY, [], (list) => [entry, ...(Array.isArray(list) ? list : [])].slice(0, HISTORY_LIMIT));
}

export function clearHistory() {
  return dataStore.set(KEY, []);
}
