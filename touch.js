// On-screen driving controls for touch screens, used by both drive pages. Each button presses a key: it sends the
// keydown / keyup a keyboard would, so the pages' own key handling drives the car and they need no touch code.
// Only steering, gas and brake/reverse stay on screen; the rest sits in a panel behind the ••• toggle.
// Shown on phones and tablets and after any touch; a real key press hides them again. While shown, <html> has the
// class touch-ui, so a page can move its own HUD out of the way. Creates its own elements and CSS.
const CSS = `
.tc{position:fixed;inset:0;pointer-events:none;z-index:10;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;font:600 14px "Helvetica Neue",Helvetica,Arial,sans-serif}
.tc>div{position:absolute;display:flex;gap:12px}
.tc button{pointer-events:auto;touch-action:none;-webkit-tap-highlight-color:transparent;margin:0;padding:0;display:flex;flex-direction:column;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,.5);background:rgba(0,0,0,.32);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);color:#fff;font:inherit;white-space:nowrap;cursor:pointer}
.tc .on{background:rgba(200,16,46,.8);border-color:#fff}
.tc-l{left:16px;bottom:100px}
.tc-r{right:16px;bottom:34px;align-items:flex-end}
.tc-p{display:flex;flex-direction:column;align-items:center;gap:12px}
.tc-b{width:72px;height:72px;border-radius:36px}
.tc-b small{font-size:10px;font-weight:500;opacity:.8}
.tc-gas{height:124px}
.tc .tc-more{width:40px;height:40px;border-radius:20px}
.tc-x{left:16px;right:16px;bottom:170px;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.tc-x[hidden]{display:none}
.tc .tc-s{padding:8px 10px;border-radius:16px;font-size:12px}`;
const icon = body => `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

// Steering, gas and brake/reverse are always there. In the panel: handbrake (held) and extras, [label, code] buttons
// for the page's other keys (lights, camera, radio…), pressed with one tap.
export function touchControls(extras = []) {
  const root = document.body.appendChild(document.createElement('div')), ups = [];
  root.className = 'tc'; root.appendChild(document.createElement('style')).textContent = CSS;
  const key = (type, code) => dispatchEvent(new KeyboardEvent(type, { code }));
  const el = (parent, cls, html = '', tag = 'button') => { const e = parent.appendChild(document.createElement(tag)); e.className = cls; e.innerHTML = html; return e; };
  const hold = (parent, cls, html, code) => { // held for as long as the finger that pressed it is down, even if it slides off
    const b = el(parent, cls, html); let id = null;
    const up = e => { if (id === null || (e && e.pointerId !== id)) return; id = null; b.classList.remove('on'); key('keyup', code); };
    b.onpointerdown = e => { e.preventDefault(); if (id !== null) return; id = e.pointerId; b.setPointerCapture(id); b.classList.add('on'); key('keydown', code); };
    b.onpointerup = b.onpointercancel = b.onlostpointercapture = up; ups.push(up); return b;
  };
  const tap = (parent, cls, html, fn) => {
    const b = el(parent, cls, html);
    b.onpointerdown = e => e.preventDefault(); // keeps focus off the button, so a real Space or Enter can't press it again
    b.onclick = fn; return b;
  };
  const L = el(root, 'tc-l', '', 'div'), R = el(root, 'tc-r', '', 'div'), P = el(R, 'tc-p', '', 'div'), X = el(root, 'tc-x', '', 'div');
  hold(L, 'tc-b', icon('<path d="M15 5l-7 7 7 7"/>'), 'ArrowLeft').ariaLabel = 'Steer left';
  hold(L, 'tc-b', icon('<path d="M9 5l7 7-7 7"/>'), 'ArrowRight').ariaLabel = 'Steer right';
  const more = tap(P, 'tc-more', icon('<path d="M5 12h.01M12 12h.01M19 12h.01"/>'), () => { X.hidden = !X.hidden; more.classList.toggle('on', !X.hidden); });
  more.ariaLabel = 'More controls';
  hold(P, 'tc-b', 'Brake<small>Reverse</small>', 'ArrowDown'); hold(R, 'tc-b tc-gas', 'Gas', 'ArrowUp');
  X.hidden = true; hold(X, 'tc-s', 'Handbrake', 'Space');
  for (const [label, code] of extras) {
    const b = tap(X, 'tc-s', label, () => { key('keydown', code); key('keyup', code); b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 150); });
  }
  const release = () => ups.forEach(u => u());
  const show = on => { root.style.display = on ? '' : 'none'; document.documentElement.classList.toggle('touch-ui', on); if (!on) release(); };
  show(matchMedia('(pointer: coarse)').matches);
  addEventListener('pointerdown', e => { if (e.pointerType === 'touch') show(true); }, true);
  addEventListener('keydown', e => { if (e.isTrusted) show(false); });
  addEventListener('blur', release);
}
