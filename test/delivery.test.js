import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryNetwork, createDelivery, allowedTime, afterCrash, deliveryPay, receiptText, FINE, KNOCK_FINE } from '../delivery.js';
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
  assert.ok(job.load.allowed === allowedTime(job.load.metres) && job.load.since === 100 && job.load.condition === 1);
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
