// A small performance readout for both drive pages, shown with ?perf in the URL or Shift+P: frames per second, the
// median and 95th-percentile frame time, the page's own work per frame (cpu ms, from the top of the loop to after
// render) and what the renderer drew (renderer.info: draw calls, triangles, shader programs, geometries, textures).
// perfHud(renderer, extra) → frame(start): call it at the end of each frame with the loop's start time. extra() may add
// a line (e.g. the quality tier and pixel ratio). Makes its own element.
export const percentile = (xs, p) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

export function perfHud(renderer, extra = () => '') {
  let el = null, on = /[?&]perf\b/.test(location.search), last = 0, shown = 0;
  const gaps = [], cpu = [];
  addEventListener('keydown', e => { if (e.code === 'KeyP' && e.shiftKey && !e.repeat) on = !on; });
  return function frame(start) {
    const now = performance.now();
    if (last) { gaps.push(now - last); cpu.push(now - start); if (gaps.length > 240) { gaps.shift(); cpu.shift(); } }
    last = now;
    if (!on) { if (el) el.hidden = true; return; }
    if (now - shown < 500) return; shown = now;
    if (!el) { el = document.body.appendChild(document.createElement('pre')); el.style.cssText = 'position:fixed;left:8px;top:52px;z-index:20;margin:0;padding:6px 9px;border-radius:6px;background:#000b;color:#cfe;font:11px/1.45 ui-monospace,monospace;pointer-events:none;white-space:pre'; }
    const { render: r, memory: m, programs } = renderer.info, p50 = percentile(gaps, 0.5);
    el.hidden = false;
    el.textContent = (1000 / (p50 || 1)).toFixed(0) + ' fps · frame p50 ' + p50.toFixed(1) + ' p95 ' + percentile(gaps, 0.95).toFixed(1) + ' ms · cpu ' + percentile(cpu, 0.5).toFixed(1) + ' ms\n' +
      r.calls + ' calls · ' + (r.triangles / 1000).toFixed(0) + 'k tris · ' + (programs?.length ?? 0) + ' programs · ' + m.geometries + ' geometries · ' + m.textures + ' textures' + (extra() ? '\n' + extra() : '');
  };
}
