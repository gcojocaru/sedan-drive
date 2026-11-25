// Car radio: free Romanian internet stations. HTTPS only (the site is served over HTTPS); a plain <audio> needs no CORS.
// Streams found via radio-browser.info and checked Nov 2026. Broadcasters move them; a dead one just shows "no signal".
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

// Returns tune(step): +1 / -1 steps off → first station → … → last → off. show(text) puts the name on screen.
export function radio(show) {
  const a = new Audio(), n = STATIONS.length + 1; let i = -1, tries = 0;
  const start = () => { a.src = STATIONS[i][1]; a.play().catch(() => {}); }; // failures arrive as 'error' events below; AbortError = tuned away
  // Chromium sometimes can't decode the first AAC packet it joins a live stream on (PIPELINE_ERROR_DECODE); a fresh connection usually plays.
  a.onerror = () => { if (i < 0) return; if (tries-- > 0) start(); else show(STATIONS[i][0] + ' · no signal'); };
  return step => {
    i = ((i + 1 + step) % n + n) % n - 1;
    if (i < 0) { a.pause(); a.removeAttribute('src'); a.load(); show('Radio off'); return; } // load() drops the live stream so it stops downloading
    tries = 2; start(); show('♪ ' + STATIONS[i][0]);
  };
}
