// Where a place's map data comes from: the browser's IndexedDB cache, then the caching proxy, then the public Overpass
// servers (raced, area-fetch.js), and OpenFreeMap's vector tiles meanwhile when they are slow. Every source returns the same
// Overpass-shaped elements.
import { CACHE_V, areaKey } from './osm-query.js';
import { fetchArea } from './area-fetch.js';

function idb() { return new Promise((res, rej) => { const r = indexedDB.open('sedan-map-cache', 1); r.onupgradeneeded = () => r.result.createObjectStore('osm'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbGet(k) { try { const db = await idb(); return await new Promise(res => { const q = db.transaction('osm').objectStore('osm').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch { return null; } }
async function idbSet(k, v) { try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction('osm', 'readwrite'); t.objectStore('osm').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); } catch { } } // (resolves once written)
async function idbPrune(prefix) { // drop entries saved by older versions of the query
  try { const s = (await idb()).transaction('osm', 'readwrite').objectStore('osm'), q = s.getAllKeys(); q.onsuccess = () => { for (const k of q.result) if (!String(k).startsWith(prefix)) s.delete(k); }; } catch { }
}

// ---------------- Map data download ----------------
// area-fetch.js races the proxy and the Overpass servers and settles for OpenFreeMap's simplified map when they're slow;
// the full map goes on downloading and is saved when it lands. A server that answers 429/406 is left alone for 30 s, as
// the Overpass usage policy asks.
const REST_KEY = 'sedan-overpass-rest-v1';
const restMap = () => { try { return JSON.parse(localStorage.getItem(REST_KEY) || '{}'); } catch { return {}; } };
const restHost = host => { const m = restMap(); m[host] = Date.now() + 30000; try { localStorage.setItem(REST_KEY, JSON.stringify(m)); } catch { } };

// status(text) shows progress (and may return a promise to wait for a repaint). Resolves to { data, fallback, err, full }:
// full (with a simplified map only) resolves true once the full map is downloaded and saved, so a reload gets it.
export async function loadArea(lat0, lon0, status) {
  const key = areaKey(lat0, lon0), saved = await idbGet(key);
  if (saved) { await status('Loading saved map data…'); return { data: saved, err: null, fallback: false, full: null }; }
  const { first, full } = fetchArea(lat0, lon0, { fetch, status, rested: h => (restMap()[h] || 0) > Date.now(), rest: restHost });
  const saving = full.then(async f => { if (!f.data) return false; await idbSet(key, f.data); idbPrune(CACHE_V); return true; }); // (a simplified map isn't kept)
  const r = await first;
  return { ...r, full: r.fallback ? saving : null };
}
