import * as THREE from 'three';
import { createDelivery, deliveryNetwork, STOP_RADIUS } from './delivery.js';

// Wire up one area's job. The road network is sampled on the first job request.
export function deliveryHud(scene, graph, occupied, button, stage, detail, flash) {
  let job, lastTarget;
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
      stage.parentElement.hidden = !target;
      button.textContent = target ? 'Cancel delivery' : 'Start delivery';
      if (target) {
        marker.position.set(target.x,0.16,target.z);
        stage.textContent = (job.phase === 'pickup' ? 'Pick up parcel' : 'Deliver parcel') + (target.name ? ' · '+target.name : '');
      }
    }
    if (target) {
      const metres = Math.hypot(target.x-x,target.z-z);
      const bearing = Math.atan2(target.x-x, z-target.z);
      const direction = ['N','NE','E','SE','S','SW','W','NW'][(Math.round(bearing/(Math.PI/4))+8)%8];
      const instruction = metres <= STOP_RADIUS ? 'Stop here' : Math.ceil(metres) + ' m ' + direction;
      if (detail.textContent !== instruction) detail.textContent = instruction;
    }
  }
  return {
    get target() { return job?.target; },
    toggle(x,z) {
      job ??= createDelivery(deliveryNetwork(graph,occupied));
      if (job.target) { job.cancel(); flash('Delivery cancelled'); }
      else if (!job.start(x,z)) flash('No local delivery available here');
      refresh(x,z);
    },
    update(x,z,speed) {
      if (!job?.target) return;
      const result = job.arrive(x,z,speed);
      if (result === 'collected') flash('Parcel collected');
      if (result === 'delivered') flash('Delivery complete');
      refresh(x,z);
    }
  };
}
