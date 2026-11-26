// The garage on the real-map page: what delivery money buys and what it does to the car. Pure (no DOM, no storage):
// the page keeps the wallet and the garage and hands them in; garage-panel.js draws the shop.

// Upgrades, each bought a level at a time: [price, what that level does]
export const UPGRADES = {
  engine: { label: 'Engine tune', levels: [[60, '12% more power'], [140, '25% more power'], [260, '40% more power']] },
  brakes: { label: 'Brakes', levels: [[70, 'stop about a tenth shorter'], [160, 'stop about a fifth shorter']] },
  tyres: { label: 'All-weather tyres', levels: [[80, 'a quarter less grip lost in rain and snow'], [180, 'nearly half less'], [320, '60% less']] },
  padding: { label: 'Cargo padding', levels: [[50, 'parcels take a third less damage'], [120, 'parcels take 60% less damage']] }
};
// Paint: [id, name, colour (null: the car's own), price]
export const PAINTS = [['factory', 'Factory', null, 0], ['white', 'Arctic white', '#e9ebea', 40], ['silver', 'Silver', '#b4b9bd', 40], ['black', 'Jet black', '#131417', 40],
  ['navy', 'Navy', '#1e365f', 40], ['green', 'Racing green', '#1c4430', 40], ['yellow', 'Taxi yellow', '#e3b21f', 60], ['orange', 'Sunset orange', '#dc6219', 60], ['plum', 'Plum', '#4a2350', 60]];
const POWER = [1, 1.12, 1.25, 1.4], BRAKE = [1, 1.12, 1.25], TYRES = [1, 0.75, 0.55, 0.4], CUSHION = [1, 0.65, 0.4];

export const freshGarage = () => ({ levels: { engine: 0, brakes: 0, tyres: 0, padding: 0 }, paints: ['factory'], paint: 'factory' });

// A stored garage made safe to use: unknown items dropped, levels in range, the paint one that's owned.
export function readGarage(stored) {
  const g = freshGarage();
  if (!stored || typeof stored !== 'object') return g;
  for (const k in g.levels) { const n = stored.levels?.[k]; if (Number.isInteger(n)) g.levels[k] = Math.max(0, Math.min(UPGRADES[k].levels.length, n)); }
  if (Array.isArray(stored.paints)) g.paints = [...new Set(['factory', ...stored.paints.filter(id => PAINTS.some(p => p[0] === id))])];
  if (g.paints.includes(stored.paint)) g.paint = stored.paint;
  return g;
}

// The wallet: { cash, earned, jobs }. Without one yet, it starts from the earnings deliveries kept before there was
// anything to spend them on (legacy: { total, jobs }).
export function readWallet(stored, legacy) {
  const ok = n => Number.isFinite(n) && n >= 0;
  if (stored && ok(stored.cash) && ok(stored.earned) && ok(stored.jobs)) return { cash: stored.cash, earned: stored.earned, jobs: stored.jobs };
  if (legacy && ok(legacy.total) && ok(legacy.jobs)) return { cash: legacy.total, earned: legacy.total, jobs: legacy.jobs };
  return { cash: 0, earned: 0, jobs: 0 };
}
export const earn = (wallet, pay) => ({ cash: wallet.cash + pay, earned: wallet.earned + pay, jobs: wallet.jobs + 1 });

// What buying `item` (an upgrade's key or a paint's id) costs next: null when there's nothing more to buy, 0 for paint
// already owned.
export function price(garage, item) {
  if (UPGRADES[item]) return UPGRADES[item].levels[garage.levels[item]]?.[0] ?? null;
  const paint = PAINTS.find(p => p[0] === item);
  return !paint ? null : garage.paints.includes(item) ? 0 : paint[3];
}
// Buy the next level of an upgrade or a paint (which is then put on): { garage, wallet }, or null if it can't be had.
export function buy(garage, wallet, item) {
  const cost = price(garage, item);
  if (cost === null || cost > wallet.cash) return null;
  const g = { levels: { ...garage.levels }, paints: [...garage.paints], paint: garage.paint };
  if (UPGRADES[item]) g.levels[item]++;
  else { if (!g.paints.includes(item)) g.paints.push(item); g.paint = item; }
  return { garage: g, wallet: { ...wallet, cash: wallet.cash - cost } };
}

// What the garage does to the car: power and brake factors for the physics, grip(g) for the tyres (g: the share of dry
// grip the weather leaves), cushion for parcel damage, and the paint colour (null: the car's own).
export function carTuning(garage) {
  const { engine, brakes, tyres, padding } = garage.levels;
  return { power: POWER[engine], brake: BRAKE[brakes], grip: g => 1 - (1 - g) * TYRES[tyres], cushion: CUSHION[padding], paint: PAINTS.find(p => p[0] === garage.paint)?.[2] ?? null };
}
