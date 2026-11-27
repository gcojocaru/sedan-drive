// Vector tiles can divide one water surface into several shoreline polygons.
// Join fragments sharing an edge before estimating their common water level.
export function levelWaters(polys, height) {
  const lakes = polys.filter(p => p.kind === 'water' && p.t.waterway !== 'riverbank' && !['river','stream','canal'].includes(p.t.water));
  const parent = lakes.map((_,i) => i), edges = new Map();
  const root = i => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i=parent[i]; }
    return i;
  };
  const vertex = ([x,z]) => Math.round(x*10)+','+Math.round(z*10);
  lakes.forEach((p,i) => {
    let prev = vertex(p.outer.at(-1));
    for (const point of p.outer) {
      const next=vertex(point);
      if (next===prev) continue;
      const edge=prev<next ? prev+';'+next : next+';'+prev;
      if (edges.has(edge)) parent[root(i)] = root(edges.get(edge));
      else edges.set(edge,i);
      prev=next;
    }
  });
  const samples = new Map(), levels = new Map();
  lakes.forEach((p,i) => {
    const group=root(i);
    if (!samples.has(group)) samples.set(group,[]);
    const shore=samples.get(group);
    for (const pt of p.outer) shore.push(height(...pt));
  });
  for (const [group,shore] of samples) {
    shore.sort((a,b)=>a-b);
    levels.set(group,shore[Math.floor(shore.length/2)]);
  }
  lakes.forEach((p,i)=>{p.waterLevel=levels.get(root(i));});
}
