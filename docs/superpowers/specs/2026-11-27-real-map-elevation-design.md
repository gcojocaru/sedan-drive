# Real elevation for the driving map

Use Mapzen Terrain Tiles to reproduce the hills around the selected location at their real vertical scale. Decode the Terrarium tiles covering the playable square and a margin. Request them alongside street data, reuse tiles across neighboring areas, and bound the wait. If coverage or loading fails, allow the drive to start on flat ground and indicate that elevation is unavailable. Credit Mapzen and its source datasets.

Mapzen supplies a continuous elevation surface across area boundaries. The other option considered was Open-Meteo’s elevation API. Its 90-metre grid is simpler to query but can smooth out short climbs. Actual Mapzen detail also varies by location.

Sample elevation in geographic coordinates and subtract the area centre height for rendering. Use the same surface for ground, roads, intersections, markings, and moving objects. Subdivide large ground triangles and long road segments so crests stay aligned. Keep buildings upright on foundations and place signs and trees at their ground height. Preserve level lake surfaces. A terrain model represents ground height and cannot establish the surveyed height of bridge decks or tunnels.

The sedan should pitch with the road, lose speed climbing and gain speed coasting downhill. Both cameras, resets, traffic and delivery markers should follow the road surface. Verify a hilly drive and a flat drive, neighboring area continuity, and a failed elevation download.
