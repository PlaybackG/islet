// Ядро острова: капсула, глазки, панель, всплывающие уведомления.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const api = window.islet;
const T = TextTools;
const Views = {};

const WIN_W = 840;
const PANEL_W = 760;
const PANEL_H = {
  home: 336, clips: 440, shelf: 370, text: 372, chat: 480, weather: 356,
  notes: 460, system: 370, command: 420, notifs: 440,
};
const TABS = [
  ['home', 'home', 'Главная'], ['clips', 'clips', 'Буфер'], ['shelf', 'shelf', 'Полка'], ['notifs', 'bell', 'Уведомления'],
  ['text', 'text', 'Текст'], ['chat', 'chat', 'Чат'], ['notes', 'notes', 'Заметка'],
  ['weather', 'weather', 'Погода'], ['system', 'system', 'Управление'],
];
const TAB_ALIAS = { media: 'home', tools: 'home', time: 'notes' };

const App = {
  settings: {}, media: null, timers: [], rec: null, claude: null, dl: null, battery: null,
  expanded: false, tab: null, lastTab: 'home', pinned: false,
};

let isl, cLeft, cRight, cText;

// ---------- Глазки ----------

const Eyes = {
  el: null, sleeping: false, blinkT: 0, happyT: 0, cur: '', fx: '', shuffleMin: 0, shuffleT: 0,
  init() { this.el = $('#eyes'); this.schedule(); },
  // стиль из настроек (eyes.style); eyes.shuffle — сменять на случайный раз в N минут
  setStyle(e = {}) {
    const id = e.style || 'nusa';
    if (id !== this.saved && window.EyeStyles) { this.saved = this.cur = id; this.fx = EyeStyles.apply(this.el, id); }
    const m = +e.shuffle || 0;
    if (m === this.shuffleMin) return;
    this.shuffleMin = m; clearInterval(this.shuffleT);
    if (m > 0) this.shuffleT = setInterval(() => {
      if (App.frozen || this.sleeping) return;
      this.cur = EyeStyles.random(this.cur); this.fx = EyeStyles.apply(this.el, this.cur);
    }, m * 60000);
  },
  schedule() {
    clearTimeout(this.blinkT);
    this.blinkT = setTimeout(() => { this.blink(Math.random() < 0.18); this.schedule(); }, 2500 + Math.random() * 3500);
  },
  blink(double) {
    const c = this.el.classList;
    if (App.frozen || this.sleeping || c.contains('happy') || c.contains('wide') || !isl.classList.contains('show-eyes')) return;
    if (this.fx && Math.random() < 0.4) { c.add('fx'); setTimeout(() => c.remove('fx'), 950); return; }
    c.add('blink'); setTimeout(() => c.remove('blink'), 110);
    if (double) setTimeout(() => { c.add('blink'); setTimeout(() => c.remove('blink'), 110); }, 260);
  },
  look(x, y) {
    const dx = x - WIN_W / 2, dy = y - 16;
    this.el.style.setProperty('--lx', (3 * dx / (Math.abs(dx) + 140)).toFixed(2) + 'px');
    this.el.style.setProperty('--ly', (2.2 * dy / (Math.abs(dy) + 90)).toFixed(2) + 'px');
  },
  center() { this.el.style.setProperty('--lx', '0px'); this.el.style.setProperty('--ly', '0px'); },
  sleep(on) {
    this.sleeping = on;
    this.el.classList.toggle('sleep', on);
    isl.classList.toggle('sleeping', on);
    if (on) { this.center(); this.el.classList.remove('happy'); }
    else this.happy();
    tracking();
  },
  happy(ms = 1600) {
    if (this.sleeping) return;
    clearTimeout(this.happyT);
    this.el.classList.add('happy');
    this.happyT = setTimeout(() => this.el.classList.remove('happy'), ms);
  },
  wide(on) { this.el.classList.toggle('wide', on && !this.sleeping); },
  // «z z» во сне: две буквы по очереди всплывают вправо-вверх за 3 с. Кадры даёт Goo.step.
  zs: null,
  zzz(now) {
    this.zs = this.zs || [...this.el.querySelectorAll('.zzz span')];
    this.zs.forEach((s, i) => {
      const p = (now / 3000 + i / 2) % 1, e = 1 - (1 - p) ** 2;
      s.style.opacity = ((p < 0.3 ? p / 0.3 : 1 - (p - 0.3) / 0.7) * 0.9).toFixed(2);
      s.style.transform = `translate(${(8 * e).toFixed(1)}px, ${(6 - 14 * e).toFixed(1)}px) scale(${(0.7 + 0.4 * e).toFixed(2)})`;
    });
  },
};

// Глазкам нужен курсор только когда они видны и не спят — иначе главный процесс его не шлёт.
let eyesSent = null;
function tracking() {
  const on = !App.frozen && !App.expanded && !Eyes.sleeping && isl.classList.contains('show-eyes') && App.settings.eyes?.follow !== false;
  if (on === eyesSent) return;
  eyesSent = on;
  api.send('win-eyes', on);
  if (!on) Eyes.center();
}

// ---------- Размер и зона кликов ----------

// Окно по высоте — под капсулу плюс запас на волну и «тягу» к курсору; открытой панели — целиком.
// Растём сразу (синхронно, до первого кадра анимации), ужимаемся — когда анимация закончилась.
const WIN_H = 600, WIN_PAD = 64;
let winH = WIN_H;
function fitWin(h, shrink) {
  const need = App.expanded ? WIN_H : Math.min(WIN_H, Math.ceil(h) + WIN_PAD);
  if (need > winH || (shrink && need < winH)) winH = api.winHeight(need) || need;
}

let hitCur = null, hitT = 0;
function setSize(w, h, r) {
  isl.style.setProperty('--w', w + 'px');
  isl.style.setProperty('--h', h + 'px');
  isl.style.setProperty('--r', (r ?? h / 2) + 'px');
  const next = { x: Math.round((WIN_W - w) / 2) - 12, y: 0, width: w + 24, height: h };
  if (hitCur && hitCur.width === next.width && hitCur.height === next.height) return;
  // Пока идёт анимация, ловим мышь и в старой, и в новой зоне.
  const u = hitCur ? {
    x: Math.min(hitCur.x, next.x), y: 0,
    width: Math.max(hitCur.x + hitCur.width, next.x + next.width) - Math.min(hitCur.x, next.x),
    height: Math.max(hitCur.height, next.height),
  } : next;
  hitCur = next;
  fitWin(u.height);
  api.send('win-hit', isTucked() ? HIT_NONE : u);
  clearTimeout(hitT);
  hitT = setTimeout(() => { api.send('win-hit', hitNow()); fitWin(hitCur.height, true); }, 520);
}
// Автоскрытие: спрятанный остров мышь не ловит — пусть клики идут в окна под ним.
const HIT_NONE = { x: 0, y: 0, width: 0, height: 0 };
const isTucked = () => isl.classList.contains('tucked') && !App.expanded;
const hitNow = () => (isTucked() ? HIT_NONE : hitCur);

// ---------- Капсула ----------

const ctx = document.createElement('canvas').getContext('2d');
function textWidth(text, sub) {
  ctx.font = '500 13px "Segoe UI Variable Text", "Segoe UI", sans-serif';
  let w = ctx.measureText(text).width;
  if (sub) { ctx.font = '400 13px "Segoe UI Variable Text", "Segoe UI", sans-serif'; w += 6 + ctx.measureText(sub).width; }
  return Math.ceil(w);
}
// Большая карточка: заголовок 600 14px, подпись 400 13px на отдельной строке.
function bigWidth(title, sub) {
  ctx.font = '600 14px "Segoe UI Variable Text", "Segoe UI", sans-serif';
  const a = ctx.measureText(title || '').width;
  ctx.font = '400 13px "Segoe UI Variable Text", "Segoe UI", sans-serif';
  return Math.ceil(Math.max(a, ctx.measureText(sub || '').width));
}

function setHTML(el, html) {
  if (el._h === html) return false;
  el._h = html;
  el.innerHTML = html;
  return true;
}

const mediaActive = () => !!(App.media && App.media.active);
const playing = () => mediaActive() && App.media.status === 'Playing';
const runningTimer = () => App.timers.filter((t) => !t.paused).sort((a, b) => a.end - b.end)[0] || App.timers[0];
const timerLeft = (t) => (t.paused ? t.left : t.end - Date.now()) / 1000;
const iconSpan = (name, color, size = 16) => `<span class="ind" style="color:${color}">${icon(name, size)}</span>`;

let toastCur = null, toastT = 0;

function toastModel(o) {
  const text = o.text ? `${T.esc(o.text)}${o.sub ? `<span class="sub">${T.esc(o.sub)}</span>` : ''}` : (o.html || '');
  if (o.big) {
    // Большая «живая» карточка: плитка-иконка, две строки текста, кнопки справа.
    const h = o.h || 72;
    return {
      w: o.w || 420, h, r: o.r || Math.min(30, h / 2 - 4), left: o.left, right: o.right, text,
      side: o.side || (o.right ? 66 : 22), leftSide: o.leftSide || 74, big: true, edge: o.edge, live: !!o.live,
    };
  }
  const side = o.left || o.right ? 44 : 20;
  const w = o.w || Math.min(440, Math.max(170, textWidth(o.text || '', o.sub) + side * 2 + 8));
  return { w, left: o.left, right: o.right, text, side, eyes: false, hud: !!o.hud, edge: o.edge };
}

// Как у Island: «2.4 ГБ», «14 МБ», «3.5 МБ» — одна цифра после точки, только пока число меньше 10.
const fmtNum = (v) => (v < 10 ? +v.toFixed(1) : Math.round(v)).toString();
const fmtSize = (b) => (b >= 1 << 30 ? fmtNum(b / (1 << 30)) + ' ГБ' : b >= 1 << 20 ? fmtNum(b / (1 << 20)) + ' МБ' : Math.max(1, Math.round(b / 1024)) + ' КБ');
// Процент идущей загрузки, если браузер сообщил полный размер; иначе null — тогда кольцо просто крутится.
const dlPct = () => (App.dl?.total > 0 ? Math.min(99.5, (App.dl.size / App.dl.total) * 100) : null);

// Покой: часы слева, погода и заряд справа (что включено в настройках «В капсуле»).
const Pill = {
  weather: null, wT: 0,
  init() {
    // Часы обновляем ровно на смене минуты, а не каждую секунду.
    const tick = () => { render(); setTimeout(tick, 60e3 - Date.now() % 60e3 + 50); };
    setTimeout(tick, 60e3 - Date.now() % 60e3 + 50);
    this.load();
  },
  async load() {
    clearTimeout(this.wT);
    this.wT = setTimeout(() => this.load(), 20 * 60e3);
    if (App.settings.pill?.weather === false) return;
    try { this.weather = await api.invoke('weather', false); render(); } catch { /* нет сети — без погоды */ }
  },
  sides() {
    const p = App.settings.pill || {};
    let left = '', right = '', lw = 0, rw = 0;
    if (p.clock !== false) {
      const t = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      left = `<span class="badge pill-t">${t}</span>`; lw = textWidth(t) + 4;
    }
    const w = this.weather;
    if (p.weather !== false && w) {
      right += `<span class="pill-w">${wIcon(w.icon, 16)}<span class="badge">${w.temp}°</span></span>`;
      rw += 16 + 4 + textWidth(w.temp + '°') + 2;
    }
    const b = App.battery;
    if (p.battery !== false && b && b.percent != null) {
      const low = !b.charging && b.percent <= 20;
      right += `<span class="pill-b${low ? ' low' : ''}${b.charging || b.plugged ? ' chg' : ''}"><i style="width:${Math.max(8, b.percent)}%"></i></span>`;
      rw += (rw ? 8 : 0) + 24;
    }
    return { left, right, side: Math.max(lw, rw) };
  },
};

function model() {
  if (toastCur) return toastModel(toastCur);
  if (App.rec) {
    // Как у Island: точка и время слева, формат и красная пилюля «Стоп» справа.
    return {
      w: 300, eyes: false, edge: 'var(--red)',
      left: `<span class="rec-dot"></span><span class="badge big-t">${T.clock((Date.now() - App.rec.start) / 1000)}</span>`,
      right: `<span class="fmt">${App.rec.fmt || 'MP4'}</span><button class="stop-pill" data-act="recStop"><i></i>Стоп</button>`,
    };
  }
  if (App.dict) {
    const d = App.dict;
    if (d.busy) return toastModel({ text: 'Распознаю речь…', left: '<span class="spin"></span>' });
    return {
      w: 300, eyes: false, edge: 'var(--red)',
      left: `<span class="dict-bars"><i></i><i></i><i></i><i></i><i></i></span><span class="badge big-t">${T.clock((Date.now() - d.t0) / 1000)}</span>`,
      right: `<button class="x-pill" data-act="dictCancel" title="Отменить">${icon('x', 13)}</button><button class="stop-pill" data-act="dictStop"><i></i>Готово</button>`,
    };
  }
  if (App.dl && App.settings.dlStyle === 'ring') {
    // Тихий вариант: капсула как в покое, у часов крутится маленькое кольцо.
    const ps = Pill.sides(), base = App.settings.eyes?.enabled === false ? 140 : 164;
    const ring = `<span class="dl-mini${dlPct() != null ? ' pct' : ''}" title="${T.esc(App.dl.name || '')}"></span>`;
    const side = Math.max(ps.side, (ps.left ? textWidth(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })) + 10 : 0) + 18);
    return { w: base + 2 * (side + 4), eyes: true, left: ps.left + ring, right: ps.right, edge: 'var(--green)' };
  }
  if (App.dl) {
    const d = App.dl, p = dlPct();
    return toastModel({
      text: d.count > 1 ? `${d.name} +${d.count - 1}` : d.name,
      sub: `${p != null ? `${Math.floor(p)}% · ${fmtSize(d.size)} из ${fmtSize(d.total)}` : fmtSize(d.size)}${d.speed ? ' · ' + fmtSize(d.speed) + '/с' : ''}`,
      left: `<span class="ring${p != null ? ' pct' : ''}">${icon('download', 12)}</span>`, edge: 'var(--green)',
    });
  }
  const t = runningTimer();
  if (t) {
    return { w: 210, timer: t.id, left: iconSpan('time', t.paused ? 'var(--dim)' : '#ffb340'), right: `<span class="badge" title="Колесо — добавить или убавить минуту">${T.clock(timerLeft(t))}</span>`, eyes: true, edge: t.paused ? null : '#ffb340' };
  }
  if (App.claude) {
    return toastModel({ text: 'Claude думает…', sub: App.claude.project, left: '<span class="spin"></span>' });
  }
  if (playing()) {
    const m = App.media;
    return {
      w: 280, art: m.thumb, eyes: true, bob: true, live: true, music: true, edge: 'var(--cover)',
      left: `<div class="art" data-k="${T.esc(m.key || '')}${m.thumb ? 1 : 0}"></div>`,
      right: '<div class="mdots"><i></i><i></i><i></i><i></i></div>',
    };
  }
  const shelfN = Views.shelf?.items?.length || 0;
  if (shelfN) {
    // Файлы на полке: лоток слева, сколько их — справа.
    return { w: 230, eyes: true, idle: true, left: `<span class="ind fg">${icon('shelf', 18)}</span>`, right: `<span class="badge">${shelfN}</span>` };
  }
  const ps = Pill.sides();
  const base = App.settings.eyes?.enabled === false ? 140 : 164;
  return { w: ps.side ? base + 2 * (ps.side + 4) : base, eyes: true, idle: true, left: ps.left, right: ps.right };
}

// Кнопки внутри капсулы (data-act): сначала действия текущей карточки, потом общие.
const ACTS = {
  recStop: () => Views.home?.stopRec?.(),
  dictStop: () => Dictate.stop(),
  dictCancel: () => Dictate.cancel(),
  vpnToggle: () => vpnToggle(),
};

// VPN по клику на щит: профили Windows — через rasdial, сторонний клиент — открываем параметры VPN.
// Об успехе скажет обычное событие 'vpn'.
async function vpnToggle() {
  toast({ text: App.vpn ? 'Отключаю VPN…' : 'Подключаю VPN…', left: '<span class="spin"></span>', ms: 45000, vpnBusy: true });
  const r = await api.invoke('vpn-toggle').catch((e) => ({ ok: false, error: errText(e) }));
  if (r.opened) toast({ text: 'Открыл параметры VPN', sub: 'Сторонний клиент включается в своём окне', left: iconSpan('shield', 'var(--dim)'), ms: 3500 });
  else if (!r.ok) toast({ text: 'VPN не переключился', sub: r.error || '', left: iconSpan('x', 'var(--red)'), ms: 4000, edge: 'var(--red)' });
  else setTimeout(() => toastDrop((o) => o.vpnBusy), 4000);
  return r;
}

// Последние цвета пипетки — для полоски образцов в карточке.
const colorHist = [];
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
// Цвет кромки и характер волны под текущее состояние.
function setEdge(color, amp, live) {
  if (color) isl.style.setProperty('--edge', color); else isl.style.removeProperty('--edge');
  Goo.wave(amp, live);
}
function panelEdge() {
  const live = playing();
  setEdge(live ? 'var(--cover)' : null, live ? 4.5 : 2.4, live);
}

function render() {
  if (App.expanded) return;
  const m = model();
  setSize(m.w, m.h || 34, m.r);
  setEdge(m.edge, m.live ? 4 : m.big ? 1.6 : 1.4, !!m.live);
  if (setHTML(cLeft, m.left || '') && m.art) { const a = $('.art', cLeft); if (a) a.style.backgroundImage = `url("${m.art}")`; }
  setHTML(cRight, m.right || '');
  setHTML(cText, m.text || '');
  // Заполнение кольца загрузки — через переменную, без пересоздания разметки, чтобы шло плавно.
  const pr = $('.pct', cLeft);
  if (pr) pr.style.setProperty('--p', dlPct() ?? 0);
  cText.style.left = (m.leftSide || m.side || 44) + 'px';
  cText.style.right = (m.side || 44) + 'px';
  const c = isl.classList;
  c.toggle('has-left', !!m.left);
  c.toggle('has-right', !!m.right);
  c.toggle('toast', !!m.text);
  c.toggle('big', !!m.big);
  c.toggle('hud', !!m.hud);
  c.toggle('idle', !!m.idle);
  c.toggle('music', !!m.music);
  c.toggle('alerting', !!toastCur?.alert && App.settings.alertGlow !== false);
  App.timerShown = m.timer || null;
  musicChar(!!m.music);
  c.toggle('show-eyes', !!m.eyes && App.settings.eyes?.enabled !== false);
  const tk = !!(App.tuck && m.idle);
  if (tk !== c.contains('tucked')) { c.toggle('tucked', tk); api.send('win-hit', hitNow()); }
  Eyes.el.classList.toggle('bob', !!m.bob);
  tracking();
}

// Пока играет музыка, на острове может жить другой персонаж (стиль глазок из настроек).
let musicStyle = '';
function musicChar(on) {
  const id = App.settings.musicCharacter;
  const want = on && id && id !== 'none' && window.EyeStyles ? id : '';
  if (want === musicStyle) return;
  musicStyle = want;
  if (window.EyeStyles) Eyes.fx = EyeStyles.apply(Eyes.el, want || Eyes.cur || App.settings.eyes?.style || 'nusa');
}

// Карточка, которая ждёт ответа (таймер вышел, вопрос Claude), не теряется под мелкими плашками:
// её откладываем и возвращаем, когда плашка уйдёт.
let toastBack = null;
function toastEnd() {
  toastCur = toastBack; toastBack = null;
  clearTimeout(toastT);
  if (toastCur) toastT = setTimeout(toastEnd, toastCur.until ? Math.max(1000, toastCur.until - Date.now()) : 2600);
  // Вопрос Claude мог потеряться под двумя карточками подряд — возвращаем его.
  else if (ClaudeAsk.list.length) { ClaudeAsk.show(ClaudeAsk.list[0]); return; }
  render();
}
function toast(o) {
  if (toastCur?.sticky && toastCur !== o) toastBack = toastCur;
  toastCur = o;
  clearTimeout(toastT);
  if (o.happy) Eyes.happy();
  if (o.sticky && !o.until) o.until = Date.now() + (o.ms || 2600);
  toastT = setTimeout(toastEnd, o.ms || 2600);
  render();
}
// Ответили на карточку или она стала не нужна.
function toastDrop(test) {
  if (toastBack && test(toastBack)) toastBack = null;
  if (toastCur && test(toastCur)) toastEnd();
}

// HUD громкости/яркости. Если такой же уже на экране — двигаем полоску на месте, чтобы она плавно ехала.
// Акцент из обложки трека: усредняем яркие пиксели миниатюры 12×12.
function coverTint(src) {
  const isl = $('#island');
  if (!src) { isl.style.removeProperty('--cover'); return; }
  const img = new Image();
  img.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 12;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, 12, 12);
      const d = g.getImageData(0, 0, 12, 12).data;
      let r = 0, gr = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
        if (mx < 60 || mx - mn < 18) continue; // тёмное и серое не берём
        r += d[i]; gr += d[i + 1]; b += d[i + 2]; n++;
      }
      if (!n) { isl.style.removeProperty('--cover'); return; }
      isl.style.setProperty('--cover', `rgb(${r / n | 0},${gr / n | 0},${b / n | 0})`);
    } catch { isl.style.removeProperty('--cover'); }
  };
  img.src = src;
}

function hud(kind, pct, muted) {
  if (App.expanded) return;
  pct = Math.max(0, Math.min(100, Math.round(pct)));
  const ic = kind === 'bright' ? 'sun' : muted || !pct ? 'mute' : 'vol';
  const left = `<span class="ind">${icon(ic, 16)}</span>`;
  const right = `<span class="badge">${pct}</span>`;
  const bar = $('.hud-bar', cText);
  if (toastCur?.hud === kind && bar && isl.classList.contains('hud')) {
    bar.firstElementChild.style.width = pct + '%';
    bar.classList.toggle('muted', !!muted);
    toastCur.left = left; toastCur.right = right;
    setHTML(cLeft, left); setHTML(cRight, right);
    clearTimeout(toastT);
    toastT = setTimeout(toastEnd, 1500);
    return;
  }
  toast({ hud: kind, w: 260, ms: 1500, left, right, html: `<div class="hud-bar${muted ? ' muted' : ''}"><div style="width:${pct}%"></div></div>` });
}

// ---------- Жидкий контур острова ----------

// Вся форма острова рисуется одним SVG-контуром: бока, скруглённые углы и низ.
// Курсор рядом — контур сам выгибается к нему (как капля ртути), а не что-то торчит из-за капсулы.
// Низ — живая волна с тонкой цветной кромкой, как у Island: под музыку частая и прыгает под бит
// в цвете обложки, в покое — пара ленивых изгибов. И всегда весь периметр медленно «дышит».
// Курсор приходит ~30 раз в секунду, поэтому всё сглаживаем по времени кадра.
const FRAME = 14; // мс между кадрами: с ожиданием vsync выходит ~60 кадров/с
const Goo = {
  a: 0, t: 0, qx: 0, qy: 0, tqx: 0, tqy: 0, cx: 0, cy: 0, tcx: 0, tcy: 0, s: 26, ts: 26,
  rad: -1, raf: 0, tm: 0, last: 0, drawnAt: 0, want: 0, vs: 16.7, tickAt: 0, chain: false,
  amp: 0, tAmp: 0, mix: 0, tMix: 0, ph: 0, ph2: 0, live: false,
  lvl: 0, tLvl: 0, lvlAt: 0, top: 0.2,
  // live — частая бегущая волна (музыка); amp — её высота в px.
  wave(amp, live) {
    this.tAmp = amp; this.tMix = live ? 1 : 0; this.live = live;
    this.kick();
  },
  // Пик громкости 0…1 от главного процесса.
  // Тихая музыка даёт пики 0.1–0.3: делим на недавний максимум, чтобы удары были видны на любой громкости.
  beat(v) {
    this.top = Math.max(v, this.top * 0.993, 0.06);
    this.tLvl = Math.min(1, v / this.top) ** 1.6;
    if (v > 0) this.lvlAt = performance.now();
    this.kick();
  },
  near(p) {
    if (!p) { this.t = 0; this.kick(); return; }
    const w = isl.offsetWidth, h = isl.offsetHeight, r = Math.max(1, this.rad);
    const b = isl.getBoundingClientRect();
    const x = p.x - b.left, y = p.y - b.top;
    // Ближайшая точка контура: «скруглённый прямоугольник», открытый сверху.
    const ix = Math.max(r, Math.min(w - r, x)), iy = Math.min(y, h - r);
    const dx = x - ix, dy = y - iy, len = Math.hypot(dx, dy) || 1;
    const d = len - r; // насколько курсор снаружи
    if (d <= 0) { this.t = 0; this.kick(); return; }
    const sm = (v) => v * v * (3 - 2 * v);
    const k = sm(Math.max(0, 1 - d / 95));
    // Тянемся к курсору, но не дальше него самого.
    this.t = Math.min((App.expanded ? 12 : 19) * k, d * 0.8 + 2);
    this.tqx = ix + dx / len * r; this.tqy = iy + dy / len * r;
    this.tcx = x; this.tcy = y;
    // Широкий и пологий горб: узкий даёт острый «клюв» в сторону курсора.
    this.ts = (App.expanded ? 44 : 35) + d * 0.25;
    if (this.a < 0.3) { this.qx = this.tqx; this.qy = this.tqy; this.cx = x; this.cy = y; }
    this.kick();
  },
  // Не чаще 60 кадров/с даже на 144–165 Гц: окно прозрачное и большое, каждый лишний кадр — работа GPU.
  kick() {
    if (this.raf) return;
    // В игре контур не живёт: только перерисовываем под новый размер, если остров вообще виден.
    if (App.frozen) { this.raf = requestAnimationFrame(() => { this.raf = 0; this.rad = this.targetRad(); this.draw(); }); return; }
    // Ждём редкого кадра «дыхания» — отменяем ожидание и рисуем, как только позволит лимит.
    if (this.tm) { clearTimeout(this.tm); this.tm = 0; } else this.last = performance.now();
    this.next(FRAME);
  },
  stop() {
    cancelAnimationFrame(this.raf); clearTimeout(this.tm); this.raf = this.tm = 0; this.chain = false;
    this.t = this.a = this.lvl = this.tLvl = 0;
  },
  // Следующий кадр — через ms от прошлого, но ровно на обновлении экрана. Голый таймер ложится между vsync,
  // и кадры шли то через одно, то через два обновления: волна ехала рывками.
  next(ms) {
    this.want = this.drawnAt + ms;
    const wait = this.want - performance.now() - this.vs;
    if (wait <= 2) { this.raf = requestAnimationFrame((t) => this.tick(t)); return; }
    this.tm = setTimeout(() => { this.tm = 0; this.raf = requestAnimationFrame((t) => this.tick(t)); }, wait);
  },
  tick(now) {
    // Период обновления экрана меряем по соседним кадрам (пропущенные кадры не считаем).
    const gap = now - this.tickAt; this.tickAt = now;
    if (this.chain && gap > 3 && gap < this.vs * 1.5) this.vs += (gap - this.vs) * 0.25;
    this.chain = true;
    // Рано больше чем на полкадра — ждём ещё одно обновление.
    if (now < this.want - this.vs / 2) { this.raf = requestAnimationFrame((t) => this.tick(t)); return; }
    this.step(now);
    this.chain = !!this.raf && !this.tm;
  },
  step(now) {
    this.raf = 0;
    this.drawnAt = now;
    const dt = Math.min(50, Math.max(1, now - this.last)); this.last = now;
    const f = (tau) => 1 - Math.exp(-dt / tau);
    const tr = this.targetRad();
    if (this.rad < 0) this.rad = tr;
    this.rad += (tr - this.rad) * f(110);
    this.a += (this.t - this.a) * f(this.t > this.a ? 90 : 150);
    this.qx += (this.tqx - this.qx) * f(70); this.qy += (this.tqy - this.qy) * f(70);
    this.cx += (this.tcx - this.cx) * f(70); this.cy += (this.tcy - this.cy) * f(70);
    this.s += (this.ts - this.s) * f(120);
    this.amp += (this.tAmp - this.amp) * f(220);
    this.mix += (this.tMix - this.mix) * f(260);
    // Бит: атака мягкая, чтобы пики громкости (приходят ступеньками) не дёргали высоту волны; спад медленный.
    this.lvl += (this.tLvl - this.lvl) * f(this.tLvl > this.lvl ? 80 : 260);
    if (this.lvl < 0.004 && !this.tLvl) this.lvl = 0;
    if (this.live) this.ph += dt * 0.0055; // волна бежит с постоянной скоростью
    this.ph2 += dt * 0.0012; // медленное «дыхание» периметра идёт всегда
    if (this.a < 0.05 && this.t === 0) this.a = 0;
    this.draw(now);
    // Глазки покачиваются под музыку здесь, а не CSS-анимацией: та крутится на частоте монитора.
    const bob = Eyes.el.classList.contains('bob');
    if (bob) Eyes.el.style.translate = `0 ${(-0.8 + 0.8 * Math.cos(now * 0.00449)).toFixed(2)}px`;
    else if (Eyes.el.style.translate) Eyes.el.style.translate = '';
    const zzz = Eyes.sleeping && isl.classList.contains('show-eyes') && !App.expanded;
    if (zzz) Eyes.zzz(now);
    const pullDone = this.t === 0 ? this.a === 0 : Math.abs(this.t - this.a) < 0.05 && Math.abs(this.tqx - this.qx) + Math.abs(this.tqy - this.qy) < 0.4 && Math.abs(this.ts - this.s) < 0.3;
    const waveDone = Math.abs(this.tAmp - this.amp) < 0.02 && Math.abs(this.tMix - this.mix) < 0.01 && Math.abs(tr - this.rad) < 0.1;
    const busy = this.live || this.lvl || !pullDone || !waveDone;
    // В покое только «дыхание» в доли пикселя: ~20 кадров/с хватает; во сне 25 кадров/с ради «z z»,
    // а без них реже; в скрытом окне почти стоим.
    const ms = document.hidden ? 1000 : busy ? FRAME : zzz ? 33 : Eyes.sleeping ? 125 : 50;
    this.next(ms);
  },
  targetRad() {
    const r = parseFloat(isl.style.getPropertyValue('--r')) || 16;
    return Math.min(r, isl.offsetWidth / 2, isl.offsetHeight);
  },
  draw(now = performance.now()) {
    const fill = $('#gooPath'), line = $('#gooLine');
    const w = isl.offsetWidth, h = isl.offsetHeight;
    const r = Math.max(0, Math.min(this.rad, w / 2, h));
    const x0 = r, x1 = w - r, span = x1 - x0;
    const k = 2 * Math.PI / (App.expanded ? 56 : 21);   // частая волна под музыку, шаг как у Island
    const kl = 2 * Math.PI / Math.max(70, span * 0.7);  // ленивые изгибы в покое
    // Под музыку высота волны прыгает под бит: в тишине почти ровная линия, на ударе до ~16 px от гребня до впадины.
    // Если пика нет (не пришёл) — мягко «дышит».
    const beat = this.live && now - this.lvlAt < 1500;
    const amp = this.amp * (beat ? 0.2 + 1.6 * this.lvl : this.live ? 0.35 + 0.08 * Math.sin(now * 0.0031) : 1);
    // На громких местах вся волна ещё и чуть опускается — гребни уходят ниже кромки капсулы.
    const sink = beat && !App.expanded ? amp * 0.5 * this.mix : 0;
    const mix = this.mix, pull = this.a, s2 = 2 * this.s * this.s;
    const fine = App.expanded ? 4 : 2;
    // Волна «дыхания» бежит по всему периметру; наружу, чтобы у плеч не было щелей.
    const idleAmp = App.expanded ? 1.4 : 0.9, ks = 2 * Math.PI / 60, ph2 = this.ph2;
    let d = '', l = '', sAcc = 0, px0 = 0, py0 = -2;
    // Точка контура (x, y) с внешней нормалью (nx, ny): сдвигаем её к курсору и, если это низ, волной.
    const pt = (x, y, nx, ny, bottom) => {
      sAcc += Math.hypot(x - px0, y - py0); px0 = x; py0 = y;
      // Верх прижат к экрану: у верхнего края дыхание затухает.
      // У открытой панели бока прямые, как у Island: дышат только низ и углы.
      const top = Math.max(0, Math.min(1, App.expanded ? (y - (h - r - 24)) / 24 : (y - 2) / 10));
      let off = idleAmp * (0.5 + 0.5 * Math.sin(sAcc * ks - ph2)) * top * top * (3 - 2 * top);
      if (bottom && span > 20) {
        const u = x - x0, e = Math.min(1, u / 12, (x1 - x) / 12), taper = e * e * (3 - 2 * e);
        // У открытой панели, как у Island, в покое ровная синусоида; у капсулы — ленивые изгибы.
        // Обе гармоники изгибов едут в одну сторону с одной скоростью: форма плывёт целиком, а не колышется.
        const lazy = App.expanded ? Math.sin(u * k - ph2 * 1.5)
          : Math.sin(u * kl + 0.9 - ph2 * 0.5) * 0.7 + Math.sin(u * kl * 2.3 + 2.2 - ph2 * 1.15) * 0.3;
        // Форма как у Island: почти синус, но впадины чуть острее гребней. Кончик чуть скруглён:
        // острый излом между точками контура на бегу то попадал в точку, то нет, и глубина мерцала.
        const th = u * k - this.ph, sn = Math.sin(th / 2), sa = (Math.sqrt(sn * sn + 0.03) - 0.1732) / 0.8417;
        const cusp = 0.55 * Math.cos(th) + 0.45 * (1 - 2 * sa);
        off += (sink + amp * (1 + lazy * (1 - mix) + cusp * mix)) * taper;
      }
      let px = x + nx * off, py = y + ny * off;
      if (pull) {
        const g = pull * Math.exp(-((x - this.qx) ** 2 + (y - this.qy) ** 2) / s2);
        if (g > 0.02) {
          // Выгибаемся по нормали и лишь слегка в сторону курсора: сильный увод к нему стягивает точки в остриё.
          let vx = this.cx - x, vy = this.cy - y; const vl = Math.hypot(vx, vy) || 1;
          vx = nx + 0.3 * vx / vl; vy = ny + 0.3 * vy / vl; const n = Math.hypot(vx, vy) || 1;
          px += g * vx / n; py += g * vy / n;
        }
      }
      d += `${d ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(2)}`;
      if (bottom) l += `${l ? 'L' : 'M'}${px.toFixed(1)} ${(py + 0.9 * ny).toFixed(2)}`;
    };
    // Левый бок сверху вниз, левый угол, низ, правый угол, правый бок снизу вверх.
    for (let y = -2; y < h - r; y += 4) pt(0, y, -1, 0);
    const arcN = Math.max(4, Math.ceil(r / 2.5));
    for (let i = 0; i <= arcN; i++) { const t = Math.PI - (i / arcN) * Math.PI / 2; pt(x0 + Math.cos(t) * r, h - r + Math.sin(t) * r, Math.cos(t), Math.sin(t)); }
    for (let x = x0 + fine; x < x1; x += fine) pt(x, h, 0, 1, true);
    for (let i = 0; i <= arcN; i++) { const t = Math.PI / 2 - (i / arcN) * Math.PI / 2; pt(x1 + Math.cos(t) * r, h - r + Math.sin(t) * r, Math.cos(t), Math.sin(t)); }
    for (let y = h - r; y > -2; y -= 4) pt(w, y, 1, 0);
    d += `L${w} -2Z`;
    fill.setAttribute('d', d);
    // Подсветка и содержимое капсулы обрезаются по тому же контуру — без «прямоугольника внутри».
    if (!App.expanded) $('#gooClipPath').setAttribute('d', d);
    line.setAttribute('d', l);
    const g = $('#edgeG');
    g.setAttribute('x1', x0); g.setAttribute('x2', x1);
  },
};

// ---------- Панель ----------

function renderTabs() {
  const n = Views.shelf?.items?.length || 0;
  const unread = Views.notifs?.unread() || 0;
  const cnt = (id) => (id === 'shelf' && n ? `<span class="cnt">${n}</span>` : id === 'notifs' && unread ? `<span class="cnt new">${unread > 99 ? '99+' : unread}</span>` : '');
  const html = TABS.map(([id, ic, title]) => `<button class="tab${id === App.tab ? ' on' : ''}" data-tab="${id}" title="${title}">${icon(ic, 18)}<span class="lbl">${title}</span>${cnt(id)}</button>`).join('');
  setHTML($('#tabs'), html);
}

function showTab(tab, opts = {}) {
  tab = TAB_ALIAS[tab] || tab;
  if (App.tab && App.tab !== tab) Views[App.tab]?.leave?.();
  App.tab = tab;
  if (tab !== 'command') { App.lastTab = tab; try { localStorage.lastTab = tab; } catch {} }
  isl.classList.toggle('cmd-mode', tab === 'command');
  $$('.view').forEach((v) => v.classList.toggle('on', v.dataset.view === tab));
  renderTabs();
  setSize(PANEL_W, PANEL_H[tab] || 400, 30);
  panelEdge();
  Views[tab]?.enter?.(opts);
}

let closeT = 0, dwellT = 0;
function openPanel(tab, opts = {}) {
  tab = TAB_ALIAS[tab] || tab;
  if (!tab) tab = App.timers.length && !playing() ? 'notes' : 'home';
  clearTimeout(closeT); clearTimeout(dwellT);
  if (toastCur?.hud) { toastCur = toastBack; toastBack = null; clearTimeout(toastT); }
  App.expanded = true;
  isl.classList.add('expanded');
  isl.classList.remove('hover', 'press', 'dragging');
  Goo.near(null);
  Eyes.wide(false);
  tracking();
  showTab(tab, opts);
  if (opts.focus) api.invoke('win-focus', true);
  // При перетаскивании файла не закрываемся по таймеру — иначе полка уедет посреди переноса.
  else if (!opts.drag && !document.hasFocus() && !App.pinned) closeT = setTimeout(() => { if (!isl.classList.contains('hover-in') && !App.pinned) closePanel(); }, 4000);
}

function closePanel(restore = true) {
  if (!App.expanded) return;
  clearTimeout(closeT);
  App.pinned = false;
  $('#pinBtn').classList.remove('on');
  Views[App.tab]?.leave?.();
  App.expanded = false;
  App.tab = null;
  isl.classList.remove('expanded', 'cmd-mode');
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  api.invoke('win-focus', false, restore && document.hasFocus());
  render();
}

// ---------- Звук уведомлений ----------

let actx = null;
function beep(times = 2) {
  try {
    actx = actx || new AudioContext();
    const t0 = actx.currentTime + 0.02;
    for (let i = 0; i < times; i++) {
      const o = actx.createOscillator(), g = actx.createGain(), t = t0 + i * 0.22;
      o.type = 'sine';
      o.frequency.value = i % 2 ? 1175 : 880;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g).connect(actx.destination);
      o.start(t); o.stop(t + 0.22);
    }
  } catch {}
}

// Звук таймера и напоминания: встроенный писк, звук Windows или свой WAV (путь из настроек).
let alertAudio = null;
function alertSound(times = 2, src = App.settings.alertSound || 'beep') {
  if (src === 'none') return;
  if (src === 'beep') { beep(times); return; }
  try {
    alertAudio?.pause();
    alertAudio = new Audio(fileUrl(src));
    alertAudio.play().catch(() => beep(times));
  } catch { beep(times); }
}

// ---------- Громкость колесом по капсуле ----------

let volBusy = false, volPending = 0;
async function wheelVolume(delta) {
  volPending += delta;
  if (volBusy) return;
  volBusy = true;
  try {
    while (volPending) {
      const d = volPending; volPending = 0;
      const v = await api.invoke('vol-set', { delta: d });
      hud('vol', v.level * 100, v.muted);
    }
  } catch {} finally { volBusy = false; }
}

// ---------- Файлы, брошенные на остров ----------

function dropPaths(e) {
  return [...(e.dataTransfer?.files || [])].map((f) => api.pathOf(f)).filter(Boolean);
}

async function addToShelf(paths) {
  const items = await api.invoke('shelf-add', paths);
  Views.shelf?.set?.(items);
  // Бросили прямо в открытую полку — файлы и так видно.
  if (App.expanded && App.tab === 'shelf') { Eyes.happy(); return; }
  const n = paths.length;
  toast({
    text: n === 1 ? 'На полке' : `На полке: ${n}`, sub: n === 1 ? paths[0].split(/[\\/]/).pop() : '',
    left: iconSpan('shelf', '#8fc2ff'), happy: true, ms: 2200, click: () => openPanel('shelf', { focus: true }),
  });
}

// ---------- События главного процесса ----------

function wire() {
  api.on('open', (o) => {
    const { tab, ...extra } = o || {};
    if (App.expanded && App.tab === tab) closePanel(true);
    else openPanel(tab, extra);
  });
  api.on('blur', () => { if (App.expanded && !App.pinned) closePanel(false); });
  api.on('hover', (h) => {
    isl.classList.toggle('hover', h && !App.expanded);
    isl.classList.toggle('hover-in', h);
    clearTimeout(dwellT);
    if (h) {
      clearTimeout(closeT);
      // Мышь задержалась на капсуле — раскрываемся сами, как Island.
      // Карточка ждёт ответа — не раскрываемся поверх её кнопок.
      if (!App.expanded && App.settings.hoverOpen !== false && !toastCur?.sticky) {
        dwellT = setTimeout(() => { if (isl.classList.contains('hover-in') && !isl.classList.contains('press') && !App.expanded) openPanel(); }, 650);
      }
    } else if (App.expanded && !App.pinned) {
      // Мышь ушла с открытого нотча — сворачиваемся.
      clearTimeout(closeT);
      closeT = setTimeout(() => { if (!isl.classList.contains('hover-in') && !App.pinned) closePanel(); }, 350);
    }
  });
  api.on('near', (p) => Goo.near(p));
  api.on('level', (v) => Goo.beat(v));
  // Тащат файл где угодно в Windows — выкатываем Полку, чтобы было куда бросить.
  api.on('file-drag', (on) => {
    if (on) {
      if (App.expanded) return;
      App.dragOpen = true;
      openPanel('shelf', { drag: true });
      Views.shelf?.dropZone?.(true);
    } else if (App.dragOpen) {
      App.dragOpen = false;
      Views.shelf?.dropZone?.(false);
      // Бросили мимо острова — убираем полку; над островом закроется обычным уходом мыши.
      clearTimeout(closeT);
      closeT = setTimeout(() => { if (!isl.classList.contains('hover-in') && !App.pinned) closePanel(false); }, 400);
    }
  });
  api.on('vol', (v) => hud('vol', v.level * 100, v.muted));
  api.on('bright', (b) => hud('bright', b.level));
  api.on('dl-progress', (d) => { App.dl = d; render(); });
  api.on('drag-near', (on) => {
    if (App.expanded) return;
    isl.classList.toggle('dragging', on);
    Eyes.wide(on);
  });
  api.on('cursor', (p) => Eyes.look(p.x, p.y));
  api.on('idle', (s) => Eyes.sleep(s === 'sleep'));
  // Игра на весь экран: остров замирает — ни кадров, ни моргания, ни CSS-анимаций.
  api.on('freeze', (on) => {
    if (on === !!App.frozen) return;
    App.frozen = on;
    isl.classList.toggle('frozen', on);
    if (on) { clearTimeout(Eyes.blinkT); Goo.stop(); } else { Eyes.schedule(); Goo.kick(); }
    tracking();
  });
  api.on('settings', (s) => {
    const was = App.settings;
    App.settings = s;
    Eyes.setStyle(s.eyes);
    musicStyle = null;
    if (s.pill?.weather !== was.pill?.weather || s.weather?.city !== was.weather?.city) { Pill.weather = null; Pill.load(); }
    render();
  });
  api.on('tuck', (on) => { App.tuck = on; render(); });

  let coverSrc = '';
  api.on('media', (m) => {
    App.media = m;
    const src = m?.thumb || '';
    if (src !== coverSrc) { coverSrc = src; coverTint(src); }
    if (App.expanded) panelEdge();
    render();
  });
  api.on('timers', (list) => { App.timers = list; render(); });
  api.on('timer-done', (t) => {
    alertSound(3);
    // Карточка висит и светится, пока на неё не ответят (но не дольше 10 минут).
    toast({
      big: true, live: true, sticky: true, alert: true, text: t.label || 'Время вышло', sub: t.label ? 'Таймер · ' + T.clock(t.total) : 'Таймер', ms: 10 * 60e3, edge: '#ffb340',
      left: `<div class="live-ic round" style="--c:#ffb340">${icon('time', 20)}</div>`,
      right: `<button class="live-btn" data-act="more">+1 мин</button><button class="live-round white" data-act="ok">${icon('check', 18)}</button>`, side: 140,
      acts: { more: () => api.invoke('timer-start', 60, t.label || ''), ok() {} },
    });
  });
  api.on('reminder', (r) => {
    alertSound(2);
    // Как у Island: колокольчик, текст, «+10 мин» и белая галочка; низ бежит янтарной волной.
    toast({
      big: true, live: true, sticky: true, alert: true, text: r.text, sub: 'Напоминание', ms: 10 * 60e3, edge: '#ffb340',
      left: `<div class="live-ic round" style="--c:#ffb340">${icon('bell', 20)}</div>`,
      right: `<button class="live-btn" data-act="snooze">+10 мин</button><button class="live-round white" data-act="ok">${icon('check', 18)}</button>`, side: 150,
      w: Math.min(520, Math.max(400, bigWidth(r.text, 'Напоминание') + 74 + 166)),
      acts: { snooze: () => api.invoke('reminder-add', { text: r.text, at: Date.now() + 10 * 60e3 }), ok() {} },
    });
  });

  api.on('indicator', (i) => {
    if (i.kind === 'caps') toast({ text: i.on ? 'Caps Lock' : 'Caps Lock выкл', left: `<span class="dot" style="background:${i.on ? 'var(--green)' : 'var(--faint)'};box-shadow:none"></span>`, ms: 1200 });
    else if (i.kind === 'layout') toast({ text: i.value, w: 110, ms: 900 });
  });

  let batPrev = null;
  api.on('battery', (b) => {
    App.battery = b;
    render();
    if (!b || b.percent == null) return;
    if (App.settings.indicators?.battery !== false) {
      if (b.plugged) toast({ text: `Заряжается · ${b.percent}%`, left: iconSpan('bolt', 'var(--green)'), ms: 2500 });
      else if (batPrev && !b.charging && [20, 10, 5].some((t) => batPrev.percent > t && b.percent <= t)) {
        toast({ text: `Батарея ${b.percent}%`, sub: 'подключи зарядку', left: iconSpan('bolt', 'var(--red)'), ms: 5000 });
      }
    }
    batPrev = b;
  });

  api.on('vpn', (on) => {
    if (App.vpn != null && on !== App.vpn && App.settings.indicators?.vpn !== false) {
      if (on) {
        toast({
          big: true, vpn: true, text: 'VPN подключён', sub: 'Трафик идёт через защищённый туннель', ms: 3500, edge: 'var(--green)', w: 400,
          left: `<button class="live-ic round" data-act="vpnToggle" title="Отключить VPN" style="--c:var(--green)">${icon('shield', 20)}</button>`,
        });
      } else toast({ text: 'VPN отключён', left: `<button class="ind" data-act="vpnToggle" title="Включить VPN" style="color:var(--dim)">${icon('shield', 16)}</button>`, ms: 2000 });
    }
    App.vpn = on;
  });
  // Через пару секунд приходят страна, IP и протокол — дописываем их в ту же карточку.
  api.on('vpn-info', (v) => {
    const sub = [v.country, v.ip, v.proto].filter(Boolean).join(' · ');
    if (!sub || App.settings.indicators?.vpn === false || (toastCur && !toastCur.vpn)) return;
    toast({
      big: true, vpn: true, text: 'VPN подключён', sub, ms: 4000, edge: 'var(--green)',
      w: Math.min(480, Math.max(360, bigWidth('VPN подключён', sub) + 74 + 34)),
      left: `<button class="live-ic round" data-act="vpnToggle" title="Отключить VPN" style="--c:var(--green)">${icon('shield', 20)}</button>`,
    });
  });

  api.on('download', (d) => {
    App.dl = null;
    toast({
      big: true, text: 'Загружено', sub: d.name + (d.size ? ' · ' + fmtSize(d.size) : ''), ms: 5000, happy: true, edge: 'var(--green)',
      left: `<div class="live-ic">${d.icon ? `<img src="${d.icon}">` : icon('download', 20)}</div>`,
      right: `<span class="live-round" title="Показать в папке">${icon('folder', 16)}</span>`,
      click: () => api.invoke('show-path', d.path),
    });
  });

  // Уведомление из Windows: иконка приложения, заголовок, ниже «приложение · текст».
  api.on('win-notif', (n) => {
    const sub = [n.app, n.body].filter(Boolean).join(' · ');
    toast({
      big: true, text: n.title, sub, ms: 6000, edge: 'rgba(255,255,255,.35)',
      w: Math.min(520, Math.max(340, bigWidth(n.title, sub) + 74 + 30)),
      left: `<div class="live-ic">${n.icon ? `<img src="${n.icon}">` : icon('bell', 20)}</div>`,
      click: () => api.invoke('notif-open', n.id),
    });
  });

  let claudeT = 0;
  api.on('claude', (c) => {
    clearTimeout(claudeT);
    if (c.event === 'UserPromptSubmit') {
      App.claude = { project: c.project };
      claudeT = setTimeout(() => { App.claude = null; render(); }, 15 * 60e3);
      render();
    } else if (c.event === 'Notification') {
      App.claude = null;
      // Вопрос уже висит на острове — второе «ждёт тебя» поверх него не нужно.
      if (ClaudeAsk.list.length) { render(); return; }
      beep(1);
      toast({ text: 'Claude ждёт тебя', sub: c.project, left: iconSpan('bell', '#d97757'), ms: 7000, edge: '#d97757' });
    } else if (c.event === 'Stop') {
      App.claude = null;
      toast({ text: 'Claude закончил', sub: c.project, left: iconSpan('check', 'var(--green)'), ms: 5000, happy: true, edge: 'var(--green)' });
    }
  });

  // Claude Code спрашивает: разрешить инструмент или выбрать вариант. Висит, пока не ответят.
  api.on('claude-ask', (q) => {
    if (q.done) { ClaudeAsk.drop(q.id); return; }
    ClaudeAsk.add(q);
  });
  api.invoke('claude-asks').then((l) => { for (const q of l || []) ClaudeAsk.add(q); }).catch(() => {});

  api.on('toast', (t) => {
    if (t.clipImg) {
      // Картинка скопирована: превью слева, размеры и откуда — ниже. Клик — история буфера.
      const sub = [t.dims, t.app].filter(Boolean).join(' · ');
      toast({
        big: true, h: 76, w: Math.min(440, Math.max(340, textWidth(sub) + 90 + 30)), leftSide: 90, side: 24, ms: 3500, happy: true, edge: 'var(--green)',
        left: `<div class="clip-prev" style="background-image:url('${t.clipImg}')"></div>`,
        html: `Картинка скопирована${sub ? `<span class="sub">${T.esc(sub)}</span>` : ''}`,
        click: () => openPanel('clips', { focus: true }),
      });
      return;
    }
    if (t.clipText != null || t.clipFiles) {
      // Текст или файлы скопированы: короткая плашка сверху, клик — история буфера.
      const n = t.clipFiles;
      const text = n ? (n > 1 ? `Скопировано файлов: ${n}` : 'Файл скопирован') : 'Текст скопирован';
      const sub = n ? t.app : t.clipText.length > 28 ? t.clipText.slice(0, 27) + '…' : t.clipText;
      toast({
        text, sub, left: iconSpan('copy', 'var(--green)'), ms: 2200, happy: true, edge: 'var(--green)',
        click: () => openPanel('clips', { focus: true }),
      });
      return;
    }
    if (t.shot && t.path) {
      // Карточка скриншота: превью (можно утащить в чат или папку), кнопки «изменить» и «в папке».
      toast({
        big: true, h: 116, r: 30, w: 470, leftSide: 196, side: 70, ms: 7000, happy: true, edge: 'var(--green)',
        left: `<div class="shot-prev" draggable="true" data-drag="${T.esc(t.path)}" style="background-image:url('${fileUrl(t.path)}')"></div>`,
        html: `Скриншот готов<span class="sub">${t.saved ? 'В буфере и в папке' : 'В буфере'}${t.dims ? ' · ' + t.dims : ''}</span><span class="sub faint">Перетащи превью в чат или папку</span>`,
        right: `<div class="col"><button class="live-round white" data-act="edit" title="Изменить">${icon('pen', 16)}</button><button class="live-round" data-act="folder" title="Показать в папке">${icon('folder', 16)}</button></div>`,
        acts: { edit: () => api.invoke('edit-image', t.path), folder: () => api.invoke('show-path', t.path) },
        click: () => api.invoke('open-path', t.path),
      });
      return;
    }
    if (t.color) {
      // Карточка пипетки: образец, HEX «в буфере», rgb() и последние цвета.
      const hex = t.color.toUpperCase(), [r, g, b] = hexRgb(hex);
      const i = colorHist.indexOf(hex); if (i >= 0) colorHist.splice(i, 1);
      colorHist.unshift(hex); colorHist.length = Math.min(colorHist.length, 5);
      const sw = colorHist.slice(1).map((c) => `<i style="background:${c}"></i>`).join('');
      toast({
        big: true, h: 100, w: 400, leftSide: 92, side: 70, ms: 6000, happy: true, edge: 'var(--green)',
        left: `<div class="swatch" style="background:${hex}"></div>`,
        html: `${hex} <span class="ok">в буфере</span><span class="sub mono">rgb(${r}, ${g}, ${b})</span>${sw ? `<span class="sub sw">${sw}</span>` : ''}`,
        right: `<button class="live-round" data-act="copy" title="Копировать rgb()">${icon('copy', 16)}</button>`,
        acts: { copy: () => api.invoke('text-copy', `rgb(${r}, ${g}, ${b})`) },
      });
      return;
    }
    let left;
    if (t.busy) left = '<span class="spin"></span>';
    else if (t.color) left = `<span class="dot" style="background:${T.esc(t.color)};box-shadow:none;width:14px;height:14px"></span>`;
    else if (t.error) left = iconSpan('x', 'var(--red)');
    else left = iconSpan('check', 'var(--green)');
    toast({
      text: t.text, left, ms: t.busy ? 30000 : t.error ? 3500 : 2400, happy: !t.error && !t.busy,
      edge: t.error ? 'var(--red)' : t.busy ? null : 'var(--green)',
      click: t.path ? () => api.invoke('show-path', t.path) : null,
    });
  });
  api.on('ocr-result', (r) => {
    toast({
      text: 'Текст скопирован', sub: r.text.replace(/\s+/g, ' ').slice(0, 40), left: iconSpan('text', '#8fc2ff'),
      ms: 5000, happy: true, click: () => openPanel('text', { focus: true, text: r.text }),
    });
  });
  api.on('qr-result', (r) => {
    const url = /^https?:\/\//i.test(r.text);
    toast({
      text: url ? 'QR: открыть ссылку' : 'QR скопирован', sub: r.text.slice(0, 50), left: iconSpan('qr', '#8fc2ff'), ms: 6000, happy: true,
      click: url ? () => api.invoke('open-url', r.text) : () => openPanel('text', { focus: true, text: r.text }),
    });
  });
}

// ---------- Вопросы Claude Code ----------

// Очередь: на острове всегда первый вопрос, остальные ждут. Ответ уходит в хук через main.
const ClaudeAsk = {
  list: [], st: {},
  add(q) {
    if (!q?.id || this.list.some((x) => x.id === q.id)) return;
    this.list.push(q);
    this.st[q.id] = { i: 0, sel: new Set(), answers: {} };
    alertSound(1);
    if (this.list.length === 1) this.show(q);
  },
  drop(id) {
    this.list = this.list.filter((x) => x.id !== id);
    delete this.st[id];
    toastDrop((o) => o.askId === id);
    if (this.list[0] && toastCur?.askId !== this.list[0].id) this.show(this.list[0]);
  },
  answer(id, ans) {
    api.invoke('claude-answer', id, ans).catch(() => {});
    this.drop(id);
  },
  show(q) {
    const st = this.st[q.id];
    if (!st) return;
    const esc = T.esc, more = this.list.length > 1 ? ` <span class="ok">+${this.list.length - 1}</span>` : '';
    const term = `<button class="x-pill" data-act="term" title="Ответить в терминале">${icon('x', 13)}</button>`;
    const base = {
      big: true, sticky: true, alert: true, keep: true, askId: q.id, ms: 10 * 60e3, edge: '#d97757',
      left: `<div class="live-ic round" style="--c:#d97757">${icon('cmd', 20)}</div>`,
    };
    let o;
    if (q.kind === 'perm') {
      o = {
        ...base, w: 480, h: q.detail ? 92 : 72, side: 176,
        html: `Claude: ${esc(q.tool || 'инструмент')}${more}<span class="sub">${esc(q.project || 'Хочет выполнить действие')}</span>${q.detail ? `<span class="sub mono cc-det">${esc(q.detail)}</span>` : ''}`,
        right: `${term}<button class="live-btn" data-act="no">Нет</button><button class="live-round white" data-act="yes" title="Разрешить">${icon('check', 18)}</button>`,
        acts: {
          yes: () => this.answer(q.id, { behavior: 'allow' }),
          no: () => this.answer(q.id, { behavior: 'deny' }),
          term: () => this.answer(q.id, { behavior: 'terminal' }),
        },
      };
    } else {
      const qq = q.questions?.[st.i];
      if (!qq) { this.answer(q.id, { behavior: 'terminal' }); return; }
      const n = q.questions.length, side = qq.multi ? 100 : 52, w = 540;
      const chips = qq.options.map((x, k) => `<button class="cc-opt${st.sel.has(k) ? ' on' : ''}" data-act="o${k}" title="${esc(x.description)}">${esc(x.label)}</button>`).join('');
      // Сколько рядов займут варианты — от этого высота карточки.
      const room = w - 74 - side, need = qq.options.reduce((s, x) => s + textWidth(x.label) + 30, 0);
      const rows = Math.min(3, Math.max(1, Math.ceil(need / room)));
      const acts = { term: () => this.answer(q.id, { behavior: 'terminal' }), done: () => this.next(q) };
      qq.options.forEach((x, k) => {
        acts['o' + k] = () => {
          if (!qq.multi) { st.sel = new Set([k]); this.next(q); return; }
          if (st.sel.has(k)) st.sel.delete(k); else st.sel.add(k);
          this.show(q);
        };
      });
      o = {
        ...base, w, h: 84 + rows * 34, side,
        html: `${esc(qq.header || 'Claude спрашивает')}${n > 1 ? ` <span class="ok">${st.i + 1}/${n}</span>` : ''}${more}<span class="sub cc-q">${esc(qq.question)}</span><span class="cc-opts">${chips}</span>`,
        right: qq.multi ? `<div class="col">${term}<button class="live-round white" data-act="done" title="Готово">${icon('check', 18)}</button></div>` : term,
        acts,
      };
    }
    // Та же карточка перерисовывается на месте, а не уходит в «запас».
    if (toastCur?.askId === q.id) toastCur = null;
    toast(o);
  },
  next(q) {
    const st = this.st[q.id], qq = q.questions[st.i];
    const labels = [...st.sel].sort((a, b) => a - b).map((k) => qq.options[k].label);
    if (!labels.length) return;
    st.answers[qq.question] = labels.join(', ');
    st.i++; st.sel = new Set();
    if (st.i < q.questions.length) this.show(q);
    else this.answer(q.id, { answers: st.answers });
  },
};

// ---------- Мышь и клавиатура ----------

function wireDom() {
  const compact = $('#compact');
  compact.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]');
    if (a) {
      const own = toastCur?.acts?.[a.dataset.act];
      // keep: карточка сама решает, когда уйти (вопросы Claude, выбор нескольких вариантов).
      if (own) { if (!toastCur.keep) toastEnd(); own(); } else ACTS[a.dataset.act]?.();
      return;
    }
    if (toastCur?.click) { const f = toastCur.click; toastEnd(); f(); return; }
    if (toastCur?.keep) return;
    openPanel('home', { focus: true });
  });
  compact.addEventListener('mousedown', (e) => { if (e.button === 0 && !e.target.closest('[data-act], [data-drag]')) { isl.classList.add('press'); clearTimeout(dwellT); } });
  // Превью скриншота тащится в любое окно как настоящий файл.
  compact.addEventListener('dragstart', (e) => {
    const d = e.target.closest('[data-drag]');
    if (!d) return;
    e.preventDefault();
    api.send('shelf-drag', [d.dataset.drag]);
  });
  $('#pinBtn').innerHTML = icon('pinf', 17);
  $('#setBtn').innerHTML = icon('toggles', 19);
  // Остров меняет размер с анимацией — волна снизу перерисовывается каждый кадр вместе с ним.
  new ResizeObserver(() => Goo.kick()).observe(isl);
  $('#pinBtn').onclick = () => {
    App.pinned = !App.pinned;
    $('#pinBtn').classList.toggle('on', App.pinned);
    $('#pinBtn').title = App.pinned ? 'Открепить панель' : 'Закрепить панель';
    if (App.pinned) clearTimeout(closeT);
  };
  $('#setBtn').onclick = () => { closePanel(false); api.invoke('open-settings'); };
  window.addEventListener('mouseup', () => isl.classList.remove('press'));
  compact.addEventListener('contextmenu', (e) => { e.preventDefault(); api.invoke('open-settings'); });
  // Колесо: над временем таймера — ±минута, в остальном капсуле — громкость.
  let wheelT = 0;
  compact.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (App.timerShown && !toastCur && e.target.closest('#cRight')) {
      if (Date.now() - wheelT < 90) return;
      wheelT = Date.now();
      api.invoke('timer-add', App.timerShown, e.deltaY < 0 ? 60 : -60);
      return;
    }
    wheelVolume(e.deltaY < 0 ? 0.04 : -0.04);
  }, { passive: false });

  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) showTab(b.dataset.tab);
  });

  // Окно не берёт фокус само — просим его, когда тыкают в панель.
  document.addEventListener('mousedown', (e) => {
    if (!App.expanded || document.hasFocus()) return;
    const el = e.target.closest('input, textarea');
    api.invoke('win-focus', true).then(() => el?.focus());
  });

  document.addEventListener('keydown', (e) => {
    if (!App.expanded) return;
    if (e.key === 'Escape') {
      if (Views[App.tab]?.key?.(e)) return;
      e.preventDefault(); closePanel(true); return;
    }
    if (e.ctrlKey && e.key === 'Tab' && App.tab !== 'command') {
      e.preventDefault();
      const ids = $$('.tab').map((b) => b.dataset.tab);
      const i = ids.indexOf(App.tab);
      showTab(ids[(i + (e.shiftKey ? -1 : 1) + ids.length) % ids.length]);
      return;
    }
    Views[App.tab]?.key?.(e);
  });

  // Перетаскивание файлов на остров.
  document.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
  document.addEventListener('dragenter', () => { if (!App.expanded) { isl.classList.add('dragging'); Eyes.wide(true); } });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) { isl.classList.remove('dragging'); Eyes.wide(false); } });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    isl.classList.remove('dragging'); Eyes.wide(false);
    const paths = dropPaths(e);
    if (paths.length) addToShelf(paths);
  });

  // Иконки-заглушки <i data-i="…">.
  for (const el of $$('[data-i]')) el.innerHTML = icon(el.dataset.i, 22);
}

// ---------- Запуск ----------

async function init() {
  isl = $('#island'); cLeft = $('#cLeft'); cRight = $('#cRight'); cText = $('#cText');
  try { App.lastTab = TAB_ALIAS[localStorage.lastTab] || localStorage.lastTab || 'home'; } catch {}
  Eyes.init();
  wireDom();
  wire();
  const st = await api.invoke('state');
  App.settings = st.settings;
  Eyes.setStyle(App.settings.eyes);
  App.media = st.media;
  App.timers = st.timers || [];
  App.vpn = st.vpn;
  App.battery = st.battery || null;
  for (const v of Object.values(Views)) { try { v.init?.(st); } catch (e) { console.error(e); } }
  if (st.idle === 'sleep') Eyes.sleep(true);
  Pill.init();
  render();
  // Секундный тик только для часов в капсуле (запись, таймер).
  setInterval(() => { if (!App.expanded && !toastCur && (App.rec || App.dict || App.timers.length)) render(); }, 1000);
}

window.addEventListener('DOMContentLoaded', init);

Object.assign(App, { open: openPanel, close: closePanel, show: showTab, toast, hud, render, renderTabs, beep, alertSound, vpnToggle, addToShelf, dropPaths, iconSpan });
