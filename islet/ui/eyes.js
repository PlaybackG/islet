// Стили глазок: размер, цвет, форма, веки, зрачки и символы. Общие для острова и галереи в настройках.
// «Эмоции» — по параметрам Expressive Eyes (Catherine Chambers) из pycozmo (MIT);
// настроение веками, циклоп и встряхивания — идеи FluxGarage RoboEyes. Код свой.
(() => {
  const ring = (n, f) => Array.from({ length: n }, (_, i) => f((i / n) * Math.PI * 2, i));
  const arc = (n, f) => Array.from({ length: n }, (_, i) => f(i / (n - 1)));

  // Формы — многоугольники в долях ширины/высоты глаза; правый глаз отражается.
  const SHAPES = {
    star: ring(10, (a, i) => { const r = i % 2 ? 0.21 : 0.5; return [0.5 + r * Math.sin(a), 0.54 - r * Math.cos(a)]; }),
    hex: ring(6, (a) => [0.5 + 0.5 * Math.sin(a), 0.5 - 0.5 * Math.cos(a)]),
    heart: (() => {
      const p = ring(28, (t) => [16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]);
      const ys = p.map((q) => q[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
      return p.map(([x, y]) => [(x + 16) / 32, (y - y0) / (y1 - y0)]);
    })(),
    lens: [...arc(9, (x) => [x, 0.5 - 0.5 * Math.sin(Math.PI * x)]), ...arc(9, (x) => [1 - x, 0.5 + 0.5 * Math.sin(Math.PI * x)]).slice(1, -1)],
    x: [[0, 0.2], [0.2, 0], [0.5, 0.3], [0.8, 0], [1, 0.2], [0.7, 0.5], [1, 0.8], [0.8, 1], [0.5, 0.7], [0.2, 1], [0, 0.8], [0.3, 0.5]],
    plus: [[0.35, 0], [0.65, 0], [0.65, 0.35], [1, 0.35], [1, 0.65], [0.65, 0.65], [0.65, 1], [0.35, 1], [0.35, 0.65], [0, 0.65], [0, 0.35], [0.35, 0.35]],
    diamond: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
    tri: [[0.5, 0], [1, 1], [0, 1]],
    pix: [[0.25, 0], [0.75, 0], [0.75, 0.2], [1, 0.2], [1, 0.8], [0.75, 0.8], [0.75, 1], [0.25, 1], [0.25, 0.8], [0, 0.8], [0, 0.2], [0.25, 0.2]],
    bolt: [[0.6, 0], [0.1, 0.58], [0.45, 0.58], [0.3, 1], [0.9, 0.4], [0.55, 0.4], [0.75, 0]],
    caret: [[0, 0.8], [0.5, 0.1], [1, 0.8], [0.82, 1], [0.5, 0.48], [0.18, 1]],
    chev: [[0, 0], [1, 0.5], [0, 1], [0, 0.72], [0.55, 0.5], [0, 0.28]],
  };

  const poly = (pts) => `polygon(${pts.map(([x, y]) => `${(x * 100).toFixed(1)}% ${(y * 100).toFixed(1)}%`).join(',')})`;

  // Веки: u — верхнее, l — нижнее, [доля высоты, угол°, изгиб]. Угол > 0: внутренний угол верхнего века ниже
  // (злость), нижнего — выше. Точек всегда поровну, поэтому смена выражения плавно перетекает.
  function lids(o, i) {
    const L = (i ? o.lidR : o.lidL) || o.lid;
    if (!L) return '';
    const [uy = 0, ua = 0, ub = 0] = L.u || [];
    const [ly = 0, la = 0, lb = 0] = L.l || [];
    const asp = (o.w ?? 8.4) / (o.h ?? 12.4) / 2;
    const ku = Math.tan((ua * Math.PI) / 180) * asp, kl = Math.tan((la * Math.PI) / 180) * asp;
    const N = 9, top = [], bot = [];
    for (let j = 0; j < N; j++) {
      const x = j / (N - 1), t = (i ? 1 - x : x) * 2 - 1; // −1 внешний край, +1 внутренний
      const y0 = Math.max(-0.05, uy + ku * t + ub * (1 - t * t) * 0.5);
      const y1 = Math.max(y0 + 0.06, 1 - (ly + kl * t + lb * (1 - t * t) * 0.5));
      top.push([x, y0]); bot.push([x, Math.min(1.05, y1)]);
    }
    return poly([...top, ...bot.reverse()]);
  }

  function clip(o, i) {
    const sh = Array.isArray(o.shape) ? o.shape[i] : o.shape;
    if (sh) return poly(i ? SHAPES[sh].map(([x, y]) => [1 - x, y]) : SHAPES[sh]);
    return lids(o, i);
  }

  const G = '#00ff41';
  const E = { w: 10, h: 13, r: '4px', g: 13 }; // база «Эмоций»: скруглённый прямоугольник, как у Cozmo
  const list = [
    // ---- Классика ----
    { id: 'nusa', n: 'Nusa', c: 'Классика' },
    { id: 'round', n: 'Круглые', c: 'Классика', w: 10, h: 10 },
    { id: 'tall', n: 'Высокие', c: 'Классика', w: 6, h: 15, r: '3px' },
    { id: 'wideo', n: 'Широкие', c: 'Классика', w: 12, h: 8 },
    { id: 'pills', n: 'Капсулы', c: 'Классика', w: 11, h: 5, r: '3px' },
    { id: 'small', n: 'Маленькие', c: 'Классика', w: 6, h: 8 },
    { id: 'big', n: 'Большие', c: 'Классика', w: 11, h: 15 },
    { id: 'close', n: 'Поближе', c: 'Классика', g: 7 },
    { id: 'soft', n: 'Мягкие квадраты', c: 'Классика', w: 10, h: 10, r: '3.5px' },
    { id: 'toon', n: 'Мультяшные', c: 'Классика', w: 10, h: 13, pupil: { w: 5, h: 6, c: '#000', k: 0.9 }, hl: 1 },
    // ---- Хакер и техника ----
    { id: 'term', n: 'Терминал', c: 'Хакер и техника', w: 7, h: 11, r: '1px', col: G, fx: 'cursor' },
    { id: 'prompt', n: 'Промпт >_', c: 'Хакер и техника', glyph: ['>', '_'], col: G, fx: 'cursor' },
    { id: 'binary', n: 'Бинарный', c: 'Хакер и техника', glyph: ['0', '1'], col: G, fx: 'glitch' },
    { id: 'matrix', n: 'Матрица', c: 'Хакер и техника', glyph: ['ｱ', 'ﾈ'], col: G, fx: 'glitch' },
    { id: 'code', n: 'Код { }', c: 'Хакер и техника', glyph: ['{', '}'], col: '#7aa2f7' },
    { id: 'root', n: 'Рут # #', c: 'Хакер и техника', glyph: '#', col: '#ff4d4d', fx: 'glitch' },
    { id: 'cyber', n: 'Киберпанк', c: 'Хакер и техника', w: 11, h: 6, r: '1px', col: ['#ff2bd6', '#00f0ff'], fx: 'glitch' },
    { id: 'glitch', n: 'Глитч', c: 'Хакер и техника', fx: 'glitch', col: '#e6fbff', glow: '#00f0ff' },
    { id: 'radar', n: 'Радар', c: 'Хакер и техника', w: 9, h: 9, ring: 1.5, col: G, pupil: { w: 3, h: 3, c: G, k: 0.8 }, fx: 'pulse' },
    { id: 'scanner', n: 'Сканер', c: 'Хакер и техника', one: 1, w: 30, h: 5, r: '3px', col: '#4a0909', glow: '#ff2020', pupil: { w: 8, h: 5, r: '3px', c: '#ff3030', k: 3 }, fx: 'scan' },
    { id: 'visor', n: 'Визор', c: 'Хакер и техника', one: 1, w: 32, h: 5, r: '3px', col: '#7ff6ff', glow: '#00d5ff', fx: 'flicker' },
    { id: 't800', n: 'Терминатор', c: 'Хакер и техника', one: 1, w: 9, h: 9, col: '#ff2020', hl: 1, fx: 'pulse' },
    { id: 'hal', n: 'HAL', c: 'Хакер и техника', one: 1, w: 11, h: 11, ring: 1.5, col: '#ff3b30', pupil: { w: 4, h: 4, c: '#ffcf4d', k: 0.4 }, fx: 'pulse' },
    { id: 'robot', n: 'Робот', c: 'Хакер и техника', w: 10, h: 8, r: '1.5px', col: '#5ff', glow: '#00c8ff' },
    { id: 'retro', n: 'Ретро-робот', c: 'Хакер и техника', w: 11, h: 4, r: '1px', col: '#ffd84d', fx: 'flicker' },
    { id: 'bit8', n: '8 бит', c: 'Хакер и техника', w: 8, h: 10, r: 0, shape: 'pix' },
    { id: 'err', n: 'Ошибка', c: 'Хакер и техника', glyph: ['?', '!'], col: '#ffb340', fx: 'shake' },
    // ---- Персонажи ----
    { id: 'anime', n: 'Аниме', c: 'Персонажи', w: 10, h: 14, col: '#4fb3ff', pupil: { w: 5, h: 7, c: '#0a1f44', k: 0.7 }, hl: 1 },
    { id: 'animep', n: 'Аниме розовые', c: 'Персонажи', w: 10, h: 14, col: '#ff7ad9', pupil: { w: 5, h: 7, c: '#3d0a2e', k: 0.7 }, hl: 1 },
    { id: 'cat', n: 'Кот', c: 'Персонажи', w: 12, h: 10, r: 0, shape: 'lens', col: '#ffd23f', pupil: { w: 2, h: 10, r: '1px', c: '#111', k: 0.8 } },
    { id: 'snake', n: 'Змея', c: 'Персонажи', w: 12, h: 9, r: 0, shape: 'lens', col: '#7dff5a', pupil: { w: 1.6, h: 9, r: '1px', c: '#062', k: 0.6 }, rot: 8 },
    { id: 'dragon', n: 'Дракон', c: 'Персонажи', w: 13, h: 8, r: 0, shape: 'lens', col: '#ff8a1f', glow: '#ff4d00', pupil: { w: 2, h: 8, r: '1px', c: '#200', k: 0.6 }, rot: 14 },
    { id: 'demon', n: 'Демон', c: 'Персонажи', col: '#ff2b2b', lid: { u: [0.32, 28] }, fx: 'pulse' },
    { id: 'vamp', n: 'Вампир', c: 'Персонажи', w: 10, h: 11, col: '#ff3355', lid: { u: [0.26, 18], l: [0.12, -8] } },
    { id: 'ghost', n: 'Призрак', c: 'Персонажи', w: 10, h: 13, col: '#e8f4ff', glow: '#cfe8ff', fx: 'flicker' },
    { id: 'alien', n: 'Пришелец', c: 'Персонажи', w: 13, h: 8, r: 0, shape: 'lens', col: '#9dff7a', rot: 25, hl: 1 },
    { id: 'zombie', n: 'Зомби', c: 'Персонажи', col: '#b7d36b', R: { w: 6, h: 7 }, lidL: { u: [0.2, -12] } },
    { id: 'googly', n: 'Глазастик', c: 'Персонажи', w: 11, h: 11, pupil: { w: 5, h: 5, c: '#000', k: 1.2 }, glow: '#ffffff' },
    { id: 'owl', n: 'Сова', c: 'Персонажи', w: 12, h: 12, g: 4, col: '#ffc93c', pupil: { w: 6, h: 6, c: '#000', k: 0.6 }, hl: 1 },
    { id: 'puppy', n: 'Щенок', c: 'Персонажи', w: 11, h: 12, col: '#ffd9a8', pupil: { w: 7, h: 8, c: '#2a1606', k: 0.6 }, hl: 1, lid: { u: [0.1, -18] } },
    { id: 'fox', n: 'Лис', c: 'Персонажи', w: 12, h: 7, r: 0, shape: 'lens', col: '#ff9d3c', rot: 16 },
    { id: 'ninja', n: 'Ниндзя', c: 'Персонажи', w: 11, h: 9, col: '#fff', lid: { u: [0.35, 18], l: [0.3, 0] } },
    { id: 'bear', n: 'Мишка', c: 'Персонажи', w: 5, h: 5, g: 22 },
    { id: 'pirate', n: 'Пират', c: 'Персонажи', R: { w: 13, h: 2.5, r: '1px', col: '#9aa0a6', glow: '#555555', rot: -20 } },
    // ---- Символы ----
    { id: 'dollar', n: 'Доллары', c: 'Символы', glyph: '$', col: '#ffd76a', glow: '#ffb300', fx: 'pulse' },
    { id: 'dizzy', n: 'Головокружение', c: 'Символы', glyph: '@', col: '#c69bff', fx: 'spin' },
    { id: 'look', n: 'ಠ_ಠ', c: 'Символы', glyph: 'ಠ', fs: 13 },
    { id: 'meh', n: 'Недовольный ¬ ¬', c: 'Символы', glyph: '¬' },
    { id: 'cry', n: 'Плачу T T', c: 'Символы', glyph: 'T', col: '#7cc4ff' },
    { id: 'oO', n: 'Чего? o O', c: 'Символы', glyph: ['o', 'O'] },
    { id: 'uwu', n: 'Умиление u u', c: 'Символы', glyph: 'u', col: '#ffb3e6' },
    { id: 'qq', n: 'Вопросы ? ?', c: 'Символы', glyph: '?', fx: 'shake' },
    { id: 'bang', n: 'Восклицания ! !', c: 'Символы', glyph: '!', col: '#ffd84d', fx: 'laugh' },
    { id: 'bull', n: 'Мишень ʘ ʘ', c: 'Символы', glyph: 'ʘ' },
    { id: 'joy', n: 'Довольный ≧ ≦', c: 'Символы', glyph: ['≧', '≦'], fx: 'laugh' },
    { id: 'kawaii', n: 'Кавай ◕ ◕', c: 'Символы', glyph: '◕', fs: 15 },
    // ---- Формы ----
    { id: 'hearts', n: 'Сердечки', c: 'Формы', w: 11, h: 10, r: 0, shape: 'heart', col: '#ff4d7a', fx: 'pulse' },
    { id: 'stars', n: 'Звёзды', c: 'Формы', w: 12, h: 12, r: 0, shape: 'star', col: '#ffd84d', fx: 'spin' },
    { id: 'xx', n: 'Крестики', c: 'Формы', w: 9, h: 9, r: 0, shape: 'x' },
    { id: 'plus', n: 'Плюсики', c: 'Формы', w: 10, h: 10, r: 0, shape: 'plus', col: '#5dffa5' },
    { id: 'diamond', n: 'Ромбы', c: 'Формы', w: 9, h: 12, r: 0, shape: 'diamond', col: '#7ff6ff' },
    { id: 'tri', n: 'Треугольники', c: 'Формы', w: 10, h: 9, r: 0, shape: 'tri', col: '#ff9d3c' },
    { id: 'hex', n: 'Соты', c: 'Формы', w: 10, h: 11, r: 0, shape: 'hex', col: '#ffc93c' },
    { id: 'bolt', n: 'Молнии', c: 'Формы', w: 9, h: 13, r: 0, shape: 'bolt', col: '#ffe14d', fx: 'flicker' },
    { id: 'rings', n: 'Кольца', c: 'Формы', w: 9, h: 9, ring: 2 },
    { id: 'squares', n: 'Квадраты', c: 'Формы', w: 9, h: 9, r: '1.5px' },
    { id: 'sticks', n: 'Палочки', c: 'Формы', w: 3, h: 13, r: '2px' },
    { id: 'dots', n: 'Точки', c: 'Формы', w: 5, h: 5 },
    { id: 'carets', n: 'Галочки ^ ^', c: 'Формы', w: 11, h: 8, r: 0, shape: 'caret' },
    { id: 'chev', n: 'Зажмурился > <', c: 'Формы', w: 9, h: 11, r: 0, shape: 'chev', fx: 'laugh' },
    { id: 'smile', n: 'Улыбка', c: 'Формы', w: 11, h: 11, lid: { l: [0.42, 0, 0.5] } },
    // ---- Цвета ----
    { id: 'ice', n: 'Лёд', c: 'Цвета', col: '#c9f3ff', glow: '#3fd0ff' },
    { id: 'fire', n: 'Огонь', c: 'Цвета', col: '#ffb347', glow: '#ff4d00', fx: 'pulse' },
    { id: 'gold', n: 'Золото', c: 'Цвета', col: '#ffd76a', glow: '#ffb300' },
    { id: 'emerald', n: 'Изумруд', c: 'Цвета', col: '#5dffa5', glow: '#00c86e' },
    { id: 'amethyst', n: 'Аметист', c: 'Цвета', col: '#c69bff', glow: '#8a4dff' },
    { id: 'ruby', n: 'Рубин', c: 'Цвета', col: '#ff4d6d', glow: '#ff0033' },
    { id: 'mint', n: 'Мята', c: 'Цвета', col: '#9fffe0', glow: '#2fe0b0' },
    { id: 'neon', n: 'Неон', c: 'Цвета', col: '#ff3df2', glow: '#ff00e6' },
    { id: 'sunset', n: 'Закат', c: 'Цвета', col: ['#ff9a5a', '#ff5ab4'] },
    { id: 'rainbow', n: 'Радуга', c: 'Цвета', col: '#ff6b6b', fx: 'hue' },
    // ---- Эмоции ----
    { id: 'e-calm', n: 'Спокойствие', ...E, w: 9, h: 11.5 },
    { id: 'e-anger', n: 'Злость', ...E, lid: { u: [0.28, 28] } },
    { id: 'e-sad', n: 'Грусть', ...E, lid: { u: [0.28, -22] } },
    { id: 'e-happy', n: 'Радость', ...E, r: '50% 50% 4px 4px', lid: { l: [0.38, 0, 0.45] } },
    { id: 'e-surprise', n: 'Удивление', ...E, w: 12, h: 15.5, r: '5px' },
    { id: 'e-disgust', n: 'Отвращение', ...E, lidL: { u: [0.18, -10], l: [0.18, 0] }, lidR: { u: [0.1, 20], l: [0.1, -10] } },
    { id: 'e-fear', n: 'Страх', ...E, lid: { u: [0.12, -30, 0.1], l: [0.25, 10] } },
    { id: 'e-plead', n: 'Мольба', ...E, lid: { u: [0.12, -30], l: [0.3, 0] } },
    { id: 'e-vuln', n: 'Ранимость', ...E, lid: { u: [0.18, -20], l: [0.3, 10] } },
    { id: 'e-despair', n: 'Отчаяние', ...E, lid: { u: [0.35, -30] } },
    { id: 'e-guilt', n: 'Вина', ...E, lid: { u: [0.35, -10, 0.3] } },
    { id: 'e-disap', n: 'Разочарование', ...E, lid: { u: [0.2, 10], l: [0.25, 0] } },
    { id: 'e-embar', n: 'Смущение', ...E, lid: { u: [0.3, -10, 0.1], l: [0.08, 0] } },
    { id: 'e-horror', n: 'Ужас', ...E, w: 11, h: 15, lid: { u: [0.05, -20] } },
    { id: 'e-skept', n: 'Скепсис', ...E, lidL: { u: [0.32, 10] }, lidR: { u: [0.05, -12] } },
    { id: 'e-annoy', n: 'Раздражение', ...E, lidL: { u: [0.2, 30], l: [0.18, -10] }, lidR: { u: [0.12, 30], l: [0.25, -5] } },
    { id: 'e-fury', n: 'Ярость', ...E, lid: { u: [0.22, 32], l: [0.28, 0] }, fx: 'shake' },
    { id: 'e-susp', n: 'Подозрение', ...E, lid: { u: [0.28, 10], l: [0.32, 0] } },
    { id: 'e-reject', n: 'Закатил глаза', ...E, lidL: { u: [0.5, -25] }, lidR: { u: [0.5, 25] } },
    { id: 'e-bored', n: 'Скука', ...E, lid: { u: [0.3, 0] } },
    { id: 'e-tired', n: 'Усталость', ...E, lid: { u: [0.3, -5], l: [0.3, 0] } },
    { id: 'e-asleep', n: 'Дрёма', ...E, lid: { u: [0.45, 0], l: [0.48, 0] } },
    { id: 'e-confused', n: 'Растерянность', ...E, lidL: { l: [0.12, 0, 0.2] }, lidR: { u: [0.2, -10], l: [0.12, -5, 0.2] }, fx: 'shake' },
    { id: 'e-amazed', n: 'Изумление', ...E, w: 11, h: 14, lid: { l: [0.12, 0] } },
    { id: 'e-excited', n: 'Восторг', ...E, lid: { l: [0.2, 0, 0.2] }, fx: 'laugh' },
  ];
  for (const s of list) if (!s.c) s.c = 'Эмоции';
  const BY = Object.fromEntries(list.map((s) => [s.id, s]));
  const cats = [...new Set(list.map((s) => s.c))];

  const px = (v) => (typeof v === 'number' ? v + 'px' : v);
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const put = (st, k, v) => (v == null || v === '' ? st.removeProperty(k) : st.setProperty(k, v));
  const hex6 = (h) => (h.length === 4 ? '#' + [...h.slice(1)].map((d) => d + d).join('') : h);

  // Подложка капсулы под стиль глазок: только статичные градиенты, ничего не анимируется.
  // Цвет — от свечения или цвета глаз; у «Эмоций» он свой, по настроению.
  const MOOD = {
    'e-anger': '#ff3b30', 'e-fury': '#ff2020', 'e-annoy': '#ff7a3c', 'e-disgust': '#9bd35a', 'e-susp': '#ffb340',
    'e-sad': '#3f8cff', 'e-despair': '#3060ff', 'e-guilt': '#6f7dff', 'e-vuln': '#7fb2ff', 'e-plead': '#8fc8ff',
    'e-happy': '#ffd84d', 'e-excited': '#ffb02e', 'e-amazed': '#5df0ff', 'e-surprise': '#5df0ff',
    'e-fear': '#a46bff', 'e-horror': '#8a4dff', 'e-embar': '#ff7ab0', 'e-confused': '#c69bff',
  };
  function backing(s) {
    const cs = (Array.isArray(s.col) ? s.col : [s.col]).filter(Boolean).map(hex6);
    const t = hex6(s.glow || cs[0] || MOOD[s.id] || '#ffffff'), t2 = cs[1] || t, tinted = !!(s.glow || cs.length || MOOD[s.id]);
    const A = (a, c = t) => rgba(c, a);
    const low = (a, c = t) => `radial-gradient(80% 150% at 50% 118%, ${A(a, c)}, transparent 70%)`;
    let L;
    if (s.id === 'cyber' || s.id === 'sunset') L = [`linear-gradient(90deg, ${A(0.24)}, transparent 38%, transparent 62%, ${A(0.24, t2)})`, low(0.1)];
    else if (s.id === 'rainbow') L = ['linear-gradient(180deg, #000 20%, rgba(0,0,0,.72))',
      'linear-gradient(90deg, #ff5a5a, #ffd250, #5aff96, #50aaff, #be6eff)'];
    else if (s.one) L = [`linear-gradient(180deg, transparent 30%, ${A(0.2)} 50%, transparent 70%)`, `repeating-linear-gradient(0deg, ${A(0.07)} 0 1px, transparent 1px 3px)`];
    else switch (s.c) {
      case 'Хакер и техника': L = [`repeating-linear-gradient(0deg, ${A(0.09)} 0 1px, transparent 1px 3px)`, low(0.22)]; break;
      case 'Персонажи': L = [low(tinted ? 0.2 : 0.08), `radial-gradient(45% 90% at 50% -35%, ${A(0.08)}, transparent)`]; break;
      case 'Символы': L = [`repeating-linear-gradient(135deg, rgba(255,255,255,.03) 0 2px, transparent 2px 6px)`, `linear-gradient(180deg, transparent, ${A(tinted ? 0.16 : 0.06)})`]; break;
      case 'Формы': L = [`radial-gradient(circle, ${A(tinted ? 0.18 : 0.09)} .7px, transparent 1.1px) 0 0 / 6px 6px`, low(tinted ? 0.14 : 0.05)]; break;
      case 'Цвета': L = [`radial-gradient(55% 150% at 22% 118%, ${A(0.3)}, transparent 70%)`, `radial-gradient(55% 150% at 78% 118%, ${A(0.3, t2)}, transparent 70%)`]; break;
      case 'Эмоции': L = [...(tinted ? [low(0.18)] : []), 'linear-gradient(180deg, #000, #121215)']; break;
      default: L = ['linear-gradient(180deg, transparent 35%, rgba(255,255,255,.045))']; // классика — чёрная, как у Island
    }
    if (s.id === 'bit8') L.unshift('linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px) 0 0 / 4px 4px', 'linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px) 0 0 / 4px 4px');
    return { bg: L.join(', ') + ', #000', glow: tinted ? `linear-gradient(90deg, ${t}, ${t2})` : null };
  }

  // Без своих значений остаются стили по умолчанию из eyes.css (глазки Nusa).
  function apply(el, id) {
    const s = BY[id] || BY.nusa;
    const st = el.style, c = el.classList, p = s.pupil;
    el.dataset.fx = s.fx || '';
    c.toggle('one', !!s.one); c.toggle('glyph', !!s.glyph); c.toggle('pupil', !!p); c.toggle('hl', !!s.hl);
    c.toggle('ring', !!s.ring); c.toggle('cl', !!(s.shape || s.lid || s.lidL || s.lidR));
    put(st, '--eg', s.g != null ? s.g + 'px' : null);
    put(st, '--fs', s.fs ? s.fs + 'px' : null);
    put(st, '--rw', s.ring ? s.ring + 'px' : null);
    put(st, '--pw', p && px(p.w)); put(st, '--ph', p && px(p.h)); put(st, '--pr', p && p.r);
    put(st, '--pc', p && p.c); put(st, '--pk', p && p.k);
    // на острове — весь .island (капсула и плечи), в настройках — .cap
    const host = el.closest('.island') || el.parentElement;
    if (host) { const b = backing(s); put(host.style, '--pbg', b.bg); put(host.style, '--pglow', b.glow); }
    el.querySelectorAll('.eye').forEach((e, i) => {
      const o = i && s.R ? { ...s, ...s.R } : s;
      const col = Array.isArray(o.col) ? o.col[i] : o.col;
      const glow = o.glow || (col && col !== '#fff' ? col : null);
      const es = e.style;
      put(es, '--ew', o.w != null ? px(o.w) : null); put(es, '--eh', o.h != null ? px(o.h) : null);
      put(es, '--er', o.r != null ? px(o.r) : null); put(es, '--ec', col);
      put(es, '--gl', glow && rgba(glow, 0.6)); put(es, '--gl2', glow && rgba(glow, 0.28));
      put(es, '--rot', o.rot ? (i && !s.R?.rot ? -o.rot : o.rot) + 'deg' : null);
      es.clipPath = clip(o, i);
      if (o.glyph) e.dataset.g = Array.isArray(o.glyph) ? o.glyph[i] : o.glyph;
      else delete e.dataset.g;
      // свечение вырезанных форм рисует фильтр контейнера — берём цвет левого глаза
      if (!i) { put(st, '--gl', glow && rgba(glow, 0.6)); put(st, '--gl2', glow && rgba(glow, 0.28)); }
    });
    return s.fx || '';
  }

  const random = (not) => { let s; do s = list[(Math.random() * list.length) | 0]; while (s.id === not); return s.id; };

  window.EyeStyles = { list, cats, get: (id) => BY[id] || BY.nusa, apply, random };
})();
