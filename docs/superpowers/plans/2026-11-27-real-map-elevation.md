# Real map elevation implementation plan

Implement the approved real-map-elevation design with native ES modules and Three.js.

- Load and decode Mapzen Terrarium tiles in terrain.js. Sample a shared 32 m grid, interpolating on its triangles. Exercise flat, hill, boundary and failed requests.
- In world.js conform ground and road layers to those triangles and anchor scenery and buildings.
- In drive-core.js use the grade for acceleration, car orientation and camera placement. Give moving actors and delivery markers the same elevation sampler.
- Wire the loader and credits into Drive Real Map, run the Node suite, and exercise the game in a browser.
