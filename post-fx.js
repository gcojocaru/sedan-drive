// Post-processing for both drive pages: the scene is drawn into a linear HDR target, everything brighter than white
// glows (lamps, headlights, brake lights, lit windows, the stop's beam), then it is tone-mapped (the renderer's own
// toneMapping and exposure, through OutputPass) and colour-graded: saturation, warm highlights and cool shadows, a soft
// vignette, then FXAA. q: the quality tier (quality.js); q.post turns it on.
// postFx(renderer, scene, camera, q) → { render(), setSize(), look({ night, low, cover }), target }, or null when the tier has no
// post-processing or the GPU can't render to half-float targets (the page then renders directly, as before).
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';

const GRADE = {
  uniforms: { tDiffuse: { value: null }, sat: { value: 1.05 }, warm: { value: new THREE.Vector3(1, 1, 1) }, cool: { value: new THREE.Vector3(1, 1, 1) }, vig: { value: 0.22 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float sat, vig; uniform vec3 warm, cool; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, sat) * mix(cool, warm, smoothstep(0.15, 0.85, l)); // split toning
      vec2 d = vUv - 0.5; c.rgb *= 1.0 - vig * dot(d, d) * 2.0;
      gl_FragColor = c;
    }`
};

export function postFx(renderer, scene, camera, q) {
  if (!q.post || !(renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'))) return null;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2()), w = size.x, h = size.y;
  const hdr = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType }); // (no MSAA: 4× on a half-float target cost ~5 ms of GPU on an M4; FXAA instead)
  const ldr = [new THREE.WebGLRenderTarget(w, h), new THREE.WebGLRenderTarget(w, h)];
  const bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.3, 0.5, 1.1), output = new OutputPass(), grade = new ShaderPass(GRADE), fxaa = new FXAAPass();
  fxaa.renderToScreen = true;
  return {
    target: hdr, // (shader warm-up compiles against it: off-screen targets need programs without tone mapping)
    render() {
      renderer.setRenderTarget(hdr); renderer.render(scene, camera); // (render targets stay linear: no tone mapping yet)
      bloom.render(renderer, null, hdr); // glows added onto hdr
      output.render(renderer, ldr[0], hdr); // tone mapping, exposure, sRGB
      grade.render(renderer, ldr[1], ldr[0]);
      fxaa.render(renderer, null, ldr[1]); // antialiasing
      renderer.setRenderTarget(null);
    },
    setSize() {
      const s = renderer.getDrawingBufferSize(new THREE.Vector2());
      for (const t of [hdr, ...ldr]) t.setSize(s.x, s.y);
      bloom.setSize(s.x / 2, s.y / 2); fxaa.setSize(s.x, s.y);
    },
    // the light: night (lamps glow wide), low sun (golden: warmer, a little richer), cover (overcast: flatter, cooler)
    look({ night = false, low = 0, cover = 0 } = {}) {
      // only lights glow: sunlit white walls, road lines and headlit markings stay below the threshold (lamps are 3.5+)
      bloom.threshold = night ? 1.6 : 2.6; bloom.strength = night ? 0.45 : 0.12 + 0.08 * low; bloom.radius = night ? 0.5 : 0.4;
      const u = grade.uniforms;
      u.sat.value = night ? 1.0 : 1.06 + 0.06 * low - 0.06 * cover;
      u.warm.value.set(1 + 0.04 * low, 1 + 0.01 * low, 1 - 0.05 * low);
      u.cool.value.set(night ? 0.92 : 0.98 - 0.02 * low, night ? 0.97 : 1, night ? 1.08 : 1.03 + 0.03 * low);
    }
  };
}
