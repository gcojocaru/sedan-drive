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

// Returns tune(step): +1 / -1 steps off → first station → … → last → off. show(title, note, busy) puts it on screen (radioHud).
// find() gives the station list; it runs on the first tune, and again after it found nothing.
// tuningStatic() plays a short burst on the dial gesture, including while the directory is loading.
export function radio(show, find = async () => STATIONS, tuningStatic = () => {}) {
  const a = new Audio(); let list = [], found = null, i = -1, tries = 0, live = false;
  const start = () => { a.src = list[i][1]; a.play().catch(() => {}); }; // failures arrive as 'error' events below; AbortError = tuned away
  // Chromium sometimes can't decode the first AAC packet it joins a live stream on (PIPELINE_ERROR_DECODE); a fresh connection usually plays.
  a.onerror = () => { if (i < 0) return; if (tries-- > 0) start(); else show(list[i][0], 'No signal'); };
  a.onplaying = () => { if (i >= 0 && !live) { live = true; show(list[i][0]); } }; // only the first time: 'playing' also fires after every stall
  return async step => {
    const searching = !list.length;
    if (searching) {
      tuningStatic();
      if (!found) show('Radio', 'Searching for stations…', true);
      list = await (found ??= find().catch(() => []));
      if (!list.length) { found = null; show('Radio', 'No stations found here'); return; }
    }
    const n = list.length + 1; i = ((i + 1 + step) % n + n) % n - 1;
    if (i < 0) { a.pause(); a.removeAttribute('src'); a.load(); show('Radio off'); return; } // load() drops the live stream so it stops downloading
    if (!searching) tuningStatic();
    tries = 2; live = false; start(); show(list[i][0], 'Tuning…', true);
  };
}

// The station display, GTA-style: the name big and outlined at the top centre, grey and blinking while it tunes, gold once
// it plays, gone a few seconds later. Creates its own element, so both drive pages share it without any page CSS.
export function radioHud() {
  const el = document.body.appendChild(document.createElement('div')), name = el.appendChild(document.createElement('div')), sub = el.appendChild(document.createElement('div'));
  const ink = w => [[w, 0], [-w, 0], [0, w], [0, -w], [w, w], [-w, w], [w, -w], [-w, -w]].map(([x, y]) => `${x}px ${y}px 0 #000`).join(); // outline that works on any font
  el.style.cssText = 'position:fixed;left:0;right:0;top:64px;text-align:center;pointer-events:none;opacity:0;transition:opacity .6s;z-index:10';
  name.style.cssText = `font:italic clamp(30px,4.4vw,54px)/1.1 Impact,Haettenschweiler,"Arial Narrow Bold","Arial Black",sans-serif;letter-spacing:.03em;text-shadow:${ink(2)},0 5px 14px rgba(0,0,0,.55);padding:0 24px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`;
  sub.style.cssText = `margin-top:4px;font:700 12px/1.2 "Helvetica Neue",Arial,sans-serif;letter-spacing:.24em;text-transform:uppercase;color:#fff;text-shadow:${ink(1)}`;
  let timer, blink;
  return (title, note = '', busy = false) => {
    name.textContent = title; sub.textContent = note; name.style.color = busy || note ? '#b4b8bd' : '#f2b02e';
    blink?.cancel(); blink = busy ? name.animate([{ opacity: 1 }, { opacity: .3 }], { duration: 260, iterations: Infinity, direction: 'alternate' }) : null;
    el.style.opacity = 1; clearTimeout(timer); if (!busy) timer = setTimeout(() => el.style.opacity = 0, 3000);
  };
}
