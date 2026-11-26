# Architecture

Where the code is today, where it is going, and the rules every PR follows to get there. CLAUDE.md has the detail on
how each part works; this file says how the parts may fit together.

## Decisions

- **No build step.** Plain HTML + native ES modules, libraries vendored under `vendor/<name>-<version>/` and loaded
  through each page's import map with SRI hashes. GitHub Pages serves the repo root as it is. No bundler, no
  TypeScript, no runtime CDN, no npm dependencies.
- **Tests run on Node's built-in runner** (`node --test`, Node 22+), with no test dependencies. They cover pure code;
  rendering is checked in the browser.
- **Refactor first, in short PRs.** The steps under [Migration](#migration) land as behaviour-neutral PRs, in order.
  Feature PRs written meanwhile already follow the [rules](#rules-for-every-pr) for the code they add.

## Today (Nov 2026)

| File | Lines | What it is |
|---|---|---|
| `drive-map.js` | 1085 | Real-map page: picker, IndexedDB cache, map download, geometry helpers, OSM tag tables, and `startGame()`, one ~690-line closure holding world build, physics, camera, time of day and HUD |
| `drive-track.js` | 259 | Test-track page (`Drive.html`): track, physics, camera, HUD, laps |
| `sedan-viewer.js` | 108 | Viewer page (`Sedan.html`): studio lights, contact shadows, light toggles, views |
| `sedan-model.js` | 662 | `buildCar()` and the axle constants `FA`, `RA`: the one procedural car, used by all three pages |
| `vaz-model.js` | 46 | `loadVaz()`: VAZ-2101 from `models/vaz-2101.glb` in `buildCar()`'s shape, the second car on the real-map page |
| `three-d-stage.js` | 435 | Viewer web component (renderer, orbit, GLB/OBJ export) |
| `area-travel.js` | — | Neighboring-area geometry, boundary confirmation and cooldown |
| `driving-audio.js` | — | Shared engine and tuning synthesis and per-tab mute |
| `road-layout.js` | — | Pure lane, junction and spawn geometry |
| `minimap.js` | — | North-up driving minimap and car marker, drawn on supplied canvases |
| `building-fronts.js` | — | Ground-floor facade layout and atlas drawing on a supplied canvas context |
| `vector-fallback.js` | 150 | OpenFreeMap vector tiles → Overpass-shaped elements |
| `radio.js` | 53 | Car radio for both drive pages: `stationsNear()` (radio-browser.info, real-map page), Romanian presets (test track), `radio(show, find, tuningStatic)` player, `radioHud()` station display |
| `touch.js` | 57 | On-screen driving buttons for touch screens, both drive pages: `touchControls(extras)` sends the keydown/keyup each button's key would |
| `osm-query.js` | 37 | Overpass query, cache key, start-point grid, servers; shared with the proxy |
| `proxy/worker.js` | 69 | Cloudflare Worker that caches map downloads |

What already works well and stays: the Overpass-shaped `elements` list as the single contract between map sources
and the world builder; `osm-query.js` shared by browser and Worker so the proxy only runs the game's query; I/O passed
in (`fetchVectorArea(lat, lon, fetchFn)`); named meshes; versioned storage keys.

What has to change:

1. **Driving exists twice.** Input, physics step, wheel/lamp sync, chase camera and HUD are copied between `drive-track.js`
   and `drive-map.js`, with drifted tuning (top speeds, off-road drag, collision only on the map page).
2. **`startGame()` does everything.** World building and the game loop share one closure, so nothing in it can be
   tested or reused, and every feature makes it longer.

## Target

Pages hold markup, CSS, the import map and one `<script type="module" src>`. All logic lives in modules at the repo
root, one copy each. Page URLs don't change.

| Module | Owns | May import |
|---|---|---|
| `drive-map.js` | Real-map page entry: picker, loading screen, time of day, game loop wiring | everything below |
| `drive-track.js` | Test-track page entry: track geometry, lap timing | `drive-core`, `sedan-model`, `radio`, `touch` |
| `sedan-viewer.js` | Viewer page entry: studio environment, light toggles, views, export | `three-d-stage`, `sedan-model` |
| `drive-core.js` | Driving shared by both drive pages: keys, physics step, wheel/steering/lamp sync, chase camera, speed/gear HUD | three |
| `minimap.js` | Cached raster of real-map geometry and car-centred HUD view | nothing |
| `world.js` | `buildWorld(elements, origin, scene)` → meshes plus lookups (`roadAt`, `areaAt`, `inBuilding`, `snapToRoad`, lamps, lit windows) | `geom`, three |
| `map-data.js` | `loadArea(lat, lon, status)`: IndexedDB cache → proxy → Overpass → vector fallback; returns `{ data, fallback, err }` | `osm-query`, `vector-fallback` |
| `sedan-model.js` | `buildCar()` and the axle constants: the procedural car | three |
| `vaz-model.js` | `loadVaz()`: the VAZ-2101 model file, returned in `buildCar()`'s shape | three (GLTFLoader) |
| `area-travel.js` | Boundary dialog, projected arrival pose and cooldown | `osm-query` |
| `driving-audio.js` | Synthesized engine and tuning sounds on both driving pages | nothing |
| `radio.js` | `stationsNear(lat, lon, fetch)`, presets, `radio(show, find, tuningStatic)` → `tune(step)`; station playback | nothing |
| `touch.js` | `touchControls(extras)`: on-screen buttons for touch screens that press keys (synthetic keydown/keyup), so pages handle touch and keyboard the same way | nothing |
| `geom.js` | Pure geometry on plain arrays (`ribbon`, `fillPoly`, `obb`, `clipHalf`, `joinRings`, …) | nothing |
| `osm-query.js` | Query, cache key, grid, servers, proxy address | nothing |
| `vector-fallback.js` | Vector tiles → Overpass-shaped elements | `osm-query` |
| `three-d-stage.js` | Viewer component | three |
| `proxy/worker.js` | Caching proxy | `osm-query` |

Dependencies point down the table only. Page entries are the only modules that touch the page's DOM at import time.
`geom.js`, `osm-query.js` and `vector-fallback.js` stay importable in Node: no three, no DOM, no storage, and network
only through a passed-in `fetch`. `radio.js` follows the same rules, except that calling `radio()` creates an `<audio>` and `radioHud()` its on-screen station display. The travel controller reads browser history and the cooldown at runtime. The driving audio factory reads the tab’s mute preference and initializes Web Audio on a driving gesture.

Tests live in `test/*.test.js` and run with `npm test`. Tests build their own fixtures (the vector-fallback test
encodes its own tile) and never touch the network. `test/pages.test.js` checks that the three import maps are identical
and every `integrity` hash matches its file in `vendor/`.

## Rules for every PR

1. **One copy.** Never paste code from one page or module into another. Code two places need goes in a module both
   import. Where they need slightly different behaviour, pass the difference in (an argument, a callback such as
   `surface(x, z)` or `blocked(x, z, h)`); don't fork the code.
2. **Respect the dependency table.** No upward imports, no new DOM or three.js use in the Node-importable modules, no
   network or storage calls outside `map-data.js`, `vector-fallback.js`, `radio.js` (station search through a passed-in
   `fetch`, and the stream itself), `vaz-model.js` (its own model file), the proxy and the page entries.
3. **New logic goes in its module, not in a page and not in `startGame()`.** A new world feature is its own function
   in `world.js` (until it exists, a function outside `startGame()` that takes what it needs). No new inline
   `<script type="module">` logic in pages.
4. **Map data enters through the elements contract.** A new map source converts its data into Overpass-shaped
   `elements` (nodes with `lat`/`lon`, ways with `geometry`, relations with `members`). The world builder never
   branches on where data came from; the `fallback` flag only drives the on-screen note.
5. **Query changes ship together.** Changing `overpassQuery` means bumping `CACHE_V` and redeploying the Worker in the
   same release.
6. **Stored data is versioned.** localStorage keys and IndexedDB entries carry a version (`-v1`, `osm3:`); changing
   their shape bumps it. New keys are added to the list in CLAUDE.md.
7. **Names are API.** Mesh, group and material names are looked up by other code. Grep before renaming.
8. **Pure logic gets a test.** A PR that adds or changes logic in a Node-importable module (or the physics step once
   it is in `drive-core.js`) adds or updates a `node --test` test. `npm test` passes before merge.
9. **Size is a signal.** A module growing past ~600 lines or a function past ~150 gets split along a seam in its own
   refactor PR, not grown further.
10. **Refactors and features are separate PRs.** A refactor PR changes no behaviour, says so in its description, and
    is checked by driving both drive pages and opening the viewer.
11. **No new dependencies.** A library is vendored as an exact version with its licence and added to all three import
    maps with its hash (the import-map test checks them). Prefer the platform and code already here.
12. **Docs move with the code.** A PR that changes the module layout, a contract or a storage key updates this file
    and CLAUDE.md in the same PR.

## Migration

Behaviour-neutral PRs, in this order. Tick them off here as they merge.

- [x] **1. Test harness.** `npm test` runs `node --test`. First tests: `osm-query.js` (`snap`, `onGrid`, `areaKey`),
  `vector-fallback.js` (`decodeTile` and the tag mapping on a fixture tile), and a check that the three pages' import
  maps are identical and every `integrity` hash matches the file in `vendor/`. `npm run build` copies `*.html`, `*.js`,
  `vendor/` and `models/` instead of a list.
- [x] **2. One car.** `Drive.html` and `Sedan.html` import `buildCar` from `sedan-model.js` (export `FA`, `RA` for the
  viewer's contact shadows) and their inline scripts move to `drive-track.js` and `sedan-viewer.js`. Delete the inline
  copies.
- [ ] **3. Shared driving.** Extract `drive-core.js` from the two drive pages. Per-page differences (top speed by
  surface, collisions, lap logic) become parameters or callbacks. Keep each page's current feel. Test the physics step.
- [ ] **4. Split `drive-map.js`.** Move the cache and download into `map-data.js`, the pure helpers into `geom.js`
  (with tests), and the world build into `world.js`. `drive-map.js` keeps the picker, loading screen, time of day and
  game loop.
- [ ] **5. Cleanup.** Drop `notifyExport()` from `three-d-stage.js`; drop anything the steps above left unused.
