# Architecture

Where the code is today, where it is going, and the rules every PR follows to get there. CLAUDE.md has the detail on
how each part works; this file says how the parts may fit together.

## Decisions

- **No build step.** Plain HTML + native ES modules, libraries vendored under `vendor/<name>-<version>/` and loaded
  through each page's import map with SRI hashes. GitHub Pages serves the repo root as it is. No bundler, no
  TypeScript, no runtime CDN, no npm dependencies.
- **Assets are files in the repo.** Models in `models/`, photo textures in `textures/` (CC0, each credited in
  `textures/README.md`), loaded by the module that uses them. Nothing third-party that isn't freely licensed.
- **Tests run on Node's built-in runner** (`node --test`, Node 22+), with no test dependencies. They cover pure code;
  rendering is checked in the browser.
- **Refactor first, in short PRs.** The steps under [Migration](#migration) land as behaviour-neutral PRs, in order.
  Feature PRs written meanwhile already follow the [rules](#rules-for-every-pr) for the code they add.

## Today (Nov 2026)

| File | Lines | What it is |
|---|---|---|
| `drive-map.js` | 370 | Real-map page: picker, loading screen, time of day and weather choice, car, game loop, HUD |
| `sky.js` | 188 | `createSky()`: the real sun position, sky canvas, sun/moon/sky lights, shadow box, fog and exposure for a time of day and weather; rain, snow and lightning |
| `weather.js` | 48 | `weatherNow()` (Open-Meteo: current weather, snow depth, recent rain and UTC offset, real-map page), WMO code table, `WEATHERS` presets, `groundOf()` (wet, snow, grip), `solarHour()` |
| `world.js` | 421 | Road/area tag tables and `buildWorld()`, which runs one builder per feature (`layRoads`, `roadLookup`, `paintCrossings`, `layRailways`, `buildWalls`, `plantTrees`, `streetLamps`, …) |
| `buildings.js` | 364 | `buildBuildings()`: building tag tables, walls and roofs per footprint (parapets, eaves), building parts, shopfronts, the facade shader and roof textures, `inBuilding` |
| `world-kit.js` | 87 | three.js and tag helpers shared by the two above: `fillPoly`, `makeTex`, `tagColor`, `num`, …, and `weatherLook()`, the wet and snowy surface shader |
| `terrain.js` | — | Decode Mapzen Terrarium tiles and sample a centre-relative height grid |
| `bridge-decks.js`, `bridge-mesh.js` | — | Grade bridge approaches and their banks, place the deck, bearings and railings |
| `water-levels.js` | — | Estimate a shared level for adjoining water polygons |
| `terrain-surface.js` | — | Fit mapped surfaces to the triangles of the terrain grid |
| `car-ground.js` | — | Wheelbase grade and cross-slope for the player and traffic |
| `map-data.js` | 55 | `loadArea()`: IndexedDB cache, proxy, Overpass servers, vector fallback |
| `geom.js` | 204 | Pure geometry: strips, polygons, oriented boxes, roof clipping, coastline → sea |
| `drive-track.js` | 215 | Test-track page (`Drive.html`): track, surface, lap timing, sky |
| `drive-core.js` | 94 | Driving shared by both drive pages: `readKeys`, `rigCar`, physics `step` (with grip and sliding), `syncCar`, `chaseCamera`, `speedHud` |
| `sedan-viewer.js` | 108 | Viewer page (`Sedan.html`): studio lights, contact shadows, light toggles, views |
| `sedan-model.js` | 662 | `buildCar()` and the axle constants `FA`, `RA`: the one procedural car, used by all three pages |
| `vaz-model.js` | 46 | `loadVaz()`: VAZ-2101 from `models/vaz-2101.glb` in `buildCar()`'s shape, the second car on the real-map page |
| `three-d-stage.js` | 412 | Viewer web component (renderer, orbit, GLB/OBJ export) |
| `area-travel.js` | — | Neighboring-area geometry, boundary confirmation and cooldown |
| `driving-audio.js` | — | Shared engine, tyre, crash, horn, traffic and tuning synthesis and per-tab mute |
| `street-furniture.js` | — | Outdoor parking rows, mapped furniture and static collision geometry |
| `furniture-mesh.js` | — | Instanced street furniture and parked cars |
| `sign-layout.js` | — | Street and landmark names and curbside placement |
| `sign-mesh.js` | — | Sign atlas, two-sided boards and instanced posts |
| `road-layout.js` | — | Pure lane, junction and spawn geometry |
| `traffic.js` | — | Traffic on the real map: lane graph, traffic lights, car following, junction claims, spawning around the player |
| `traffic-cars.js` | — | The traffic cars on screen: instanced bodies, paint, brake lights and night glows |
| `app-version.js` | — | Shared release label from the local package manifest |
| `delivery.js` | — | Parcel stops on connected, directed lanes, pickup/drop-off state, the clock, damage, fines and pay |
| `delivery-hud.js` | — | Current job prompt, countdown, receipt and road marker |
| `garage.js` | — | What delivery money buys (upgrades, paint), the wallet, and what the upgrades do to the car |
| `garage-panel.js` | — | The garage dialog: cash, upgrade levels and prices, paint swatches |
| `minimap-labels.js` | — | Nearby street and address labels, footprint anchors and label spacing |
| `traffic-lights.js` | — | Traffic light poles and signal heads on screen, the lamp that's on |
| `pedestrians.js` | — | Pedestrians on the real map: the walk network (sidewalks, crosswalks, corners, footways, crossings), people who walk it, wait to cross and step out of the way |
| `pedestrian-figures.js` | — | The pedestrians on screen: instanced figures, clothes colours, swinging limbs |
| `minimap.js` | — | North-up driving minimap and car marker, drawn on supplied canvases |
| `building-fronts.js` | — | Facade layout (style, storeys, window bays, doors, shop windows) and atlas drawing on a supplied canvas context |
| `vector-fallback.js` | 150 | OpenFreeMap vector tiles → Overpass-shaped elements |
| `radio.js` | 53 | Car radio for both drive pages: `stationsNear()` (radio-browser.info, real-map page), Romanian presets (test track), `radio(show, find, tuningStatic)` player, `radioHud()` station display |
| `quality.js` | — | Graphics tiers, the device's default, pixel budget and dynamic resolution (pure) |
| `post-fx.js` | — | Glow, tone mapping, colour grade and FXAA (Medium, High) |
| `car-probe.js` | — | Live reflections of the street on the car |
| `car-merge.js` | — | The driven car's still parts merged into a few meshes |
| `perf-hud.js` | — | Performance readout for both drive pages (`?perf`, Shift+P) |
| `gamepad.js` | — | Gamepad for both drive pages: analogue steer, gas and brake, buttons that press keys, rumble |
| `toast.js` | — | Short messages (toasts) on both drive pages |
| `result-card.js` | — | The results card after a delivery: receipt, pay, stars, level progress |
| `touch.js` | 57 | On-screen driving buttons for touch screens, both drive pages: `touchControls(extras)` sends the keydown/keyup each button's key would |
| `osm-query.js` | 37 | Overpass query, cache key, start-point grid, servers; shared with the proxy |
| `proxy/worker.js` | 69 | Cloudflare Worker that caches map downloads |

What already works well and stays: the Overpass-shaped `elements` list as the single contract between map sources
and the world builder; `osm-query.js` shared by browser and Worker so the proxy only runs the game's query; I/O passed
in (`fetchVectorArea(lat, lon, fetchFn)`); named meshes; versioned storage keys.

Nothing structural is outstanding: every module is under ~600 lines and every function under ~150. Keep it that way
with the rules below.

## Target

Pages hold markup, CSS, the import map and one `<script type="module" src>`. All logic lives in modules at the repo
root, one copy each. Page URLs don't change.

| Module | Owns | May import |
|---|---|---|
| `drive-map.js` | Real-map page entry: picker, loading screen, time of day, game loop wiring | everything below |
| `drive-track.js` | Test-track page entry: track geometry, lap timing | `drive-core`, `sedan-model`, `radio`, `touch`, `toast`, `gamepad`, `world-kit`, `quality`, `perf-hud`, `car-merge`, `post-fx`, `car-probe`, `app-version` |
| `sedan-viewer.js` | Viewer page entry: studio environment, light toggles, views, export | `three-d-stage`, `sedan-model`, `app-version` |
| `drive-core.js` | Driving shared by both drive pages: keys, physics step, wheel/steering/lamp sync, chase camera, speed/gear HUD. Pages pass in their tuning (`power`, `idle`, `vtop`, `brake`), and `repaint(C, hex)` colours the car's `paint`; the ground under the car (`vmax`, `drag`, `rough`, `grip`, optional `height(x,z)`) and collisions | `car-ground` |
| `app-version.js` | Show the current release on the three game pages | nothing |
| `delivery.js` | Select reachable stops and advance an area-local job, a round of drop-offs; `JOB_LEVELS`, `levelOf`, `levelText`, `CARGO`; `allowedTime`, `afterCrash` (with the padding's cushion), `deliveryPay`, `receiptText`; fines for red lights and knocking into pedestrians (`FINE`, `KNOCK_FINE`) | nothing |
| `result-card.js` | `resultCard(chime)` → `show(receipt, jobs, levelUp)`, `hide`: the results card after a delivery | `delivery` |
| `delivery-hud.js` | Drive the HUD (job, countdown, damage and fines, the stop's ring and beam) and place the active stop in the scene; `paid(receipt)` hands the pay to the page, `level()` says what level to plan jobs at, `cargo` is what's aboard | `delivery`, three |
| `garage-panel.js` | `garagePanel(root, choose)` → `draw(garage, wallet)`: the shop in the garage dialog | `garage` |
| `garage.js` | `UPGRADES`, `PAINTS`, `readGarage`, `readWallet`, `earn`, `price`, `buy`, `carTuning`: what delivery money buys and what it does to the car | nothing |
| `minimap.js` | Cached raster of real-map geometry, car and goal markers, traffic as dots | `minimap-labels`, `delivery` |
| `minimap-labels.js` | Nearby names and address numbers on the supplied canvas | `geom` |
| `traffic-cars.js` | `trafficCars(scene, max, glowTex, height)` → `sync(cars, lit)`: instanced car bodies posed from `traffic.js` cars | `car-ground`, `world-kit`, three |
| `traffic-lights.js` | `trafficLights(scene, signals, glowTex)` → `sync(lit)`: the signal heads in `graph.signals`, showing their `state`, and the pedestrian signals their `walk` | three |
| `pedestrian-figures.js` | `pedestrianFigures(scene, max)` → `sync(people)`: instanced figures posed from `pedestrians.js` people | `world-kit`, three |
| `pedestrians.js` | `walkGraph(roads, paths, junctions, { armBack, roadAt, crossings })` → `{ nodes, edges }`, `createPedestrians(walks, { rand, max, radius, half, seen })` → `people`, `crossing`, `step(dt, player, cars, signals)`, `hit`, `bump`, `clear`, `setLevel`; `PEOPLE`, `SIDEWALK`, `CROSSWALK` | `road-layout`, `geom` |
| `traffic.js` | `laneGraph(roads, junctions, half, signals)` → lanes, nodes, `signals` (light heads) and `armBack(road, i, direction)` (how far each junction's stop lines stand back), `lightAt(signal, t)`, `walkLeft(ctrl, t)`, `ranRed(signals, ax, az, bx, bz)`, `createTraffic(graph, { rand, max, seen })` → `step(dt, player, others)`, `hit`, `clear`, `setLevel`; `LEVELS` | `road-layout`, `geom` |
| `sky.js` | `createSky(renderer, scene, lat, { shadow, drops }, now, height)` → `TIMES`, `sunAt`, `set(h, forceNight, weather, snow)`, `update(dt, cameraPosition)`, `placeShadow(x, z)`: sun, sky, lights, fog, exposure, rain and snow | `world-kit`, `geom`, three |
| `world.js` | `buildWorld(elements, lat0, lon0, scene, say, terrain, { lampLights })` → meshes plus lookups (`roadAt`, `areaAt`, `inBuilding`), lamps (`setLamps`), lit windows (`wallMat`, `frontMat`), mapped traffic signals and crossings (`signalPts`, `crossPts`), wet and snowy surfaces (`setGround(wet, snow)`, `reflectLamps(x, z)`). One builder function per feature, called in order; road/area tag tables | `terrain-surface`, `buildings`, `world-kit`, `geom`, `road-layout`, `sign-layout`, `sign-mesh`, `street-furniture`, `furniture-mesh`, three |
| `street-furniture.js` | Plan parked cars and mapped furnishings and provide the player collision lookup | `geom`, `osm-query` |
| `furniture-mesh.js` | Draw static parking and street furniture | `traffic-cars`, `world-kit`, three |
| `sign-layout.js` | Choose sign positions at named junctions and near mapped landmarks | `geom`, `osm-query` |
| `sign-mesh.js` | Draw street and landmark signs for the current area | `world-kit`, three |
| `road-layout.js` | `prepareRoads(roads, side)` → lanes per road, junction arms and corners, spawn segments; `laneSpawn`, `mappedStops`, `drivingSide`, `nodeKey` | nothing |
| `buildings.js` | `buildBuildings(polys, entranceNodes, roadAt, mkMesh, wear)` → `{ blds, inBuilding, frontMat, wallMat }`; building tag tables, `roofPlanes`, parapets and eaves, shopfronts, the facade material | `world-kit`, `geom`, `building-fronts`, three |
| `world-kit.js` | three.js and tag helpers shared by `world.js`, `buildings.js`, both drive pages, `traffic-cars` and `pedestrian-figures`: `fillPoly`/`eachTri`, `makeTex`, `speckle`, `num`, `tagColor`, `matColor`, `blobTex(inner, a)` (contact-shadow texture), `weatherLook()` → `{ wear, set, lamps, lit, follow }` | `geom`, three |
| `map-data.js` | `loadArea(lat, lon, status)`: IndexedDB cache → proxy → Overpass → vector fallback; returns `{ data, fallback, err }` | `osm-query`, `vector-fallback` |
| `sedan-model.js` | `buildCar()` and the axle constants: the procedural car | three |
| `vaz-model.js` | `loadVaz()`: the VAZ-2101 model file, returned in `buildCar()`'s shape | three (GLTFLoader) |
| `area-travel.js` | Boundary dialog, projected arrival pose and cooldown | `osm-query` |
| `driving-audio.js` | Synthesized engine, tyre (`tyreSound`), crash (`impactSound`, `impact`), horn and tuning sounds on both driving pages, and the traffic around the camera (`trafficVoices`, `traffic(cars, ear)`, `honkAt`) | nothing |
| `radio.js` | `stationsNear(lat, lon, fetch)`, presets, `radio(show, find, tuningStatic)` → `tune(step)`; station playback | nothing |
| `weather.js` | `weatherNow(lat, lon, fetch)` → `{ kind, label, amount, temp, offset, snowDepth?, recent? }`, `weatherOf(code)`, `WEATHERS`, `groundOf(w)` → `{ wet, snow, grip }`, `solarHour(ms, lon)` | nothing |
| `perf-hud.js` | `perfHud(renderer, extra, on)` → `frame(start)` with `lap`, `begin`, `show`, `onToggle`: the performance readout; `percentile` | nothing |
| `post-fx.js` | `postFx(renderer, scene, camera, q)` → `render`, `setSize`, `look`, `target` (or null) | three, three addons |
| `car-probe.js` | `carProbe(renderer, scene, car, size)` → `update()` | three |
| `car-merge.js` | `mergeStatic(car, keep)`: bake the driven car's still parts into one mesh per material | three |
| `quality.js` | `QUALITY`, `autoQuality`, `pickQuality`, `pixelRatio`, `dynamicRes`, `frameVerdict` | nothing |
| `toast.js` | `toasts()` → `show(text, tone, key)`: readable short messages on both drive pages | nothing |
| `gamepad.js` | `gamepad()` → `poll()` (analogue controls for `readKeys`; buttons press keys), `crash(speed)`, `feel(speed, braking, ride)`: rumble; `padControls(gp)` | `driving-audio` |
| `touch.js` | `touchControls(extras)`: on-screen buttons for touch screens that press keys (synthetic keydown/keyup), so pages handle touch and keyboard the same way | nothing |
| `geom.js` | Pure geometry on plain arrays (`ribbon`, `obb`, `clipHalf`, `offsetRing`, `joinRings`, `seaPolys`, `trimLine`, `pointAt`, …). Triangulating polygons needs three.js, so `fillPoly` is in `world-kit.js` | nothing |
| `osm-query.js` | Query, cache key, grid, servers, proxy address | nothing |
| `vector-fallback.js` | Vector tiles → Overpass-shaped elements | `osm-query` |
| `three-d-stage.js` | Viewer component | three |
| `proxy/worker.js` | Caching proxy | `osm-query` |

Dependencies point down the table only. Page entries are the only modules that touch the page's DOM at import time.
`geom.js`, `drive-core.js`, `road-layout.js`, `traffic.js`, `pedestrians.js`, `garage.js`, `quality.js`, `osm-query.js`, `vector-fallback.js` and `weather.js` stay importable in Node: no three, no DOM, no storage, and network
only through a passed-in `fetch`. `radio.js` follows the same rules, except that calling `radio()` creates an `<audio>` and `radioHud()` its on-screen station display. The travel controller reads browser history and the cooldown at runtime. The driving audio factory reads the tab’s mute preference and initializes Web Audio on a driving gesture.

Tests live in `test/*.test.js` and run with `npm test`. Tests build their own fixtures (the vector-fallback test
encodes its own tile) and never touch the network. `test/pages.test.js` checks that the three import maps are identical
and every `integrity` hash matches its file in `vendor/`.

## Rules for every PR

1. **One copy.** Never paste code from one page or module into another. Code two places need goes in a module both
   import. Where they need slightly different behaviour, pass the difference in (an argument, a callback such as
   `surface(x, z)` or `blocked(x, z, h)`); don't fork the code.
2. **Respect the dependency table.** No upward imports, no new DOM or three.js use in the Node-importable modules, no
   network or storage calls outside `app-version.js` (local package metadata), `map-data.js`, `terrain.js` (Terrarium tiles), `vector-fallback.js`, `weather.js` (through a passed-in `fetch`), `radio.js` (station search through a passed-in
   `fetch`, and the stream itself), `vaz-model.js` (its own model file), `buildings.js` (its own photo textures in `textures/`), the proxy and the page entries.
3. **New logic goes in its module, not in a page and not in `startGame()`.** A new world feature is its own function
   in `world.js` that `buildWorld()` calls, not more lines inside `buildWorld()`. No new inline
   `<script type="module">` logic in pages.
4. **Map data enters through the elements contract.** A new map source converts its data into Overpass-shaped
   `elements` (nodes with `lat`/`lon`, ways with `geometry`, relations with `members`). The world builder never
   branches on where data came from; the `fallback` flag only drives the on-screen note.
5. **Query changes ship together.** Changing `overpassQuery` means bumping `CACHE_V` and redeploying the Worker in the
   same release.
6. **Stored data is versioned.** localStorage keys and IndexedDB entries carry a version (`-v1`, `osm3:`); changing
   their shape bumps it. New keys are added to the list in CLAUDE.md.
7. **Names are API.** Mesh, group and material names are looked up by other code. Grep before renaming.
8. **Pure logic gets a test.** A PR that adds or changes logic in a Node-importable module (including
   `drive-core.js`) adds or updates a `node --test` test. `npm test` passes before merge.
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
- [x] **3. Shared driving.** Extract `drive-core.js` from the two drive pages. Per-page differences (top speed by
  surface, collisions, lap logic) become parameters or callbacks. Keep each page's current feel. Test the physics step.
- [x] **4. Split `drive-map.js`.** Move the cache and download into `map-data.js`, the pure helpers into `geom.js`
  (with tests), and the world build into `world.js`. `drive-map.js` keeps the picker, loading screen, time of day and
  game loop.
- [x] **5. Cleanup.** Drop `notifyExport()` from `three-d-stage.js`; drop anything the steps above left unused (the
  never-read `st.a`; `buildCar()` returns `drlMat` instead of setting `window.__drl`).
- [x] **6. Split `buildWorld()` per feature.** One builder function per feature in `world.js`; buildings and their tag
  tables in `buildings.js`; shared three.js/tag helpers in `world-kit.js`.
