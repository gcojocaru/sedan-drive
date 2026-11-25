// Car radio. Plays through a plain <audio>, which needs no CORS; only HTTPS streams, because the site is served over HTTPS.
// Presets for the test track: Romanian stations, checked Nov 2026. Broadcasters move them; a dead one just shows "no signal".
export const STATIONS = [
  ['Radio România Actualități', 'https://stream4.srr.ro:8443/romania-actualitati'],
  ['Radio România Cultural', 'https://stream4.srr.ro:8443/romania-cultural'],
  ['Radio România Muzical', 'https://stream4.srr.ro:8443/romania-muzical'],
  ['Antena Satelor', 'https://stream4.srr.ro:8443/antena-satelor'],
  ['Europa FM', 'https://astreaming.edi.ro:8443/EuropaFM_aac'],
  ['Virgin Radio', 'https://astreaming.edi.ro:8443/VirginRadio_aac'],
  ['Kiss FM', 'https://live.kissfm.ro/kissfm.aacp'],
  ['Magic FM', 'https://live.magicfm.ro/magicfm.aacp'],
  ['Rock FM', 'https://live.rockfm.ro/rockfm.aacp'],
  ['Pro FM', 'https://edge126.rcs-rds.ro/profm/profm.mp3'],
  ['Digi FM', 'https://edge76.rcs-rds.ro/digifm/digifm.mp3'],
  ['Radio Guerrilla', 'https://live.guerrillaradio.ro:8443/guerrilla.aac'],
];

// radio-browser.info: the free community station directory. all.api is round-robin DNS over its mirrors.
const RB = 'https://all.api.radio-browser.info/json/stations/search?hidebroken=true&order=clickcount&reverse=true&limit=100';

// Stations for a place, most listened-to first: those within 200 km plus the top ones of that country (the country of
// the nearest station that has coordinates; few have them). Same [name, url] shape as STATIONS; [] when nothing is near.
export async function stationsNear(lat, lon, fetchFn = fetch) {
  const get = async q => { const r = await fetchFn(RB + q); if (!r.ok) throw new Error('radio-browser HTTP ' + r.status); return r.json(); };
  const near = await get(`&geo_lat=${lat}&geo_long=${lon}&geo_distance=200000`);
  const cc = near.reduce((a, s) => !a || s.geo_distance < a.geo_distance ? s : a, null)?.countrycode;
  const all = near.concat(cc ? await get('&countrycode=' + cc) : []).sort((a, b) => b.clickcount - a.clickcount);
  const seen = new Set(), out = [];
  for (const s of all) {
    const name = s.name.trim(), url = s.url_resolved;
    if (!name || !url.startsWith('https://') || s.hls || seen.has(name.toLowerCase()) || seen.has(url)) continue; // <audio> can't play HLS
    seen.add(name.toLowerCase()); seen.add(url); out.push([name, url]);
    if (out.length === 30) break;
  }
  return out;
}

// Returns tune(step): +1 / -1 steps off → first station → … → last → off. show(text) puts a line on screen.
// find() gives the station list; it runs on the first tune, and again after it found nothing.
export function radio(show, find = async () => STATIONS) {
  const a = new Audio(); let list = [], found = null, i = -1, tries = 0;
  const start = () => { a.src = list[i][1]; a.play().catch(() => {}); }; // failures arrive as 'error' events below; AbortError = tuned away
  // Chromium sometimes can't decode the first AAC packet it joins a live stream on (PIPELINE_ERROR_DECODE); a fresh connection usually plays.
  a.onerror = () => { if (i < 0) return; if (tries-- > 0) start(); else show(list[i][0] + ' · no signal'); };
  return async step => {
    if (!found) show('Searching for radio stations…');
    list = await (found ??= find().catch(() => []));
    if (!list.length) { found = null; show('No radio stations found here'); return; }
    const n = list.length + 1; i = ((i + 1 + step) % n + n) % n - 1;
    if (i < 0) { a.pause(); a.removeAttribute('src'); a.load(); show('Radio off'); return; } // load() drops the live stream so it stops downloading
    tries = 2; start(); show('♪ ' + list[i][0]);
  };
}
