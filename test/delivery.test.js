import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryNetwork, createDelivery } from '../delivery.js';
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
