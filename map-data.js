// Where a place's map data comes from: the browser's IndexedDB cache, then the caching proxy, then the public Overpass
// servers one at a time, and last OpenFreeMap's vector tiles. Every source returns the same Overpass-shaped elements.
import { CACHE_V, AREA_PROXY, ENDPOINTS, areaKey, overpassQuery, overpassError } from './osm-query.js';
import { fetchVectorArea } from './vector-fallback.js';

function idb() { return new Promise((res, rej) => { const r = indexedDB.open('sedan-map-cache', 1); r.onupgradeneeded = () => r.result.createObjectStore('osm'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbGet(k) { try { const db = await idb(); return await new Promise(res => { const q = db.transaction('osm').objectStore('osm').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch { return null; } }
async function idbSet(k, v) { try { const db = await idb(); db.transaction('osm', 'readwrite').objectStore('osm').put(v, k); } catch { } }
async function idbPrune(prefix) { // drop entries saved by older versions of the query
  try { const s = (await idb()).transaction('osm', 'readwrite').objectStore('osm'), q = s.getAllKeys(); q.onsuccess = () => { for (const k of q.result) if (!String(k).startsWith(prefix)) s.delete(k); }; } catch { }
}

// ---------------- Map data download ----------------
// The caching proxy first (one shared download per place for all players), then the public Overpass servers one by
// one. A server that answers 429/406 is left alone for 30 s, as the Overpass usage policy asks. When none of them
// delivers, the place is built from OpenFreeMap's vector tiles instead (no limits, less detail; see vector-fallback.js).
const REST_KEY = 'sedan-overpass-rest-v1';
const restMap = () => { try { return JSON.parse(localStorage.getItem(REST_KEY) || '{}'); } catch { return {}; } };
const restHost = host => { const m = restMap(); m[host] = Date.now() + 30000; try { localStorage.setItem(REST_KEY, JSON.stringify(m)); } catch { } };
async function fetchArea(lat0, lon0, status) {
  const proxy = AREA_PROXY ? [{ host: new URL(AREA_PROXY).host, url: AREA_PROXY.replace(/\/$/, '') + '/area?lat=' + lat0.toFixed(4) + '&lon=' + lon0.toFixed(4), wait: 150000, proxy: true }] : [];
  const sources = proxy.concat(ENDPOINTS.map(u => ({ host: new URL(u).host, url: u, wait: 45000 })));
  let err = null, rested = 0;
  for (const s of sources) {
    if ((restMap()[s.host] || 0) > Date.now()) { rested++; continue; }
    const ac = new AbortController();
    status('Downloading map data from ' + s.host + '…');
    const kill = setTimeout(() => ac.abort(), s.wait);
    try {
      const r = await fetch(s.url, s.proxy ? { signal: ac.signal } : { method: 'POST', signal: ac.signal, body: 'data=' + encodeURIComponent(overpassQuery(lat0, lon0)), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (s.proxy && r.status === 503) { // the proxy already tried every Overpass server; asking them again ourselves would only add load
        const j = await r.json().catch(() => ({})); err = new Error(j.error || 'the map servers are busy'); break;
      }
      if (r.status === 429 || r.status === 406) { restHost(s.host); throw new Error('too many requests'); }
      if (!r.ok) throw new Error('server replied ' + r.status);
      const data = await r.json();
      if (!data || !Array.isArray(data.elements)) throw new Error('bad reply');
      const bad = overpassError(data.remark); if (bad) throw new Error(bad.slice(0, 90));
      return { data };
    } catch (e) { err = e.name === 'AbortError' ? new Error('no answer in time') : e; status(s.host + ' is busy, trying another server…'); }
    finally { clearTimeout(kill); }
  }
  status('The map servers are busy. Building a simplified map from OpenFreeMap…');
  try { return { data: await fetchVectorArea(lat0, lon0), fallback: true }; } catch (e) { console.warn('vector fallback failed', e); }
  return { err: rested && !err ? new Error('the servers asked us to wait 30 seconds') : err };
}

// status(text) shows progress (and may return a promise to wait for a repaint). Resolves to { data, fallback, err }.
export async function loadArea(lat0, lon0, status) {
  const key = areaKey(lat0, lon0), saved = await idbGet(key);
  if (saved) { await status('Loading saved map data…'); return { data: saved, err: null, fallback: false }; }
  const r = await fetchArea(lat0, lon0, status);
  if (r.data && !r.fallback) { idbSet(key, r.data); idbPrune(CACHE_V); } // a simplified map isn't kept, so the next visit tries for full detail
  return r;
}
