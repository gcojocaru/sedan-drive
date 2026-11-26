// The garage dialog's contents (garage.js says what's on sale and what it does): the cash, each upgrade with the
// levels fitted and what the next one costs, and the paints. choose(item) is called with an upgrade's key or a paint's
// id when its button is pressed; the page buys it and calls draw() again.
import { UPGRADES, PAINTS, price } from './garage.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function garagePanel(root, choose) {
  root.addEventListener('click', e => { const b = e.target.closest('button[data-item]'); if (b && !b.disabled) choose(b.dataset.item); });
  return {
    draw(garage, wallet) {
      const rows = Object.entries(UPGRADES).map(([key, { label, levels }]) => {
        const have = garage.levels[key], cost = price(garage, key), next = levels[have]?.[1];
        const pips = levels.map((_, i) => '<i class="' + (i < have ? 'on' : '') + '"></i>').join('');
        const button = cost === null ? '<button type="button" disabled>Fitted</button>'
          : '<button type="button" data-item="' + key + '"' + (cost > wallet.cash ? ' disabled' : '') + ' aria-label="Buy ' + esc(label) + ' level ' + (have + 1) + ' for $' + cost + '">$' + cost + '</button>';
        return '<div class="garage-item"><div><strong>' + esc(label) + '</strong><span class="pips" aria-label="' + have + ' of ' + levels.length + '">' + pips + '</span>'
          + '<small>' + (next ? 'Next: ' + esc(next) : 'All levels fitted: ' + esc(levels.at(-1)[1])) + '</small></div>' + button + '</div>';
      }).join('');
      const swatches = PAINTS.map(([id, name, colour]) => {
        const cost = price(garage, id), on = garage.paint === id;
        const tip = name + (on ? ' (on the car)' : cost ? ' · $' + cost : ' (yours)');
        return '<button type="button" class="swatch' + (on ? ' on' : '') + (cost ? ' shop' : '') + '" data-item="' + id + '"' + (cost > wallet.cash ? ' disabled' : '') + ' title="' + esc(tip) + '" aria-label="' + esc(tip) + '" style="--c:' + (colour || 'transparent') + '">' + (colour ? '' : 'F') + (cost ? '<b>$' + cost + '</b>' : '') + '</button>';
      }).join('');
      root.innerHTML = '<p class="garage-cash"><strong>$' + wallet.cash + '</strong> to spend' + (wallet.jobs ? ' · $' + wallet.earned + ' earned in ' + wallet.jobs + (wallet.jobs === 1 ? ' delivery' : ' deliveries') : ' · earn it delivering parcels (J)') + '</p>'
        + rows + '<h3>Paint</h3><div class="swatches">' + swatches + '</div>';
    }
  };
}
