// Live reflections for the driven car: a small cube camera at the car renders the street around it, one face a frame
// (the whole cube every 6 frames, 10 times a second), and the car's shiny materials reflect that instead of only the
// sky. The car itself, and anything in `hide` (rain, snow), are left out of the cube. size: cube face size (quality.js
// probe; 0: no probe). Faces render into a half-float target without the shadow map being redrawn.
// carProbe(renderer, scene, car, size, hide) → update(), or a no-op when size is 0.
import * as THREE from 'three';

export function carProbe(renderer, scene, car, size, hide = []) {
  if (!size) return () => {};
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cube = new THREE.CubeCamera(0.3, 400, rt); scene.add(cube);
  cube.coordinateSystem = renderer.coordinateSystem; cube.updateCoordinateSystem(); // (CubeCamera.update would do this; we render a face at a time)
  // the materials that reflect: metal, clearcoat or smooth surfaces (the paint, chrome, glass, alloys)
  const mats = new Set(); car.traverse(o => { if (o.isMesh && o.material?.isMeshStandardMaterial && (o.material.metalness > 0.3 || o.material.clearcoat > 0 || o.material.roughness < 0.25)) mats.add(o.material); });
  for (const m of mats) { m.envMap = rt.texture; m.needsUpdate = true; }
  const cams = cube.children; let face = 0, wait = 2;
  return function update() {
    if (wait > 0) { wait--; return; } // (first let the page draw a normal frame or two: the sun's shadow map must exist before a face renders without it)
    cube.position.set(car.position.x, car.position.y + 1.1, car.position.z); cube.updateMatrixWorld(true);
    const auto = renderer.shadowMap.autoUpdate, was = renderer.getRenderTarget(), shown = [car, ...hide].map(o => o.visible);
    renderer.shadowMap.autoUpdate = false; car.visible = false; for (const o of hide) o.visible = false;
    renderer.setRenderTarget(rt, face); renderer.render(scene, cams[face]);
    renderer.setRenderTarget(was); renderer.shadowMap.autoUpdate = auto; [car, ...hide].forEach((o, i) => { o.visible = shown[i]; });
    if (++face === 6) { face = 0; rt.texture.needsPMREMUpdate = true; }
  };
}
