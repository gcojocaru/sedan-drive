# Changelog

What changed in each release of the game. Every pull request bumps the version in `package.json` (minor for features,
patch for fixes) and adds its entry at the top. Versions before 0.4.0 are in the git history.

## 0.10.0 — 2026-11-28

- **Windows with depth:** on Medium and High graphics, windows sit back in the walls, so from an angle you see the
  sides of each opening, and behind the glass there's a room: walls, floor, ceiling, furniture, sometimes a blind half
  down. By day the rooms are dim behind the reflections; at night the lit ones glow in their own colours instead of
  as flat yellow panels.
- **Cornices:** older flat-roofed buildings get a stone cornice under the roof line, like the mansard blocks.

## 0.9.0 — 2026-11-28

- **Cities that look like themselves:** buildings now take the look of the country you drive in. Paris is cream stone
  with grey zinc mansard roofs and dormer windows, London is brick under slate, Rome, Barcelona and Lisbon are ochre
  plaster under terracotta, and New York and San Francisco get brick, glass and painted houses. Everywhere else,
  Bucharest included, keeps the mix of styles it had.
- **Mansard roofs:** a mansard (tagged on the map, or the usual roof of a Paris apartment block) is a stone cornice,
  then a steep zinc slope with a dormer over each column of windows, lit at night like the windows below.
- **Party walls:** where two buildings share a wall, that wall has no windows, so a taller building's exposed side
  is blank, as it is in a real terrace.

## 0.8.0 — 2026-11-27

- **Faster first drive:** the map servers are now asked two at a time, and if they're slow you start driving on the
  simplified map after about 15 seconds instead of waiting up to three minutes. The full map keeps downloading in the
  background; when it's ready, a **Full map ready** button (or U) switches to it right where you are.
- **Pick a place in one click:** featured cities (Bucharest, Paris, London, New York, Tokyo, Rome, San Francisco,
  Barcelona), **Surprise me**, and your recent places.
- **Hints instead of a key list:** the start card shows just four controls; the game suggests the rest when you need
  them (headlights when it gets dark, R when you're stuck, deliveries when you're idle, the garage when you can afford
  something, and more), each once.
- **Cleaner screen:** the line of keys at the top and the model viewer link are gone; the map stats and the viewer link
  are in Settings, and your cash is easier to read.

## 0.7.1 — 2026-11-27

- **Less glare:** only real lights glow now. Sunlit walls, white road lines and markings caught in your headlights no
  longer bloom into a haze, the glow is softer at night, and the car's lamp glows are dimmer. The paint and windows
  reflect lamps and the sun as soft highlights instead of blinding points, and the street lamps near you are a little
  softer.

## 0.7.0 — 2026-11-27

- **Handling:** the tyres now have a real grip limit. Held keys corner just inside it, so you won't slide by accident
  on dry roads, but the handbrake throws the car into a slide, holding the throttle keeps a drift going, and letting
  go of the steering catches it. Too fast on wet or snowy roads and the car slides wide.
- **Crashes:** brushing a wall or a car at an angle glances off and scrapes along it instead of stopping dead and
  bouncing back; only head-on hits stop the car. A scrape counts once, not every frame, so it does less parcel damage.
- **Tyres you can see:** tyre smoke and black skid marks when the tyres squeal, spray on wet roads, dirt or snow
  thrown up off the road, and sparks from crashes and scrapes.
- **A car with weight:** the body dips under braking, squats when accelerating, leans in corners and rocks back as it
  settles.
- **Arrival:** before you start, the camera circles the car so you see the place; the start card sits in the corner.
- **Test track:** best laps start fresh, because the new handling changes lap times.

## 0.6.0 — 2026-11-27

- **Glow and colour:** street lamps, headlights, brake lights, lit windows and the delivery beam now glow, and the picture
  gets a gentle colour grade (warmer highlights, cooler shadows, a soft vignette) on Medium and High.
- **Reflections:** your car reflects the street, buildings and trees around it, not just the sky.
- **Night:** the street lamps near you really light your car and the road, so the car is no longer a black silhouette.
- **Trees:** crowns are built from clumps with shaded undersides instead of single lumpy spheres.
- **Fixes:** the test track now uses the same shadow type as the real map; dynamic resolution no longer drops the
  sharpness while the game window isn't in focus.

## 0.5.0 — 2026-11-27

- **Graphics quality:** Settings → Graphics: Auto, Low, Medium or High. Auto picks for your device; each level sets the
  sharpness, antialiasing, shadow detail and how many cars, people and raindrops there are. The resolution drops a
  little when frames get slow and comes back when they're smooth again.
- **Smoother driving:** the city is drawn in tiles, so what's out of sight is skipped (a fifth fewer triangles in a
  city centre), and your car is drawn in a few dozen draw calls instead of hundreds (half the draw calls overall).
  Nothing past the fog is drawn.
- **No more freeze on headlights:** switching headlights or night on no longer stalls the game the first time.
- **Faster VAZ:** the VAZ-2101 downloads 7.8 MB instead of 17.7 MB and uses a quarter of the graphics memory.
- **Settings:** a Controls list (keyboard, gamepad, touch) and a Performance stats switch (also Shift+P) that shows
  frame rate, frame times and draw calls.

## 0.4.0 — 2026-11-27

- **Hills:** the real map follows the real terrain. Roads, ground, buildings and trees sit on the hills, and the car slows
  going up and picks up speed going down. Bridges over water are raised on decks with ramps, girders and railings. If
  the elevation can't load, the area opens flat and the status line says so.
- **Camera:** the chase camera stays close behind the car at any speed, swings out to show a slide, and moves in front
  of poles, signs and tree trunks instead of sitting behind them.
- **Start:** the car starts on a lane with a long straight road ahead; R no longer faces you into a junction.
- **Light:** warmer low sun with cooler shade, so long shadows show; soft shadows on overcast days. Traffic, parked cars
  and pedestrians have soft shadows under them, and traffic never wears your car's paint.
- **Messages:** readable pop-ups with coloured edges, and every new delivery job is announced.
- **Deliveries:** a results card after each delivery: the pay line by line, counting up, 1–3 stars, progress to the next
  level and a level-up banner, with chimes. A beam of light marks the stop (amber for pickup, teal for drop-off).
- **Gamepad:** analogue steering, throttle and brake, buttons for horn, camera, reset, radio, delivery and lights, and
  rumble on crashes, slides and rough ground.
