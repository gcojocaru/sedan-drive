// One place's OpenStreetMap download: the Overpass query, its cache key and the servers that answer it.
// Shared by the game (drive-map.js) and the caching proxy (proxy/worker.js), so the proxy only ever runs this query.

export const HALF = 500;        // metres each side of the start point (the playable area is a 1 km square)
export const MARGIN = 60;       // extra metres of map data around it
export const CACHE_V = 'osm7:'; // bump whenever the query changes; browser and proxy caches then start afresh
export const SNAP = 0.0005;     // start points snap to this grid (degrees, about 55 m) so nearby picks share one download

// The deployed caching proxy (see proxy/README.md), e.g. 'https://sedan-drive-osm.<your-subdomain>.workers.dev'.
// Leave empty to download straight from the public Overpass servers.
export const AREA_PROXY = '';

export const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

const NAMED_LANDMARKS = ['["shop"]', '["railway"~"^(station|halt)$"]', '["public_transport"="station"]', '["amenity"="bus_station"]'];
const PARTS = ['way["highway"]', 'node["highway"="stop"]', 'node["highway"="crossing"]["crossing"!~"^(unmarked|no)$"]',
  'node["barrier"="bollard"]', 'node["highway"="bus_stop"]', 'node["amenity"="bench"]', 'way["amenity"="bench"]',
  'node["public_transport"="platform"]["bus"="yes"]', 'way["public_transport"="platform"]["bus"="yes"]',
  'node["entrance"]["entrance"!="no"]', 'node["building"="entrance"]',
  ...NAMED_LANDMARKS.flatMap(tags => ['node', 'way', 'relation["type"="multipolygon"]'].map(type => type + tags + '["name"]')),
  'node["leisure"~"^(park|garden)$"]["name"]',
  'way["building"]', 'relation["building"]["type"="multipolygon"]', 'way["building:part"]', 'relation["building:part"]["type"="multipolygon"]',
  'way["natural"~"^(water|wood|scrub|grassland|heath|tree_row|beach|sand|wetland|coastline|bare_rock|scree)$"]', 'relation["natural"~"^(water|wood|scrub|beach|sand)$"]',
  'way["waterway"~"^(river|stream|canal|riverbank|ditch|drain)$"]', 'relation["waterway"="riverbank"]', 'way["water"]',
  'way["landuse"~"^(grass|meadow|forest|recreation_ground|village_green|cemetery|allotments|orchard|farmland|vineyard|residential|commercial|retail|industrial|railway|construction|brownfield|garages|military|religious|flowerbed|plant_nursery)$"]',
  'relation["landuse"~"^(forest|grass|meadow|residential|commercial|retail|industrial|cemetery|recreation_ground|railway|construction)$"]',
  'way["leisure"~"^(park|garden|pitch|playground|golf_course|common|dog_park)$"]', 'relation["leisure"~"^(park|garden|pitch)$"]',
  'way["amenity"~"^(parking|marketplace)$"]', 'relation["amenity"="parking"]',
  'way["railway"~"^(rail|light_rail|tram|narrow_gauge|subway|monorail|funicular|platform)$"]',
  'way["barrier"~"^(wall|fence|hedge|retaining_wall|city_wall|guard_rail)$"]', 'way["man_made"~"^(pier|breakwater|groyne)$"]', 'node["natural"="tree"]'];

export const snap = v => +(Math.round(v / SNAP) * SNAP).toFixed(4);
export const onGrid = v => Number.isFinite(v) && Math.abs(v / SNAP - Math.round(v / SNAP)) < 1e-6;
export const areaKey = (lat, lon) => CACHE_V + lat.toFixed(4) + ',' + lon.toFixed(4) + ':' + HALF;

export function overpassQuery(lat, lon) {
  const d = HALF + MARGIN, dLat = d / 110574, dLon = d / (111320 * Math.cos(lat * Math.PI / 180));
  const bb = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map(v => v.toFixed(6)).join(',');
  // Country metadata supplies the usual driving side for roads without a driving_side tag.
  return '[out:json][timeout:90];is_in(' + lat.toFixed(6) + ',' + lon.toFixed(6) + ')->.containing;area.containing["ISO3166-1"];out tags;(' + PARTS.map(s => s + '(' + bb + ');').join('') + ');out geom qt;';
}

// Overpass reports a timeout or running out of memory as a "remark" in an otherwise normal reply (with partial data).
export const overpassError = remark => typeof remark === 'string' && /error/i.test(remark) ? remark : null;
