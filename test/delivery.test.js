import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryNetwork, createDelivery, allowedTime, afterCrash, deliveryPay, receiptText, FINE, KNOCK_FINE, JOB_LEVELS, CARGO, levelOf, levelText } from '../delivery.js';
import { laneGraph } from '../traffic.js';
import { prepareRoads } from '../road-layout.js';

function street(name,g,t={}) { return {name,g,t,type:'residential',hw:3.5}; }
function network(roads, occupied) {
  const {junctions} = prepareRoads(roads,'right');
  return deliveryNetwork(laneGraph(roads,junctions,500),occupied);
}

test('both handoffs require a stop near the current marker and completion counts once', () => {
  const stops = network([street('High Street',[[-100,0],[100,0]])]);
  const job = createDelivery(stops,()=>0);
  assert.ok(job.start(-90,0));
  const pickup = job.target;
  assert.equal(job.start(0,0),false);
  assert.equal(job.arrive(pickup.x+20,pickup.z,0),null);
  for (const speed of [3,-3]) assert.equal(job.arrive(pickup.x,pickup.z,speed),null);
  assert.equal(job.arrive(pickup.x,pickup.z,0),'collected');
  const drop = job.target;
  assert.ok(Math.hypot(pickup.x-drop.x,pickup.z-drop.z)>=60);
  assert.equal(job.arrive(pickup.x,pickup.z,0),null);
  assert.equal(job.arrive(drop.x,drop.z,0),'delivered');
  assert.equal(job.target,null);
  assert.equal(job.arrive(drop.x,drop.z,0),null);
  assert.ok(job.start(drop.x,drop.z));
  job.cancel();
  assert.equal(job.phase,'idle');
});

test('jobs follow one-way streets and never jump to a disconnected street', () => {
  const graph = network([street('Market Road',[[-200,0],[20,0]],{oneway:'yes'}),
    street('Shop Lane',[[20,0],[200,0]],{oneway:'yes'}), street('Across the river',[[-200,20],[200,20]])]);
  const job = createDelivery(graph,()=>0.99);
  assert.ok(job.start(-195,1.5));
  const a=job.target;
  job.arrive(a.x,a.z,0);
  assert.ok(job.target.x>a.x);
  assert.equal(job.target.name,'Shop Lane');
});

test('jobs stay inside the area and skip obstructed stops, beyond-boundary connections and short lanes', () => {
  const detour = street('River Road',[[460,0],[520,0],[520,180],[460,180]],{oneway:'yes'});
  assert.equal(createDelivery(network([detour])).start(466,0),false);
  assert.equal(createDelivery([]).start(0,0),false);
  const stops = network([street('Long Road',[[-2000,0],[2000,0]])],x=>x<0);
  assert.ok(stops.length>1 && stops.every(p=>p.x>=0 && p.x<495));
});

test('the clock allows for the distance, and crashes damage the parcel by how hard they are', () => {
  assert.equal(allowedTime(300), 75);
  assert.ok(allowedTime(600) > allowedTime(300) + 40);
  assert.equal(afterCrash(1, 1.2), 1, 'a knock does nothing');
  assert.ok(Math.abs(afterCrash(1, 30 / 3.6) - 0.66) < 0.02, 'a crash at 30 km/h takes a third off');
  assert.equal(afterCrash(1, 75 / 3.6), 0, 'one at 75 km/h ruins it');
  assert.equal(afterCrash(0.2, 15), 0);
  assert.ok(Math.abs((1 - afterCrash(1, 30 / 3.6, 0.4)) - 0.4 * (1 - afterCrash(1, 30 / 3.6))) < 1e-9, 'padding lets through only its share');
});

test('pay rewards arriving early and undamaged, and takes off for lateness, damage and fines', () => {
  const job = { metres: 300, allowed: 75 };
  const early = deliveryPay({ ...job, taken: 40 }), onTime = deliveryPay({ ...job, taken: 75 }), late = deliveryPay({ ...job, taken: 105 });
  assert.equal(onTime.base, 14); assert.equal(onTime.total, 14);
  assert.ok(early.bonus > 0 && early.total > onTime.total && late.late < 0 && late.total < onTime.total);
  assert.ok(deliveryPay({ ...job, taken: 600 }).total >= Math.round(onTime.base * 0.2) - 1, 'a very late parcel still pays a little');
  const damaged = deliveryPay({ ...job, taken: 75, condition: 0.5 });
  assert.equal(damaged.damage, -7); assert.equal(damaged.total, 7);
  assert.equal(deliveryPay({ ...job, taken: 75, condition: 0 }).total, 0, 'a ruined parcel pays nothing');
  assert.equal(deliveryPay({ ...job, taken: 75, fines: 2 * FINE }).total, 0, 'and fines never make it negative');
  assert.deepEqual(receiptText({ ...deliveryPay({ ...job, taken: 40, condition: 0.9, fines: FINE }), taken: 40 }),
    { title: 'Delivered in 0:40 · $5', detail: '$14 pay · +$3 early · −$2 damage · −$10 red light' });
});

test('the clock, damage and fines start once the parcel is aboard, and the receipt adds them up', () => {
  const job = createDelivery(network([street('High Street', [[-300, 0], [300, 0]])]), () => 0);
  assert.ok(job.start(-290, 0));
  const pickup = job.target;
  job.crash(15); job.ranRed();
  assert.equal(job.load, null, 'nothing counts before the parcel is collected');
  assert.equal(job.arrive(pickup.x, pickup.z, 0, 100), 'collected');
  assert.ok(job.load.allowed === Math.round(allowedTime(job.load.metres) * JOB_LEVELS[0].ease) && job.load.since === 100 && job.load.condition === 1, 'the first level has time to spare');
  job.crash(30 / 3.6); job.ranRed();
  const drop = job.target;
  assert.equal(job.arrive(drop.x, drop.z, 0, 100 + 10), 'delivered');
  const r = job.receipt;
  assert.ok(r.taken === 10 && r.condition < 0.7 && r.fines === -FINE && r.bonus > 0 && r.damage < 0);
  assert.equal(r.total, Math.max(0, r.base + r.bonus + r.late + r.damage + r.fines));
  assert.equal(job.load, null);
});

test('knocking into someone with the parcel aboard is fined, and the receipt says what for', () => {
  const run = fines => {
    const job = createDelivery(network([street('High Street', [[-300, 0], [300, 0]])]), () => 0);
    job.start(-290, 0); job.knocked(); job.arrive(job.target.x, job.target.z, 0, 0);
    fines(job); job.arrive(job.target.x, job.target.z, 0, 200); return job.receipt;
  };
  const one = run(job => job.knocked()), both = run(job => { job.knocked(); job.ranRed(); });
  assert.equal(one.fines, -KNOCK_FINE, 'only once the parcel is aboard');
  assert.match(receiptText(one).detail, new RegExp('−\\$' + KNOCK_FINE + ' pedestrian hit$'));
  assert.equal(both.fines, -(KNOCK_FINE + FINE));
  assert.match(receiptText(both).detail, /fines$/);
  assert.match(receiptText(run(job => { job.ranRed(); job.ranRed(); })).detail, /red lights$/);
});

// a town of two-way streets `gap` m apart, n by n
function town(n = 4, gap = 150) {
  const at = k => (k - (n - 1) / 2) * gap, roads = [];
  for (let j = 0; j < n; j++) roads.push(street('Row ' + j, [...Array(n)].map((_, i) => [at(i), at(j)])));
  for (let i = 0; i < n; i++) roads.push(street('Column ' + i, [...Array(n)].map((_, j) => [at(i), at(j)])));
  return network(roads);
}

test('levels come with deliveries made: the first is easy, each after carries more parcels and harder cargo for more pay', () => {
  assert.deepEqual([0, 2, 3, 6, 7, 12, 18, 26, 400].map(levelOf), [0, 0, 1, 1, 2, 3, 4, 5, 5]);
  JOB_LEVELS.forEach((L, i) => { if (i) { const b = JOB_LEVELS[i - 1]; assert.ok(L.from > b.from && L.drops >= b.drops && L.pay > b.pay && L.ease <= b.ease, L.name); } });
  assert.ok(JOB_LEVELS[0].drops === 1 && JOB_LEVELS[0].ease > 1 && JOB_LEVELS[0].cargo.join() === 'parcel', 'one plain parcel, time to spare');
  assert.ok(JOB_LEVELS.at(-1).drops >= 5);
  assert.equal(levelText(2), '2 drop-offs a job, better pay');
  assert.equal(levelText(3), '3 drop-offs a job, heavy crates, better pay');
  assert.equal(allowedTime(300, 3), allowedTime(300) + 30, 'each further drop-off allows 15 s');
  assert.equal(deliveryPay({ metres: 300, allowed: 75, taken: 75, drops: 3, rate: 1.5 }).base, Math.round((15 + 9) * 1.5));
});

test('a round drops a parcel at each stop in turn, every one reachable from the last and apart from the others', () => {
  const stops = town(), job = createDelivery(stops, () => 0.37);
  assert.ok(job.start(-225, -225, 3, 'heavy'));
  assert.equal(job.job.parcels, 3); assert.equal(job.job.cargo, CARGO.heavy);
  const pickup = job.target; assert.equal(job.arrive(pickup.x, pickup.z, 0, 0), 'collected');
  const seen = [pickup];
  for (let k = 0; k < 3; k++) {
    const t = job.target;
    assert.ok(seen.every(q => Math.hypot(q.x - t.x, q.z - t.z) >= 40), 'stop ' + k + ' stands apart from the others');
    assert.ok(Math.hypot(seen.at(-1).x - t.x, seen.at(-1).z - t.z) >= 60);
    assert.equal(job.job.delivered, k);
    seen.push(t);
    assert.equal(job.arrive(t.x, t.z, 0, 100 + k), k < 2 ? 'dropped' : 'delivered');
  }
  const r = job.receipt;
  assert.equal(r.drops, 3);
  assert.ok(r.base > deliveryPay({ metres: r.drops * 100, allowed: 100, taken: 100 }).base, 'a bigger round pays more');
  assert.match(receiptText(r).title, /^Delivered 3 heavy crates in /);
  assert.equal(job.job, null);
});

test('cargo matters: fragile parcels take crashes harder, heavy crates weigh the car down, express letters run a tight clock', () => {
  const stops = town(), load = kind => { const job = createDelivery(stops, () => 0.5); job.start(0, 0, 4, kind); job.arrive(job.target.x, job.target.z, 0, 0); return job; };
  const plain = load('parcel'), fragile = load('fragile'), heavy = load('heavy'), express = load('express');
  plain.crash(30 / 3.6); fragile.crash(30 / 3.6);
  assert.ok(Math.abs((1 - fragile.load.condition) - 2 * (1 - plain.load.condition)) < 1e-9);
  assert.ok(CARGO.heavy.power < 1 && CARGO.heavy.brake < 1 && CARGO.parcel.power === 1);
  assert.ok(express.load.allowed < Math.round(allowedTime(express.load.metres, express.load.drops) * 0.8), 'express gets less time');
  assert.ok(heavy.load.rate > plain.load.rate && express.load.rate > plain.load.rate);
});
