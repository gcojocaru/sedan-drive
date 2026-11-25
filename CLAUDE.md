# CLAUDE.md

Context for working on this repo. See README.md for what the pages do and how to run them.

## Stack

- Plain HTML + native ES modules. No bundler, no npm dependencies, no TypeScript.
- three.js **0.184.0** via the import map in each page's `<head>` (unpkg, with SRI `integrity` hashes). If you bump the version, update every URL *and* every hash in all three pages together, or the browser will refuse to load it.
- Leaflet 1.9.4 (real-map page only), loaded as a classic script → global `L`.
- Serve with `npm run dev` (port 5173). `file://` won't work because of module imports.

## Architecture

- **The car model exists in three copies** — keep this in mind before editing it:
  - `sedan-model.js` → `export function buildCar()`; imported by `drive-map.js`.
  - `Drive.html` → its own inline `buildCar()`.
  - `Sedan.html` → inline model inside the page module, plus the full interior and light rig.
  A change to the car's look only shows up on the page(s) whose copy you edit. Consolidating them into `sedan-model.js` is a reasonable refactor, but do it deliberately (the Sedan.html copy has extras the others lack) and only when asked.
- Units are metres; the car's long axis is +X (front axle at x≈1.32, rear at x≈-1.31), y up.
- Meshes and groups are named (`car.getObjectByName('underbody')`, `steering_wheel`, `front_seat_L`, …). Other code looks parts up by name, so keep names stable when renaming things.
- `drive-map.js` sections: map picker (Leaflet + Nominatim) → IndexedDB cache → geometry helpers (`ribbon`, `fillPoly`, `obb`, `clipHalf`, `tri3`/`wallStrip`, …) → `seaPolys()` (coastline → sea) → OSM tag tables (`areaKind`, `ROAD` widths, `PATH`, roof shapes, wall/roof materials) → `startGame()` (Overpass fetch with mirror fallback, world build, physics, camera, HUD).
- World build order inside `startGame()`: area fills + sea → roads, lane marks → road lookup grid (`roadAt`) → crossings, railways → flat layer meshes → walls/fences/bridge railings → area grid (`areaAt`) → buildings → trees → car. Flat ground layers are separate meshes stacked a few mm apart (`LAYERS`, lowest first); the base ground plane sits 3 cm below them.
- Buildings: walls and roofs are generated per footprint (no `ExtrudeGeometry`). Pitched roofs are the lower envelope of planes over the footprint's minimum-area box (`roofPlanes`); walls rise to that roof line. Footprints that aren't box-like enough fall back to flat roofs.
- The playable area is a 1 km square (`HALF = 500` m) around the chosen point.
- `three-d-stage.js` is a generic viewer web component from the Claude Design starter. Its `notifyExport()` posts a message to `window.parent` for the old host's telemetry; it's a harmless no-op standalone and can be removed.

## localStorage / IndexedDB keys

- `sedan-map-last-place-v1` — last chosen place (real-map page)
- `sedan-drive-best-v1` — best lap time (Drive.html)
- `sedan-lights-v1` — viewer light toggles (Sedan.html)
- IndexedDB `sedan-map-cache` / store `osm` — cached Overpass responses, keyed `osm2:<lat>,<lon>:<HALF>`. Bump `CACHE_V` in `drive-map.js` whenever the Overpass query changes; entries with an older prefix are pruned after the next download.

## Conventions

- Code is written densely (many statements per line, short helper names like `V`, `B`, `add`). Match the surrounding style rather than reformatting whole files.
- Pin any new CDN dependency to an exact version.
- `reference/` holds the photos the model was matched against (Logan front 3/4, front, interior, wheel, underbody) — look at them when working on the car's shape.
