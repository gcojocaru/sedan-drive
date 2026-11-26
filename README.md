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

While driving on a real map, the minimap shows 240 metres across with north at the top. Nearby streets and mapped house numbers are labeled as space allows. The amber arrow shows where your car is and which way it faces. During a delivery, the mint marker points toward the stop, including when it is beyond the map edge. A dashed line marks the edge of the playable area. When you reach it, choose **Load next area** to continue in that direction or **Stay here** to turn back. Neighboring map loads have a 30-second cooldown. The car resumes at rest, facing the same way.

## Release version

On the real map, open **Settings** with Esc or the touch menu and look for **Game version**. The test track and model viewer also display the version from `package.json`. Use `npm version patch --no-git-tag-version` for a fix, or replace `patch` with `minor` for a feature or `major` for a breaking change. Commit the manifest with the release. Both the repository-root site and the production build read the same file.

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
| B | Horn (hold it down for a long blast) |
| T · N | Next time of day · night on/off (real-map page: starts at the place's real local time, with the sun where it really is; T goes through the presets and back to live) |
| E | Next weather (real-map page: starts with the real weather there now; then clear, partly cloudy, overcast, fog, rain, snow, thunderstorm, and back to live). Rain leaves the roads wet and shiny and snow lies on the ground and roofs; both cost grip, so the car takes longer to stop and slides wide in fast corners |
| Esc | Settings (real-map page): choose the time of day, the weather, how much traffic (off, light, normal, heavy) and how many people (off, few, normal, busy). Driving pauses while it is open |
| V | Mute or unmute the driving sounds (your engine, the traffic, tuning static). The radio has its own off position. |
| Q · Shift+Q | Radio: next / previous station, last one is off (real-map page: up to 30 stations from around the chosen place; test track: Romanian stations) |
| R | Reset / back on the road |
| J | Start or cancel a parcel delivery (real-map page). You can also use the Start delivery button. |
| G | Garage (real-map page): spend delivery money on upgrades and paint. Driving pauses while it's open |
| M | Choose another place (real-map page) |

On phones and tablets only the driving controls appear on screen: steer on the left, gas and brake/reverse on the right. The ••• button above the brake opens the rest (handbrake, lights, time of day or night, weather, settings, garage, camera, horn, radio, reset).

In a delivery job, follow the mint minimap marker and stop inside the road ring to collect the parcel. The marker then moves to the drop-off, and the clock starts: the time you have depends on the distance, and the status box counts it down. The pay is more the farther the drop-off, up to 40% more for arriving early and less the later you are. Crashes damage the parcel (a knock is fine, a hard crash ruins it) and cut the pay by as much; running a red light costs $10 and knocking into a pedestrian $25. When you deliver, the status box shows the receipt, and your cash and deliveries are kept under it from one drive to the next. Each job stays in the current area.

Spend the money in the garage (G): a stronger engine, better brakes, all-weather tyres that lose less grip in rain and snow, and cargo padding so crashes damage parcels less, each bought a level at a time, plus paint colours for either car (Factory puts its own colours back). Upgrades and paint are kept from one drive to the next; the test track keeps the stock car.

## What gets built from the map (real-map page)

- **Roads** at their tagged width, sidewalks, lane markings (centre line, edge lines, lane dividers from `lanes=*`), zebra crossings, railings on bridges.
- Teal street signs mark junctions where named roads meet. Brown roadside signs identify nearby mapped parks, stations and shops by name.
- Cars start and reset in a travel lane. Connected junctions have rounded corners, gaps in the lane markings and stop lines at mapped stops.
- **Buildings** from footprints and height/level tags, with `roof:shape` roofs (gabled, hipped, pyramidal, skillion, dome, onion). Untagged houses get a pitched roof unless mappers in the area mostly tag flat roofs. `building:part` pieces replace their outline, so landmarks with 3D tagging come out properly. `building:colour`/`material` and `roof:colour`/`material` are used.
- Ground-floor doors follow mapped entrances, with a street-facing doorway inferred when a building has none mapped. Retail frontages have framed display windows and a few softly lit bays at night.
- **Ground**: residential, commercial and industrial land, parking lots, plazas, parks, forests, farmland, beaches, rivers, lakes, and the **sea**, which is built from coastlines.
- **Railways** (ballast, sleepers, rails), **tram tracks**, **walls, fences and hedges**, piers and breakwaters, trees (mapped trees, tree rows, parks and forests, scattered garden trees).
- Outdoor parking lots contain parked cars with gaps for driving aisles. Benches, bollards and bus-stop poles appear at mapped locations.
- Parking lots and plazas count as hard ground, so the car keeps its road speed there.
- **Weather on the ground**: in rain the roads, sidewalks and roofs turn dark and glossy, with puddles, and at night the street lamps glint in the wet asphalt. Snow whitens the ground, roofs, wall tops and tree crowns, and leaves grey slush on the roads. Live weather goes by the real snow depth and the last few hours of rain, so snow stays after it stops falling and roads stay wet after a shower (the clock line then says e.g. "20 cm on the ground" or "wet roads"). Wet roads cost about a third of the grip and full snow over half: braking from 50 km/h takes about 8 m wet and 12 m on snow instead of 5, the car pulls away slower on snow, and corners taken too fast make it slide wide until its path lines up with where it points again.
- **Traffic**: other cars drive the streets around you in their lanes, on the side of the road the place drives on, at each road's speed limit (`maxspeed`, or a typical speed for the road type), slowing for bends. They keep their distance, stop for you if you're in their way, and take junctions in turn without blocking them. One-way streets are respected, and service roads and private roads stay empty. Their lights come on at dusk and their brake lights as they slow. Bumping into one is like hitting a wall. New cars appear out of sight 150 to 260 m away; set the amount in the settings (Esc). They show on the minimap as dots. You hear the nearest ones: engines that rise in pitch as they come and drop as they pass, tyres hissing louder on wet roads, a horn if you sit in their way (and a long one if you hit them), and a screech when one has to stop hard. Your own car squeals braking hard, on the handbrake, cornering at the limit and sliding (not on grass or snow, less on wet roads), rumbles off the road and swishes through the wet; hitting a wall thuds, a post clangs, and a car crunches, with breaking glass in a hard hit.
- **Pedestrians** walk the sidewalks (most town streets have them, unless OpenStreetMap says a street has none or maps them as separate footways), mapped footways, paths and pedestrian streets, keeping to one side so people pass each other. They cross only at crossings: at every junction arm, just in front of the traffic's stop line, and at mapped zebra crossings. At traffic lights they cross while the cars crossing their way have red; elsewhere they wait for a gap, and traffic stops for anyone on a crossing. They step out of the way of your car (and round it where it's parked across their way); drive into someone anyway and they stumble back with a thud, and the car pulls up. Set how many in the settings (Esc).
- **Traffic lights** where OpenStreetMap has them (`highway=traffic_signals`), on every road into the junction; the simplified map has none, so there they stand where main roads cross. Traffic stops at red and goes in turns, one direction at a time. Nobody stops you running a red.

## External services (real-map page)

- Map tiles: OpenStreetMap, Esri World Imagery (satellite toggle)
- Geocoding: Nominatim. Searches run on submit and are cached in the browser, at most one request a second; a clicked spot is named once, when you press Drive.
- Map data: The game requests Overpass servers directly, one at a time. The optional shared cache is disabled (`AREA_PROXY` is empty). A server that answers HTTP 429 is left alone for 30 s. Each browser also keeps the places it loaded in IndexedDB (`sedan-map-cache`).
- Weather: [Open-Meteo](https://open-meteo.com), free and keyless. Asked for the current weather, snow depth, the last 3 hours of precipitation and the local time zone once while the place loads, and again every 15 minutes while live weather is on.
- Radio: [radio-browser.info](https://www.radio-browser.info), the free community station directory. Asked once, on the first press of Q, for stations near the chosen place; the streams then play straight from each broadcaster.
- Fallback map data: when every Overpass server (or the proxy) refuses, the place is built from [OpenFreeMap](https://openfreemap.org)'s vector tiles, which have no request limits. That map is simpler (no roof shapes, walls, crossings or single trees), says so on screen, and isn't saved, so the next visit tries for full detail.

These are free community services with usage policies that count all of a site's players together. Deploy the proxy before sharing the site widely: see [proxy/README.md](proxy/README.md).

## Files

Contributing: [ARCHITECTURE.md](ARCHITECTURE.md) has the target module layout and the rules every PR follows.

```
Drive Real Map.html   real-map page (markup + styles; logic in drive-map.js)
drive-map.js          real-map page: map picker, loading screen, time of day and weather choice, car, game loop, HUD
sky.js                real-map sky: the sun where it really is, sky canvas, lights, shadows, fog, clouds, rain and snow
weather.js            the weather and local time right now at a place (Open-Meteo), the weather presets, and what they leave on the ground
map-data.js           map data: browser cache, proxy, Overpass servers, vector-tile fallback
world.js              buildWorld(): the 3D place from OpenStreetMap elements, one builder per feature, plus road/area lookups
buildings.js          buildBuildings(): walls and roofs per footprint, building parts, shopfronts, lit windows
world-kit.js          three.js and tag helpers shared by world.js and buildings.js, and the wet and snowy surface shader
geom.js               pure geometry helpers (strips, polygons, roofs, coastline → sea)
drive-core.js         driving shared by both drive pages: physics (with grip and sliding), car posing, chase camera, speed HUD
building-fronts.js    ground-floor entrance placement and retail window layouts
street-furniture.js   outdoor parking rows, furniture placement and collision footprints
furniture-mesh.js     instanced benches, bollards and bus-stop poles
sign-layout.js        curbside placement of named street and landmark signs
sign-mesh.js          sign lettering, two-sided boards and posts
road-layout.js        directional lanes, junction corners, stop lines and spawn positions
area-travel.js        adjacent map areas, boundary prompts and load cooldown
driving-audio.js      synthesized engine, tyre, crash, horn, traffic and radio tuning sounds for both drive pages
minimap.js            north-up driving minimap drawn from the loaded world geometry
traffic.js            traffic: lanes and junctions from the road layout, cars that follow them and take turns at junctions
traffic-cars.js       the traffic cars on screen (one instanced car body, paint, brake lights, night glows)
traffic-lights.js     traffic light poles and signal heads on screen
pedestrians.js        pedestrians: sidewalks, crossings and footways as a walk network, people who walk it and cross with care
pedestrian-figures.js the pedestrians on screen (simple instanced figures with swinging arms and legs)
garage.js             what delivery money buys (upgrades, paint) and what it does to the car
garage-panel.js       the garage dialog
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
