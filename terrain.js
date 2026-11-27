// Local coordinates match world.js. Terrain vertices and road surfaces share this triangle grid.
const STEP = 32, EXTENT = 640, SIDE = 1 + 2 * EXTENT / STEP;
const FLAT = Object.freeze({ active: false, step: STEP, extent: EXTENT, seaLevel: 0, height: () => 0 });
const TILE = 256, RAD = Math.PI / 180;
const wrap = (value, count) => ((value % count) + count) % count;

async function readTile(zoom, x, y, signal) {
  const url = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/' + [zoom, x, y].join('/') + '.png';
  // Neighboring drives reload the page. Use the browser's disk-backed HTTP cache.
  const response = await fetch(url, { signal, cache: 'force-cache' });
  if (!response.ok) throw new Error('Terrain tile unavailable');
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none' });
  try {
    if (bitmap.width !== TILE || bitmap.height !== TILE) throw new Error('Unexpected terrain tile size');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TILE;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, TILE, TILE).data;
  } finally { bitmap.close(); }
}

function terrainGrid(values) {
  const centre = values[(values.length - 1) / 2];
  function height(x, z) {
    const gx = (Math.max(-EXTENT, Math.min(EXTENT, x)) + EXTENT) / STEP;
    const gz = (Math.max(-EXTENT, Math.min(EXTENT, z)) + EXTENT) / STEP;
    const ix = Math.min(SIDE - 2, Math.floor(gx)), iz = Math.min(SIDE - 2, Math.floor(gz));
    const i = iz * SIDE + ix, u = gx - ix, v = gz - iz;
    const a = values[i], b = values[i + 1], c = values[i + SIDE], d = values[i + SIDE + 1];
    return (u >= v ? a + u * (b-a) + v * (d-b) : a + v * (c-a) + u * (d-c)) - centre;
  }
  return { active: true, step: STEP, extent: EXTENT, seaLevel: -centre, height };
}

async function fromTiles(lat, lon, getTile, signal) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) + (EXTENT + 2*STEP) / 110574 > 85.0511) return FLAT;
  const cos = Math.cos(lat * RAD);
  // Select native pixels around 20–30 metres apart across latitudes.
  const zoom = Math.round(Math.log2(156543 * cos / 24)), tileCount = 2 ** zoom, pixels = TILE * tileCount;
  // Pixel coordinates refer to the sample centres, half a pixel in from the tile edge.
  const columns = [], rows = [];
  for (let offset = -EXTENT - 2*STEP; offset <= EXTENT + 2*STEP; offset += STEP) {
    columns.push((lon + offset / (111320 * cos) + 180) / 360 * pixels - 0.5);
    const latitude = (lat - offset / 110574) * RAD;
    rows.push((1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2 * pixels - 0.5);
  }
  const tiles = new Map(), pending = [];
  for (let ty = Math.floor(rows[0] / TILE); ty <= Math.floor((Math.floor(rows.at(-1)) + 1) / TILE); ty++) {
    for (let tx = Math.floor(columns[0] / TILE); tx <= Math.floor((Math.floor(columns.at(-1)) + 1) / TILE); tx++) {
      pending.push(getTile(zoom, wrap(tx, tileCount), ty, signal).then(rgba => {
        if (rgba.length !== TILE * TILE * 4) throw new Error('Incomplete terrain tile');
        tiles.set(tx + ',' + ty, rgba);
      }));
    }
  }
  await Promise.all(pending);
  const pixel = (x, y) => {
    const data = tiles.get(Math.floor(x / TILE) + ',' + Math.floor(y / TILE));
    const i = 4 * (wrap(x, TILE) + TILE * wrap(y, TILE));
    const metres = data[i] * 256 + data[i + 1] + data[i + 2] / 256 - 32768;
    if (data[i + 3] !== 255 || metres === -32768) throw new Error('Missing terrain sample');
    return metres;
  };
  const values = [];
  for (const y of rows) for (const x of columns) {
    const ix = Math.floor(x), iy = Math.floor(y), u = x - ix, v = y - iy;
    const top = pixel(ix, iy) * (1-u) + pixel(ix+1, iy) * u;
    const bottom = pixel(ix, iy+1) * (1-u) + pixel(ix+1, iy+1) * u;
    values.push(top + (bottom-top) * v);
  }
  // Filter over a halo so a street near the area edge gets the same treatment.
  // The symmetric kernel preserves a steady uphill grade and damps one-cell spikes.
  const kernel = [1, 4, 6, 4, 1], filtered = [];
  for (let z = 0; z < SIDE; z++) for (let x = 0; x < SIDE; x++) {
    let sum = 0;
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
      sum += values[(z+j)*columns.length + x+i] * kernel[i] * kernel[j];
    }
    filtered.push(sum / 256);
  }
  return terrainGrid(filtered);
}

export async function loadTerrain(lat, lon, getTile = readTile, timeoutMs = 5000) {
  const controller = new AbortController();
  let timer;
  try {
    const deadline = new Promise(resolve => { timer = setTimeout(() => resolve(FLAT), timeoutMs); });
    return await Promise.race([fromTiles(lat, lon, getTile, controller.signal), deadline]);
  } catch {
    return FLAT;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
