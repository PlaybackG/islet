// Разбор фраз: напоминания, таймеры, калькулятор, перевод единиц.

const UNIT_SEC = [
  [/^(?:сек[\wа-яё]*|с|s|sec[\wа-яё]*)$/, 1],
  [/^(?:мин[\wа-яё]*|м|m|min[\wа-яё]*)$/, 60],
  [/^(?:час[\wа-яё]*|ч|h|hour[\wа-яё]*)$/, 3600],
  [/^(?:дн[\wа-яё]*|день|сут[\wа-яё]*|d|day[\wа-яё]*)$/, 86400],
  [/^(?:недел[\wа-яё]*|нед|w|week[\wа-яё]*)$/, 604800],
];

function unitSeconds(u) {
  for (const [re, k] of UNIT_SEC) if (re.test(u)) return k;
  return null;
}

// «10 мин», «1 час 20 минут», «1ч20м», «1:30», «90 сек», «полчаса», «10» (минуты)
function parseDuration(str) {
  const s = str.trim().toLowerCase().replace(',', '.');
  if (!s) return null;
  if (/^полчаса$/.test(s)) return 1800;
  if (/^(?:час|минуту|минутку)$/.test(s)) return s === 'час' ? 3600 : 60;
  let m = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) return m[3] !== undefined ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
  if (/^\d+(?:\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 60);
  let total = 0;
  let found = false;
  const re = /(\d+(?:\.\d+)?)\s*([a-zа-яё]+)/g;
  let rest = s;
  while ((m = re.exec(s))) {
    const k = unitSeconds(m[2]);
    if (!k) return null;
    total += parseFloat(m[1]) * k;
    found = true;
    rest = rest.replace(m[0], '');
  }
  if (!found || rest.replace(/[\sи]+/g, '')) return null;
  return Math.round(total);
}

function parseTimer(input) {
  const m = input.trim().match(/^(?:таймер|timer)\s+(.+)$/i);
  if (!m) return null;
  const sec = parseDuration(m[1]);
  return sec ? { seconds: sec } : null;
}

const WEEKDAYS = [
  ['воскресень', 0], ['понедельник', 1], ['вторник', 2], ['сред', 3], ['четверг', 4], ['пятниц', 5], ['суббот', 6],
];

function weekdayOf(word) {
  for (const [stem, d] of WEEKDAYS) if (word.startsWith(stem)) return d;
  return null;
}

function cut(state, m) {
  state.text = state.text.slice(0, m.index) + ' '.repeat(m[0].length) + state.text.slice(m.index + m[0].length);
}

// Возвращает { text, at, repeat } или null.
function parseReminder(input, now = new Date()) {
  let s = input.trim().replace(/^напомн[\wа-яё]*\s*(?:мне\s*)?/i, '').replace(/^напоминание\s*/i, '');
  const st = { text: s };
  const low = () => st.text.toLowerCase();
  let m;

  let at = null;
  let repeat = null;
  let day = null; // смещение в днях
  let weekday = null;
  let date = null;
  let hour = null;
  let minute = 0;

  // Через N минут / через час / через 2 часа 15 минут
  m = low().match(/через\s+(полчаса|час|минуту|(?:\d+(?:[.,]\d+)?\s*[a-zа-яё]+(?:\s+\d+\s*[a-zа-яё]+)?))(?=\s|$)/i);
  if (m) {
    const sec = parseDuration(m[1]);
    if (sec) {
      at = new Date(now.getTime() + sec * 1000);
      cut(st, m);
    }
  }

  if (!at) {
    // Повторы
    if ((m = low().match(/(?:^|\s)(каждый\s+день|ежедневно|каждое\s+утро|каждый\s+вечер)(?=\s|$)/))) {
      repeat = [0, 1, 2, 3, 4, 5, 6];
      if (m[1].includes('утро')) hour = 9;
      if (m[1].includes('вечер')) hour = 20;
      cut(st, m);
    } else if ((m = low().match(/(?:^|\s)по\s+будням(?=\s|$)/))) {
      repeat = [1, 2, 3, 4, 5]; cut(st, m);
    } else if ((m = low().match(/(?:^|\s)по\s+выходным(?=\s|$)/))) {
      repeat = [0, 6]; cut(st, m);
    } else if ((m = low().match(/(?:^|\s)(?:кажд[\wа-яё]+|по)\s+(понедельник[\wа-яё]*|вторник[\wа-яё]*|сред[\wа-яё]*|четверг[\wа-яё]*|пятниц[\wа-яё]*|суббот[\wа-яё]*|воскресень[\wа-яё]*)(?=\s|$)/))) {
      repeat = [weekdayOf(m[1])]; cut(st, m);
    }

    // Время
    if ((m = low().match(/(?:^|\s)в\s+полдень(?=\s|$)/))) { hour = 12; minute = 0; cut(st, m); }
    else if ((m = low().match(/(?:^|\s)в\s+полночь(?=\s|$)/))) { hour = 0; minute = 0; cut(st, m); }
    else if ((m = low().match(/(?:^|\s)(?:в|к)\s+(\d{1,2})(?:[:.](\d{2}))?(?:\s*час[\wа-яё]*)?(?:\s+(утра|дня|вечера|ночи))?(?=\s|$|[,.!])/))) {
      hour = +m[1]; minute = m[2] ? +m[2] : 0;
      if ((m[3] === 'вечера' || m[3] === 'дня') && hour < 12) hour += 12;
      if (m[3] === 'ночи' && hour === 12) hour = 0;
      cut(st, m);
    } else if ((m = low().match(/(?:^|\s)(\d{1,2}):(\d{2})(?=\s|$)/))) {
      hour = +m[1]; minute = +m[2]; cut(st, m);
    } else if ((m = low().match(/(?:^|\s)(утром|днём|днем|вечером)(?=\s|$)/))) {
      hour = { 'утром': 9, 'днём': 13, 'днем': 13, 'вечером': 19 }[m[1]]; cut(st, m);
    }

    // День
    if ((m = low().match(/(?:^|\s)(послезавтра|завтра|сегодня)(?=\s|$)/))) {
      day = { 'сегодня': 0, 'завтра': 1, 'послезавтра': 2 }[m[1]]; cut(st, m);
    } else if ((m = low().match(/(?:^|\s)во?\s+(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)(?=\s|$)/))) {
      weekday = weekdayOf(m[1]); cut(st, m);
    } else if ((m = low().match(/(?:^|\s)(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?=\s|$)/))) {
      let y = m[3] ? +m[3] : now.getFullYear();
      if (y < 100) y += 2000;
      date = new Date(y, +m[2] - 1, +m[1]);
      cut(st, m);
    }

    if (hour === null && day === null && weekday === null && !date && !repeat) return null;
    if (hour === null) hour = 9;
    if (hour > 23 || minute > 59) return null;

    if (repeat) {
      at = nextRepeat(repeat, hour, minute, now);
    } else {
      const d = date ? new Date(date) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (day !== null) d.setDate(d.getDate() + day);
      if (weekday !== null) {
        let diff = (weekday - d.getDay() + 7) % 7;
        d.setDate(d.getDate() + diff);
      }
      d.setHours(hour, minute, 0, 0);
      // «сегодня в 9», когда уже день, — это 21:00
      if (d <= now && day === 0 && hour < 12 && !/утра|ночи/.test(input)) d.setHours(hour + 12);
      if (d <= now) {
        if (weekday !== null) d.setDate(d.getDate() + 7);
        else if (date && !input.match(/\d{1,2}[./]\d{1,2}[./]\d{2,4}/)) d.setFullYear(d.getFullYear() + 1);
        else if (day === null && !date) d.setDate(d.getDate() + 1);
        else return null;
      }
      at = d;
    }
  }

  let text = st.text.replace(/\s+/g, ' ').trim()
    .replace(/^(?:что|о том,? что|про|о|об)\s+/i, '')
    .replace(/^[,.:;\-–—\s]+|[,;:\-–—\s]+$/g, '');
  if (!text) text = 'Напоминание';
  text = text[0].toUpperCase() + text.slice(1);
  return { text, at: at.getTime(), repeat: repeat ? { days: repeat, hour, minute } : null };
}

function nextRepeat(days, hour, minute, after = new Date()) {
  const d = new Date(after);
  d.setSeconds(0, 0);
  for (let i = 0; i < 8; i++) {
    const c = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, hour, minute, 0, 0);
    if (c > after && days.includes(c.getDay())) return c;
  }
  return null;
}

// ---------- Калькулятор: свой разборщик, без eval ----------

const FUNCS = {
  sqrt: Math.sqrt, sin: (x) => Math.sin(x * Math.PI / 180), cos: (x) => Math.cos(x * Math.PI / 180),
  tan: (x) => Math.tan(x * Math.PI / 180), ln: Math.log, log: Math.log10, abs: Math.abs,
  round: Math.round, floor: Math.floor, ceil: Math.ceil, exp: Math.exp,
};
const CONSTS = { pi: Math.PI, 'π': Math.PI, e: Math.E };

function calc(input) {
  let s = input.trim().toLowerCase().replace(/×/g, '*').replace(/÷/g, '/').replace(/,/g, '.').replace(/\s+/g, '');
  if (s.startsWith('=')) s = s.slice(1);
  if (/^\d{1,4}[-./]\d{1,2}[-./]\d{1,4}$/.test(s)) return null; // дата, а не пример
  if (!s || !/^[\d.+\-*/^%()a-zπ]+$/.test(s)) return null;
  if (!/[+\-*/^%(]/.test(s.replace(/^-/, ''))) return null;
  let i = 0;
  const peek = () => s[i];
  function num() {
    const m = s.slice(i).match(/^\d*\.?\d+(?:e[+-]?\d+)?/);
    if (!m) throw 0;
    i += m[0].length;
    return parseFloat(m[0]);
  }
  function atom() {
    if (peek() === '(') { i++; const v = expr(); if (peek() !== ')') throw 0; i++; return v; }
    if (peek() === '-') { i++; return -atom(); }
    if (peek() === '+') { i++; return atom(); }
    const m = s.slice(i).match(/^[a-zπ]+/);
    if (m) {
      i += m[0].length;
      if (m[0] in CONSTS) return CONSTS[m[0]];
      if (m[0] in FUNCS) return FUNCS[m[0]](atom());
      throw 0;
    }
    return num();
  }
  function postfix() {
    let v = atom();
    while (peek() === '%') { i++; v = v / 100; }
    return v;
  }
  function power() {
    const b = postfix();
    if (peek() === '^') { i++; return Math.pow(b, power()); }
    return b;
  }
  function term() {
    let v = power();
    while (peek() === '*' || peek() === '/') {
      const op = s[i++];
      const r = power();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = s[i++];
      // 200+10% = 220
      const save = i;
      const r = term();
      const pct = s.slice(save, i).endsWith('%');
      const rr = pct ? v * r : r;
      v = op === '+' ? v + rr : v - rr;
    }
    return v;
  }
  try {
    const v = expr();
    if (i !== s.length || !isFinite(v)) return null;
    return +v.toPrecision(12);
  } catch {
    return null;
  }
}

// ---------- Единицы и валюты ----------

const UNITS = [
  // [ключ, группа, множитель к базе, синонимы и основы слов]
  ['mm', 'len', 0.001, ['mm', 'мм', 'миллиметр']], ['cm', 'len', 0.01, ['cm', 'см', 'сантиметр']],
  ['m', 'len', 1, ['m', 'м', 'метр']], ['km', 'len', 1000, ['km', 'км', 'километр']],
  ['in', 'len', 0.0254, ['in', 'inch', 'дюйм', '"']], ['ft', 'len', 0.3048, ['ft', 'foot', 'feet', 'фут']],
  ['yd', 'len', 0.9144, ['yd', 'ярд']], ['mi', 'len', 1609.344, ['mi', 'mile', 'мил']],
  ['mg', 'mass', 1e-6, ['mg', 'мг', 'миллиграм']], ['g', 'mass', 0.001, ['g', 'г', 'гр', 'грамм']],
  ['kg', 'mass', 1, ['kg', 'кг', 'килограм', 'кило']], ['t', 'mass', 1000, ['t', 'т', 'тонн']],
  ['lb', 'mass', 0.45359237, ['lb', 'lbs', 'фунт']], ['oz', 'mass', 0.028349523125, ['oz', 'унци']],
  ['ml', 'vol', 0.001, ['ml', 'мл', 'миллилитр']], ['l', 'vol', 1, ['l', 'л', 'литр']],
  ['gal', 'vol', 3.785411784, ['gal', 'галлон']], ['pt', 'vol', 0.473176473, ['pt', 'пинт']],
  ['km/h', 'speed', 1, ['km/h', 'kmh', 'км/ч', 'кмч']], ['mph', 'speed', 1.609344, ['mph', 'миль/ч']],
  ['m/s', 'speed', 3.6, ['m/s', 'м/с']],
  ['B', 'data', 1, ['b', 'байт', 'byte']], ['KB', 'data', 1024, ['kb', 'кб', 'килобайт']],
  ['MB', 'data', 1024 ** 2, ['mb', 'мб', 'мегабайт']], ['GB', 'data', 1024 ** 3, ['gb', 'гб', 'гигабайт']],
  ['TB', 'data', 1024 ** 4, ['tb', 'тб', 'терабайт']],
  ['°C', 'temp', 0, ['c', '°c', 'с', '°с', 'цельси']], ['°F', 'temp', 0, ['f', '°f', 'фаренгейт']],
  ['K', 'temp', 0, ['k', 'кельвин']],
];

const CURRENCIES = [
  ['USD', ['usd', '$', 'доллар', 'бакс']], ['EUR', ['eur', '€', 'евро']], ['RUB', ['rub', '₽', 'руб', 'р']],
  ['CNY', ['cny', 'юан', '¥']], ['GBP', ['gbp', '£', 'стерлинг']], ['KZT', ['kzt', 'тенге', '₸']],
  ['UAH', ['uah', 'грив', '₴']], ['BYN', ['byn', 'белорусск']], ['TRY', ['try', 'лир']],
  ['JPY', ['jpy', 'иен', 'йен']], ['AED', ['aed', 'дирхам']], ['KRW', ['krw', 'вон']],
  ['GEL', ['gel', 'лари']], ['AMD', ['amd', 'драм']], ['UZS', ['uzs', 'сум']], ['THB', ['thb', 'бат']],
];

function findUnit(word) {
  const w = word.trim().toLowerCase().replace(/\.$/, '');
  if (!w) return null;
  if (w.includes('стерлинг')) return { kind: 'cur', key: 'GBP' };
  // Сначала точные совпадения, потом самая длинная основа.
  for (const [key, alts] of CURRENCIES) if (alts.includes(w)) return { kind: 'cur', key };
  for (const u of UNITS) if (u[3].includes(w)) return { kind: 'unit', key: u[0], group: u[1], k: u[2] };
  let best = null;
  for (const [key, alts] of CURRENCIES) for (const a of alts) {
    if (a.length >= 3 && w.startsWith(a) && (!best || a.length > best.len)) best = { len: a.length, r: { kind: 'cur', key } };
  }
  for (const u of UNITS) for (const a of u[3]) {
    if (a.length >= 3 && w.startsWith(a) && (!best || a.length > best.len)) best = { len: a.length, r: { kind: 'unit', key: u[0], group: u[1], k: u[2] } };
  }
  return best ? best.r : null;
}

function tempConvert(v, from, to) {
  const c = from === '°C' ? v : from === '°F' ? (v - 32) * 5 / 9 : v - 273.15;
  return to === '°C' ? c : to === '°F' ? c * 9 / 5 + 32 : c + 273.15;
}

function fmt(n) {
  if (Math.abs(n) >= 1000) return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  return (+n.toPrecision(6)).toLocaleString('ru-RU', { maximumFractionDigits: 6 });
}

// rates: { USD: рублей за 1, ... }
function convert(input, rates) {
  const s = input.trim().toLowerCase().replace(/,/g, '.');
  let m = s.match(/^([$€£¥₽₴₸])?\s*(\d+(?:\.\d+)?)\s*([^\d\s][^\s]*(?:\s[^\s]+)?)?\s+(?:в|во|to|in|=|->|→)\s+(.+)$/);
  let amount, fromWord, toWord;
  if (m) {
    amount = parseFloat(m[2]); fromWord = m[1] || m[3] || ''; toWord = m[4];
  } else {
    m = s.match(/^([$€£¥₽₴₸])?\s*(\d+(?:\.\d+)?)\s*([$€£¥₽₴₸]|[a-zа-яё]+)?$/);
    if (!m || !(m[1] || m[3])) return null;
    amount = parseFloat(m[2]); fromWord = m[1] || m[3]; toWord = null;
  }
  const from = findUnit(fromWord);
  if (!from) return null;
  if (from.kind === 'cur') {
    if (!rates) return null;
    const to = toWord ? findUnit(toWord) : { kind: 'cur', key: from.key === 'RUB' ? 'USD' : 'RUB' };
    if (!to || to.kind !== 'cur') return null;
    const rf = from.key === 'RUB' ? 1 : rates[from.key];
    const rt = to.key === 'RUB' ? 1 : rates[to.key];
    if (!rf || !rt) return null;
    const v = amount * rf / rt;
    return { value: v, text: `${fmt(v)} ${to.key}`, detail: `${fmt(amount)} ${from.key} по курсу ЦБ` };
  }
  if (!toWord) return null;
  const to = findUnit(toWord);
  if (!to || to.kind !== 'unit' || to.group !== from.group) return null;
  const v = from.group === 'temp' ? tempConvert(amount, from.key, to.key) : amount * from.k / to.k;
  return { value: v, text: `${fmt(v)} ${to.key}`, detail: `${fmt(amount)} ${from.key}` };
}

module.exports = { parseDuration, parseTimer, parseReminder, nextRepeat, calc, convert };
