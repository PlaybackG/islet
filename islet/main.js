// Islet — динамический остров для Windows. Главный процесс.
const {
  app, BrowserWindow, ipcMain, screen, clipboard, ClipboardItem, nativeImage, globalShortcut, Tray, Menu,
  shell, desktopCapturer, session, safeStorage, Notification, dialog,
} = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

// «Islet.exe --quit» (так зовёт деинсталлятор) закрывает уже запущенный остров и сам не стартует.
if (!app.requestSingleInstanceLock() || process.argv.includes('--quit')) { app.quit(); process.exit(0); }

const native = require('./native');
const helper = require('./helper');
const Store = require('./store');
const services = require('./services');
const agents = require('./agents');
const parse = require('./parse');
const { trayIcon } = require('./icon');

app.setAppUserModelId('Islet');

const DATA = app.getPath('userData');
const CLIPS_DIR = path.join(DATA, 'clips');
fs.mkdirSync(CLIPS_DIR, { recursive: true });

// ---------- Журнал сбоев: DATA/islet.log, старый уезжает в islet.old.log после 512 КБ ----------

const LOG = path.join(DATA, 'islet.log');
function logLine(...a) {
  const s = `[${new Date().toISOString()}] ${a.map((x) => (x instanceof Error ? x.stack : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`;
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 512e3) fs.renameSync(LOG, LOG.replace(/\.log$/, '.old.log'));
    fs.appendFileSync(LOG, s);
  } catch {}
}
process.on('uncaughtException', (e) => { logLine('uncaught', e); console.error(e); });
process.on('unhandledRejection', (e) => { logLine('unhandled', e); });

// Ускорение видеокартой отключается до готовности приложения, поэтому настройка читается прямо из файла.
try {
  if (JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')).gpu === false) app.disableHardwareAcceleration();
} catch {}

const DEFAULTS = {
  hotkeys: {
    clips: 'Alt+V', command: 'Alt+Space', chat: 'Alt+Shift+A',
    shot: 'Alt+Shift+S', ocr: 'Alt+Shift+T', color: 'Alt+Shift+C', toggle: 'Alt+Shift+I',
  },
  ai: {
    preset: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', key: '',
    sttBaseUrl: '', sttModel: 'whisper-1', sttKey: '',
    system: 'Ты помощник в динамическом острове на рабочем столе. Отвечай кратко и по делу, на языке вопроса.',
    // терминальные агенты в чате: что им можно (read | edit | all), папка по умолчанию и своя команда
    agentMode: 'read', agentCwd: '', agentCmd: '',
  },
  weather: { city: 'Москва', lat: 55.7558, lon: 37.6173 },
  clip: {
    max: 200,
    exclude: ['keepass.exe', 'keepassxc.exe', '1password.exe', 'bitwarden.exe', 'lastpass.exe', 'enpass.exe'],
  },
  eyes: { enabled: true, dozeMin: 3, follow: true, style: 'nusa', shuffle: 0 },
  hideFullscreen: true,
  autostart: false,
  watchDownloads: true,
  winNotifs: true,
  hideWinBanners: true,
  indicators: { caps: true, layout: true, battery: true, vpn: true, volume: true, brightness: true },
  hoverOpen: true,
  autoHide: false,
  display: '',
  pill: { clock: true, weather: true, battery: true },
  onboarded: false, // мастер первого запуска пройден или закрыт
  searchUrl: 'https://yandex.ru/search/?text=',
  shotDir: path.join(app.getPath('pictures'), 'Islet'),
  recDir: path.join(app.getPath('videos'), 'Islet'),
  mediaPrefer: '',
  searchCustom: '',
  gpu: true,
  playerStyle: 'center', // center — обложка по центру с зеркалом, fill — обложка на весь плеер, compact — прежний
  lyrics: true,
  musicCharacter: 'none', // none | cat | blob — кто живёт на острове, пока играет музыка
  alertSound: 'beep', // beep | none | путь к WAV (звуки Windows или свой)
  alertGlow: true,
  dlStyle: 'card', // card — карточка с именем, ring — маленькое кольцо у часов
  dlIgnore: ['*.tmp', '*.temp', '~*', 'desktop.ini', 'thumbs.db'],
  hideApps: [], // exe, при которых остров прячется
  showApps: [], // exe, при которых остров виден даже с автоскрытием
  islandScale: 100,
  islandOffset: 0,
  ccAsk: true,
};

const settings = new Store(DATA, 'settings', DEFAULTS);
for (const k of ['hotkeys', 'ai', 'weather', 'clip', 'eyes', 'indicators', 'pill']) {
  settings.data[k] = { ...DEFAULTS[k], ...settings.data[k] };
}
const clips = new Store(DATA, 'clips', []);
const shelf = new Store(DATA, 'shelf', []);
const notes = new Store(DATA, 'notes', []);
const reminders = new Store(DATA, 'reminders', []);
const notifs = new Store(DATA, 'notifs', []);
const appIcons = new Store(DATA, 'appicons', {});
const WIN = process.env.SystemRoot || 'C:\\Windows';
const dock = new Store(DATA, 'dock', [
  path.join(WIN, 'explorer.exe'), path.join(WIN, 'System32', 'notepad.exe'),
  path.join(WIN, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  path.join(WIN, 'System32', 'control.exe'), path.join(WIN, 'System32', 'Taskmgr.exe'),
]);
const S = settings.data;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// В Electron 44 буфер обмена асинхронный (ClipboardItem), readImage/writeImage убрали.
const clip = {
  readText: async () => { const t = await clipboard.readText(); return typeof t === 'string' ? t : ''; },
  writeText: (t) => clipboard.writeText(String(t ?? '')),
  async readImage() {
    for (const it of await clipboard.read()) {
      if (!it.types.includes('image/png')) continue;
      const buf = Buffer.from(await (await it.getType('image/png')).arrayBuffer());
      const img = nativeImage.createFromBuffer(buf);
      if (!img.isEmpty()) return img;
    }
    return null;
  },
  writeImage: (img) => clipboard.write([new ClipboardItem({ 'image/png': new Blob([img.toPNG()], { type: 'image/png' }) })]),
};

// ---------- Ключи: шифруются средствами Windows ----------

function encrypt(s) {
  if (!s) return '';
  return safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(s).toString('base64') : s;
}
function decrypt(s) {
  if (!s) return '';
  if (!s.startsWith('enc:')) return s;
  try { return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64')); } catch { return ''; }
}
function aiConfig() {
  return { baseUrl: S.ai.baseUrl, model: S.ai.model, key: decrypt(S.ai.key) };
}
function sttConfig() {
  return {
    baseUrl: S.ai.sttBaseUrl || S.ai.baseUrl,
    key: decrypt(S.ai.sttKey) || decrypt(S.ai.key),
    model: S.ai.sttModel,
  };
}

// Агент получает только новый вопрос, если продолжает свою сессию; иначе — весь разговор текстом.
// resume — сессия Claude Code из терминала: продолжаем её копию (--fork-session) в её же папке.
async function agentChat(id, messages, src) {
  const text = (m) => (typeof m.content === 'string' ? m.content : (m.content || []).filter((p) => p.type === 'text').map((p) => p.text).join('\n'));
  const keeps = src.id === 'claude' || src.id === 'codex';
  let session = keeps && typeof src.session === 'string' ? src.session : '', fork = false;
  let cwd = typeof src.cwd === 'string' && src.cwd ? src.cwd : S.ai.agentCwd;
  if (!session && src.id === 'claude' && agents.UUID.test(src.resume || '')) {
    const s = (await agents.detect()).sessions.find((x) => x.id === src.resume);
    if (s) { session = s.id; fork = true; cwd = s.cwd; }
  }
  const last = messages[messages.length - 1] || { content: '' };
  const prev = messages.slice(0, -1);
  const prompt = session || !prev.length ? text(last)
    : 'Предыдущий разговор:\n' + prev.map((m) => `${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${text(m)}`).join('\n\n') + '\n\nНовое сообщение: ' + text(last);
  const r = await agents.run(id, { agent: src.id, prompt, mode: S.ai.agentMode, session, fork, cwd, command: S.ai.agentCmd },
    (d) => send('ai-delta', { id, text: d }));
  send('ai-done', { id, session: keeps ? r.session : '', cwd });
  return r.text;
}
// ---------- Окна ----------

const W = 840, H = 600;
// Ширина и верх окна острова постоянны, высота — под содержимое (в покое ~100 px вместо 600):
// прозрачное окно GPU перерисовывает целиком. Капсула прижата к верху, так что ресайз её не сдвигает.
let islandH = H;
let island = null, overlay = null, settingsWin = null, tray = null;
let islandHwnd = 0n, overlayHwnd = 0n, settingsHwnd = 0n;

function send(ch, data) {
  if (island && !island.isDestroyed()) island.webContents.send(ch, data);
}

// Монитор острова: основной, выбранный в настройках или тот, где курсор (проверяется раз в секунду).
let cursorDisplayId = null;
function islandDisplay() {
  const all = screen.getAllDisplays();
  const id = S.display === 'cursor' ? cursorDisplayId : S.display ? +S.display : null;
  return (id != null && all.find((d) => d.id === id)) || screen.getPrimaryDisplay();
}

function followCursorDisplay() {
  if (S.display !== 'cursor' || interactive) return;
  const id = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
  if (id !== cursorDisplayId) { cursorDisplayId = id; updateDisplayRect(); placeIsland(); }
}

// Масштаб острова: окно растёт вместе с zoom страницы, CSS-размеры внутри остаются прежними.
const zoom = () => Math.max(0.7, Math.min(1.4, (+S.islandScale || 100) / 100));

function placeIsland() {
  if (!island || island.isDestroyed()) return;
  const b = islandDisplay().bounds, z = zoom();
  const w = Math.round(W * z), off = Math.max(-b.width / 2 + w / 2, Math.min(b.width / 2 - w / 2, +S.islandOffset || 0));
  island.setBounds({ x: Math.round(b.x + (b.width - w) / 2 + off), y: b.y, width: w, height: Math.round(islandH * z) });
}

function applyZoom() {
  if (!island || island.isDestroyed()) return;
  island.webContents.setZoomFactor(zoom());
  placeIsland();
}

// Сторож окна острова: если страница зависла дольше 8 с или её процесс упал — окно пересоздаётся.
let hangTimer = null, recreating = false, lastRecreate = 0;
function recreateIsland(why) {
  if (recreating) return;
  recreating = true;
  lastRecreate = Date.now();
  logLine('island restart:', why);
  clearTimeout(hangTimer); hangTimer = null;
  try { if (island && !island.isDestroyed()) island.destroy(); } catch (e) { logLine('destroy', e); }
  island = null; islandHwnd = 0n; hitRect = null; interactive = false;
  setTimeout(() => {
    recreating = false;
    try { createIsland(); } catch (e) { logLine('create island', e); setTimeout(() => recreateIsland('retry'), 3000); }
  }, 500);
}

function createIsland() {
  island = new BrowserWindow({
    width: W, height: H, frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
    focusable: false, show: false, hasShadow: false, alwaysOnTop: true, backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true,
      backgroundThrottling: false, spellcheck: false,
    },
  });
  island.setAlwaysOnTop(true, 'screen-saver');
  island.setContentProtection(!process.env.ISLET_CAPTURABLE); // остров не попадает на скриншоты и записи
  island.setIgnoreMouseEvents(true, { forward: true });
  placeIsland();
  island.loadFile(path.join(__dirname, 'ui', 'index.html'));
  // Под нагрузкой при входе в Windows ready-to-show может прийти очень поздно — тогда показываем сами.
  const shown = () => { if (!island || island.isDestroyed()) return; applyZoom(); applyVisibility(); if (fsActive) send('freeze', true); };
  const fallback = setTimeout(shown, 6000);
  island.once('ready-to-show', () => { clearTimeout(fallback); shown(); });
  island.on('blur', () => send('blur'));
  island.on('unresponsive', () => {
    clearTimeout(hangTimer);
    // В первую минуту после запуска (ПК ещё грузится) и сразу после перезапуска ждём дольше.
    const wait = process.uptime() < 60 || Date.now() - lastRecreate < 60e3 ? 30000 : 8000;
    hangTimer = setTimeout(() => recreateIsland('unresponsive'), wait);
  });
  island.on('responsive', () => { clearTimeout(hangTimer); hangTimer = null; });
  // При выходе из Windows will-quit может не успеть — баннеры возвращаем здесь.
  island.on('session-end', restoreBanners);
  island.webContents.on('render-process-gone', (e, d) => {
    if (d.reason !== 'clean-exit') recreateIsland('render gone: ' + d.reason);
  });
  islandHwnd = native.handleOf(island);
}

function createOverlay() {
  overlay = new BrowserWindow({
    frame: false, show: false, resizable: false, movable: false, skipTaskbar: true, fullscreenable: false,
    alwaysOnTop: true, hasShadow: false, enableLargerThanScreen: true, backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true,
      backgroundThrottling: false, spellcheck: false,
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.loadFile(path.join(__dirname, 'ui', 'overlay.html'));
  overlayHwnd = native.handleOf(overlay);
}

// Мастер живёт в окне без рамки: полоса заголовка своя и выезжает при наведении на верх, как в Firefox.
// again — мастер открыт из настроек, по окончании он возвращает обычное окно.
function openSettings(section, again) {
  const wizard = section === 'welcome';
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.wizard === wizard) {
      settingsWin.show(); settingsWin.focus();
      if (section) settingsWin.webContents.send('section', section);
      return;
    }
    settingsWin.destroy();
  }
  // Мастер — прозрачное окно: скруглённые углы рисует сама страница, высоту подгоняет под шаг (win-ctl fit),
  // показывается после первой подгонки, чтобы не мигнуть пустым прямоугольником.
  const w = settingsWin = new BrowserWindow({
    width: 760, height: 640, autoHideMenuBar: true, icon: nativeImage.createFromBuffer(trayIcon(64)),
    title: wizard ? 'Islet — первый запуск' : 'Islet — настройки', frame: !wizard,
    ...(wizard ? { transparent: true, backgroundColor: '#00000000', resizable: false, maximizable: false, show: false }
      : { backgroundColor: '#0b0b0d', minWidth: 600, minHeight: 480 }),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  if (wizard) setTimeout(() => { if (!w.isDestroyed() && !w.isVisible()) w.show(); }, 2000);
  w.wizard = wizard;
  w.removeMenu(); // иначе Alt в поле горячих клавиш открывает меню
  w.loadFile(path.join(__dirname, 'ui', 'settings.html'), { hash: section || '', search: again ? 'again' : '' });
  settingsHwnd = native.handleOf(w);
  w.on('closed', () => { if (settingsWin === w) { settingsWin = null; settingsHwnd = 0n; } });
}

// ---------- Видимость: скрытие в полноэкранных приложениях ----------

let userHidden = false, fsActive = false;

function applyVisibility() {
  if (!island) return;
  const visible = !userHidden && !(S.hideFullscreen && fsActive) && !fgHideApp;
  if (visible && !island.isVisible()) { island.showInactive(); island.setAlwaysOnTop(true, 'screen-saver'); }
  else if (!visible && island.isVisible()) { island.hide(); }
}

// Игровой режим: пока впереди полноэкранное окно (игра, видео), остров замирает целиком —
// никаких кадров и опросов, кроме проверки активного окна, чтобы заметить выход из игры.
function setFrozen(on) {
  if (on && island && !island.isDestroyed()) {
    setInteractive(false);
    if (hovering) { hovering = false; send('hover', false); }
    if (dragNear) { dragNear = false; send('drag-near', false); }
    if (nearPt) { nearPt = null; send('near', null); }
  }
  send('freeze', on);
}

let displayPhys = null;
function updateDisplayRect() {
  const d = islandDisplay();
  displayPhys = screen.dipToScreenRect(null, d.bounds);
}

const DESKTOP_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);

function isFullscreen(hwnd) {
  if (!hwnd || hwnd === islandHwnd || hwnd === overlayHwnd) return false;
  const r = native.windowRect(hwnd);
  if (!r || !displayPhys) return false;
  const d = displayPhys;
  if (r.left > d.x || r.top > d.y || r.right < d.x + d.width || r.bottom < d.y + d.height) return false;
  return !DESKTOP_CLASSES.has(native.className(hwnd));
}

// ---------- Опрос активного окна, Caps Lock и раскладки (150 мс) ----------

let lastExternal = 0n, lastFg = 0n, caps = null, layout = null;

function ours(hwnd) {
  return hwnd === islandHwnd || hwnd === overlayHwnd || (settingsHwnd && hwnd === settingsHwnd);
}

// Списки приложений: в hideApps остров прячется, в showApps не уезжает при автоскрытии.
let fgHideApp = false, fgShowApp = false;
const exeList = (a) => (Array.isArray(a) ? a : String(a || '').split(/[,;\n]/)).map((s) => s.trim().toLowerCase()).filter(Boolean)
  .map((s) => (s.endsWith('.exe') ? s : s + '.exe'));
function checkFgApp(fg) {
  const hide = exeList(S.hideApps), show = exeList(S.showApps);
  let h = false, s = false;
  if (hide.length || show.length) {
    const exe = native.processName(fg);
    h = hide.includes(exe); s = show.includes(exe);
  }
  if (s !== fgShowApp) fgShowApp = s;
  if (h !== fgHideApp) { fgHideApp = h; applyVisibility(); }
}

function pollForeground() {
  const fg = native.foreground();
  const fgChanged = fg !== lastFg;
  if (fg && !ours(fg)) lastExternal = fg;
  if (fgChanged) {
    lastFg = fg;
    if (fg && !ours(fg)) checkFgApp(fg);
    const fs2 = isFullscreen(fg);
    if (fs2 !== fsActive) { fsActive = fs2; applyVisibility(); setFrozen(fs2); }
    if (!fsActive && island?.isVisible() && !ours(fg)) island.moveTop();
  }
  const c = native.capsLock();
  if (caps !== null && c !== caps && S.indicators.caps && !fsActive) send('indicator', { kind: 'caps', on: c });
  caps = c;
  const l = native.keyboardLayout();
  // Смена окна тоже меняет раскладку — показываем только настоящее переключение.
  if (layout !== null && l !== layout && !fgChanged && S.indicators.layout && !fsActive) send('indicator', { kind: 'layout', value: l });
  layout = l;
  if (++fgTick % 7 === 0) followCursorDisplay();
}
let fgTick = 0;

// ---------- Курсор: где мышь, наведение, глазки, перетаскивание (30 Гц) ----------

let hitRect = null;          // зона острова в координатах окна (DIP)
let interactive = false, hovering = false, dragNear = false, fileDrag = false;
let eyesOn = false, lastCursor = { x: -1, y: -1 };

function setInteractive(on) {
  if (on === interactive) return;
  interactive = on;
  island.setIgnoreMouseEvents(!on, { forward: true });
}

function pollCursor() {
  if (!island || !island.isVisible() || !hitRect || fsActive) return;
  const p = screen.getCursorScreenPoint();
  const b = island.getBounds(), z = zoom();
  const x = (p.x - b.x) / z, y = (p.y - b.y) / z;
  const down = native.mouseDown();
  const m = down ? 36 : 0;
  const inside = x >= hitRect.x - m && x <= hitRect.x + hitRect.width + m && y >= hitRect.y - m && y <= hitRect.y + hitRect.height + m;
  const strictInside = inside && (m === 0 || (x >= hitRect.x && x <= hitRect.x + hitRect.width && y <= hitRect.y + hitRect.height));
  setInteractive(inside);
  const hov = strictInside && !down;
  if (hov !== hovering) { hovering = hov; send('hover', hov); }
  const dn = inside && down;
  if (dn !== dragNear) { dragNear = dn; send('drag-near', dn); }
  // Начали тащить файл где угодно — выкатываем Полку, чтобы было куда бросить.
  const fd = down && S.dragOpen !== false && (fileDrag || native.fileDragging());
  if (fd !== fileDrag) { fileDrag = fd; send('file-drag', fd); }
  autoHideTick(x, y, down);
  if (eyesOn && !tucked && S.eyes.follow && (Math.abs(p.x - lastCursor.x) > 2 || Math.abs(p.y - lastCursor.y) > 2)) {
    lastCursor = p;
    send('cursor', { x, y });
  }
  // Курсор рядом с нижним краем — край капсулы тянется к нему, как жидкость.
  const near = !down && x > hitRect.x - 90 && x < hitRect.x + hitRect.width + 90 && y < hitRect.height + 100 && y >= -2;
  if (near) {
    if (!nearPt || Math.abs(nearPt.x - x) > 1 || Math.abs(nearPt.y - y) > 1) { nearPt = { x, y }; send('near', nearPt); }
  } else if (nearPt) { nearPt = null; send('near', null); }
}
let nearPt = null;

// Автоскрытие: в покое остров уезжает за верхний край. Выезжает, когда курсор упёрся в край над ним.
// Прячет сам остров (ui), если он в простом виде; музыка, таймер и уведомления остаются на виду.
let tucked = false, awayAt = 0;
function setTucked(on) { if (on !== tucked) { tucked = on; awayAt = 0; send('tuck', on); } }
function autoHideTick(x, y, down) {
  if (!S.autoHide || fgShowApp) { setTucked(false); return; }
  if (tucked) {
    if (!down && y <= 1 && Math.abs(x - W / 2) < 130) setTucked(false);
    return;
  }
  const away = x < hitRect.x - 30 || x > hitRect.x + hitRect.width + 30 || y > hitRect.height + 30;
  if (!away || down || hovering || hitRect.height > 40) { awayAt = 0; return; }
  if (!awayAt) awayAt = Date.now();
  else if (Date.now() - awayAt > 900) setTucked(true);
}

// Пока играет музыка — пик громкости 30 раз в секунду: низ острова прыгает под бит.
let peakSent = 0;
function pollPeak() {
  const on = media?.active && media.status === 'Playing' && island?.isVisible() && !fsActive;
  const v = on ? Math.min(1, native.audioPeak()) : 0;
  if (Math.abs(v - peakSent) < 0.015 && (v || !peakSent)) return;
  peakSent = v;
  send('level', +v.toFixed(3));
}

// ---------- Громкость и яркость: показываем на острове, когда меняются ----------

let volPrev = null, brightPrev = null, brightOk = true, levelBusy = false, brightTick = 0;
async function pollLevels() {
  if (levelBusy || fsActive) return;
  levelBusy = true;
  try {
    const v = await helper.call('vol.get', {}, 2000);
    const key = Math.round(v.level * 100) + (v.muted ? 'm' : '');
    if (volPrev !== null && key !== volPrev && S.indicators.volume !== false) send('vol', v);
    volPrev = key;
    if (brightOk && ++brightTick % 3 === 0) {
      const b = await helper.call('bright.get', {}, 3000).catch(() => null);
      if (!b || b.level == null) brightOk = false;
      else {
        if (brightPrev !== null && b.level !== brightPrev && S.indicators.brightness !== false) send('bright', b);
        brightPrev = b.level;
      }
    }
  } catch {} finally { levelBusy = false; }
}

// ---------- Простой пользователя: глазки засыпают и просыпаются ----------

let idleState = 'awake';
function pollIdle() {
  if (fsActive) return;
  const idle = native.idleMs();
  const doze = Math.max(1, S.eyes.dozeMin) * 60e3;
  if (idleState === 'awake' && idle >= doze) { idleState = 'sleep'; send('idle', 'sleep'); }
  else if (idleState === 'sleep' && idle < 1500) { idleState = 'awake'; send('idle', 'wake'); }
}

// ---------- Буфер обмена ----------

let clipSeq = native.clipboardSeq();
let ignoreSeq = -1, clipPaused = false;

function publicClips() {
  return clips.data;
}

function removeClipFiles(item) {
  for (const f of [item.file, item.thumb]) if (f) fs.rm(f, { force: true }, () => {});
}

function trimClips() {
  const max = S.clip.max;
  let n = 0;
  clips.data = clips.data.filter((c) => {
    if (c.pinned) return true;
    if (++n <= max) return true;
    removeClipFiles(c);
    return false;
  });
}

function addClip(item) {
  if (item.type === 'text') {
    const i = clips.data.findIndex((c) => c.type === 'text' && c.text === item.text);
    if (i >= 0) { item.pinned = clips.data[i].pinned; item.id = clips.data[i].id; clips.data.splice(i, 1); }
  } else if (item.type === 'files') {
    const key = item.paths.join('|');
    const i = clips.data.findIndex((c) => c.type === 'files' && c.paths.join('|') === key);
    if (i >= 0) { item.pinned = clips.data[i].pinned; item.id = clips.data[i].id; clips.data.splice(i, 1); }
  }
  clips.data.unshift(item);
  trimClips();
  clips.save();
  send('clips', publicClips());
}

async function readClipboard() {
  if (clipPaused) return;
  if (native.clipboardIsPrivate()) return;
  const appName = lastExternal ? native.processName(lastExternal) : '';
  if (appName && S.clip.exclude.includes(appName)) return;
  const base = { id: uid(), time: Date.now(), app: appName, pinned: false };

  if (native.clipboardHasFiles()) {
    try {
      const paths = await helper.call('clip.getfiles', {}, 4000);
      if (paths && paths.length) {
        addClip({ ...base, type: 'files', paths: [].concat(paths) });
        if (S.clip.toast !== false) send('toast', { clipFiles: [].concat(paths).length, app: appName });
        return;
      }
    } catch {}
  }
  const text = await clip.readText();
  if (text.trim()) {
    addClip({ ...base, type: 'text', text: text.length > 50000 ? text.slice(0, 50000) : text });
    // Как у Island: сверху «Текст скопирован» с началом текста.
    if (S.clip.toast !== false) send('toast', { clipText: text.replace(/\s+/g, ' ').trim().slice(0, 60), app: appName });
    return;
  }
  const img = await clip.readImage();
  if (img) {
    const { width, height } = img.getSize();
    const file = path.join(CLIPS_DIR, base.id + '.png');
    const thumb = path.join(CLIPS_DIR, base.id + '.t.png');
    const small = width > 320 ? img.resize({ width: 320, quality: 'good' }) : img;
    fs.writeFileSync(file, img.toPNG());
    fs.writeFileSync(thumb, small.toPNG());
    addClip({ ...base, type: 'image', file, thumb, width, height });
    // Как у Island: «Картинка скопирована» с превью, размером и программой.
    if (S.clip.toast !== false) send('toast', { clipImg: small.resize({ height: 96, quality: 'good' }).toDataURL(), dims: `${width}×${height}`, app: appName });
  }
}

function pollClipboard() {
  if (fsActive) return; // скопированное в игре подхватим, когда из неё выйдут
  const s = native.clipboardSeq();
  if (s === clipSeq) return;
  clipSeq = s;
  if (s === ignoreSeq) return;
  setTimeout(() => readClipboard().catch((e) => console.error('clip', e)), 60);
}

async function writeClip(item) {
  if (item.type === 'text') await clip.writeText(item.text);
  else if (item.type === 'image') await clip.writeImage(nativeImage.createFromPath(item.file));
  else if (item.type === 'files') await helper.call('clip.files', { paths: item.paths }, 5000);
  ignoreSeq = clipSeq = native.clipboardSeq();
  // Выбранная запись поднимается наверх.
  const i = clips.data.indexOf(item);
  if (i > 0) { clips.data.splice(i, 1); clips.data.unshift(item); clips.save(); send('clips', publicClips()); }
}

// ---------- Фокус и вставка в прошлое окно ----------

function focusIsland() {
  if (!island) return;
  if (!island.isVisible()) island.showInactive();
  island.setFocusable(true);
  island.focus();
  if (native.foreground() !== islandHwnd) native.focusWindow(islandHwnd);
}

function releaseIsland(restore = true) {
  if (!island) return;
  island.setFocusable(false);
  if (restore && lastExternal && native.foreground() === islandHwnd) native.focusWindow(lastExternal);
}

async function pasteToPrevious() {
  releaseIsland(false);
  if (lastExternal) native.focusWindow(lastExternal);
  await sleep(70);
  native.sendCtrlV();
}

function openPanel(tab, focus, extra) {
  if (userHidden) { userHidden = false; }
  if (!island.isVisible()) island.showInactive();
  send('open', { tab, ...extra });
  if (focus) focusIsland();
}

// ---------- Медиа ----------

let media = null, mediaThumb = null, mediaKey = '', mediaTimer = null, mediaIntent = null;

async function pollMedia() {
  let delay = 1000;
  try {
    const m = await helper.call('media.get', { prefer: S.mediaPrefer, haveThumb: mediaThumb ? mediaKey : '' }, 6000);
    if (m.active) {
      if (m.key !== mediaKey) { mediaThumb = m.thumb || null; mediaKey = m.key; }
      else if (m.thumb) mediaThumb = m.thumb;
    } else {
      mediaKey = ''; mediaThumb = null; delay = 2500;
    }
    // Некоторые плееры (Яндекс Музыка для ПК) сообщают Windows новое состояние с опозданием в 1–3 с.
    // Пока не истекло намерение после нажатия, старое состояние считаем устаревшим.
    if (mediaIntent && m.active) {
      if (Date.now() > mediaIntent.until || m.key !== mediaIntent.key || m.status === mediaIntent.status) mediaIntent = null;
      else { m.status = mediaIntent.status; m.position = media?.position ?? m.position; m.updated = media?.updated ?? m.updated; delay = 400; }
    }
    const next = { ...m, thumb: mediaThumb };
    if (JSON.stringify(next) !== JSON.stringify(media)) { media = next; send('media', media); }
  } catch { delay = 3000; }
  if (fsActive) delay = Math.max(delay, 10000);
  mediaTimer = setTimeout(pollMedia, delay);
}

// ---------- Таймеры и напоминания ----------

const timers = new Map(); // id -> { id, label, total, end, left, paused, handle }

function timerList() {
  return [...timers.values()].map(({ handle, ...t }) => t);
}

function notify(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: true, icon: nativeImage.createFromBuffer(trayIcon(64)) }).show();
  }
}

function armTimer(t) {
  clearTimeout(t.handle);
  t.handle = setTimeout(() => {
    timers.delete(t.id);
    send('timer-done', { id: t.id, label: t.label, total: t.total });
    send('timers', timerList());
    notify('Таймер', t.label || 'Время вышло');
  }, Math.max(0, t.end - Date.now()));
}

function startTimer(seconds, label = '') {
  const t = { id: uid(), label, total: seconds, end: Date.now() + seconds * 1000, left: seconds * 1000, paused: false };
  timers.set(t.id, t);
  armTimer(t);
  send('timers', timerList());
  return t.id;
}

function checkReminders() {
  const now = Date.now();
  let changed = false;
  for (const r of [...reminders.data]) {
    if (r.at > now) continue;
    send('reminder', r);
    notify('Напоминание', r.text);
    if (r.repeat) {
      const n = parse.nextRepeat(r.repeat.days, r.repeat.hour, r.repeat.minute, new Date(now + 1000));
      if (n) r.at = n.getTime(); else reminders.data.splice(reminders.data.indexOf(r), 1);
    } else {
      reminders.data.splice(reminders.data.indexOf(r), 1);
    }
    changed = true;
  }
  if (changed) { reminders.save(); send('reminders', reminders.data); }
}

// ---------- Уведомления Windows ----------
// Центр уведомлений хранит всё в SQLite-базе пользователя. Читаем её только на чтение
// и показываем новые всплывашки в острове. Свои уведомления Islet пропускаем — их остров уже показал.

const WPN_DB = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Notifications', 'wpndatabase.db');
let wpn = null, wpnNew = null, wpnLast = -1, wpnTimer = 0, wpnWatch = null, wpnDeb = 0;

const xmlText = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(x?)([0-9a-f]+);/gi, (_, x, n) => String.fromCodePoint(parseInt(n, x ? 16 : 10))).replace(/&amp;/g, '&').trim();

// «Claude_pzs…!Claude» → «Claude»; имя из меню «Пуск», если оно там есть.
const WPN_NAMES = {
  'Windows.SystemToast.SecurityAndMaintenance': 'Безопасность Windows',
  'windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel': 'Параметры',
  'Microsoft.Windows.Explorer': 'Проводник',
};
function wpnAppName(id) {
  if (WPN_NAMES[id]) return WPN_NAMES[id];
  const hit = apps.find((a) => a.id === id);
  if (hit) return hit.name;
  let s = id.includes('!') ? id.split('!').pop() : id;
  s = s.replace(/\.exe$/i, '').split(/[\\/]/).pop();
  if (/^Windows\.SystemToast\./i.test(s)) s = s.slice(20);
  return s.split('.').pop() || s;
}

function parseToast(xml) {
  const texts = [...xml.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) => xmlText(m[1])).filter(Boolean);
  if (!texts.length) return null;
  const logo = xml.match(/<image\b[^>]*placement="appLogoOverride"[^>]*src="([^"]+)"/)?.[1]
    || xml.match(/<image\b[^>]*src="([^"]+)"[^>]*placement="appLogoOverride"/)?.[1];
  return { title: texts[0], body: texts.slice(1).join(' · '), logo };
}

// Картинка из самого уведомления (аватар чата и т. п.), если она лежит на диске.
function wpnLogo(n) {
  try {
    const src = n.logo && decodeURI(n.logo.replace(/^file:\/\/\/?/i, ''));
    if (src && /^[a-z]:\\/i.test(src) && fs.existsSync(src)) {
      const img = nativeImage.createFromPath(src);
      if (!img.isEmpty()) return img.resize({ width: 40, quality: 'good' }).toDataURL();
    }
  } catch {}
  return '';
}

// Иконка приложения как в «Пуске» — helper достаёт её по AUMID, Store-приложения тоже. Запоминаем навсегда.
const appIconWait = new Map();
function appIcon(id) {
  if (appIcons.data[id]) return Promise.resolve(appIcons.data[id]);
  if (!appIconWait.has(id)) {
    appIconWait.set(id, (async () => {
      let icon = '';
      try { icon = (await helper.call('appicon', { id }, 15000)) || ''; } catch {}
      if (!icon) {
        const exe = apps.find((a) => a.id === id && /\.exe$/i.test(a.id))?.id || (/^[a-z]:\\.*\.exe$/i.test(id) ? id : '');
        try { if (exe) icon = (await app.getFileIcon(exe, { size: 'normal' })).toDataURL(); } catch {}
      }
      if (icon) { appIcons.data[id] = icon; appIcons.save(); }
      appIconWait.delete(id);
      return icon;
    })());
  }
  return appIconWait.get(id);
}

// История уведомлений для вкладки «Уведомления». Иконки приложений отдельно, чтобы не копить их в каждой записи.
const NOTIFS_MAX = 100;
const publicNotifs = () => ({ list: notifs.data, icons: appIcons.data });
function addNotif(aumid, n) {
  const logo = wpnLogo(n);
  appIcon(aumid).then((icon) => {
    const item = { id: uid(), aumid, app: wpnAppName(aumid), title: n.title, body: n.body, time: Date.now(), logo };
    notifs.data.unshift(item);
    if (notifs.data.length > NOTIFS_MAX) notifs.data.length = NOTIFS_MAX;
    notifs.save();
    send('win-notif', { id: item.id, app: item.app, title: n.title, body: n.body, icon: logo || icon });
    send('notifs', publicNotifs());
  });
}

function openNotifApp(aumid) {
  if (aumid && !/^Windows\.SystemToast\./i.test(aumid)) spawn('explorer.exe', ['shell:AppsFolder\\' + aumid], { detached: true, stdio: 'ignore' }).unref();
}

function pollWinNotifs() {
  if (!S.winNotifs) return;
  try {
    if (!wpn) {
      const { DatabaseSync } = require('node:sqlite');
      wpn = new DatabaseSync(WPN_DB, { readOnly: true });
      wpnNew = wpn.prepare(`SELECT n.Id, h.PrimaryId AS app, n.Payload AS p FROM Notification n
        JOIN NotificationHandler h ON h.RecordId = n.HandlerId WHERE n.Id > ? AND n.Type = 'toast' ORDER BY n.Id`);
    }
    if (S.hideWinBanners) hideBanners(wpn.prepare('SELECT PrimaryId AS id FROM NotificationHandler').all().map((h) => h.id));
    if (wpnLast < 0) { wpnLast = wpn.prepare('SELECT ifnull(max(Id), 0) AS m FROM Notification').get().m; return; }
    const rows = wpnNew.all(wpnLast);
    for (const r of rows) {
      wpnLast = Math.max(wpnLast, r.Id);
      if (r.app === 'Islet') continue;
      const n = parseToast(Buffer.from(r.p || []).toString('utf8'));
      if (!n) continue;
      addNotif(r.app, n);
    }
  } catch (e) {
    // База занята или её нет — попробуем на следующем круге с новым соединением.
    try { wpn?.close(); } catch {}
    wpn = null;
  }
}

// Баннеры Windows. Чтобы всплывашки не дублировались, у каждого приложения выключаем тот же флаг,
// что «Показывать баннеры» в Параметрах (ShowBanner). В центре уведомлений и в базе они остаются,
// остров берёт их оттуда. Прежние значения запоминаем и возвращаем, когда Islet закрывают
// или настройку выключают, — без острова уведомления не пропадут.
const WPN_KEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\\';
const BANNERS_FILE = path.join(DATA, 'banners.json');
let bannersSaved = null;
const bannersDone = new Set();

function loadBanners() {
  if (!bannersSaved) { try { bannersSaved = JSON.parse(fs.readFileSync(BANNERS_FILE, 'utf8')); } catch { bannersSaved = {}; } }
  return bannersSaved;
}

function hideBanners(ids) {
  const saved = loadBanners();
  let changed = false;
  for (const id of ids) {
    if (!id || id === 'Islet' || bannersDone.has(id)) continue;
    bannersDone.add(id);
    const cur = native.regDword(WPN_KEY + id, 'ShowBanner');
    if (cur === 0) continue;
    if (!(id in saved)) { saved[id] = cur; changed = true; }
    native.setRegDword(WPN_KEY + id, 'ShowBanner', 0);
  }
  if (changed) { try { fs.writeFileSync(BANNERS_FILE, JSON.stringify(saved)); } catch {} }
}

function restoreBanners() {
  const saved = loadBanners();
  for (const [id, v] of Object.entries(saved)) native.setRegDword(WPN_KEY + id, 'ShowBanner', v);
  bannersSaved = {};
  bannersDone.clear();
  try { fs.unlinkSync(BANNERS_FILE); } catch {}
}

function watchWinNotifs() {
  clearInterval(wpnTimer);
  wpnWatch?.close(); wpnWatch = null;
  wpnLast = -1;
  if (!S.winNotifs || !S.hideWinBanners) restoreBanners();
  if (!S.winNotifs) { try { wpn?.close(); } catch {} wpn = null; return; }
  pollWinNotifs();
  // Каждое новое уведомление пишется в файлы базы — просыпаемся по их изменению, а не крутим опрос.
  try {
    wpnWatch = fs.watch(path.dirname(WPN_DB), () => { clearTimeout(wpnDeb); wpnDeb = setTimeout(pollWinNotifs, 150); });
    wpnWatch.on('error', () => { wpnWatch = null; });
  } catch { wpnWatch = null; }
  wpnTimer = setInterval(pollWinNotifs, wpnWatch ? 10000 : 1500);
}

// ---------- Загрузки ----------

// Временные файлы идущих загрузок браузеров и качалок. .tmp сюда не входит: его пишет кто угодно.
const TEMP_EXTS = ['crdownload', 'part', 'partial', 'download', 'opdownload', '!ut', 'aria2'];
const TEMP_EXT = new RegExp(`\\.(${TEMP_EXTS.map((e) => e.replace('!', '\\!')).join('|')})$`, 'i');
const seenDownloads = new Map();
let downloadsWatcher = null;

// Исключения из настроек: маски вида *.tmp, ~*, setup*.exe (без учёта регистра).
let dlIgnoreRe = null, dlIgnoreSrc = '';
function dlIgnored(name) {
  const src = JSON.stringify(S.dlIgnore || []);
  if (src !== dlIgnoreSrc) {
    dlIgnoreSrc = src;
    const masks = (Array.isArray(S.dlIgnore) ? S.dlIgnore : String(S.dlIgnore).split(/[,;\n]/)).map((s) => s.trim()).filter(Boolean);
    dlIgnoreRe = masks.length ? new RegExp('^(' + masks.map((m) => m.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')).join('|') + ')$', 'i') : null;
  }
  return /\.te?mp$/i.test(name) || !!dlIgnoreRe?.test(name);
}

// Файл ещё не готов, если рядом лежит его временный двойник (браузер ждёт «Сохранить как» или докачивает).
function hasTempTwin(p) {
  return TEMP_EXTS.some((e) => fs.existsSync(p + '.' + e));
}

// Готовность: размер не меняется между двумя проверками и временного двойника нет.
function settleDownload(dir, name, tries = 0) {
  const p = path.join(dir, name);
  fs.stat(p, (err, st) => {
    if (err || !st.isFile() || st.size === 0) return;
    // Долгая загрузка: файл создан давно, но дописан только что — тоже показываем.
    if (Date.now() - Math.max(st.birthtimeMs, st.mtimeMs) > 120e3) return;
    if (hasTempTwin(p)) return; // переименование из .crdownload в готовое имя снова позовёт нас
    setTimeout(() => fs.stat(p, (err2, st2) => {
      if (err2 || !st2.isFile()) return;
      if (st2.size !== st.size || st2.mtimeMs !== st.mtimeMs) { if (tries < 20) settleDownload(dir, name, tries + 1); return; }
      if (hasTempTwin(p)) return;
      app.getFileIcon(p, { size: 'normal' }).then((ic) => {
        send('download', { path: p, name, size: st2.size, icon: ic.toDataURL() });
      }).catch(() => send('download', { path: p, name, size: st2.size }));
    }), 900);
  });
}

function watchDownloads() {
  downloadsWatcher?.close();
  downloadsWatcher = null;
  if (!S.watchDownloads) return;
  const dir = app.getPath('downloads');
  try {
    downloadsWatcher = fs.watch(dir, (ev, name) => {
      if (name && TEMP_EXT.test(name)) { const p = path.join(dir, name); if (!activeDl.has(p)) activeDl.set(p, { name, size: 0, t: Date.now(), speed: 0 }); return; }
      if (!name || name.startsWith('~$') || name.startsWith('.') || dlIgnored(name) || /^Unconfirmed \d+/i.test(name)) return;
      clearTimeout(seenDownloads.get(name));
      seenDownloads.set(name, setTimeout(() => {
        seenDownloads.delete(name);
        settleDownload(dir, name);
      }, 1200));
    });
  } catch (e) { console.error('downloads watch', e); }
}

// Полный размер идущей загрузки берём из истории Chromium-браузеров (Chrome, Edge, Яндекс, Opera…):
// там есть total_bytes. Файл истории браузер держит открытым, поэтому читаем его копию.
function historyFiles() {
  const out = [];
  const roots = ['Google\\Chrome', 'Microsoft\\Edge', 'Yandex\\YandexBrowser', 'BraveSoftware\\Brave-Browser', 'Vivaldi', 'Chromium']
    .map((b) => path.join(process.env.LOCALAPPDATA || '', b, 'User Data'));
  for (const root of roots) {
    let names;
    try { names = fs.readdirSync(root); } catch { continue; }
    for (const n of names) if (n === 'Default' || /^Profile \d+$/.test(n)) out.push(path.join(root, n, 'History'));
  }
  for (const o of ['Opera Stable', 'Opera GX Stable']) out.push(path.join(process.env.APPDATA || '', 'Opera Software', o, 'History'));
  return out;
}

let dlTotalBusy = false;
async function lookupDlTotals() {
  const now = Date.now();
  const need = [...activeDl].filter(([, d]) => d.live && !d.total && (d.tries || 0) < 30 && now - (d.looked || 0) > 3000);
  if (!need.length || dlTotalBusy) return;
  dlTotalBusy = true;
  for (const [, d] of need) { d.looked = now; d.tries = (d.tries || 0) + 1; }
  const tmp = path.join(app.getPath('temp'), 'islet-history.db');
  try {
    const { DatabaseSync } = require('node:sqlite');
    for (const h of historyFiles()) {
      // Браузер, который давно ничего не писал в историю, эту загрузку не ведёт — не копируем его зря.
      const mt = await Promise.all([h, h + '-wal'].map((f) => fs.promises.stat(f).then((s) => s.mtimeMs, () => 0)));
      if (now - Math.max(...mt) > 10 * 60e3) continue;
      try {
        await fs.promises.copyFile(h, tmp);
        await fs.promises.copyFile(h + '-wal', tmp + '-wal').catch(() => fs.promises.rm(tmp + '-wal', { force: true }));
        const db = new DatabaseSync(tmp);
        const q = db.prepare('select total_bytes t from downloads where state = 0 and (current_path = ? collate nocase or target_path = ? collate nocase) order by id desc limit 1');
        for (const [p, d] of need) {
          const r = d.total ? null : q.get(p, p.replace(TEMP_EXT, ''));
          if (r?.t > 0) d.total = r.t;
        }
        db.close();
      } catch {}
      if (need.every(([, d]) => d.total)) break;
    }
  } finally {
    for (const f of [tmp, tmp + '-wal', tmp + '-shm']) fs.promises.rm(f, { force: true }).catch(() => {});
    dlTotalBusy = false;
  }
}

// Идущие загрузки (.crdownload, .part…): размер и скорость раз в секунду.
const activeDl = new Map();
let dlSent = '';
function pollActiveDownloads() {
  if ((!activeDl.size && !dlSent) || fsActive) return;
  lookupDlTotals().catch(() => {});
  for (const [p, d] of activeDl) {
    let st;
    try { st = fs.statSync(p); } catch { activeDl.delete(p); continue; }
    const now = Date.now();
    const dt = (now - d.t) / 1000;
    if (dt > 0 && d.size) d.speed = d.speed ? d.speed * 0.6 + 0.4 * Math.max(0, st.size - d.size) / dt : Math.max(0, st.size - d.size) / dt;
    d.size = st.size; d.t = now;
    if (st.size > 0) d.live = true;
  }
  const list = [...activeDl.values()].filter((d) => d.live);
  const cur = list.sort((a, b) => b.t - a.t)[0];
  const out = cur ? { name: cur.name.replace(TEMP_EXT, '').replace(/^Unconfirmed \d+$/, 'Файл'), size: cur.size, total: cur.total || 0, speed: cur.speed, count: list.length } : null;
  const key = JSON.stringify(out);
  if (key !== dlSent) { dlSent = cur ? key : ''; send('dl-progress', out); }
}

// ---------- VPN и батарея ----------

const VPN_RE = /wireguard|wintun|\bwg\d*|\btun|\btap|vpn|outline|amnezia|hiddify|nekoray|clash|v2ray|xray|sing-?box|proton|nord|happ|openvpn|zerotier|tailscale/i;
let vpnOn = null, batteryState;

// VPN по клику: подключения Windows (rasphone.pbk) включаются и выключаются через rasdial
// с сохранёнными данными. Сторонние клиенты так не управляются — для них открываем их окно или параметры VPN.
function run(cmd, args, ms = 30000) {
  return new Promise((resolve) => {
    let out = '';
    const p = spawn(cmd, args, { windowsHide: true });
    const t = setTimeout(() => { try { p.kill(); } catch {} }, ms);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', () => { clearTimeout(t); resolve({ code: -1, out }); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}
function vpnProfiles() {
  const files = [
    path.join(app.getPath('appData'), 'Microsoft', 'Network', 'Connections', 'Pbk', 'rasphone.pbk'),
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Network', 'Connections', 'Pbk', 'rasphone.pbk'),
  ];
  const out = [];
  for (const f of files) {
    try {
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/^\[(.+)\]\s*$/gm)) if (!out.includes(m[1])) out.push(m[1]);
    } catch {}
  }
  return out;
}
let vpnPbk = { t: 0, list: [] };
function vpnProfilesCache() {
  if (Date.now() - vpnPbk.t > 60e3) vpnPbk = { t: Date.now(), list: vpnProfiles() };
  return vpnPbk.list;
}
async function vpnToggle() {
  const profiles = vpnProfiles();
  if (!profiles.length) { shell.openExternal('ms-settings:network-vpn'); return { ok: false, opened: true }; }
  // Подключённый профиль виден как сетевой интерфейс с тем же именем (вывод rasdial — в OEM-кодировке).
  const ifs = Object.keys(os.networkInterfaces());
  const connected = profiles.find((p) => ifs.includes(p));
  const r = connected ? await run('rasdial', [connected, '/disconnect'], 15000) : await run('rasdial', [profiles[0]], 45000);
  setTimeout(pollNet, 800); setTimeout(pollNet, 3000);
  if (r.code !== 0) logLine('rasdial', r.code, r.out.trim().slice(0, 300));
  return { ok: r.code === 0, on: !connected, name: connected || profiles[0], error: r.code === 0 ? '' : r.out.trim().split('\n').pop() };
}

// Карточка «VPN подключён»: страна · внешний IP · протокол — как у Island.
// Один запрос к ipwho.is на подключение, без повторов.
function vpnProto(n = '') {
  if (/wireguard|\bwg|amnezia/i.test(n)) return 'WireGuard';
  if (/openvpn|\btap/i.test(n)) return 'OpenVPN';
  if (/tailscale/i.test(n)) return 'Tailscale';
  if (/zerotier/i.test(n)) return 'ZeroTier';
  if (/wintun|\btun|sing-?box|hiddify|nekoray|clash|v2ray|xray|happ|outline/i.test(n)) return 'TUN';
  return vpnProfilesCache().includes(n) ? 'IKEv2' : '';
}
async function vpnInfo(name) {
  const proto = vpnProto(name);
  await new Promise((r) => setTimeout(r, 1500)); // маршрут через туннель поднимается не сразу
  let geo = {};
  try {
    const r = await fetch('https://ipwho.is/?fields=ip,country,country_code', { signal: AbortSignal.timeout(5000) });
    geo = await r.json();
  } catch {}
  if (vpnOn) send('vpn-info', { ip: geo.ip || '', country: geo.country || '', cc: geo.country_code || '', proto });
}

function pollNet() {
  if (fsActive) return;
  const names = Object.keys(os.networkInterfaces());
  const on = names.some((n) => VPN_RE.test(n));
  const on2 = on || vpnProfilesCache().some((p) => names.includes(p));
  if (on2 !== vpnOn) {
    const first = vpnOn === null;
    vpnOn = on2; send('vpn', on2);
    if (on2 && !first) vpnInfo(names.find((n) => VPN_RE.test(n)) || vpnProfilesCache().find((p) => names.includes(p)));
  }
  const b = native.battery();
  if (JSON.stringify(b) !== JSON.stringify(batteryState)) {
    const plugged = batteryState && b && !batteryState.charging && b.charging;
    batteryState = b;
    send('battery', { ...b, plugged });
  }
}

// ---------- Горячие клавиши ----------

let hotkeyErrors = [];
// Если стандартное сочетание занято (например, Alt+Space у PowerToys Run), берём запасное.
const HOTKEY_FALLBACK = {
  command: ['Ctrl+Alt+Space', 'Alt+Shift+Space'], clips: ['Alt+Shift+V'], chat: ['Ctrl+Alt+A'],
  shot: ['Ctrl+Alt+S'], ocr: ['Ctrl+Alt+T'], color: ['Ctrl+Alt+C'], toggle: ['Ctrl+Alt+I'],
};

// Запасное сочетание не записываем в настройки: при каждом запуске сначала пробуем стандартное
// (Alt+Space освобождается, когда закрыт PowerToys Run и т. п.). Что реально занято — в hotkeysActive.
let hotkeysActive = {};
if (!S.hkFallbackFixed) {
  for (const [name, list] of Object.entries(HOTKEY_FALLBACK)) if (list.includes(S.hotkeys[name])) S.hotkeys[name] = DEFAULTS.hotkeys[name];
  S.hkFallbackFixed = true;
  settings.save(100);
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  hotkeyErrors = [];
  hotkeysActive = {};
  const actions = {
    clips: () => openPanel('clips', true),
    command: () => openPanel('command', true),
    chat: () => openPanel('chat', true),
    shot: () => startCapture('shot'),
    ocr: () => startCapture('ocr'),
    color: () => startCapture('color'),
    toggle: () => { userHidden = !userHidden; applyVisibility(); },
  };
  for (const [name, fn] of Object.entries(actions)) {
    const acc = S.hotkeys[name];
    if (!acc) continue;
    const handler = () => { captureForeground(); fn(); };
    const tryReg = (a) => { try { return globalShortcut.register(a, handler); } catch { return false; } };
    if (tryReg(acc)) { hotkeysActive[name] = acc; continue; }
    const alt = acc === DEFAULTS.hotkeys[name] && (HOTKEY_FALLBACK[name] || []).find(tryReg);
    if (alt) hotkeysActive[name] = alt; else hotkeyErrors.push(name);
  }
}

function captureForeground() {
  const fg = native.foreground();
  if (fg && !ours(fg)) lastExternal = fg;
}

// ---------- Скриншоты, текст с экрана, QR, пипетка ----------

let capture = null;

async function startCapture(mode) {
  if (capture) return;
  const pt = screen.getCursorScreenPoint();
  const d = screen.getDisplayNearestPoint(pt);
  const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
  capture = { mode, display: d, img: null };
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const src = sources.find((s) => s.display_id === String(d.id)) || sources[0];
    capture.img = src.thumbnail;
    if (mode === 'full') {
      // Весь экран — без рамки выбора: сразу в буфер и в папку.
      capture = null;
      fs.mkdirSync(S.shotDir, { recursive: true });
      const file = path.join(S.shotDir, `Снимок ${stamp()}.png`);
      fs.writeFileSync(file, src.thumbnail.toPNG());
      clip.writeImage(src.thumbnail);
      send('toast', { text: 'Скриншот готов', path: file, shot: true, saved: true, dims: dims(src.thumbnail) });
      return;
    }
    const { width, height } = capture.img.getSize();
    overlay.setBounds(d.bounds);
    overlay.webContents.send('ov-start', { mode, width, height, bitmap: capture.img.toBitmap(), scale: d.scaleFactor });
    overlay.show();
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.focus();
    native.focusWindow(overlayHwnd);
  } catch (e) {
    capture = null;
    send('toast', { text: 'Не удалось снять экран', error: true });
  }
}

function endCapture() {
  overlay.hide();
  overlay.webContents.send('ov-clear');
  capture = null;
  if (lastExternal) native.focusWindow(lastExternal);
}

const dims = (img) => { const s = img.getSize(); return `${s.width}×${s.height}`; };

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

async function onCaptureResult(res) {
  if (!capture) return;
  const { img } = capture;
  endCapture();
  if (!res || res.action === 'cancel') return;
  if (res.action === 'color') {
    clip.writeText(res.hex);
    send('toast', { text: `Цвет ${res.hex} скопирован`, color: res.hex });
    return;
  }
  if (res.action === 'qr') {
    clip.writeText(res.text);
    send('qr-result', { text: res.text });
    return;
  }
  const r = res.rect;
  const part = img.crop({ x: r.x, y: r.y, width: Math.max(1, r.width), height: Math.max(1, r.height) });
  if (res.action === 'copy') {
    clip.writeImage(part);
    send('toast', { text: 'Скриншот скопирован' });
  } else if (res.action === 'save') {
    fs.mkdirSync(S.shotDir, { recursive: true });
    const file = path.join(S.shotDir, `Снимок ${stamp()}.png`);
    fs.writeFileSync(file, part.toPNG());
    clip.writeImage(part);
    send('toast', { text: 'Снимок сохранён', path: file, shot: true, saved: true, dims: dims(part) });
  } else if (res.action === 'ocr') {
    send('toast', { text: 'Распознаю текст…', busy: true });
    const tmp = path.join(os.tmpdir(), `islet-ocr-${uid()}.png`);
    fs.writeFileSync(tmp, part.toPNG());
    try {
      const text = String(await helper.call('ocr', { path: tmp }, 20000) || '').trim();
      if (text) { clip.writeText(text); send('ocr-result', { text }); }
      else send('toast', { text: 'Текст не найден', error: true });
    } catch (e) {
      send('toast', { text: 'Распознавание не удалось: ' + e.message, error: true });
    } finally {
      fs.rm(tmp, { force: true }, () => {});
    }
  }
}

// ---------- Запись экрана ----------

let recStream = null, recFile = '';

function setupDisplayMedia() {
  session.defaultSession.setDisplayMediaRequestHandler(async (req, cb) => {
    try {
      const d = islandDisplay();
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      const src = sources.find((s) => s.display_id === String(d.id)) || sources[0];
      cb({ video: src, audio: 'loopback' });
    } catch { cb({}); }
  });
}

// ---------- Мост к хукам Claude Code (только по кнопке в настройках) ----------

const CC_PORT = 47823;
const CC_MARK = `127.0.0.1:${CC_PORT}/claude`;
const CC_CMD = `curl -s -m 2 -X POST -H "Content-Type: application/json" --data-binary "@-" http://${CC_MARK}`;
const CC_EVENTS = ['UserPromptSubmit', 'Notification', 'Stop'];
// Вопросы, на которые можно ответить с острова: запрос разрешения и AskUserQuestion.
// curl ждёт ответа до 10 минут; не ответили или Islet не запущен — Claude спросит в терминале как обычно.
const CC_ASK_CMD = `curl -s -m 590 -X POST -H "Content-Type: application/json" --data-binary "@-" http://${CC_MARK}/ask`;
const CC_ASK_HOOKS = { PermissionRequest: '*', PreToolUse: 'AskUserQuestion' };
const ccSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');

const ccAsks = new Map(); // id -> { res, timer, input }
function ccReply(id, body) {
  const a = ccAsks.get(id);
  if (!a) return false;
  ccAsks.delete(id);
  clearTimeout(a.timer);
  try { a.res.writeHead(200, { 'Content-Type': 'application/json' }); a.res.end(JSON.stringify(body || {})); } catch {}
  send('claude-ask', { id, done: true });
  return true;
}
function ccDetail(tool, inp = {}) {
  if (inp.command) return String(inp.command);
  if (inp.file_path) return String(inp.file_path);
  if (inp.url) return String(inp.url);
  if (inp.pattern) return String(inp.pattern);
  const s = JSON.stringify(inp);
  return s === '{}' ? tool : s;
}
function ccAsk(j, req, res) {
  const tool = j.tool_name || '';
  const isQuestion = j.hook_event_name === 'PreToolUse' && tool === 'AskUserQuestion';
  const isPerm = j.hook_event_name === 'PermissionRequest' && tool !== 'AskUserQuestion';
  if (S.ccAsk === false || fsActive || !(isQuestion || isPerm)) { res.writeHead(200); return res.end('{}'); }
  const id = uid();
  const project = j.cwd ? path.basename(j.cwd) : '';
  const timer = setTimeout(() => ccReply(id, {}), 580e3);
  ccAsks.set(id, { res, timer, input: j.tool_input || {}, kind: isQuestion ? 'question' : 'perm' });
  // Claude закрыл запрос сам (ответили в терминале, прервали) — убираем вопрос с острова.
  res.on('close', () => { if (ccAsks.has(id)) { clearTimeout(timer); ccAsks.delete(id); send('claude-ask', { id, done: true }); } });
  let msg;
  if (isQuestion) {
    const qs = (j.tool_input?.questions || []).map((q) => ({
      question: String(q.question || ''), header: String(q.header || ''), multi: !!q.multiSelect,
      options: (q.options || []).map((o) => ({ label: String(o.label || ''), description: String(o.description || '') })),
    }));
    msg = { id, kind: 'question', project, questions: qs };
  } else {
    msg = { id, kind: 'perm', project, tool, detail: ccDetail(tool, j.tool_input).slice(0, 400) };
  }
  ccAsks.get(id).msg = msg;
  send('claude-ask', msg);
}

function startClaudeBridge() {
  const srv = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/claude/ask') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        try { ccAsk(JSON.parse(body), req, res); } catch { res.writeHead(200); res.end('{}'); }
      });
      return;
    }
    if (req.method !== 'POST' || req.url !== '/claude') { res.writeHead(404); return res.end(); }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      res.writeHead(200); res.end('ok');
      try {
        const j = JSON.parse(body);
        send('claude', {
          event: j.hook_event_name, message: j.message || '', project: j.cwd ? path.basename(j.cwd) : '',
        });
      } catch {}
    });
  });
  srv.on('error', (e) => console.error('claude bridge', e.message));
  srv.requestTimeout = 0; // ответы на вопросы держатся, пока пользователь не нажмёт кнопку
  srv.listen(CC_PORT, '127.0.0.1');
}

// Ответ с острова: { behavior: 'allow' | 'deny' | 'terminal' } или { answers: { вопрос: вариант } }.
function ccAnswer(id, ans = {}) {
  const a = ccAsks.get(id);
  if (!a) return false;
  if (ans.behavior === 'terminal') return ccReply(id, {});
  if (a.kind === 'question') {
    if (!ans.answers) return ccReply(id, {});
    return ccReply(id, { hookSpecificOutput: {
      hookEventName: 'PreToolUse', permissionDecision: 'allow',
      updatedInput: { ...a.input, answers: ans.answers },
    } });
  }
  const decision = ans.behavior === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: 'Отклонено на острове Islet' };
  return ccReply(id, { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } });
}

function ccRead() {
  try { return JSON.parse(fs.readFileSync(ccSettingsPath, 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error('Не получилось прочитать ~/.claude/settings.json: ' + e.message);
  }
}

function ccStatus() {
  try {
    const j = ccRead();
    const has = (ev) => JSON.stringify(j.hooks?.[ev] || []).includes(CC_MARK);
    return {
      installed: CC_EVENTS.some(has), ask: Object.keys(CC_ASK_HOOKS).some(has),
      askHooks: Object.fromEntries(Object.entries(CC_ASK_HOOKS).map(([ev, m]) => [ev, [{ matcher: m, hooks: [{ type: 'command', command: CC_ASK_CMD, timeout: 600 }] }]])),
    };
  } catch (e) { return { installed: false, error: e.message }; }
}

function ccWrite(mutate) {
  const j = ccRead();
  if (fs.existsSync(ccSettingsPath)) fs.copyFileSync(ccSettingsPath, ccSettingsPath + `.islet-backup-${Date.now()}`);
  mutate(j);
  fs.mkdirSync(path.dirname(ccSettingsPath), { recursive: true });
  fs.writeFileSync(ccSettingsPath, JSON.stringify(j, null, 2));
}

function ccStrip(j, events = [...CC_EVENTS, ...Object.keys(CC_ASK_HOOKS)]) {
  if (!j.hooks) return;
  for (const ev of events) {
    if (!Array.isArray(j.hooks[ev])) continue;
    j.hooks[ev] = j.hooks[ev].filter((g) => !JSON.stringify(g).includes(CC_MARK));
    if (!j.hooks[ev].length) delete j.hooks[ev];
  }
  if (!Object.keys(j.hooks).length) delete j.hooks;
}

// ---------- Приложения для командной строки ----------

let apps = [];
async function loadApps() {
  try { apps = (await helper.call('apps', {}, 30000)) || []; } catch {}
}

async function commandQuery(q) {
  const out = [];
  const s = q.trim();
  if (!s) return out;
  const c = parse.calc(s);
  if (c !== null) out.push({ kind: 'calc', title: c.toLocaleString('ru-RU', { maximumFractionDigits: 10 }), sub: 'Enter — скопировать', value: String(c) });
  const conv = parse.convert(s, /[$€£¥₽₴₸]|руб|дол|евро|usd|eur|rub|gbp|cny|юан|фунт|тенге|гривн|kzt|uah|byn|try|лир/i.test(s) ? await services.rates() : null);
  if (conv) out.push({ kind: 'calc', title: conv.text, sub: conv.detail, value: String(+conv.value.toFixed(4)) });
  const t = parse.parseTimer(s);
  if (t) out.push({ kind: 'timer', title: `Таймер на ${fmtDuration(t.seconds)}`, sub: 'Enter — запустить', seconds: t.seconds });
  if (/^напомн/i.test(s)) {
    const r = parse.parseReminder(s);
    if (r) out.push({ kind: 'reminder', title: r.text, sub: fmtWhen(r.at) + (r.repeat ? ' · повтор' : ''), reminder: r });
  }
  if (/^https?:\/\/\S+$|^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(s)) out.push({ kind: 'url', title: 'Открыть ' + s, url: /^https?:/.test(s) ? s : 'https://' + s });
  if (s.length >= 2) {
    const low = s.toLowerCase();
    const hits = apps
      .map((a) => ({ a, i: a.name.toLowerCase().indexOf(low) }))
      .filter((x) => x.i >= 0)
      .sort((x, y) => (x.i === 0 ? 0 : 1) - (y.i === 0 ? 0 : 1) || x.a.name.length - y.a.name.length)
      .slice(0, 5);
    for (const { a } of hits) out.push({ kind: 'app', title: a.name, sub: 'Приложение', id: a.id });
  }
  out.push(...await actionHits(s));
  out.push({ kind: 'ai', title: `Спросить ИИ: «${s}»`, sub: S.ai.model || 'ИИ', q: s });
  out.push({ kind: 'web', title: 'Искать в браузере', sub: s, q: s });
  return out;
}

// Встроенные действия острова, как в Island: «скр» — скриншоты, «вкл» — переключатели.
const ACTIONS = [
  { id: 'shot', title: 'Скриншот области', sub: 'Выделить часть экрана', icon: 'region', words: 'скриншот снимок скрин область фото экрана screenshot shot' },
  { id: 'full', title: 'Скриншот экрана', sub: 'Весь экран — в буфер и в папку', icon: 'screen', words: 'скриншот снимок скрин весь экран полный screenshot' },
  { id: 'ocr', title: 'Текст с экрана', sub: 'Распознать и скопировать текст', icon: 'scan', words: 'текст распознать ocr экрана скопировать' },
  { id: 'color', title: 'Пипетка', sub: 'Взять цвет с экрана', icon: 'pipette', words: 'пипетка цвет color picker' },
  { id: 'rec', title: 'Запись экрана', sub: 'MP4 со звуком системы', icon: 'video', words: 'запись экрана видео record' },
  { id: 'dictate', title: 'Голосовой ввод', sub: 'Надиктовать текст', icon: 'mic', words: 'голос голосовой диктовка надиктовать речь voice' },
  { id: 'mic', toggle: true, title: 'Микрофон', icon: 'mic', words: 'микрофон mic звук' },
  { id: 'WiFi', toggle: true, title: 'Wi-Fi', icon: 'wifi', words: 'wifi wi-fi вайфай сеть интернет' },
  { id: 'Bluetooth', toggle: true, title: 'Bluetooth', icon: 'bt', words: 'bluetooth блютуз bt' },
  { id: 'theme', title: 'Сменить тему Windows', sub: 'Светлая ↔ тёмная', icon: 'contrast', words: 'тема тёмная темная светлая theme' },
  { id: 'lock', title: 'Заблокировать компьютер', sub: 'Win + L', icon: 'lock', words: 'блокировка заблокировать lock' },
  { id: 'settings', title: 'Настройки Islet', sub: 'Открыть окно настроек', icon: 'gear', words: 'настройки settings параметры islet' },
];
const TOGGLE_WORDS = 'вкл включить выкл выключить переключить';

async function actionHits(s) {
  const toks = s.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (a) => {
    const words = (a.title + ' ' + a.words + (a.toggle ? ' ' + TOGGLE_WORDS : '')).toLowerCase().split(/[\s-]+/);
    return toks.every((t) => words.some((w) => w.startsWith(t)));
  };
  const found = ACTIONS.filter(hit).slice(0, 6);
  if (!found.length) return [];
  // Текущее состояние переключателей спрашиваем, только если они нашлись.
  const needMic = found.some((a) => a.id === 'mic'), needRadio = found.some((a) => a.id === 'WiFi' || a.id === 'Bluetooth');
  const [mic, radios] = await Promise.all([
    needMic ? helper.call('mic.get', {}, 1500).catch(() => null) : null,
    needRadio ? helper.call('radios.get', {}, 2500).catch(() => []) : [],
  ]);
  const out = [];
  for (const a of found) {
    if (!a.toggle) { out.push({ kind: 'act', id: a.id, title: a.title, sub: a.sub, icon2: a.icon }); continue; }
    let on = null;
    if (a.id === 'mic') on = mic ? !mic.muted : null;
    else { const r = [].concat(radios || []).find((x) => x.kind === a.id); if (!r) continue; on = r.state === 'On'; }
    out.push({ kind: 'act', id: a.id, on, icon2: a.icon, title: on === null ? `${a.title}: переключить` : `${on ? 'Выключить' : 'Включить'} ${a.id === 'mic' ? 'микрофон' : a.title}`, sub: on === null ? '' : on ? 'Сейчас включён' : 'Сейчас выключен' });
  }
  return out;
}

async function runAction(r) {
  const say = (text, error) => send('toast', { text, error });
  switch (r.id) {
    case 'shot': case 'full': case 'ocr': case 'color': setTimeout(() => startCapture(r.id === 'full' ? 'full' : r.id), 180); break;
    case 'mic': { const m = await helper.call('mic.toggle', {}, 5000).catch(() => null); if (m) say(m.muted ? 'Микрофон выключен' : 'Микрофон включён'); else say('Микрофон не найден', true); break; }
    case 'WiFi': case 'Bluetooth':
      try { await helper.call('radios.set', { kind: r.id, on: !r.on }, 8000); say(`${r.id === 'WiFi' ? 'Wi-Fi' : 'Bluetooth'} ${r.on ? 'выключен' : 'включён'}`); }
      catch (e) { say('Не получилось: ' + e.message, true); }
      break;
    case 'theme': helper.call('theme', { toggle: true }, 5000).catch(() => {}); break;
    case 'lock': spawn('rundll32.exe', ['user32.dll,LockWorkStation'], { detached: true, stdio: 'ignore' }).unref(); break;
    case 'settings': openSettings(); break;
  }
}

function fmtDuration(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
  return [h && `${h} ч`, m && `${m} мин`, x && `${x} с`].filter(Boolean).join(' ') || '0 с';
}

function fmtWhen(ms) {
  const d = new Date(ms);
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return 'сегодня в ' + time;
  if (d.toDateString() === tomorrow.toDateString()) return 'завтра в ' + time;
  return d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' }) + ' в ' + time;
}

async function commandRun(r) {
  switch (r.kind) {
    case 'calc': clip.writeText(r.value); send('toast', { text: 'Скопировано: ' + r.value }); break;
    case 'timer': startTimer(r.seconds); break;
    case 'reminder': addReminder(r.reminder); break;
    case 'url': shell.openExternal(r.url); break;
    case 'web': shell.openExternal(searchUrl(r.q || r.sub)); break;
    case 'act': runAction(r); break;
    case 'app': spawn('explorer.exe', ['shell:AppsFolder\\' + r.id], { detached: true, stdio: 'ignore' }).unref(); break;
  }
}

function addReminder(r) {
  const item = { id: uid(), text: r.text, at: r.at, repeat: r.repeat || null };
  reminders.data.push(item);
  reminders.data.sort((a, b) => a.at - b.at);
  reminders.save();
  send('reminders', reminders.data);
  send('toast', { text: `Напомню ${fmtWhen(item.at)}` });
  return item;
}

// «Искать в браузере»: поисковик из списка или свой адрес, где %s — запрос (без %s запрос дописывается в конец).
function searchUrl(q) {
  const e = encodeURIComponent(q);
  const base = S.searchUrl === 'custom' ? (S.searchCustom || '').trim() : S.searchUrl;
  if (!/^https?:\/\//i.test(base || '')) return 'https://yandex.ru/search/?text=' + e;
  return base.includes('%s') ? base.split('%s').join(e) : base + e;
}

// Звуки Windows для таймера и напоминаний.
function windowsSounds() {
  const dir = path.join(WIN, 'Media');
  try {
    return fs.readdirSync(dir).filter((f) => /\.wav$/i.test(f)).sort((a, b) => a.localeCompare(b))
      .map((f) => ({ name: f.replace(/\.wav$/i, ''), path: path.join(dir, f) }));
  } catch { return []; }
}

// ---------- Настройки ----------

function publicSettings() {
  return {
    ...S,
    ai: { ...S.ai, key: '', sttKey: '', hasKey: !!S.ai.key, hasSttKey: !!S.ai.sttKey },
    hotkeyErrors, hotkeysActive,
    displays: screen.getAllDisplays().map((d, i) => ({ id: d.id, name: `${d.label || 'Монитор ' + (i + 1)} · ${d.size.width}×${d.size.height}${d.id === screen.getPrimaryDisplay().id ? ' (основной)' : ''}` })),
    version: app.getVersion(),
  };
}

function applySettings(patch) {
  const old = JSON.stringify(S.hotkeys);
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && S[k] && typeof S[k] === 'object' && !Array.isArray(S[k])) {
      S[k] = { ...S[k], ...v };
    } else {
      S[k] = v;
    }
  }
  if (patch.ai) {
    // Ключи приходят только когда их ввели заново; хранятся зашифрованными.
    if (typeof patch.ai.key === 'string') S.ai.key = encrypt(patch.ai.key);
    if (typeof patch.ai.sttKey === 'string') S.ai.sttKey = encrypt(patch.ai.sttKey);
  }
  settings.save(100);
  if (JSON.stringify(S.hotkeys) !== old) registerHotkeys();
  if ('autostart' in patch) applyAutostart();
  if ('watchDownloads' in patch) watchDownloads();
  if ('winNotifs' in patch || 'hideWinBanners' in patch) watchWinNotifs();
  if ('hideFullscreen' in patch) applyVisibility();
  if ('display' in patch) { cursorDisplayId = null; updateDisplayRect(); placeIsland(); }
  if ('autoHide' in patch && !S.autoHide) setTucked(false);
  if ('islandScale' in patch || 'islandOffset' in patch) applyZoom();
  if ('hideApps' in patch || 'showApps' in patch) { if (lastExternal) checkFgApp(lastExternal); }
  const pub = publicSettings();
  send('settings', pub);
  return pub;
}

function applyAutostart() {
  const opts = { openAtLogin: !!S.autostart, path: process.execPath };
  if (!app.isPackaged) opts.args = [app.getAppPath()];
  app.setLoginItemSettings(opts);
}

// ---------- IPC ----------

function handle(ch, fn) {
  ipcMain.handle(ch, (e, ...a) => fn(...a));
}

function registerIpc() {
  handle('state', () => ({
    settings: publicSettings(), clips: publicClips(), shelf: shelf.data, notes: notes.data,
    reminders: reminders.data, timers: timerList(), media, vpn: vpnOn, battery: batteryState,
    idle: idleState, caps, layout, notifs: publicNotifs(),
  }));

  // окно острова
  ipcMain.on('win-hit', (e, r) => { hitRect = r; });
  ipcMain.on('win-h', (e, h) => {
    h = Math.max(60, Math.min(H, Math.round(h) || H));
    if (h !== islandH && island && !island.isDestroyed()) { islandH = h; placeIsland(); }
    e.returnValue = islandH;
  });
  ipcMain.on('win-eyes', (e, on) => { eyesOn = on; lastCursor = { x: -1, y: -1 }; });
  handle('win-focus', (on, restore = true) => (on ? focusIsland() : releaseIsland(restore)));

  // буфер обмена
  const findClip = (id) => clips.data.find((c) => c.id === id);
  handle('clip-paste', async (id) => { const c = findClip(id); if (!c) return; await writeClip(c); await pasteToPrevious(); });
  handle('clip-copy', async (id) => { const c = findClip(id); if (c) await writeClip(c); });
  handle('clip-pin', (id) => { const c = findClip(id); if (c) { c.pinned = !c.pinned; clips.save(); send('clips', publicClips()); } });
  handle('clip-delete', (id) => {
    const i = clips.data.findIndex((c) => c.id === id);
    if (i >= 0) { removeClipFiles(clips.data[i]); clips.data.splice(i, 1); clips.save(); send('clips', publicClips()); }
  });
  handle('clip-clear', () => {
    clips.data = clips.data.filter((c) => { if (!c.pinned) removeClipFiles(c); return c.pinned; });
    clips.save(); send('clips', publicClips());
  });

  // уведомления Windows
  handle('notif-open', (id) => {
    const i = notifs.data.findIndex((n) => n.id === id);
    if (i < 0) return;
    openNotifApp(notifs.data[i].aumid);
    notifs.data.splice(i, 1); notifs.save(); send('notifs', publicNotifs());
  });
  handle('notif-delete', (id) => {
    const i = notifs.data.findIndex((n) => n.id === id);
    if (i >= 0) { notifs.data.splice(i, 1); notifs.save(); send('notifs', publicNotifs()); }
  });
  handle('notif-clear', () => { notifs.data = []; notifs.save(); send('notifs', publicNotifs()); });
  handle('clip-pause', (on) => { clipPaused = on; return clipPaused; });
  handle('text-copy', async (text) => { await clip.writeText(text); ignoreSeq = clipSeq = native.clipboardSeq(); });
  handle('text-paste', async (text) => { await clip.writeText(text); ignoreSeq = clipSeq = native.clipboardSeq(); await pasteToPrevious(); });
  handle('text-read', () => clip.readText());

  // полка
  const shelfIcons = new Map();
  async function shelfItems() {
    return Promise.all(shelf.data.map(async (p) => {
      if (!shelfIcons.has(p)) {
        try { shelfIcons.set(p, (await app.getFileIcon(p, { size: 'normal' })).toDataURL()); } catch { shelfIcons.set(p, ''); }
      }
      let exists = true;
      try { fs.accessSync(p); } catch { exists = false; }
      return { path: p, name: path.basename(p), icon: shelfIcons.get(p), exists };
    }));
  }
  handle('shelf-get', shelfItems);
  handle('shelf-add', async (paths) => {
    for (const p of paths) if (p && !shelf.data.includes(p)) shelf.data.push(p);
    shelf.save();
    return shelfItems();
  });
  handle('shelf-remove', async (paths) => { shelf.data = shelf.data.filter((p) => !paths.includes(p)); shelf.save(); return shelfItems(); });
  handle('shelf-copy', async (paths) => { await helper.call('clip.files', { paths }, 5000); ignoreSeq = clipSeq = native.clipboardSeq(); });
  ipcMain.on('shelf-drag', async (e, paths) => {
    let icon = nativeImage.createFromBuffer(trayIcon(32));
    try { icon = await app.getFileIcon(paths[0], { size: 'normal' }); } catch {}
    e.sender.startDrag({ files: paths, icon });
  });
  // док приложений на «Главной»
  const dockIcons = new Map();
  async function dockItems() {
    return Promise.all(dock.data.map(async (p) => {
      if (!dockIcons.has(p)) {
        try { dockIcons.set(p, (await app.getFileIcon(p, { size: 'large' })).toDataURL()); } catch { dockIcons.set(p, ''); }
      }
      return { path: p, name: path.basename(p).replace(/\.(exe|lnk|url)$/i, ''), icon: dockIcons.get(p) };
    }));
  }
  handle('dock-get', dockItems);
  handle('dock-add', async (paths) => {
    if (!paths?.length) {
      releaseIsland(false);
      const r = await dialog.showOpenDialog({
        title: 'Добавить в док', properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Приложения и ярлыки', extensions: ['exe', 'lnk', 'url', 'bat', 'cmd'] }, { name: 'Все файлы', extensions: ['*'] }],
      });
      paths = r.canceled ? [] : r.filePaths;
    }
    for (const p of paths) if (p && !dock.data.includes(p)) dock.data.push(p);
    dock.save();
    return dockItems();
  });
  handle('dock-remove', (p) => { dock.data = dock.data.filter((x) => x !== p); dock.save(); return dockItems(); });

  handle('open-path', (p) => shell.openPath(p));
  // Карандаш на карточке скриншота: сразу в редактор (Paint), как у Island.
  handle('edit-image', (p) => {
    if (!/\.(png|jpe?g|bmp|gif)$/i.test(p) || !fs.existsSync(p)) return false;
    const c = spawn('mspaint.exe', [p], { detached: true, stdio: 'ignore', windowsHide: false });
    c.on('error', () => shell.openPath(p));
    c.unref();
    return true;
  });
  handle('show-path', (p) => shell.showItemInFolder(p));
  handle('open-url', (u) => { if (/^https?:\/\//i.test(u)) shell.openExternal(u); });

  // медиа и звук
  handle('media-ctl', async (action) => {
    const ok = await helper.call('media.ctl', { action, prefer: S.mediaPrefer }, 5000).catch(() => false);
    if (ok && media?.active && /^(playpause|play|pause)$/.test(action)) {
      const status = action === 'play' ? 'Playing' : action === 'pause' ? 'Paused' : media.status === 'Playing' ? 'Paused' : 'Playing';
      mediaIntent = { key: media.key, status, until: Date.now() + 3500 };
      media = { ...media, status, position: media.position + (media.status === 'Playing' && media.updated ? (Date.now() - media.updated) / 1000 : 0), updated: Date.now() };
      send('media', media);
    } else if (ok) mediaIntent = null;
    clearTimeout(mediaTimer); mediaTimer = setTimeout(pollMedia, 250);
    return ok;
  });
  handle('vol-get', () => helper.call('vol.get', {}, 5000));
  handle('vol-set', (args) => helper.call('vol.set', args, 5000));
  handle('audio-list', async () => (await helper.call('audio.list', {}, 5000)).list || []);
  handle('audio-set', (id) => helper.call('audio.set', { id }, 5000));
  handle('bright-get', () => helper.call('bright.get', {}, 5000).catch(() => null));
  handle('bright-set', async (level) => {
    const b = await helper.call('bright.set', { level }, 5000);
    brightPrev = b.level; // своё изменение не показываем всплывашкой
    return b;
  });
  handle('mic-get', () => helper.call('mic.get', {}, 5000));
  handle('mic-toggle', () => helper.call('mic.toggle', {}, 5000));

  // система
  handle('theme', (toggle) => helper.call('theme', { toggle: !!toggle }, 5000));
  handle('radios-get', () => helper.call('radios.get', {}, 8000).catch(() => []));
  handle('radios-set', (kind, on) => helper.call('radios.set', { kind, on }, 8000));
  handle('net-get', () => helper.call('net.get', {}, 8000).catch(() => ({})));
  handle('lock', () => spawn('rundll32.exe', ['user32.dll,LockWorkStation'], { detached: true, stdio: 'ignore' }).unref());
  handle('power', (kind) => {
    const cmd = {
      sleep: ['rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']],
      restart: ['shutdown.exe', ['/r', '/t', '0']],
      shutdown: ['shutdown.exe', ['/s', '/t', '0']],
    }[kind];
    if (cmd) spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref();
  });

  // ИИ
  // src — откуда ответ: { kind: 'api' } (ключ из настроек), { kind: 'local', id, model } или { kind: 'agent', id, session, resume, cwd }
  handle('ai-chat', async (id, messages, src = {}) => {
    try {
      if (src.kind === 'agent') return await agentChat(id, messages, src);
      const local = src.kind === 'local';
      const cfg = local ? { baseUrl: agents.localUrl(src.id), model: String(src.model || ''), key: '' } : aiConfig();
      if (!cfg.baseUrl || !cfg.model) throw new Error(local ? 'Не выбрана локальная модель' : 'ИИ не настроен — открой настройки');
      const msgs = S.ai.system ? [{ role: 'system', content: S.ai.system }, ...messages] : messages;
      const full = await services.aiStream(cfg, id, msgs, (d) => send('ai-delta', { id, text: d })).catch((e) => {
        throw local && /fetch failed/i.test(e.message) ? new Error('Локальный сервер не отвечает — запусти Ollama или LM Studio') : e;
      });
      send('ai-done', { id });
      return full;
    } catch (e) {
      send('ai-done', { id, error: e.message });
      throw e;
    }
  });
  // Вход в Claude Code делает сам пользователь: открываем консоль с claude, /login он набирает там.
  handle('agent-login', async () => {
    const bin = (await agents.detect(false)).bins.claude;
    if (!bin) throw new Error('Claude Code не установлен');
    spawn('cmd.exe', ['/k', `"${bin}"`], { cwd: os.homedir(), detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: true }).unref();
  });
  handle('ai-stop', (id) => agents.stop(id) || services.aiStop(id));
  handle('ai-sources', (force) => agents.detect(!!force).then(({ bins, ...r }) => ({ ...r, mode: S.ai.agentMode, custom: !!S.ai.agentCmd })));
  handle('ai-once', (system, text) => {
    const cfg = aiConfig();
    if (!cfg.baseUrl || !cfg.model) throw new Error('ИИ не настроен — открой настройки');
    return services.aiOnce(cfg, [{ role: 'system', content: system }, { role: 'user', content: text }], 60000);
  });
  // Проверка ключа: список моделей сервиса с таймаутом. Новые адрес и ключ можно передать до сохранения.
  handle('ai-models', (o = {}) => {
    const cfg = aiConfig();
    return services.aiModels({ baseUrl: o.baseUrl || cfg.baseUrl, key: typeof o.key === 'string' && o.key ? o.key : cfg.key }, 8000);
  });
  handle('lyrics', (m) => services.lyrics(m || {}));
  handle('vpn-toggle', () => vpnToggle());
  handle('sounds-list', () => windowsSounds());
  handle('pick-sound', async () => {
    const r = await dialog.showOpenDialog(settingsWin && !settingsWin.isDestroyed() ? settingsWin : undefined, {
      title: 'Звук для таймера и напоминаний', filters: [{ name: 'WAV', extensions: ['wav'] }], properties: ['openFile'],
    });
    return r.canceled ? '' : r.filePaths[0] || '';
  });
  handle('timer-add', (id, delta) => {
    const t = timers.get(id);
    if (!t) return;
    const left = Math.max(5e3, (t.paused ? t.left : t.end - Date.now()) + delta * 1000);
    t.total = Math.max(t.total, Math.ceil(left / 1000));
    if (t.paused) t.left = left; else { t.end = Date.now() + left; armTimer(t); }
    send('timers', timerList());
  });
  handle('stt', (bytes, mime) => services.transcribe(sttConfig(), Buffer.from(bytes), mime));

  // погода
  handle('weather', (force) => services.weather(S.weather, force));
  handle('geo-search', (q) => services.geocode(q));

  // заметки
  handle('notes-save', (list) => { notes.data = list; notes.save(); });

  // таймеры и напоминания
  handle('timer-start', (seconds, label) => startTimer(seconds, label));
  handle('timer-stop', (id) => { const t = timers.get(id); if (t) { clearTimeout(t.handle); timers.delete(id); } send('timers', timerList()); });
  handle('timer-pause', (id) => {
    const t = timers.get(id);
    if (!t) return;
    if (t.paused) { t.paused = false; t.end = Date.now() + t.left; armTimer(t); }
    else { t.paused = true; t.left = Math.max(0, t.end - Date.now()); clearTimeout(t.handle); }
    send('timers', timerList());
  });
  handle('reminder-parse', (text) => parse.parseReminder(text));
  handle('reminder-add', (r) => addReminder(r));
  handle('reminder-remove', (id) => {
    reminders.data = reminders.data.filter((r) => r.id !== id); reminders.save(); send('reminders', reminders.data);
  });
  handle('fmt-when', (ms) => fmtWhen(ms));

  // командная строка
  handle('cmd-query', commandQuery);
  handle('cmd-run', commandRun);

  // инструменты
  handle('capture', (mode) => { releaseIsland(true); setTimeout(() => startCapture(mode), 120); });
  ipcMain.on('ov-result', (e, res) => onCaptureResult(res));
  handle('qr-make', (text) => text);

  // запись экрана
  handle('rec-start', (ext) => {
    fs.mkdirSync(S.recDir, { recursive: true });
    recFile = path.join(S.recDir, `Запись ${stamp()}.${ext === 'mp4' ? 'mp4' : 'webm'}`);
    recStream = fs.createWriteStream(recFile);
  });
  ipcMain.on('rec-chunk', (e, bytes) => { recStream?.write(Buffer.from(bytes)); });
  handle('rec-stop', () => new Promise((resolve) => {
    if (!recStream) return resolve(null);
    const f = recFile;
    recStream.end(() => resolve(f));
    recStream = null;
  }));

  // настройки
  handle('settings-get', publicSettings);
  handle('settings-set', applySettings);
  handle('open-settings', (section, again) => { setImmediate(() => openSettings(section, again)); });
  // кнопки своей полосы заголовка у окна без рамки
  ipcMain.handle('win-ctl', (e, what, n) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return;
    if (what === 'min') w.minimize();
    else if (what === 'max') (w.isMaximized() ? w.unmaximize() : w.maximize());
    else if (what === 'close') w.close();
    else if (what === 'fit' && w.wizard) {
      // высота окна мастера = высота шага; верхний край стоит на месте, первый раз — по центру экрана
      const b = w.getContentBounds(), wa = screen.getDisplayMatching(b).workArea;
      const h = Math.round(Math.max(360, Math.min(Number(n) || 640, wa.height - 60, 820)));
      const first = !w.isVisible();
      const y = first ? wa.y + Math.round((wa.height - h) / 2) : Math.min(b.y, wa.y + wa.height - h);
      w.setContentBounds({ x: b.x, y, width: b.width, height: h });
      if (first) w.show();
    }
  });
  handle('cc-status', ccStatus);
  handle('cc-install', () => {
    ccWrite((j) => {
      ccStrip(j);
      j.hooks = j.hooks || {};
      for (const ev of CC_EVENTS) {
        j.hooks[ev] = j.hooks[ev] || [];
        j.hooks[ev].push({ hooks: [{ type: 'command', command: CC_CMD }] });
      }
      if (S.ccAsk !== false) {
        for (const [ev, matcher] of Object.entries(CC_ASK_HOOKS)) {
          j.hooks[ev] = j.hooks[ev] || [];
          j.hooks[ev].push({ matcher, hooks: [{ type: 'command', command: CC_ASK_CMD, timeout: 600 }] });
        }
      }
    });
    return ccStatus();
  });
  handle('claude-answer', (id, ans) => ccAnswer(id, ans));
  handle('claude-asks', () => [...ccAsks.values()].map((a) => a.msg).filter(Boolean));
  handle('cc-remove', () => { ccWrite((j) => ccStrip(j)); return ccStatus(); });
  // кнопка «Добавить хук»: только хуки ответов с острова, остальные записи не трогаем
  handle('cc-ask-install', () => {
    ccWrite((j) => {
      ccStrip(j, Object.keys(CC_ASK_HOOKS));
      j.hooks = j.hooks || {};
      for (const [ev, matcher] of Object.entries(CC_ASK_HOOKS)) {
        j.hooks[ev] = j.hooks[ev] || [];
        j.hooks[ev].push({ matcher, hooks: [{ type: 'command', command: CC_ASK_CMD, timeout: 600 }] });
      }
    });
    return ccStatus();
  });
  handle('cc-ask-remove', () => { ccWrite((j) => ccStrip(j, Object.keys(CC_ASK_HOOKS))); return ccStatus(); });
  handle('quit', () => app.quit());
}

// ---------- Трей ----------

function createTray() {
  tray = new Tray(nativeImage.createFromBuffer(trayIcon(32)));
  tray.setToolTip('Islet');
  const menu = () => Menu.buildFromTemplate([
    { label: userHidden ? 'Показать остров' : 'Спрятать остров', click: () => { userHidden = !userHidden; applyVisibility(); } },
    { label: clipPaused ? 'Продолжить запись буфера' : 'Пауза буфера обмена', click: () => { clipPaused = !clipPaused; } },
    { type: 'separator' },
    { label: 'Настройки', click: () => openSettings() },
    { label: 'Перезапустить', click: () => { app.relaunch(); app.quit(); } },
    { label: 'Выход', click: () => app.quit() },
  ]);
  tray.on('click', () => { userHidden = false; applyVisibility(); openPanel('home', false); });
  tray.on('right-click', () => tray.popUpContextMenu(menu()));
}

// ---------- Запуск ----------

app.on('second-instance', (e, argv) => {
  if (argv.includes('--quit')) { app.quit(); return; }
  userHidden = false; applyVisibility(); openSettings();
});

// Шаг запуска, упавший под нагрузкой, не роняет остальное: пишем в журнал и через несколько секунд пробуем снова.
function step(name, fn, retries = 2) {
  try { fn(); } catch (e) {
    logLine('start ' + name, e);
    if (retries > 0) setTimeout(() => step(name, fn, retries - 1), 4000);
  }
}

app.whenReady().then(() => {
  // Сразу после входа в Windows ПК занят автозагрузкой: второстепенное откладываем.
  const late = os.uptime() < 180 ? 15000 : 0;
  step('helper', () => helper.start());
  step('display', updateDisplayRect);
  step('island', () => { try { createIsland(); } catch (e) { recreateIsland('start: ' + e.message); } }, 0);
  step('ipc', registerIpc, 0);
  if (!S.onboarded) setTimeout(() => step('welcome', () => openSettings('welcome')), 1200);
  step('tray', createTray);
  step('overlay', createOverlay);
  step('hotkeys', registerHotkeys);
  step('display media', setupDisplayMedia);
  // Установщик передаёт --autostart, если оставили галочку «Запускать вместе с Windows».
  if (process.argv.includes('--autostart') && !S.autostart) { S.autostart = true; settings.save(); }
  step('autostart', applyAutostart);
  step('claude', startClaudeBridge);
  setTimeout(() => { step('downloads', watchDownloads); step('win notifs', watchWinNotifs); }, late);

  setInterval(pollForeground, 150);
  setInterval(pollCursor, 33);
  setInterval(pollPeak, 33);
  setInterval(pollClipboard, 250);
  setInterval(pollIdle, 2000);
  setInterval(checkReminders, 5000);
  setInterval(pollNet, 15000);
  setInterval(pollLevels, 300);
  setInterval(pollActiveDownloads, 1000);
  setInterval(loadApps, 10 * 60e3);
  setTimeout(pollMedia, 500);
  setTimeout(pollNet, 1500);
  setTimeout(loadApps, 3000 + late);
  checkReminders();

  const onDisplays = () => { updateDisplayRect(); placeIsland(); };
  screen.on('display-metrics-changed', onDisplays);
  screen.on('display-added', onDisplays);
  screen.on('display-removed', onDisplays);
});

app.on('window-all-closed', () => {}); // живём в трее

// Ошибки интерфейса — в консоль главного процесса, чтобы их было видно при запуске из терминала.
app.on('web-contents-created', (e, wc) => {
  wc.on('console-message', (ev, lvl, msg, line, src) => {
    const level = ev.level ?? lvl, text = ev.message ?? msg;
    if (level === 'error' || level === 'warning' || level >= 2) {
      console.log(`[ui ${level}] ${text} (${String(ev.sourceId ?? src).split('/').pop()}:${ev.lineNumber ?? line})`);
    }
  });
  wc.on('render-process-gone', (ev, d) => console.log('[ui gone]', d.reason));
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  for (const s of [settings, clips, shelf, notes, reminders, notifs, appIcons]) { if (s.timer) s.flush(); }
  restoreBanners();
  helper.stop();
});
