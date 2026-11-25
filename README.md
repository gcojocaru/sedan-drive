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
| T · N | Next time of day · night on/off (real-map page: the sun is placed where it really is over that place today) |
| Q · Shift+Q | Radio: next / previous station, last one is off (real-map page: up to 30 stations from around the chosen place; test track: Romanian stations) |
| R | Reset / back on the road |
| M | Choose another place (real-map page) |

## What gets built from the map (real-map page)

- **Roads** at their tagged width, sidewalks, lane markings (centre line, edge lines, lane dividers from `lanes=*`), zebra crossings, railings on bridges.
- **Buildings** from footprints and height/level tags, with `roof:shape` roofs (gabled, hipped, pyramidal, skillion, dome, onion). Untagged houses get a pitched roof unless mappers in the area mostly tag flat roofs. `building:part` pieces replace their outline, so landmarks with 3D tagging come out properly. `building:colour`/`material` and `roof:colour`/`material` are used.
- **Ground**: residential, commercial and industrial land, parking lots, plazas, parks, forests, farmland, beaches, rivers, lakes, and the **sea**, which is built from coastlines.
- **Railways** (ballast, sleepers, rails), **tram tracks**, **walls, fences and hedges**, piers and breakwaters, trees (mapped trees, tree rows, parks and forests, scattered garden trees).
- Parking lots and plazas count as hard ground, so the car keeps its road speed there.

## External services (real-map page)

- Map tiles: OpenStreetMap, Esri World Imagery (satellite toggle)
- Geocoding: Nominatim. Searches run on submit and are cached in the browser, at most one request a second; a clicked spot is named once, when you press Drive.
- Map data: Overpass API, through the caching proxy in `proxy/` when it is deployed (one download per place for all players), else straight from the Overpass servers one at a time. A server that answers HTTP 429 is left alone for 30 s. Each browser also keeps the places it loaded in IndexedDB (`sedan-map-cache`).
- Radio: [radio-browser.info](https://www.radio-browser.info), the free community station directory. Asked once, on the first press of Q, for stations near the chosen place; the streams then play straight from each broadcaster.
- Fallback map data: when every Overpass server (or the proxy) refuses, the place is built from [OpenFreeMap](https://openfreemap.org)'s vector tiles, which have no request limits. That map is simpler (no roof shapes, walls, crossings or single trees), says so on screen, and isn't saved, so the next visit tries for full detail.

These are free community services with usage policies that count all of a site's players together. Deploy the proxy before sharing the site widely: see [proxy/README.md](proxy/README.md).

## Files

Contributing: [ARCHITECTURE.md](ARCHITECTURE.md) has the target module layout and the rules every PR follows.

```
Drive Real Map.html   real-map page (markup + styles; logic in drive-map.js)
drive-map.js          map picker, map data download/cache, world mesh building, driving game
osm-query.js          the Overpass query, cache key, start-point grid and proxy address (shared with proxy/)
vector-fallback.js    OpenFreeMap vector tiles → the same element list as an Overpass reply (fallback map data)
radio.js              car radio: stations near the chosen place from radio-browser.info, Romanian presets on the test track
proxy/                Cloudflare Worker that caches map downloads for all players (see proxy/README.md)
vendor/               three.js 0.184.0 and Leaflet 1.9.4, served by the site
sedan-model.js        buildCar() as an ES module (used by drive-map.js)
Drive.html            test-track page (self-contained, own inline copy of the car)
Sedan.html            model viewer (self-contained, own inline copy of the car + interior)
three-d-stage.js      <three-d-stage> web component: renderer, studio lights, orbit, GLB/OBJ export
```

The model was matched against third-party reference photos (Logan front 3/4, front, interior, wheel, underbody). They aren't in the repo for copyright reasons; keep local copies in `reference/`, which git ignores.

Originally made in Claude Design; moved here to keep developing it as code.
