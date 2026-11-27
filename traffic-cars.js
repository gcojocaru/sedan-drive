// The traffic cars (traffic.js) on screen: three instanced body styles in a range of paint
// colours, with head and tail lamps that light up at night and brake lights that come on as each car slows, and a soft
// contact shadow under each. None wears a paint close to the player's (avoid).
import * as THREE from 'three';
import { blobTex } from './world-kit.js';
import { groundPose } from './car-ground.js';
import { FLEET, AXLES, TYRE_RADIUS, streetCarModel, streetWheel, cabinTexture } from './traffic-models.js';

const PAINT = ['#e9e9e6', '#e9e9e6', '#d3d5d6', '#b9bdc0', '#8b9094', '#5c6165', '#2c2f32', '#151618', '#151618', '#7c1514', '#a92b1f', '#1f3a66', '#2e5079', '#3f5e44', '#c9bb9c', '#6f5b49', '#d8c64a', '#e2e0d8'].map(c => new THREE.Color(c));
// PAINT without the colours within 0.25 (sRGB, 0–1 a channel) of the player's paint `avoid`
const near = (a, b) => { const p = a.getHex(), q = b.getHex(); let d = 0; for (const s of [16, 8, 0]) d += ((p >> s & 255) - (q >> s & 255)) ** 2; return d < (0.25 * 255) ** 2; };
const paints = avoid => { const ok = avoid ? PAINT.filter(c => !near(c, avoid)) : PAINT; return ok.length ? ok : PAINT; };
const HEAD_ON = new THREE.Color(4, 3.8, 3.3), HEAD_OFF = new THREE.Color('#c9ccce'), TAIL = new THREE.Color(1.6, 0.08, 0.05), TAIL_OFF = new THREE.Color('#5a1010'), BRAKE = new THREE.Color(5, 0.25, 0.15);
// Geometry is immutable and shared between parked and moving fleets.
let models, wheelGeometry, windows;
function carMeshes(scene, max, height) {
  models ??= FLEET.map(streetCarModel);
  wheelGeometry ??= streetWheel();
  windows ??= cabinTexture();
  const meshes = [];
  function batch(name, geometry, material, capacity=max, colored=false, shadow=true) {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name=name; mesh.count=0; mesh.castShadow=mesh.receiveShadow=shadow; mesh.frustumCulled=false;
    if (colored) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity*3),3);
    scene.add(mesh); meshes.push(mesh);
    return mesh;
  }
  const paint = new THREE.MeshPhysicalMaterial({roughness:0.30, metalness:0.40, clearcoat:0.48, clearcoatRoughness:0.19});
  const glazing = new THREE.MeshStandardMaterial({map:windows,color:'#bbc7cb',roughness:0.13,metalness:0.32});
  const fittings = new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.56,metalness:0.23});
  const lamp = new THREE.MeshBasicMaterial();
  const fleet = models.map((g,i)=>{
    const make = (part, mat, colored, shadow) => batch('traffic_'+FLEET[i].name+'_'+part,g[part],mat,max,colored,shadow);
    return { body:make('body',paint,true,true), glass:make('glass',glazing,false,true),
      detail:make('detail',fittings,false,true), head:make('head',lamp,true,false), tail:make('tail',lamp,true,false) };
  });
  const wheels=batch('traffic_alloys',wheelGeometry,fittings,max*4);
  const distantWheels=batch('traffic_distant_tyres',new THREE.CylinderGeometry(TYRE_RADIUS,TYRE_RADIUS,0.19,10).rotateX(Math.PI/2),
    new THREE.MeshStandardMaterial({color:'#242527',roughness:0.87}),max*4);
  const shade=batch('traffic_contact_shadows',new THREE.PlaneGeometry(4.8,2.1).rotateX(-Math.PI/2).translate(0,0.07,0),
    new THREE.MeshBasicMaterial({map:blobTex(0.35,0.6),transparent:true,depthWrite:false}),max,false,false);
  shade.renderOrder=2;
  const M=new THREE.Matrix4(), W=new THREE.Matrix4(), Q=new THREE.Quaternion(), P=new THREE.Vector3();
  const orientation=new THREE.Euler(0,0,0,'YXZ'), one=new THREE.Vector3(1,1,1);
  return function paintCars(cars,lit,pal,placeGlows,eye) {
    for(const m of meshes)m.count=0;
    const n=Math.min(cars.length,max);
    for(let i=0;i<n;i++){
      const c=cars[i], type=(c.id ?? c.paint)%fleet.length, parts=fleet[type];
      const ground=height && groundPose(height,c.x,c.z,c.h);
      Q.setFromEuler(orientation.set(ground?.roll ?? 0,c.h,ground?.pitch ?? 0,'YXZ'));
      M.compose(P.set(c.x,ground?.y ?? 0,c.z),Q,one);
      placeGlows?.(c,i,M,models[type]);
      const close=!eye || (eye.x-c.x)**2+(eye.z-c.z)**2<85**2;
      const slot=parts.body.count;
      parts.body.setColorAt(slot,pal[c.paint%pal.length]);
      parts.head.setColorAt(slot,lit?HEAD_ON:HEAD_OFF);
      parts.tail.setColorAt(slot,c.braking?BRAKE:lit?TAIL:TAIL_OFF);
      for(const key of ['body','glass','head','tail'])parts[key].setMatrixAt(parts[key].count++,M);
      if(close)parts.detail.setMatrixAt(parts.detail.count++,M);
      shade.setMatrixAt(shade.count++,M);

      const wheel=close?wheels:distantWheels;
      const spin=close ? -(c.s ?? 0)/TYRE_RADIUS : 0;
      for(const x of AXLES)for(const side of [-1,1]){
        // Mirror the outward alloy face, then roll about the axle in car space.
        W.makeRotationFromEuler(orientation.set(0,side<0?Math.PI:0,spin,'ZXY'));
        W.setPosition(x,TYRE_RADIUS,side*0.756);
        wheel.setMatrixAt(wheel.count++,W.premultiply(M));
      }
    }
    for(const m of meshes)if(m.count){
      m.instanceMatrix.needsUpdate=true;
      if(m.instanceColor)m.instanceColor.needsUpdate=true;
    }
  };
}

// → avoid(color): repaints them away from the player's paint (null: any)
export function parkedCars(scene, cars, height) {
  if (!cars.length) return () => {};
  const group = new THREE.Group();
  group.name = 'parked_cars';
  scene.add(group);
  const paint = carMeshes(group, cars.length, height); paint(cars, false, PAINT);
  return avoid => paint(cars, false, paints(avoid));
}

export function trafficCars(scene, max, glowTex, height) {
  const paintCars = carMeshes(scene, max, height); let pal = PAINT;
  // night glows round the lamps: one point per lamp, brightness in its vertex colour
  const glows = [0xfff1dc, 0xff2a1a].map((color, i) => {
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 6), 3)).setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 6), 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ map: glowTex, color, size: i ? 0.9 : 1.5, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    p.frustumCulled = false; scene.add(p); return p;
  });
  // cars: traffic.js cars; lit: whether their lamps are on (dusk, night, murky weather)
  const point = new THREE.Vector3();
  function sync(cars, lit, eye) {
    const n = Math.min(cars.length, max), [hp, hc] = ['position', 'color'].map(a => glows[0].geometry.attributes[a]), [tp, tc] = ['position', 'color'].map(a => glows[1].geometry.attributes[a]);
    paintCars(cars, lit, pal, (c, i, matrix, model) => {
      const tailGlow = c.braking ? (lit ? 1 : 0.35) : lit ? 0.45 : 0;
      for (let k = 0; k < 2; k++) {
        const [hx, hy, hz] = model.heads[k], [tx, ty, tz] = model.tails[k], j = i * 2 + k;
        point.set(hx, hy, hz).applyMatrix4(matrix); hp.setXYZ(j, point.x, point.y, point.z); hc.setXYZ(j, lit ? 0.8 : 0, lit ? 0.8 : 0, lit ? 0.8 : 0);
        point.set(tx, ty, tz).applyMatrix4(matrix); tp.setXYZ(j, point.x, point.y, point.z); tc.setXYZ(j, tailGlow, tailGlow, tailGlow);
      }
    }, eye);
    for (const p of glows) { p.geometry.setDrawRange(0, n * 2); p.geometry.attributes.position.needsUpdate = p.geometry.attributes.color.needsUpdate = true; }
  }
  return { sync, avoid(color) { pal = paints(color); } }; // avoid: the player's paint (null: any)
}
