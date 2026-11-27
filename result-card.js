import { receiptText, stars, money, JOB_LEVELS, levelOf } from './delivery.js';

// The results card after a delivery (real-map page): the receipt line by line, the pay counting up, the stars
// (delivery.js stars()), progress to the next level, and a gold banner on a level-up. It hides after 5.5 s (not on a key:
// the player drives straight off, and the card never takes focus, so driving goes on under it). While it's up, html
// has the class result-up and the toasts (toast.js) move below it. With the touch controls on it shows only
// the pay and the stars. chime(kind, i): driving-audio.js sounds. Creates its own elements and CSS.
const CSS = `
.rc{position:fixed;left:50%;top:12%;transform:translateX(-50%);z-index:9;min-width:250px;max-width:calc(100vw - 32px);box-sizing:border-box;padding:14px 22px 16px;border-radius:12px;background:#13262bf0;border-top:4px solid #68e6d3;color:#eff3ef;box-shadow:0 4px 18px rgba(0,0,0,.5);pointer-events:none;text-align:center;font:500 15px/1.4 "Helvetica Neue",Helvetica,Arial,sans-serif;font-variant-numeric:tabular-nums}
.rc[hidden]{display:none}
.rc h2{margin:0 0 6px;font-size:16px;font-weight:600}
.rc-lines div{opacity:0;transition:opacity .2s} .rc-lines div.on{opacity:1} .rc-lines .neg{color:#ffc1ad}
.rc-total{font-size:40px;font-weight:700;color:#ffbd66;line-height:1.15;margin-top:4px}
.rc-stars{font-size:28px;letter-spacing:6px;color:#3b5055} .rc-stars i{font-style:normal;display:inline-block}
.rc-stars i.on{color:#ffbd66;animation:rc-pop .3s ease-out}
@keyframes rc-pop{from{transform:scale(1.8)}}
.rc-bar{height:6px;border-radius:3px;background:#2b4146;margin-top:10px;overflow:hidden} .rc-bar i{display:block;height:100%;background:#68e6d3}
.rc small{display:block;margin-top:5px;color:#a6efdf;font-size:12.5px}
.rc-up{margin-top:10px;padding:6px 10px;border-radius:6px;background:#ffbd66;color:#211c14;font-weight:650}
.rc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.result-up:not(.touch-ui) .toasts{top:62%}
@media (orientation:portrait){.result-up.touch-ui .toasts{top:60%}}
@media (prefers-reduced-motion:reduce){.rc-stars i.on{animation:none}}
.touch-ui .rc{min-width:0;padding:8px 16px 10px} .touch-ui .rc h2,.touch-ui .rc-lines,.touch-ui .rc-bar,.touch-ui .rc small{display:none}
.touch-ui .rc-total{font-size:28px;margin:0}
@media (orientation:portrait){.touch-ui .rc{top:42%}}`;

export function resultCard(chime = () => {}) {
  let el, timers = [], raf = 0;
  const later = (ms, fn) => timers.push(setTimeout(fn, ms)), html = document.documentElement;
  function hide() {
    timers.forEach(clearTimeout); timers = []; cancelAnimationFrame(raf);
    if (el) el.hidden = true; html.classList.remove('result-up');
  }
  // r: the receipt (createDelivery), jobs: deliveries made, this one counted; levelUp: the level-up note, if any
  function show(r, jobs, levelUp = '') {
    if (!el) {
      document.head.appendChild(document.createElement('style')).textContent = CSS;
      el = document.body.appendChild(document.createElement('div')); el.className = 'rc'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    }
    hide();
    const { head, lines } = receiptText(r), n = stars(r), L = levelOf(jobs), up = JOB_LEVELS[L + 1], from = JOB_LEVELS[L].from;
    const left = up && up.from - jobs, next = up ? left + ' more ' + (left === 1 ? 'delivery' : 'deliveries') + ' to ' + up.name : JOB_LEVELS[L].name + ' · top level';
    el.innerHTML = '<span class="rc-sr"></span><div aria-hidden="true"><h2></h2><div class="rc-lines"></div><div class="rc-total">$0</div><div class="rc-stars">' + '<i>★</i>'.repeat(3) +
      '</div><div class="rc-bar"><i></i></div><small></small><div class="rc-up" hidden></div></div>';
    const $ = s => el.querySelector(s), total = $('.rc-total'), starEls = el.querySelectorAll('.rc-stars i');
    $('.rc-sr').textContent = head + ', ' + money(r.total) + ', ' + n + (n === 1 ? ' star' : ' stars') + '. ' + (levelUp || next);
    $('h2').textContent = head; $('small').textContent = next; $('.rc-up').textContent = levelUp;
    $('.rc-bar i').style.width = (up ? 100 * (jobs - from) / (up.from - from) : 100) + '%';
    lines.forEach(([v, text], i) => { const d = $('.rc-lines').appendChild(document.createElement('div')); d.textContent = text; d.classList.toggle('neg', v < 0); later(180 * i, () => d.classList.add('on')); });
    const t0 = 180 * lines.length, every = Math.max(1, Math.ceil(r.total / 8)); // a tick every few dollars, about 8 in all
    later(t0, () => {
      const start = performance.now(); let ticked = 0;
      const count = now => {
        const k = Math.min(1, (now - start) / 700), v = Math.round(r.total * k); total.textContent = money(v);
        if (v - ticked >= every && k < 1) { ticked = v; chime('tick'); }
        if (k < 1) raf = requestAnimationFrame(count); else if (r.total) chime('coin');
      };
      raf = requestAnimationFrame(count);
    });
    const t1 = t0 + 900;
    starEls.forEach((s, i) => i < n && later(t1 + 260 * i, () => { s.classList.add('on'); chime('star', i); }));
    if (!n) later(t1, () => chime('fail'));
    if (levelUp) later(t1 + 260 * n + 200, () => { $('.rc-up').hidden = false; chime('level'); });
    el.hidden = false; html.classList.add('result-up');
    later(5500, hide);
  }
  return { show, hide };
}
