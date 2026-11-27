import * as THREE from 'three';
import { createDelivery, deliveryNetwork, receiptText, money, minutes, STOP_RADIUS, FINE, KNOCK_FINE } from './delivery.js';


// Wire up one area's job. The road network is sampled on the first job request. paid(receipt) banks a delivery;
// level() is the JOB_LEVELS level new jobs are planned for.
const cap = s => s[0].toUpperCase() + s.slice(1);
export function deliveryHud(scene, graph, occupied, button, stage, detail, flash, paid = () => {}, level = () => 0) {
  let job, lastTarget, clock = 0, receiptFor = 0; // clock: seconds of driving; receiptFor: how long the last receipt stays up
  const marker = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(STOP_RADIUS-0.45, STOP_RADIUS, 64),
    new THREE.MeshBasicMaterial({color:0x68e6d3, transparent:true, opacity:0.85, depthWrite:false}));
  marker.name = 'delivery_stop';
  ring.rotation.x = -Math.PI/2;
  marker.add(ring);
  // The parcel stays visible above traffic as the driver approaches the ground ring.
  const parcel = new THREE.Mesh(new THREE.BoxGeometry(1.1,0.85,0.9),
    new THREE.MeshStandardMaterial({color:0xe3ae6e, emissive:0x694420, emissiveIntensity:0.65}));
  const tape = new THREE.Mesh(new THREE.BoxGeometry(0.21,0.86,0.91),
    new THREE.MeshBasicMaterial({color:0xffe2ad}));
  parcel.add(tape);
  parcel.position.y = 3;
  parcel.rotation.y = Math.PI/4;
  marker.add(parcel);
  marker.visible = false;
  scene.add(marker);

  function refresh(x,z) {
    const target = job?.target;
    if (target !== lastTarget) {
      lastTarget = target;
      marker.visible = !!target;
      if (target || receiptFor <= 0) stage.parentElement.hidden = !target;
      button.textContent = target ? 'Cancel delivery' : 'Start delivery';
      if (target) {
        marker.position.set(target.x,0.16,target.z);
        const { cargo: C, parcels: n, delivered } = job.job;
        stage.textContent = (job.phase === 'pickup' ? 'Pick up ' + (n > 1 ? n + ' ' + C.many : C.one) : n > 1 ? 'Drop-off ' + (delivered + 1) + ' of ' + n : 'Deliver ' + C.one) + (target.name ? ' · '+target.name : '');
      }
    }
    if (target) {
      const metres = Math.hypot(target.x-x,target.z-z);
      const bearing = Math.atan2(target.x-x, z-target.z);
      const direction = ['N','NE','E','SE','S','SW','W','NW'][(Math.round(bearing/(Math.PI/4))+8)%8];
      let instruction = metres <= STOP_RADIUS ? 'Stop here' : Math.ceil(metres) + ' m ' + direction;
      const load = job.load, left = load && load.allowed - (clock - load.since); // with the parcel aboard, the clock runs
      if (load) instruction += ' · ' + minutes(left) + (left < 0 ? ' late' : ' left') + (load.condition < 1 ? (load.drops > 1 ? ' · load ' : ' · parcel ') + Math.round(load.condition * 100) + '%' : '');
      if (detail.textContent !== instruction) detail.textContent = instruction;
      stage.parentElement.classList.toggle('late', left < 0);
    }
  }
  return {
    get target() { return job?.target; },
    // the cargo aboard (delivery.js CARGO: what it does to the car), or null
    get cargo() { return job?.load ? job.job.cargo : null; },
    toggle(x,z) {
      job ??= createDelivery(deliveryNetwork(graph,occupied));
      if (job.target) { job.cancel(); flash('Delivery cancelled'); }
      else if (!job.start(x,z,level())) flash('No local delivery available here');
      else { const { cargo: C, parcels: n } = job.job; if (n > 1 || C.tip) flash('New job: ' + (n > 1 ? n + ' ' + C.many + ' to ' + n + ' drop-offs' : 'a ' + C.one) + (C.tip ? ' · ' + C.tip : '')); }
      refresh(x,z);
    },
    // every frame of driving, dt seconds long
    update(x,z,speed,dt = 0) {
      clock += dt;
      if (receiptFor > 0 && (receiptFor -= dt) <= 0 && !job?.target) stage.parentElement.hidden = true;
      if (!job?.target) return;
      const { cargo: C, parcels: n, delivered } = job.job, result = job.arrive(x,z,speed,clock); // (the job as it was: gone once delivered)
      if (result === 'collected') flash((n > 1 ? n + ' ' + C.many + ' aboard · ' + minutes(job.load.allowed) + ' for the round' : cap(C.one) + ' collected · ' + minutes(job.load.allowed) + ' to deliver it') + (C.tip ? ' · ' + C.tip : ''));
      if (result === 'dropped') flash(cap(C.one) + ' ' + (delivered + 1) + ' of ' + n + ' delivered · ' + (n - delivered - 1) + ' to go');
      if (result === 'delivered') {
        const { title, detail: lines } = receiptText(job.receipt);
        receiptFor = 8; paid(job.receipt);
        refresh(x,z); // (hides the marker; the receipt takes the status box)
        stage.parentElement.hidden = false; stage.parentElement.classList.remove('late');
        stage.textContent = title; detail.textContent = lines;
        return;
      }
      refresh(x,z);
    },
    // a crash at `speed` m/s, running a red light and knocking into someone: they count while the parcel is aboard
    // (knocked() says whether it did)
    crash(speed, cushion = 1) {
      const load = job?.load; if (!load) return;
      const before = load.condition; job.crash(speed, cushion);
      const what = load.drops > 1 ? 'Load' : 'Parcel';
      if (load.condition < before) flash(load.condition > 0 ? what + ' damaged · ' + Math.round(load.condition * 100) + '%' : what + ' ruined');
    },
    ranRed() { if (job?.load) { job.ranRed(); flash('Ran a red light · ' + money(-FINE)); } },
    knocked() { if (!job?.load) return false; job.knocked(); flash('Hit a pedestrian · ' + money(-KNOCK_FINE)); return true; }
  };
}
