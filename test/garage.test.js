import test from 'node:test';
import assert from 'node:assert/strict';
import { UPGRADES, PAINTS, freshGarage, readGarage, readWallet, earn, price, buy, carTuning } from '../garage.js';

test('the wallet starts from earnings kept before the garage, and anything broken starts at zero', () => {
  assert.deepEqual(readWallet(null, { total: 85, jobs: 6 }), { cash: 85, earned: 85, jobs: 6 });
  assert.deepEqual(readWallet({ cash: 10, earned: 85, jobs: 6 }, { total: 85, jobs: 6 }), { cash: 10, earned: 85, jobs: 6 }, 'the wallet wins once there is one');
  for (const junk of [null, 'x', { cash: -5, earned: 1, jobs: 1 }, { cash: NaN }]) assert.deepEqual(readWallet(junk, null), { cash: 0, earned: 0, jobs: 0 });
  assert.deepEqual(earn({ cash: 10, earned: 85, jobs: 6 }, 14), { cash: 24, earned: 99, jobs: 7 });
});

test('upgrades are bought a level at a time while there is money, up to the last level', () => {
  let garage = freshGarage(), wallet = { cash: 1000, earned: 1000, jobs: 50 };
  assert.equal(buy(garage, { ...wallet, cash: 59 }, 'engine'), null, "can't afford it");
  const spent = [];
  for (let i = 0; i < UPGRADES.engine.levels.length; i++) { spent.push(price(garage, 'engine')); ({ garage, wallet } = buy(garage, wallet, 'engine')); }
  assert.deepEqual(spent, UPGRADES.engine.levels.map(l => l[0]));
  assert.equal(garage.levels.engine, 3);
  assert.equal(wallet.cash, 1000 - spent.reduce((a, b) => a + b));
  assert.equal(price(garage, 'engine'), null);
  assert.equal(buy(garage, wallet, 'engine'), null, 'nothing past the last level');
  assert.equal(buy(garage, wallet, 'rocket'), null, 'nor anything not on sale');
  assert.equal(freshGarage().levels.engine, 0, 'buying never changes the garage it was given');
});

test('paint is bought once, then put back on for nothing', () => {
  let garage = freshGarage(), wallet = { cash: 100, earned: 100, jobs: 5 };
  assert.equal(price(garage, 'factory'), 0);
  ({ garage, wallet } = buy(garage, wallet, 'yellow'));
  assert.equal(garage.paint, 'yellow'); assert.equal(wallet.cash, 40);
  ({ garage, wallet } = buy(garage, wallet, 'factory'));
  assert.equal(garage.paint, 'factory'); assert.equal(wallet.cash, 40);
  ({ garage, wallet } = buy(garage, wallet, 'yellow'));
  assert.equal(garage.paint, 'yellow'); assert.equal(wallet.cash, 40, 'already ours');
  assert.equal(carTuning(garage).paint, PAINTS.find(p => p[0] === 'yellow')[2]);
  assert.equal(carTuning(freshGarage()).paint, null, 'factory paint is the car\'s own');
});

test('a stored garage is checked before use', () => {
  const g = readGarage({ levels: { engine: 9, brakes: -1, tyres: 1.5, padding: 2, nitro: 3 }, paints: ['navy', 'gold'], paint: 'gold' });
  assert.deepEqual(g.levels, { engine: 3, brakes: 0, tyres: 0, padding: 2 });
  assert.deepEqual(g.paints, ['factory', 'navy']);
  assert.equal(g.paint, 'factory', 'not a paint we own');
  assert.deepEqual(readGarage('junk'), freshGarage());
});

test('what the upgrades do to the car', () => {
  const stock = carTuning(freshGarage()), full = carTuning({ ...freshGarage(), levels: { engine: 3, brakes: 2, tyres: 3, padding: 2 } });
  assert.deepEqual([stock.power, stock.brake, stock.cushion], [1, 1, 1]);
  assert.ok(full.power > 1.3 && full.brake > 1.2 && full.cushion < 0.5);
  assert.equal(full.grip(1), 1, 'tyres change nothing on a dry road');
  assert.equal(stock.grip(0.6), 0.6);
  assert.ok(Math.abs(full.grip(0.6) - 0.84) < 1e-9, 'the best tyres lose 60% less grip in the wet');
});
