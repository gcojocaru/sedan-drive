# Sedan Drive

A procedurally modelled 3D compact sedan (Dacia Logan–style) built in three.js, with three pages:

| Page | What it does |
|---|---|
| `Drive Real Map.html` | **Main page.** Pick any spot on a world map; the 1 km square around it is built in 3D from OpenStreetMap (roads, buildings, parks, water) and you drive the sedan through it. |
| `Drive.html` | Drive the sedan around a closed test track with lap timing (best lap saved in `localStorage`). |
| `Sedan.html` | Studio model viewer: orbit the car, toggle every light (headlights, fog, indicators, hazards, brake, reverse, cabin), night scene, underside and interior views, export to GLB / OBJ. |

No build step, no dependencies to install: plain HTML + ES modules. three.js 0.184.0 and Leaflet 1.9.4 are served from `vendor/` (copies of the published files, checked with SRI hashes), so the game needs no CDN.

## Run it

ES modules don't load over `file://`, so serve the folder:

```bash
npm run dev        # http://localhost:5173  (uses npx serve)
# or
python3 -m http.server 5173
```

`npm test` runs the tests (`node --test`, Node 22+).

Then open http://localhost:5173 — it redirects to the real-map drive.

While driving on a real map, the minimap shows 240 metres across with north at the top. The amber arrow shows where your car is and which way it faces. A dashed line marks the edge of the playable area. When you reach it, choose **Load next area** to continue in that direction or **Stay here** to turn back. Neighboring map loads have a 30-second cooldown. The car resumes at rest, facing the same way.

## Deploy

It's a static site. GitHub Pages publishes the repo root from `main` (Settings → Pages → Deploy from a branch: `main`, `/ (root)`); `.nojekyll` makes it serve the files as they are. Any other static host works too: `npm run build` copies just the site files into `dist/` (`npm run preview` builds and serves it on :5174).

Before sharing the site widely, deploy the map data proxy: [proxy/README.md](proxy/README.md).

## Controls (driving pages)

| Key | Action |
|---|---|
| W / ↑ | Accelerate |
| S / ↓ | Brake, then reverse |
| A D / ← → | Steer |
| Space | Handbrake |
| H · C | Headlights · camera |
| T · N | Next time of day · night on/off (real-map page: starts at the place's real local time, with the sun where it really is; T goes through the presets and back to live) |
| E | Next weather (real-map page: starts with the real weather there now; then clear, partly cloudy, overcast, fog, rain, snow, thunderstorm, and back to live) |
| Esc | Settings (real-map page): choose the time of day and the weather. Driving pauses while it is open |
| V | Mute or unmute engine sound and tuning static. The radio has its own off position. |
| Q · Shift+Q | Radio: next / previous station, last one is off (real-map page: up to 30 stations from around the chosen place; test track: Romanian stations) |
| R | Reset / back on the road |
| M | Choose another place (real-map page) |

On phones and tablets only the driving controls appear on screen: steer on the left, gas and brake/reverse on the right. The ••• button above the brake opens the rest (handbrake, lights, time of day or night, weather, settings, camera, radio, reset).

## What gets built from the map (real-map page)

- **Roads** at their tagged width, sidewalks, lane markings (centre line, edge lines, lane dividers from `lanes=*`), zebra crossings, railings on bridges.
- Cars start and reset in a travel lane. Connected junctions have rounded corners, gaps in the lane markings and stop lines at mapped stops.
- **Buildings** from footprints and height/level tags, with `roof:shape` roofs (gabled, hipped, pyramidal, skillion, dome, onion). Untagged houses get a pitched roof unless mappers in the area mostly tag flat roofs. `building:part` pieces replace their outline, so landmarks with 3D tagging come out properly. `building:colour`/`material` and `roof:colour`/`material` are used.
- Ground-floor doors follow mapped entrances, with a street-facing doorway inferred when a building has none mapped. Retail frontages have framed display windows and a few softly lit bays at night.
- **Ground**: residential, commercial and industrial land, parking lots, plazas, parks, forests, farmland, beaches, rivers, lakes, and the **sea**, which is built from coastlines.
- **Railways** (ballast, sleepers, rails), **tram tracks**, **walls, fences and hedges**, piers and breakwaters, trees (mapped trees, tree rows, parks and forests, scattered garden trees).
- Parking lots and plazas count as hard ground, so the car keeps its road speed there.

## External services (real-map page)

- Map tiles: OpenStreetMap, Esri World Imagery (satellite toggle)
- Geocoding: Nominatim. Searches run on submit and are cached in the browser, at most one request a second; a clicked spot is named once, when you press Drive.
- Map data: The game requests Overpass servers directly, one at a time. The optional shared cache is disabled (`AREA_PROXY` is empty). A server that answers HTTP 429 is left alone for 30 s. Each browser also keeps the places it loaded in IndexedDB (`sedan-map-cache`).
- Weather: [Open-Meteo](https://open-meteo.com), free and keyless. Asked for the current weather and the local time zone once while the place loads, and again every 15 minutes while live weather is on.
- Radio: [radio-browser.info](https://www.radio-browser.info), the free community station directory. Asked once, on the first press of Q, for stations near the chosen place; the streams then play straight from each broadcaster.
- Fallback map data: when every Overpass server (or the proxy) refuses, the place is built from [OpenFreeMap](https://openfreemap.org)'s vector tiles, which have no request limits. That map is simpler (no roof shapes, walls, crossings or single trees), says so on screen, and isn't saved, so the next visit tries for full detail.

These are free community services with usage policies that count all of a site's players together. Deploy the proxy before sharing the site widely: see [proxy/README.md](proxy/README.md).

## Files

Contributing: [ARCHITECTURE.md](ARCHITECTURE.md) has the target module layout and the rules every PR follows.

```
Drive Real Map.html   real-map page (markup + styles; logic in drive-map.js)
drive-map.js          real-map page: map picker, loading screen, time of day and weather choice, car, game loop, HUD
sky.js                real-map sky: the sun where it really is, sky canvas, lights, shadows, fog, clouds, rain and snow
weather.js            the weather and local time right now at a place (Open-Meteo), and the weather presets
map-data.js           map data: browser cache, proxy, Overpass servers, vector-tile fallback
world.js              buildWorld(): the 3D place from OpenStreetMap elements, one builder per feature, plus road/area lookups
buildings.js          buildBuildings(): walls and roofs per footprint, building parts, shopfronts, lit windows
world-kit.js          three.js and tag helpers shared by world.js and buildings.js
geom.js               pure geometry helpers (strips, polygons, roofs, coastline → sea)
drive-core.js         driving shared by both drive pages: physics, car posing, chase camera, speed HUD
building-fronts.js    ground-floor entrance placement and retail window layouts
road-layout.js        directional lanes, junction corners, stop lines and spawn positions
area-travel.js        adjacent map areas, boundary prompts and load cooldown
driving-audio.js      synthesized engine and radio tuning sounds for both drive pages
minimap.js            north-up driving minimap drawn from the loaded world geometry
osm-query.js          the Overpass query, cache key, start-point grid and proxy address (shared with proxy/)
vector-fallback.js    OpenFreeMap vector tiles → the same element list as an Overpass reply (fallback map data)
radio.js              car radio: stations near the chosen place from radio-browser.info, Romanian presets on the test track
touch.js              on-screen driving buttons for touch screens (both drive pages)
proxy/                Cloudflare Worker that caches map downloads for all players (see proxy/README.md)
vendor/               three.js 0.184.0 and Leaflet 1.9.4, served by the site
sedan-model.js        buildCar(): the car, used by all three pages
vaz-model.js          loadVaz(): the VAZ-2101 car from models/vaz-2101.glb, chosen in the real-map picker
Drive.html            test-track page (markup + styles; logic in drive-track.js)
Sedan.html            model viewer (markup + styles; logic in sedan-viewer.js)
three-d-stage.js      <three-d-stage> web component: renderer, studio lights, orbit, GLB/OBJ export
```

The model was matched against third-party reference photos (Logan front 3/4, front, interior, wheel, underbody). They aren't in the repo for copyright reasons; keep local copies in `reference/`, which git ignores.

Originally made in Claude Design; moved here to keep developing it as code.
