// Сетевые сервисы: ИИ (OpenAI-совместимый API), распознавание речи, погода, курсы ЦБ.
const UA = 'Islet/0.1 (personal desktop widget)';

// ---------- ИИ ----------

const running = new Map(); // id -> AbortController

function aiUrl(base, p) {
  return base.replace(/\/+$/, '') + p;
}

// Потоковый ответ: onDelta(text) на каждый кусок, промис с полным текстом.
async function aiStream({ baseUrl, key, model }, id, messages, onDelta) {
  const ctrl = new AbortController();
  running.set(id, ctrl);
  let full = '';
  try {
    const res = await fetch(aiUrl(baseUrl, '/chat/completions'), {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
      body: JSON.stringify({ model, messages, stream: true }),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return full;
        try {
          const d = JSON.parse(data).choices?.[0]?.delta?.content;
          if (d) { full += d; onDelta(d); }
        } catch {}
      }
    }
    return full;
  } catch (e) {
    if (e.name === 'AbortError') return full;
    throw e;
  } finally {
    running.delete(id);
  }
}

function aiStop(id) {
  running.get(id)?.abort();
}

// Понятный текст ошибки сервиса вместо сырого JSON.
async function aiError(res) {
  const raw = await res.text().catch(() => '');
  let msg = '';
  try { const j = JSON.parse(raw); msg = j.error?.message || j.message || j.detail || ''; } catch {}
  if (res.status === 401 || res.status === 403) return new Error(`Ключ не подошёл (${res.status})${msg ? ': ' + msg.slice(0, 160) : ''}`);
  if (res.status === 404) return new Error(`Адрес не найден (404) — проверь базовый URL${msg ? ': ' + msg.slice(0, 160) : ''}`);
  if (res.status === 429) return new Error('Слишком много запросов или кончился баланс (429)');
  return new Error(`${res.status} ${(msg || raw).slice(0, 300)}`);
}

function timeoutError(e, ms) {
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return new Error(`Сервис не ответил за ${Math.round(ms / 1000)} с`);
  if (e?.cause?.code === 'ENOTFOUND') return new Error('Сервер не найден — проверь адрес');
  if (e?.cause?.code === 'ECONNREFUSED') return new Error('Сервер не принимает подключения');
  return e;
}

async function aiOnce(cfg, messages, ms = 60000) {
  try {
    const res = await fetch(aiUrl(cfg.baseUrl, '/chat/completions'), {
      method: 'POST',
      signal: AbortSignal.timeout(ms),
      headers: { 'Content-Type': 'application/json', ...(cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {}) },
      body: JSON.stringify({ model: cfg.model, messages }),
    });
    if (!res.ok) throw await aiError(res);
    const j = await res.json();
    return j.choices?.[0]?.message?.content || '';
  } catch (e) { throw timeoutError(e, ms); }
}

// Проверка ключа: GET /models. Возвращает список id моделей, которые отдаёт сервис.
async function aiModels({ baseUrl, key }, ms = 8000) {
  if (!baseUrl) throw new Error('Не указан адрес сервиса');
  try {
    const res = await fetch(aiUrl(baseUrl, '/models'), {
      signal: AbortSignal.timeout(ms),
      headers: key ? { Authorization: 'Bearer ' + key } : {},
    });
    if (!res.ok) throw await aiError(res);
    const j = await res.json();
    const list = (Array.isArray(j) ? j : j.data || j.models || []).map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
    return [...new Set(list.map((s) => String(s).replace(/^models\//, '')))].sort((a, b) => a.localeCompare(b));
  } catch (e) { throw timeoutError(e, ms); }
}

// ---------- Тексты песен (LRCLIB, бесплатно и без ключа) ----------

const lyricsCache = new Map();

function parseLrc(s) {
  const out = [];
  for (const line of String(s || '').split(/\r?\n/)) {
    const tags = [...line.matchAll(/\[(\d+):(\d+(?:[.,]\d+)?)\]/g)];
    if (!tags.length) continue;
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const t of tags) out.push({ t: +t[1] * 60 + parseFloat(t[2].replace(',', '.')), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

async function lyrics({ artist = '', title = '', album = '', duration = 0 }) {
  title = String(title).trim(); artist = String(artist).trim();
  if (!title) return null;
  const key = `${artist}\n${title}`.toLowerCase();
  if (lyricsCache.has(key)) return lyricsCache.get(key);
  const q = new URLSearchParams({ track_name: title, artist_name: artist });
  if (album) q.set('album_name', album);
  if (duration) q.set('duration', String(Math.round(duration)));
  const pick = (j) => (j && (j.syncedLyrics || j.plainLyrics)
    ? { synced: parseLrc(j.syncedLyrics), plain: j.syncedLyrics ? '' : String(j.plainLyrics || '').trim(), instrumental: !!j.instrumental }
    : j?.instrumental ? { synced: [], plain: '', instrumental: true } : null);
  let out = null;
  try {
    let res = await fetch('https://lrclib.net/api/get?' + q, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (res.ok) out = pick(await res.json());
    if (!out) {
      res = await fetch('https://lrclib.net/api/search?' + new URLSearchParams({ track_name: title, artist_name: artist }), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const list = await res.json();
        out = pick(list.find((x) => x.syncedLyrics) || list[0]);
      }
    }
  } catch { return null; } // сеть: не кешируем, попробуем на следующем треке
  if (lyricsCache.size > 100) lyricsCache.delete(lyricsCache.keys().next().value);
  lyricsCache.set(key, out);
  return out;
}

async function transcribe({ baseUrl, key, model }, bytes, mime) {
  const form = new FormData();
  const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';
  form.append('file', new Blob([bytes], { type: mime }), 'voice.' + ext);
  form.append('model', model || 'whisper-1');
  const res = await fetch(aiUrl(baseUrl, '/audio/transcriptions'), {
    method: 'POST',
    headers: key ? { Authorization: 'Bearer ' + key } : {},
    body: form,
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).text || '';
}

// ---------- Погода (MET Norway) ----------

let weatherCache = null;

const SYMBOLS = {
  clearsky: ['☀️', 'Ясно'], fair: ['🌤', 'Малооблачно'], partlycloudy: ['⛅', 'Переменная облачность'],
  cloudy: ['☁️', 'Облачно'], fog: ['🌫', 'Туман'],
  lightrain: ['🌦', 'Небольшой дождь'], rain: ['🌧', 'Дождь'], heavyrain: ['🌧', 'Ливень'],
  lightrainshowers: ['🌦', 'Кратковременный дождь'], rainshowers: ['🌦', 'Ливни'], heavyrainshowers: ['🌧', 'Сильные ливни'],
  lightsleet: ['🌨', 'Мокрый снег'], sleet: ['🌨', 'Мокрый снег'], heavysleet: ['🌨', 'Мокрый снег'],
  lightsleetshowers: ['🌨', 'Мокрый снег'], sleetshowers: ['🌨', 'Мокрый снег'], heavysleetshowers: ['🌨', 'Мокрый снег'],
  lightsnow: ['🌨', 'Небольшой снег'], snow: ['❄️', 'Снег'], heavysnow: ['❄️', 'Снегопад'],
  lightsnowshowers: ['🌨', 'Снег'], snowshowers: ['🌨', 'Снег'], heavysnowshowers: ['❄️', 'Снегопад'],
};

function symbol(code) {
  if (!code) return ['🌡', ''];
  const base = code.replace(/_(day|night|polartwilight)$/, '').replace(/andthunder$/, '');
  const s = SYMBOLS[base] || ['🌡', ''];
  if (code.includes('thunder')) return ['⛈', s[1] ? s[1] + ', гроза' : 'Гроза'];
  if (code.endsWith('_night') && (base === 'clearsky' || base === 'fair')) return ['🌙', s[1]];
  return s;
}

// Восход и закат по упрощённому алгоритму NOAA, время в мс. null — полярный день/ночь.
function sunTimes(lat, lon, date) {
  const rad = Math.PI / 180;
  const day0 = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const n = Math.floor((day0 - Date.UTC(2000, 0, 1, 12)) / 864e5) + 1;
  const J = n - lon / 360;
  const M = (357.5291 + 0.98560028 * J) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const L = (M + C + 180 + 102.9372) % 360;
  const Jt = 2451545 + J + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
  const dec = Math.asin(Math.sin(L * rad) * Math.sin(23.44 * rad));
  const cosH = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec));
  if (cosH < -1 || cosH > 1) return null;
  const H = Math.acos(cosH) / rad / 360;
  const toMs = (jd) => (jd - 2440587.5) * 864e5;
  return { rise: Math.round(toMs(Jt - H)), set: Math.round(toMs(Jt + H)) };
}

async function weather({ lat, lon, city }, force = false) {
  const key = `${lat},${lon}`;
  if (!force && weatherCache && weatherCache.key === key && Date.now() - weatherCache.time < 20 * 60e3) {
    return weatherCache.data;
  }
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${(+lat).toFixed(4)}&lon=${(+lon).toFixed(4)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('weather ' + res.status);
  const ts = (await res.json()).properties.timeseries;
  const now = ts[0];
  const cur = now.data.instant.details;
  const next = now.data.next_1_hours || now.data.next_6_hours;
  const [icon, text] = symbol(next?.summary?.symbol_code);
  const hours = ts.slice(1, 13).map((t) => ({
    time: t.time,
    temp: Math.round(t.data.instant.details.air_temperature),
    icon: symbol((t.data.next_1_hours || t.data.next_6_hours)?.summary?.symbol_code)[0],
  }));
  // По дням: минимум/максимум и значок на полдень.
  const days = new Map();
  for (const t of ts) {
    const d = new Date(t.time);
    const k = d.toDateString();
    const temp = t.data.instant.details.air_temperature;
    if (!days.has(k)) days.set(k, { date: t.time, min: temp, max: temp, icon: null, mm: 0 });
    const day = days.get(k);
    day.min = Math.min(day.min, temp);
    day.max = Math.max(day.max, temp);
    // Осадки за день: часовые шаги, а дальше, где прогноз шестичасовой, — шестичасовые.
    const p1 = t.data.next_1_hours?.details?.precipitation_amount;
    if (p1 != null) day.mm += p1;
    else if (t.data.next_6_hours) day.mm += t.data.next_6_hours.details?.precipitation_amount || 0;
    if (!day.icon || d.getHours() === 12 || d.getHours() === 13) {
      const c = (t.data.next_6_hours || t.data.next_1_hours)?.summary?.symbol_code;
      if (c) day.icon = symbol(c)[0];
    }
  }
  // Ощущаемая температура (формула Стедмана) и осадки за ближайший час.
  const ta = cur.air_temperature, rh = cur.relative_humidity;
  const e = rh / 100 * 6.105 * Math.exp(17.27 * ta / (237.7 + ta));
  const sun = sunTimes(+lat, +lon, new Date());
  const data = {
    city, temp: Math.round(ta), wind: Math.round(cur.wind_speed), humidity: Math.round(rh),
    // Откуда дует: 8 румбов по-русски.
    windDir: cur.wind_from_direction == null ? '' : ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'][Math.round(cur.wind_from_direction / 45) % 8],
    feels: Math.round(ta + 0.33 * e - 0.7 * cur.wind_speed - 4),
    precip: now.data.next_1_hours?.details?.precipitation_amount ?? now.data.next_6_hours?.details?.precipitation_amount ?? 0,
    sunrise: sun?.rise, sunset: sun?.set,
    icon, text, hours,
    days: [...days.values()].slice(0, 7).map((d) => ({ ...d, min: Math.round(d.min), max: Math.round(d.max), mm: Math.round(d.mm * 10) / 10 })),
    time: Date.now(),
  };
  weatherCache = { key, time: Date.now(), data };
  return data;
}

async function geocode(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&accept-language=ru&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('geocode ' + res.status);
  return (await res.json()).map((r) => ({
    name: r.display_name.split(',').slice(0, 3).join(',').trim(),
    city: r.name || r.display_name.split(',')[0],
    lat: +r.lat,
    lon: +r.lon,
  }));
}

// ---------- Курсы ЦБ ----------

let ratesCache = null;

async function rates() {
  if (ratesCache && Date.now() - ratesCache.time < 6 * 3600e3) return ratesCache.data;
  try {
    const res = await fetch('https://www.cbr-xml-daily.ru/daily_json.js', { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error('rates ' + res.status);
    const j = await res.json();
    const data = {};
    for (const [code, v] of Object.entries(j.Valute)) data[code] = v.Value / v.Nominal;
    ratesCache = { time: Date.now(), data };
    return data;
  } catch (e) {
    return ratesCache?.data || null;
  }
}

module.exports = { aiStream, aiStop, aiOnce, aiModels, lyrics, transcribe, weather, geocode, rates };
