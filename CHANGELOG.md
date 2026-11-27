# Changelog

What changed in each release of the game. Every pull request bumps the version in `package.json` (minor for features,
patch for fixes) and adds its entry at the top. Versions before 0.4.0 are in the git history.

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
