// Generic water crossings with a closed deck, longitudinal ribs and bearings.
// Use the mapped centreline for every section, including curved spans.
import * as THREE from 'three';
import { cumLen, pointAt, segDist } from './geom.js';

export function addBridgeStructures(scene, crossings, height) {
  const positions = [], colors = [], blocks = [], occupied = [];
  const stone = new THREE.Color('#b6a992'), slab = new THREE.Color('#908c81');
  const steel = new THREE.Color('#45615d'), cap = new THREE.Color('#708580');
  const v = (x,y,z) => new THREE.Vector3(x,y,z);
  function panel(a,b,c,d,color) {
    for (const p of [a,b,d,b,c,d]) {
      positions.push(p.x,p.y,p.z);
      colors.push(color.r,color.g,color.b);
    }
  }
  function beam(a,b,width,depth,color) {
    const axis = b.clone().sub(a), len = axis.length();
    if (len < 0.01) return;
    axis.divideScalar(len);
    const across = v(-axis.z,0,axis.x);
    if (across.lengthSq() < 0.0001) across.set(0,0,1);
    across.normalize();
    const up = across.clone().cross(axis);
    const matrix = new THREE.Matrix4().makeBasis(axis,up,across);
    matrix.scale(v(len,depth,width)).setPosition(a.clone().lerp(b,0.5));
    blocks.push({matrix,color});
  }
  const runs = [];
  for (const {road,samples,levels} of crossings) {
    let run = null;
    for (let i=1;i<samples.length;i++) {
      if (!Number.isFinite(levels[i-1]) && !Number.isFinite(levels[i])) { run=null; continue; }
      if (!run) { run={g:[samples[i-1]],road}; runs.push(run); }
      run.g.push(samples[i]);
    }
  }
  for (const run of runs) run.stations=cumLen(run.g);
  runs.sort((a,b)=>b.stations.at(-1)-a.stations.at(-1));
  for (const {g,road,stations} of runs) {
    const length=stations.at(-1), width=road.hw+(road.walk?2.2:0);
    if (length<5) continue;
    const spans=Math.max(1,Math.ceil(length/100)), span=length/spans;
    const bays=Math.max(2,Math.ceil(span/3)), pitch=span/bays;
    function section(s) {
      const [x,z,dx,dz]=pointAt(g,stations,s);
      return (offset,y) => {
        const px=x-dz*offset, pz=z+dx*offset;
        return v(px,height(px,pz)+y,pz);
      };
    }
    const existing=occupied.slice();
    for(let i=0;i<spans*bays;i++) {
      const [x,z]=pointAt(g,stations,(i+0.5)*pitch);
      if(existing.some(segment=>segDist(x,z,segment)[0]<Math.min(width,segment.width))) continue;
      const a=section(i*pitch), b=section((i+1)*pitch);
      const pa=a(0,0), pb=b(0,0), dx=pb.x-pa.x, dz=pb.z-pa.z;
      occupied.push({ax:pa.x,az:pa.z,dx,dz,l2:dx*dx+dz*dz||1,width});
      panel(a(-width,-0.48),b(-width,-0.48),b(width,-0.48),a(width,-0.48),slab);
      const ribDepth = t => 0.85 + Math.min(2.3,span/20)*(2*t-1)**2;
      const h0=-ribDepth((i%bays)/bays), h1=-ribDepth((i%bays+1)/bays);
      for(const side of [-1,1]) {
        const edge=side*width, rib=side*(width-0.35);
        panel(a(edge,0.038),a(edge,-0.48),b(edge,-0.48),b(edge,0.038),stone);
        beam(a(rib,h0),b(rib,h1),0.38,0.38,steel);
        beam(a(rib,h0),a(rib,-0.46),0.20,0.18,steel);
        beam(a(edge,0.08),b(edge,0.08),0.28,0.18,stone);
        beam(a(edge,1.14),b(edge,1.14),0.095,0.095,cap);
        beam(a(edge,0.56),b(edge,0.56),0.05,0.06,steel);
        for(const f of [a,section((i+0.5)*pitch)]) beam(f(edge,0.14),f(edge,1.14),0.075,0.075,steel);
      }
      if(i%bays===0 || i===spans*bays-1) {
        const foot=i%bays===0?a:b;
        beam(foot(-width+0.1,-0.6),foot(width-0.1,-0.6),1.5,0.35,stone);
        beam(foot(-width+0.35,-6.4),foot(width-0.35,-6.4),1.6,11.2,stone);
      }
    }
  }
  if (!blocks.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geo.computeVertexNormals();
  const shell=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:0.85}));
  const details=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({roughness:0.69}),blocks.length);
  blocks.forEach(({matrix,color},i)=>{details.setMatrixAt(i,matrix);details.setColorAt(i,color);});
  for(const m of [shell,details]) { m.castShadow=m.receiveShadow=true; scene.add(m); }
}
