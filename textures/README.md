# Building textures

Photo colour maps used under the procedural facades and on roofs of the real-map page (`buildings.js`, table `SURFACES`
in `building-fronts.js`). All are from [Poly Haven](https://polyhaven.com) and released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain). Each is the 1k diffuse JPEG, shrunk to
512 × 512 px. The game levels them to a neutral grey at load, so the building or roof colour gives the hue.

| File | Poly Haven asset | Real size |
|---|---|---|
| `plastered_wall_02.jpg` | [plastered_wall_02](https://polyhaven.com/a/plastered_wall_02) | 2.23 m |
| `red_bricks_04.jpg` | [red_bricks_04](https://polyhaven.com/a/red_bricks_04) | 2.5 m |
| `concrete_wall_008.jpg` | [concrete_wall_008](https://polyhaven.com/a/concrete_wall_008) | 2.71 m |
| `corrugated_iron_02.jpg` | [corrugated_iron_02](https://polyhaven.com/a/corrugated_iron_02) | 2.7 m |
| `clay_roof_tiles_02.jpg` | [clay_roof_tiles_02](https://polyhaven.com/a/clay_roof_tiles_02) | 2.5 m |
| `tarred_gravel.jpg` | [tarred_gravel](https://polyhaven.com/a/tarred_gravel) | 2.2 m |

The real-map sky uses a masked cloud layer derived from [Kloofendal 48d Partly Cloudy](https://polyhaven.com/a/kloofendal_48d_partly_cloudy), CC0. The panorama's landscape and sun have been removed so the game's terrain, horizon and solar lighting control the view.

The real-map broadleaf sprays and bark use cropped colour and opacity textures from [Tree Small 02](https://polyhaven.com/a/tree_small_02). The fir sprays use [Fir Tree 01](https://polyhaven.com/a/fir_tree_01). Both sources are CC0. The two distant canopy atlases are rendered from the game's branch geometry using those textures.
