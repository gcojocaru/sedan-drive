// Places to start from in the real-map picker: a few featured city centres with good streets to drive, and the
// player's recent places (stored by the page as sedan-map-recent-v1). Pure: no DOM or storage.
// [name, lat, lon]
export const FEATURED = [
  ['Bucharest · Piața Universității', 44.4355, 26.1025], ['Paris · Arc de Triomphe', 48.8738, 2.2950],
  ['London · Westminster', 51.5007, -0.1246], ['New York · Times Square', 40.7580, -73.9855],
  ['Tokyo · Shibuya', 35.6595, 139.7005], ['Rome · Colosseum', 41.8902, 12.4922],
  ['San Francisco · Union Square', 37.7880, -122.4075], ['Barcelona · Passeig de Gràcia', 41.3917, 2.1649]
];
export const RECENT_MAX = 6;
// A stored recent list made safe: only { lat, lon, name } entries with real coordinates, at most RECENT_MAX.
export function readRecent(stored) {
  if (!Array.isArray(stored)) return [];
  return stored.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180)
    .map(p => ({ lat: p.lat, lon: p.lon, name: typeof p.name === 'string' ? p.name.slice(0, 120) : '' })).slice(0, RECENT_MAX);
}
// The list with `place` first; the same spot (within ~100 m) is kept once.
export const addRecent = (list, place) => [place, ...list.filter(p => Math.abs(p.lat - place.lat) > 0.001 || Math.abs(p.lon - place.lon) > 0.001)].slice(0, RECENT_MAX);
// A featured place to surprise the player with, never the one they started from last (`skip`), r in [0, 1).
export function surprise(r, skip) {
  const pool = FEATURED.filter(([, lat, lon]) => !skip || Math.abs(lat - skip.lat) > 0.001 || Math.abs(lon - skip.lon) > 0.001);
  return pool[Math.min(pool.length - 1, Math.floor(r * pool.length))];
}
