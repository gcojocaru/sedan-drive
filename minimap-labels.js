// Map positions are metres east and south. Label positions are in the minimap's 180 drawing units.
import { bbox, cumLen } from './geom.js';

// The midpoint of an interior interval stays inside concave footprints and outside courtyards.
export function addressAnchor({outer, holes}) {
  const {z0,z1} = bbox(outer), z = (z0+z1)/2, cuts = [];
  for (const ring of [outer, ...holes]) {
    for (let i=1; i<ring.length; i++) {
      const [x0,y0] = ring[i-1], [x1,y1] = ring[i];
      if ((y0 > z) !== (y1 > z)) cuts.push(x0 + (x1-x0)*(z-y0)/(y1-y0));
    }
  }
  cuts.sort((a,b)=>a-b);
  let widest = 0, point;
  for (let i=1; i<cuts.length; i+=2) {
    const width = cuts[i]-cuts[i-1];
    if (width > widest) { widest = width; point = [(cuts[i]+cuts[i-1])/2,z]; }
  }
  return point;
}

const CELL = 80;
export function minimapLabels({roads, polys, addressPoints = []}, half) {
  const grid = new Map();
  function add(text, [x,z], street, angle=0) {
    if (Math.abs(x)>half || Math.abs(z)>half || !text) return;
    const key = Math.floor(x/CELL)+','+Math.floor(z/CELL);
    if (!grid.has(key)) grid.set(key,[]);
    grid.get(key).push({text,x,z,street,angle});
  }
  for (const {g,name} of roads) {
    if (!name || g.length<2) continue;
    const lengths = cumLen(g), total = lengths.at(-1);
    const count = Math.max(1,Math.ceil(total/42));
    let i=1;
    for (let n=0; n<count && total>0; n++) {
      const d = (n+0.5)*total/count;
      while (i<g.length-1 && lengths[i]<d) i++;
      const [ax,az]=g[i-1], dx=g[i][0]-ax, dz=g[i][1]-az;
      const t=(d-lengths[i-1])/(lengths[i]-lengths[i-1]);
      let angle=Math.atan2(dz,dx);
      if (angle>Math.PI/2) angle-=Math.PI;
      if (angle< -Math.PI/2) angle+=Math.PI;
      add(name,[ax+t*dx,az+t*dz],true,angle);
    }
  }
  for (const {text,point} of addressPoints) add(text,point,false);
  for (const p of polys) {
    const number = p.t?.['addr:housenumber'];
    if (!number || !['building','part'].includes(p.kind)) continue;
    const point = addressAnchor(p);
    if (point) add(number,point,false);
  }

  // The same street can have many anchors; measure each distinct label only once per area.
  const metrics = new Map();
  function measure(ctx, text, street) {
    const key = (street ? 'street:' : 'address:') + text;
    if (!metrics.has(key)) {
      let lines = [text];
      if (street && ctx.measureText(text).width > 136) {
        const words = text.split(/\s+/);
        let best = Infinity;
        for (let i=1; i<words.length; i++) {
          const pair = [words.slice(0,i).join(' '), words.slice(i).join(' ')];
          const width = Math.max(...pair.map(line=>ctx.measureText(line).width));
          if (width < best) { best=width; lines=pair; }
        }
      }
      const width = Math.min(144, Math.max(...lines.map(line=>ctx.measureText(line).width)));
      metrics.set(key,{lines,width});
    }
    return metrics.get(key);
  }
  return (ctx,x,z,size,span,goal) => {
    const mid=size/2, scale=size/span, visible=[];
    for (let i=Math.floor((x-span/2)/CELL); i<=Math.floor((x+span/2)/CELL); i++) {
      for (let j=Math.floor((z-span/2)/CELL); j<=Math.floor((z+span/2)/CELL); j++) {
        for (const p of grid.get(i+','+j) || []) {
          const px=mid+(p.x-x)*scale, py=mid+(p.z-z)*scale;
          if (px>=0 && py>=0 && px<=size && py<=size) visible.push({p,px,py,dist:(p.x-x)**2+(p.z-z)**2});
        }
      }
    }
    visible.sort((a,b)=>Number(b.p.street)-Number(a.p.street) || a.dist-b.dist);
    const used=[[mid-12,mid-12,mid+12,mid+12],[0,0,23,22],[3,size-21,82,size]];
    if (goal) used.push([goal.x-9,goal.y-9,goal.x+9,goal.y+9]);
    const streets=new Set();
    let numbers=0;
    ctx.save();
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.lineJoin='round';
    for (const {p,px,py} of visible) {
      if (p.street ? streets.has(p.text) || streets.size>=4 : numbers>=8) continue;
      ctx.font=p.street?'600 15px sans-serif':'bold 13px sans-serif';
      const {lines,width}=measure(ctx,p.text,p.street);
      const w=width/2+2, h=p.street?8*lines.length:8;
      const c=Math.abs(Math.cos(p.angle)), s=Math.abs(Math.sin(p.angle));
      const rx=w*c+h*s, ry=w*s+h*c;
      // Prefer the road itself. At a junction try beside it to keep both the name and the markers readable.
      let cx,cy,box;
      for (const offset of p.street ? [0,14,-14,23,-23] : [0]) {
        cx=px+Math.sin(p.angle)*offset; cy=py-Math.cos(p.angle)*offset;
        const room=[cx-rx,cy-ry,cx+rx,cy+ry];
        if (room[0]>=2 && room[1]>=2 && room[2]<=size-2 && room[3]<=size-2 &&
            !used.some(([l,t,r,b])=>room[2]>=l && room[0]<=r && room[3]>=t && room[1]<=b)) {
          box=room;
          break;
        }
      }
      if (!box) continue;
      used.push(box);
      if (p.street) streets.add(p.text); else numbers++;
      ctx.save(); ctx.translate(cx,cy); ctx.rotate(p.angle);
      ctx.strokeStyle='#172329'; ctx.lineWidth=3;
      ctx.fillStyle=p.street?'#ffffef':'#f5dec0';
      for (let i=0; i<lines.length; i++) {
        const baseline=(i-(lines.length-1)/2)*16;
        ctx.strokeText(lines[i],0,baseline,144);
        ctx.fillText(lines[i],0,baseline,144);
      }
      ctx.restore();
    }
    ctx.restore();
  };
}
