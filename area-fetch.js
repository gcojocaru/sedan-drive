// Downloading one place's map without the long wait: the caching proxy and the Overpass servers race, up to two at a
// time (the next starts when one fails, or when none has answered for `stagger` ms), and the simplified OpenFreeMap
// map is fetched alongside once Overpass is slow (`vectorAfter`). `first` settles with what to drive on now: the full
// map if it lands within `patience` ms, else the simplified one; `full` goes on to the full map whatever happens, so
// the page can offer it when it lands. Node-importable: the network only through the passed-in fetch, and the
// servers' rests (429/406: leave a host alone for a while) through rested(host) and rest(host).
// fetchArea(lat, lon, opts) → { first: Promise<{ data, fallback } | { err }>, full: Promise<{ data } | { err }> }
import { AREA_PROXY, ENDPOINTS, overpassQuery, overpassError } from './osm-query.js';
import { fetchVectorArea } from './vector-fallback.js';

export function fetchArea(lat, lon, { fetch, status = () => {}, rested = () => false, rest = () => {}, stagger = 8000, patience = 15000, vectorAfter = 6000, wait = 45000,
  proxy = AREA_PROXY, endpoints = ENDPOINTS, vector = () => fetchVectorArea(lat, lon, fetch) } = {}) {
  const sources = (proxy ? [{ host: new URL(proxy).host, url: proxy.replace(/\/$/, '') + '/area?lat=' + lat.toFixed(4) + '&lon=' + lon.toFixed(4), wait: wait * 2, proxy: true }] : [])
    .concat(endpoints.map(u => ({ host: new URL(u).host, url: u, wait }))).filter(s => !rested(s.host));
  async function one(s, signal) {
    const r = await fetch(s.url, s.proxy ? { signal } : { method: 'POST', signal, body: 'data=' + encodeURIComponent(overpassQuery(lat, lon)), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    if (s.proxy && r.status === 503) { const j = await r.json().catch(() => ({})); throw Object.assign(new Error(j.error || 'the map servers are busy'), { allBusy: true }); } // (the proxy already asked them all)
    if (r.status === 429 || r.status === 406) { rest(s.host); throw new Error('too many requests'); }
    if (!r.ok) throw new Error('server replied ' + r.status);
    const data = await r.json();
    if (!data || !Array.isArray(data.elements)) throw new Error('bad reply');
    const bad = overpassError(data.remark); if (bad) throw new Error(bad.slice(0, 90));
    return data;
  }
  let fullDone = false;
  const full = new Promise(resolve => {
    let next = 0, live = 0, err = sources.length ? null : new Error('the servers asked us to wait'), timer = 0;
    const aborts = new Set(), finish = v => { if (fullDone) return; fullDone = true; clearTimeout(timer); aborts.forEach(a => a.abort()); resolve(v); };
    const start = () => {
      clearTimeout(timer);
      if (fullDone || live >= 2 || next >= sources.length) { if (!live && next >= sources.length) finish({ err }); return; }
      const s = sources[next++], ac = new AbortController(), kill = setTimeout(() => ac.abort(), s.wait); live++; aborts.add(ac);
      status('Downloading map data from ' + s.host + '…');
      one(s, ac.signal).then(data => finish({ data }), e => {
        err = e.name === 'AbortError' ? new Error('no answer in time') : e; live--; aborts.delete(ac);
        if (e.allBusy) next = sources.length; else if (!fullDone) status(s.host + ' is busy, trying another server…');
        start();
      }).finally(() => clearTimeout(kill));
      if (next < sources.length) timer = setTimeout(start, stagger); // no answer for a while: ask one more at the same time
    };
    start();
  });
  const first = new Promise(resolve => {
    let simple = null; // the simplified map, once Overpass has been slow for vectorAfter ms
    const getSimple = () => simple ??= vector().then(data => data?.elements ? data : null, () => null);
    const slow = setTimeout(() => { if (!fullDone) { status('The map servers are slow. Getting a simplified map meanwhile…'); getSimple(); } }, vectorAfter);
    const settle = setTimeout(() => getSimple().then(data => { if (data) resolve({ data, fallback: true }); }), patience);
    full.then(f => { clearTimeout(slow); if (f.data) { clearTimeout(settle); resolve({ data: f.data }); } else getSimple().then(data => resolve(data ? { data, fallback: true } : { err: f.err })); });
  });
  return { first, full };
}
