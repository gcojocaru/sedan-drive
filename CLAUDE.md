# CLAUDE.md

Context for working on this repo. See README.md for what the pages do and how to run them.

**Every PR follows the rules and target layout in ARCHITECTURE.md** (imported below). If a change can't follow them, say why in the PR.

@ARCHITECTURE.md

## Stack

- Plain HTML + native ES modules. No bundler, no npm dependencies, no TypeScript.
- three.js **0.184.0** via the import map in each page's `<head>`, served from `vendor/three-0.184.0/` (unmodified copies of the npm files) with SRI `integrity` hashes. To bump it, copy the new files into a new `vendor/three-<version>/`, then update every path *and* every hash in all three pages together, or the browser will refuse to load it. Nothing loads from a CDN at runtime.
- Leaflet 1.9.4 (real-map page only) from `vendor/leaflet-1.9.4/`, loaded as a classic script → global `L`.
- Serve with `npm run dev` (port 5173). `file://` won't work because of module imports.

## Architecture

- **The car model exists in three copies** — keep this in mind before editing it:
  - `sedan-model.js` → `export function buildCar()`; imported by `drive-map.js`.
  - `Drive.html` → its own inline `buildCar()`.
  - `Sedan.html` → inline model inside the page module.
  The model bodies are identical today (interior and light rig included); only the page setup around them differs (Sedan.html adds a studio environment, contact shadows and light controls). Until migration step 2 in ARCHITECTURE.md lands, a change to the car's look must be made in all three.
- Units are metres; the car's long axis is +X (front axle at x≈1.32, rear at x≈-1.31), y up.
- Meshes and groups are named (`car.getObjectByName('underbody')`, `steering_wheel`, `front_seat_L`, …). Other code looks parts up by name, so keep names stable when renaming things.
- `osm-query.js` holds the Overpass query (`overpassQuery`), the cache key (`areaKey`, `CACHE_V`), the ~55 m start-point grid (`snap`), the server list and `AREA_PROXY`. It is imported by both `drive-map.js` and `proxy/worker.js` (Cloudflare Worker, bundled by wrangler), so the proxy only ever runs the game's own query. Change the query there, bump `CACHE_V`, and redeploy the Worker with the site.
- `vector-fallback.js` decodes Mapbox Vector Tiles itself (no library) and maps OpenMapTiles layers to OSM-style tags (`tagsFor`), emitting Overpass-shaped `elements` (ways, and relations for polygons with holes) so `startGame()` doesn't care about the source. Polygons are clipped to their tile so neighbouring tiles' pieces don't overlap; street names come from the `transportation_name` layer by nearest-line match.
- `drive-map.js` sections: map picker (Leaflet + Nominatim: searches cached, max 1 request/s, one reverse lookup on Drive) → IndexedDB cache → map data download (`fetchArea`: proxy, then Overpass servers one at a time; 429/406 rests a server for 30 s; a 503 from the proxy means it already tried them all; if nothing delivers, `vector-fallback.js` builds the place from OpenFreeMap vector tiles, which isn't cached) → geometry helpers (`ribbon`, `fillPoly`, `obb`, `clipHalf`, `tri3`/`wallStrip`, …) → `seaPolys()` (coastline → sea) → OSM tag tables (`areaKind`, `ROAD` widths, `PATH`, roof shapes, wall/roof materials) → `startGame()` (world build, physics, camera, HUD).
- World build order inside `startGame()`: area fills + sea → roads, lane marks → road lookup grid (`roadAt`) → crossings, railways → flat layer meshes → walls/fences/bridge railings → area grid (`areaAt`) → buildings → trees → street lamps → car → `applyTime()`.
- Lighting (real-map page): `TIMES` are time-of-day presets in local *solar* time; `sunAt(h)` gives the real sun direction for the place's latitude and today's date. `applyTime(i)` sets everything from the sun elevation: directional light (sun / soft dusk sky light / moon), hemisphere + environment fill, fog, exposure, lit windows, street lamps, auto headlights, and redraws the sky canvas (`drawSky`, equirect, sun drawn where the light comes from) plus its PMREM. The single shadow map covers a box centred 45 m ahead of the car (`placeShadow`), snapped to texels so edges don't shimmer. Flat ground layers are separate meshes stacked a few mm apart (`LAYERS`, lowest first); the base ground plane sits 3 cm below them.
- Buildings: walls and roofs are generated per footprint (no `ExtrudeGeometry`). Pitched roofs are the lower envelope of planes over the footprint's minimum-area box (`roofPlanes`); walls rise to that roof line. Footprints that aren't box-like enough fall back to flat roofs.
- The playable area is a 1 km square (`HALF = 500` m) around the chosen point.
- `radio.js` is the car radio for both drive pages (`Q` / `Shift+Q`): `STATIONS` (name, HTTPS stream URL; the site is HTTPS so `http://` streams would be blocked, and HLS needs a library) and `radio(show)` → `tune(step)` playing through one `<audio>`. Streams came from radio-browser.info; replace any that die there.
- `three-d-stage.js` is a generic viewer web component from the Claude Design starter. Its `notifyExport()` posts a message to `window.parent` for the old host's telemetry; it's a harmless no-op standalone and can be removed.

## localStorage / IndexedDB keys

- `sedan-map-last-place-v1` — last chosen place (real-map page)
- `sedan-drive-best-v1` — best lap time (Drive.html)
- `sedan-lights-v1` — viewer light toggles (Sedan.html)
- IndexedDB `sedan-map-cache` / store `osm` — cached Overpass responses, keyed `areaKey()` = `osm3:<lat>,<lon>:<HALF>` (4 decimals, snapped). Bump `CACHE_V` in `osm-query.js` whenever the query changes; entries with an older prefix are pruned after the next download.
- `sedan-geocode-cache-v1` — Nominatim results (last 60 searches / reverse lookups)
- `sedan-overpass-rest-v1` — Overpass servers to leave alone until a time (after HTTP 429/406)

## Conventions

- Code is written densely (many statements per line, short helper names like `V`, `B`, `add`). Match the surrounding style rather than reformatting whole files.
- Add any new library as an exact version under `vendor/<name>-<version>/` with its licence, not from a CDN.
- `reference/` (git-ignored, local only) holds the photos the model was matched against (Logan front 3/4, front, interior, wheel, underbody) — look at them when working on the car's shape if they're present. They are third-party photos: never commit them; the repo is public.
