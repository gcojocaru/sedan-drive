// Short messages on both drive pages: dark pills at the top centre with a coloured edge, a few at a time, newest last.
// toasts() → show(text, tone, key): tone 'good', 'bad', 'money', 'gold' (larger and longer) or none; a toast with the same
// key replaces the one showing (repeated T or E presses). With the touch controls on (html.touch-ui) they sit between the
// buttons (landscape) or below the top HUD (portrait), under the buttons. Creates its own elements and CSS.
const CSS = `
.toasts{position:fixed;left:50%;top:14%;transform:translateX(-50%);z-index:9;display:flex;flex-direction:column;align-items:center;gap:8px;width:max-content;max-width:min(640px,calc(100vw - 32px));pointer-events:none;font:600 18px/1.3 "Helvetica Neue",Helvetica,Arial,sans-serif;color:#fff}
.toast{background:#13262bf0;border-left:4px solid var(--c,#9fb0ad);border-radius:8px;padding:8px 16px;box-shadow:0 2px 10px rgba(0,0,0,.4);text-shadow:0 1px 2px #000;text-align:center;transition:opacity .25s,transform .25s}
.toast.out{opacity:0;transform:translateY(-8px)}
.toast.good{--c:#68e6d3} .toast.bad{--c:#ff8a6b} .toast.money{--c:#ffbd66} .toast.gold{--c:#ffbd66;color:#ffe2ad;font-size:24px}
@media (prefers-reduced-motion:reduce){.toast.out{transform:none}}
.touch-ui .toasts{top:auto;bottom:84px;max-width:calc(100vw - 400px);font-size:15px}
@media (orientation:portrait){.touch-ui .toasts{top:42%;bottom:auto;max-width:calc(100vw - 28px)}}`;

export function toasts(max = 3) {
  let root;
  const hide = t => { t.classList.add('out'); t.timer = setTimeout(() => t.remove(), 300); };
  return function show(text, tone = '', key = '') {
    if (!root) {
      document.head.appendChild(document.createElement('style')).textContent = CSS;
      root = document.body.appendChild(document.createElement('div')); root.className = 'toasts';
      root.setAttribute('role', 'status'); root.setAttribute('aria-live', 'polite');
    }
    let t = key && [...root.children].find(e => e.dataset.key === key);
    const fresh = !t;
    if (fresh) { t = root.appendChild(document.createElement('div')); t.dataset.key = key; }
    clearTimeout(t.timer); t.className = 'toast out ' + tone; t.textContent = text;
    if (fresh) void t.offsetWidth; // (lay it out hidden first, so it slides in)
    t.classList.remove('out');
    t.timer = setTimeout(() => hide(t), tone === 'gold' ? 3500 : 2400);
    while (root.children.length > max) root.firstElementChild.remove();
  };
}
