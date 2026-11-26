// The weather right now at a place, and its clock, from Open-Meteo (free, no key, CORS; data under CC BY 4.0, credited
// on screen), plus the weather presets the real-map page can choose instead. Network only through the fetch passed in.

// Presets, in the order the E key and the picker go through them. amount: how heavy the rain or snow is (0–1).
export const WEATHERS = [{ kind: 'clear', label: 'Clear' }, { kind: 'partly', label: 'Partly cloudy' }, { kind: 'overcast', label: 'Overcast' },
  { kind: 'fog', label: 'Fog' }, { kind: 'rain', label: 'Rain', amount: 0.7 }, { kind: 'snow', label: 'Snow', amount: 0.7 }, { kind: 'storm', label: 'Thunderstorm', amount: 1 }];

// WMO weather codes, as Open-Meteo reports them → [kind, label, amount]
const CODES = {
  0: ['clear', 'Clear'], 1: ['clear', 'Mainly clear'], 2: ['partly', 'Partly cloudy'], 3: ['overcast', 'Overcast'], 45: ['fog', 'Fog'], 48: ['fog', 'Freezing fog'],
  51: ['rain', 'Light drizzle', 0.2], 53: ['rain', 'Drizzle', 0.3], 55: ['rain', 'Heavy drizzle', 0.4], 56: ['rain', 'Freezing drizzle', 0.3], 57: ['rain', 'Freezing drizzle', 0.4],
  61: ['rain', 'Light rain', 0.4], 63: ['rain', 'Rain', 0.7], 65: ['rain', 'Heavy rain', 1], 66: ['rain', 'Freezing rain', 0.5], 67: ['rain', 'Freezing rain', 1],
  71: ['snow', 'Light snow', 0.4], 73: ['snow', 'Snow', 0.7], 75: ['snow', 'Heavy snow', 1], 77: ['snow', 'Snow grains', 0.3],
  80: ['rain', 'Light showers', 0.4], 81: ['rain', 'Showers', 0.7], 82: ['rain', 'Heavy showers', 1], 85: ['snow', 'Snow showers', 0.5], 86: ['snow', 'Heavy snow showers', 1],
  95: ['storm', 'Thunderstorm', 1], 96: ['storm', 'Thunderstorm with hail', 1], 99: ['storm', 'Thunderstorm with hail', 1],
};
export function weatherOf(code) { const [kind, label, amount = 0] = CODES[code] || CODES[0]; return { kind, label, amount }; }

// { kind, label, amount, temp (°C), offset (the place's UTC offset in seconds) }; rejects when Open-Meteo doesn't answer
export async function weatherNow(lat, lon, fetchFn) {
  const r = await fetchFn('https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(3) + '&longitude=' + lon.toFixed(3) + '&current=weather_code,temperature_2m&timezone=auto', { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('weather replied HTTP ' + r.status);
  const j = await r.json(), c = j.current;
  if (!Number.isFinite(c?.weather_code)) throw new Error('no current weather in the reply');
  return { ...weatherOf(c.weather_code), temp: c.temperature_2m, offset: j.utc_offset_seconds || 0 };
}

// Local solar time (hours, 12 = sun due south or north) at longitude lon at epoch milliseconds ms.
// shortcut: ignores the equation of time (sun up to 16 min early or late); add it if sunrise has to match tables to the minute.
export const solarHour = (ms, lon) => (((ms / 3.6e6 + lon / 15) % 24) + 24) % 24;
