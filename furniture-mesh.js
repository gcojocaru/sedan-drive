// Static street furniture. Each repeated part is drawn in one batch for the entire area.
import * as THREE from 'three';
import { parkedCars } from './traffic-cars.js';
import { makeTex } from './world-kit.js';

function busPlate() {
  const map = makeTex(128, 144, ctx => {
    ctx.fillStyle = '#175ab0'; ctx.fillRect(0,0,128,144);
    ctx.fillStyle = '#fff'; ctx.fillRect(9,9,110,126);
    ctx.fillStyle = '#173753';
    ctx.beginPath(); ctx.roundRect(31,28,66,78,12); ctx.fill();
    ctx.fillRect(35,99,12,14); ctx.fillRect(81,99,12,14);
    ctx.fillStyle = '#fff';
    ctx.fillRect(39,44,50,30); ctx.fillRect(49,35,30,4);
    ctx.fillRect(39,90,9,6); ctx.fillRect(80,90,9,6);
  });
  return new THREE.MeshStandardMaterial({map, roughness:0.65});
}

// → avoid(color) for the parked cars (traffic-cars.js parkedCars)
export function addFurniture(scene, objects, height = () => 0) {
  const avoid = parkedCars(scene, objects.filter(o=>o.kind==='car'), height);
  function group(kind, build) {
    const poses = objects.filter(o=>o.kind===kind);
    if (!poses.length) return;
    const group = new THREE.Group(); group.name = 'mapped_' + kind; scene.add(group);
    function part(geometry, material, offsets) {
      const mesh = new THREE.InstancedMesh(geometry, material, poses.length * offsets.length);
      const matrix = new THREE.Matrix4(), offset = new THREE.Matrix4();
      let i=0;
      for (const {x,z,h} of poses) for (const [lx,y,lz] of offsets) {
        matrix.makeRotationY(h).setPosition(x,height(x,z),z);
        mesh.setMatrixAt(i++,matrix.multiply(offset.makeTranslation(lx,y,lz)));
      }
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
    build(part);
  }
  const metal = new THREE.MeshStandardMaterial({color:0x47535a, roughness:0.58, metalness:0.45});
  group('bench', part => {
    const wood = new THREE.MeshStandardMaterial({color:0xb47645, roughness:0.83});
    part(new THREE.BoxGeometry(1.85,0.065,0.105), wood, [[0,0.49,-0.18],[0,0.49,-0.05],[0,0.49,0.08],[0,0.49,0.21]]);
    part(new THREE.BoxGeometry(1.85,0.13,0.055), wood, [[0,0.76,0.25],[0,0.94,0.25]]);
    part(new THREE.BoxGeometry(0.065,0.44,0.42), metal, [[-0.65,0.24,0],[0.65,0.24,0]]);
    part(new THREE.BoxGeometry(0.055,0.54,0.05), metal, [[-0.65,0.72,0.29],[0.65,0.72,0.29]]);
  });
  group('bollard', part => {
    part(new THREE.CylinderGeometry(0.09,0.11,0.88,12),metal,[[0,0.46,0]]);
    part(new THREE.CylinderGeometry(0.099,0.101,0.075,12),new THREE.MeshStandardMaterial({color:0xffdf85}),[[0,0.73,0]]);
  });
  group('bus_stop', part => {
    part(new THREE.CylinderGeometry(0.04,0.045,2.7,10),metal,[[0,1.36,0]]);
    const face = busPlate();
    part(new THREE.BoxGeometry(0.045,0.63,0.56),[face,face,metal,metal,metal,metal],[[0,2.51,0]]);
  });
  return avoid;
}
