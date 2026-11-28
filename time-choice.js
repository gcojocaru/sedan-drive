// Time of day and weather on the real-map page. Each choice is 'live' (this place, now) or an index into the presets
// (sky.js TIMES: [name, solar hour]; weather.js WEATHERS). Pure: the page keeps the choices and does the drawing.
import { solarHour, groundOf } from './weather.js';

// T and E: live, then each preset in turn, then live again
export const nextChoice = (i, n) => i === 'live' ? 0 : i + 1 < n ? i + 1 : 'live';

// The solar hour to light the place for (ms: the time now), and the weather to show (clear when live weather is missing)
export const hourIn = (tSel, times, lon, ms) => tSel === 'live' ? solarHour(ms, lon) : times[tSel][1];
export const weatherIn = (wSel, presets, live) => wSel !== 'live' ? presets[wSel] : live || { kind: 'clear', label: 'Weather unavailable' };

// Hours → 'hh:mm', wrapping round midnight
export const clock = h => { const m = Math.round((((h % 24) + 24) % 24) * 60); return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

// The status line: the preset's name, the local clock time (presets are set in solar time; the UTC offset comes from the
// live weather, else is guessed from the longitude), the weather, and with live weather its temperature and what lies on
// the ground. hour: hourIn(); weather: weatherIn(); live: the live weather or null.
export function timeText({ tSel, wSel, times, hour, lon, weather, live }) {
  const real = wSel === 'live' && live, offset = live ? live.offset : Math.round(lon / 15) * 3600;
  const lying = !real ? '' : live.snowDepth >= 0.01 ? ', ' + Math.round(live.snowDepth * 100) + ' cm on the ground'
    : groundOf(weather).wet > 0.3 && !['rain', 'storm', 'snow'].includes(weather.kind) ? ', wet roads' : '';
  return (tSel === 'live' ? '' : times[tSel][0] + ' · ') + clock(hour - lon / 15 + offset / 3600) + ' · ' + weather.label + (real ? ', ' + Math.round(live.temp) + '°C' : '') + lying;
}

// What the once-a-minute tick does: ask for the weather again every 15 minutes while it is live (Open-Meteo updates every
// 15), move the sun every 5 while the time is live, else only redraw the clock
export const minuteTick = (minutes, tSel, wSel) => wSel === 'live' && minutes % 15 === 0 ? 'weather' : tSel === 'live' && minutes % 5 === 0 ? 'sun' : 'clock';
