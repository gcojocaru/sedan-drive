// Just-in-time hints on the real-map page instead of a wall of keys: each one is shown once (the page keeps the ids
// shown, sedan-map-hints-v1), when the moment for it comes, at most one every `gap` seconds. Pure.
// state: { t: seconds driven, dark, headlights, stuck (seconds held on the gas without moving), offRoad (seconds off
// any road), job (a delivery running), jobs (deliveries made), idle (seconds with no job), cash, cheapest (the cheapest
// thing the garage sells next, or Infinity), garageSeen, touch }
export const HINTS = [
  { id: 'lights', when: s => s.dark && !s.headlights, key: 'It\'s getting dark · H for the headlights', touch: 'It\'s getting dark · ••• → Lights' },
  { id: 'reset', when: s => s.stuck >= 4 || s.offRoad >= 8, key: 'Stuck? R puts you back on the road', touch: 'Stuck? ••• → Reset puts you back on the road' },
  { id: 'delivery', when: s => !s.job && s.jobs < 3 && s.idle >= 25, key: 'Want to earn? J starts a delivery', touch: 'Want to earn? Start delivery, top right' },
  { id: 'garage', when: s => s.cash >= s.cheapest && !s.garageSeen, key: 'You can afford an upgrade · G for the garage', touch: 'You can afford an upgrade · ••• → Garage' },
  { id: 'camera', when: s => s.t >= 90, key: 'C switches to the driver\'s seat', touch: '••• → Camera for the driver\'s seat' },
  { id: 'weather', when: s => s.t >= 150, key: 'T time of day · E weather · N night', touch: '••• → Time and Weather change the sky' },
  { id: 'radio', when: s => s.t >= 210, key: 'Q tunes in local radio stations', touch: '••• → Radio tunes in local stations' },
  { id: 'settings', when: s => s.t >= 270, key: 'Esc for settings and the full list of controls', touch: '••• → Settings for options and controls' }
];
// The hint to show now, or null: the first whose moment has come that wasn't shown, if `since` (seconds since the
// last hint) is at least `gap`. → { id, text }
export function nextHint(state, shown, since, gap = 30) {
  if (since < gap) return null;
  const h = HINTS.find(h => !shown.includes(h.id) && h.when(state));
  return h ? { id: h.id, text: state.touch ? h.touch : h.key } : null;
}
// A stored list of shown ids made safe
export const readShown = v => Array.isArray(v) ? v.filter(id => HINTS.some(h => h.id === id)) : [];
