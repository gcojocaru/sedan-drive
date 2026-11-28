// Browser storage that never throws, for every page: storage can be blocked (site data turned off, some private modes),
// full, or hold a damaged value, and none of that may stop a page. stored(key) → the saved value, parsed as JSON when it
// is JSON and as the plain text otherwise, or null; keep(key, value) saves it (text as it is, anything else as JSON), or
// quietly doesn't. Callers still check the value's shape (garage.js readWallet / readGarage, places.js readRecent).
export function stored(key) {
  let s = null;
  try { s = localStorage.getItem(key); } catch { return null; }
  if (s === null) return null;
  try { return JSON.parse(s); } catch { return s; }
}
export function keep(key, value) {
  try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch { }
}
