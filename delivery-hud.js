import * as THREE from 'three';
import { createDelivery, deliveryNetwork, money, minutes, STOP_RADIUS, FINE, KNOCK_FINE } from './delivery.js';
import { routeTo, nearestOn } from './traffic.js';
import { pointAt, trimLine } from './geom.js';


// Wire up one area's job. The road network is sampled on the first job request. paid(receipt) banks a delivery;
// level() is the JOB_LEVELS level new jobs are planned for. flash(text, tone): toast.js.
const cap = s => s[0].toUpperCase() + s.slice(1);
const away = (t, x, z) => Math.ceil(Math.hypot(t.x-x, t.z-z)) + ' m ' + ['N','NE','E','SE','S','SW','W','NW'][(Math.round(Math.atan2(t.x-x, z-t.z)/(Math.PI/4))+8)%8];
const AMBER = 0xffbd66, TEAL = 0x68e6d3; // the stop's colour: pickup, drop-off
// The way to the stop (traffic.js routeTo) is planned when the stop changes and again when the car strays 18 m off it;
// `route` is what's left of it ahead of the car (for the minimap), and arrows lie on the road along the next 100 m.
export function deliveryHud(scene, graph, occupied, button, stage, detail, flash, paid = () => {}, level = () => 0, height = () => 0) {
  let job, lastTarget, clock = 0, lit = false; // clock: seconds of driving; lit: night (the beam may glow brighter)
  let way = null, along = 0, ahead = null, heading = 0, recheck = 0; // way: the route; along: how far the car is along it
  const ARROWS = 10, chevron = new THREE.Shape([[0.75, 0], [-0.15, 0.95], [-0.7, 0.95], [0.2, 0], [-0.7, -0.95], [-0.15, -0.95]].map(([x, y]) => new THREE.Vector2(x, y)));
  const arrows = new THREE.InstancedMesh(new THREE.ShapeGeometry(chevron).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, depthWrite: false }), ARROWS);
  arrows.name = 'delivery_route'; arrows.count = 0; arrows.frustumCulled = false; arrows.renderOrder = 2; scene.add(arrows);
  const place = new THREE.Object3D();
  function plan(x, z) { const t = job?.target; way = t ? routeTo(graph, x, z, heading, t.x, t.z) : null; along = 0; recheck = 1; }
  function follow(x, z, dt) { // keep up with the car along the route, plan again once it has left it, and lay the arrows
    if (!way) { arrows.count = 0; ahead = null; return; }
    const p = nearestOn(way, x, z);
    if (p.d > 18 && (recheck -= dt) <= 0) { plan(x, z); if (!way) return follow(x, z, 0); }
    else if (p.d <= 18) { along = p.along; recheck = 1; }
    ahead = along < way.len - 1 ? trimLine(way.pts, along, 0) : null;
    let n = 0;
    for (let d = along + 9; n < ARROWS && d < Math.min(along + 105, way.len - 4); d += 10, n++) {
      const [px, pz, ux, uz] = pointAt(way.pts, way.cum, d);
      place.position.set(px, height(px, pz) + 0.12, pz); place.rotation.set(0, Math.atan2(-uz, ux), 0); place.updateMatrix();
      arrows.setMatrixAt(n, place.matrix);
    }
    arrows.count = n; arrows.instanceMatrix.needsUpdate = true;
  }
  const marker = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(STOP_RADIUS-0.45, STOP_RADIUS, 64),
    new THREE.MeshBasicMaterial({color:0x68e6d3, transparent:true, opacity:0.85, depthWrite:false}));
  marker.name = 'delivery_stop';
  ring.rotation.x = -Math.PI/2;
  marker.add(ring);
  // A beam of light over the stop, above the rooftops: additive, so it only brightens, fading out upwards (vertex colours
  // to black), and out of the fog so it shows from across the area.
  const beamGeo = new THREE.CylinderGeometry(1.4,1.4,90,24,8,true), up = beamGeo.attributes.position, fade = [];
  for (let i = 0; i < up.count; i++) { const f = (0.5 - up.getY(i)/90) ** 1.6; fade.push(f,f,f); }
  beamGeo.setAttribute('color', new THREE.Float32BufferAttribute(fade,3));
  const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({vertexColors:true, transparent:true, opacity:0.4, blending:THREE.AdditiveBlending, depthWrite:false, fog:false, side:THREE.DoubleSide}));
  beam.name = 'delivery_beam'; beam.position.y = 45; beam.renderOrder = 1;
  marker.add(beam);
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
      lastTarget = target; plan(x, z);
      marker.visible = !!target;
      stage.parentElement.hidden = !target;
      button.textContent = target ? 'Cancel delivery' : 'Start delivery';
      if (target) {
        const base = height(target.x, target.z);
        marker.position.set(target.x, base + 0.16, target.z);
        const points = ring.geometry.attributes.position;
        for (let i = 0; i < points.count; i++) {
          points.setZ(i, height(target.x + points.getX(i), target.z - points.getY(i)) - base);
        }
        points.needsUpdate = true;
        ring.geometry.computeBoundingSphere();
        for (const m of [ring, beam, arrows]) m.material.color.set(job.phase === 'pickup' ? AMBER : TEAL);
        const { cargo: C, parcels: n, delivered } = job.job;
        stage.textContent = (job.phase === 'pickup' ? 'Pick up ' + (n > 1 ? n + ' ' + C.many : C.one) : n > 1 ? 'Drop-off ' + (delivered + 1) + ' of ' + n : 'Deliver ' + C.one) + (target.name ? ' · '+target.name : '');
      }
    }
    if (target) {
      const metres = Math.hypot(target.x-x,target.z-z), pulse = 0.5 + 0.5 * Math.sin(clock * 2 * Math.PI * 0.6);
      // (gentle by day; the beam fades out as the car reaches it, so it doesn't fill the view)
      beam.material.opacity = (lit ? 0.6 : 0.35) * (0.75 + 0.25 * pulse) * Math.min(1, Math.max(0, (metres - 8) / 25));
      ring.scale.setScalar(1 + 0.1 * pulse); ring.material.opacity = 0.6 + 0.3 * pulse;
      let instruction = metres <= STOP_RADIUS ? 'Stop here' : away(target, x, z);
      const load = job.load, left = load && load.allowed - (clock - load.since); // with the parcel aboard, the clock runs
      if (load) instruction += ' · ' + minutes(left) + (left < 0 ? ' late' : ' left') + (load.condition < 1 ? (load.drops > 1 ? ' · load ' : ' · parcel ') + Math.round(load.condition * 100) + '%' : '');
      if (detail.textContent !== instruction) detail.textContent = instruction;
      stage.parentElement.classList.toggle('late', left < 0);
    }
  }
  return {
    get target() { return job?.target; },
    // the rest of the way to the stop, [[x, z], …] from the car (null without a route)
    get route() { return ahead; },
    // the cargo aboard (delivery.js CARGO: what it does to the car), or null
    get cargo() { return job?.load ? job.job.cargo : null; },
    toggle(x,z,h = heading) {
      heading = h; job ??= createDelivery(deliveryNetwork(graph,occupied));
      if (job.target) { job.cancel(); flash('Delivery cancelled'); }
      else if (!job.start(x,z,level())) flash('No local delivery available here');
      else { const { cargo: C, parcels: n } = job.job; flash('New job · pick up ' + (n > 1 ? n + ' ' + C.many + ' for ' + n + ' drop-offs' : 'a ' + C.one) + ' ' + away(job.target, x, z) + (C.tip ? ' · ' + C.tip : ''), 'good'); }
      refresh(x,z); follow(x, z, 0);
    },
    // every frame of driving, dt seconds long (night: it's dark; h: the car's heading, for the route)
    update(x,z,speed,dt = 0,night = false,h = heading) {
      clock += dt; lit = night; heading = h;
      if (!job?.target) { follow(x, z, dt); return; }
      const { cargo: C, parcels: n, delivered } = job.job, result = job.arrive(x,z,speed,clock); // (the job as it was: gone once delivered)
      if (result === 'collected') flash((n > 1 ? n + ' ' + C.many + ' aboard · ' + minutes(job.load.allowed) + ' for the round' : cap(C.one) + ' collected · ' + minutes(job.load.allowed) + ' to deliver it') + (C.tip ? ' · ' + C.tip : ''), 'good');
      if (result === 'dropped') flash(cap(C.one) + ' ' + (delivered + 1) + ' of ' + n + ' delivered · ' + (n - delivered - 1) + ' to go', 'good');
      if (result === 'delivered') paid(job.receipt); // (the page shows the results card; refresh hides the marker and the status box)
      refresh(x,z); follow(x, z, dt);
    },
    // a crash at `speed` m/s, running a red light and knocking into someone: they count while the parcel is aboard
    // (knocked() says whether it did)
    crash(speed, cushion = 1) {
      const load = job?.load; if (!load) return;
      const before = load.condition; job.crash(speed, cushion);
      const what = load.drops > 1 ? 'Load' : 'Parcel';
      if (load.condition < before) flash(load.condition > 0 ? what + ' damaged · ' + Math.round(load.condition * 100) + '%' : what + ' ruined', 'bad');
    },
    ranRed() { if (job?.load) { job.ranRed(); flash('Ran a red light · ' + money(-FINE), 'bad'); } },
    knocked() { if (!job?.load) return false; job.knocked(); flash('Hit a pedestrian · ' + money(-KNOCK_FINE), 'bad'); return true; }
  };
}
