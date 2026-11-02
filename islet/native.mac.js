// То же, что native.js, но для macOS: Core Graphics и AppKit через koffi, без запуска процессов.
// «Окно» здесь — pid приложения: на Mac активно приложение, а не окно.
const koffi = require('koffi');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const fw = (n) => koffi.load(`/System/Library/Frameworks/${n}.framework/${n}`);
const objc = koffi.load('/usr/lib/libobjc.A.dylib');
const cg = fw('CoreGraphics'), cf = fw('CoreFoundation'), carbon = fw('Carbon');
fw('AppKit');

koffi.struct('CGRect', { x: 'double', y: 'double', w: 'double', h: 'double' });

const objc_getClass = objc.func('void *objc_getClass(const char *name)');
const sel_registerName = objc.func('void *sel_registerName(const char *name)');
const poolPush = objc.func('void *objc_autoreleasePoolPush()');
const poolPop = objc.func('void objc_autoreleasePoolPop(void *pool)');
const msg = (ret, ...args) => objc.func('objc_msgSend', ret, ['void *', 'void *', ...args]);
const msgObj = msg('void *'), msgLong = msg('int64_t'), msgInt = msg('int32_t'), msgBool = msg('bool');
const msgObjStr = msg('void *', 'const char *'), msgObjInt = msg('void *', 'int32_t');
const msgObjObj = msg('void *', 'void *'), msgBoolObj = msg('bool', 'void *'), msgBoolLong = msg('bool', 'uint64_t');

const cls = (n) => objc_getClass(n), sel = (n) => sel_registerName(n);
const pooled = (fn) => { const p = poolPush(); try { return fn(); } finally { poolPop(p); } };
const nsstr = (s) => msgObjStr(cls('NSString'), sel('stringWithUTF8String:'), s);

const SOURCE = 1; // kCGEventSourceStateHIDSystemState
const CGEventSourceSecondsSinceLastEventType = cg.func('double CGEventSourceSecondsSinceLastEventType(int src, uint32_t type)');
const CGEventSourceButtonState = cg.func('bool CGEventSourceButtonState(int src, uint32_t button)');
const CGEventSourceFlagsState = cg.func('uint64_t CGEventSourceFlagsState(int src)');
const CGEventCreateKeyboardEvent = cg.func('void *CGEventCreateKeyboardEvent(void *src, uint16_t key, bool down)');
const CGEventSetFlags = cg.func('void CGEventSetFlags(void *e, uint64_t flags)');
const CGEventPost = cg.func('void CGEventPost(int tap, void *e)');
const CGWindowListCopyWindowInfo = cg.func('void *CGWindowListCopyWindowInfo(uint32_t opt, uint32_t rel)');
const CGRectMakeWithDictionaryRepresentation = cg.func('bool CGRectMakeWithDictionaryRepresentation(void *d, _Out_ CGRect *r)');
const CFRelease = cf.func('void CFRelease(void *o)');
const CFArrayGetCount = cf.func('int64_t CFArrayGetCount(void *a)');
const CFArrayGetValueAtIndex = cf.func('void *CFArrayGetValueAtIndex(void *a, int64_t i)');
const CFDictionaryGetValue = cf.func('void *CFDictionaryGetValue(void *d, void *k)');
const CFNumberGetValue = cf.func('bool CFNumberGetValue(void *n, int type, _Out_ int32_t *v)');
const CFStringCreateWithCString = cf.func('void *CFStringCreateWithCString(void *a, const char *s, uint32_t enc)');
const CFStringGetCString = cf.func('bool CFStringGetCString(void *s, _Out_ uint8_t *buf, int64_t size, uint32_t enc)');
const TISCopyCurrentKeyboardInputSource = carbon.func('void *TISCopyCurrentKeyboardInputSource()');
const TISGetInputSourceProperty = carbon.func('void *TISGetInputSourceProperty(void *src, void *key)');
const proc_pidpath = koffi.load('/usr/lib/libproc.dylib').func('int proc_pidpath(int pid, _Out_ uint8_t *buf, uint32_t size)');

const UTF8 = 0x08000100;
const cfstr = (s) => CFStringCreateWithCString(null, s, UTF8);
const K_PID = cfstr('kCGWindowOwnerPID'), K_LAYER = cfstr('kCGWindowLayer'), K_BOUNDS = cfstr('kCGWindowBounds');
const K_LANGS = cfstr('TISPropertyInputSourceLanguages');

function foreground() {
  return pooled(() => {
    const app = msgObj(msgObj(cls('NSWorkspace'), sel('sharedWorkspace')), sel('frontmostApplication'));
    return app ? msgInt(app, sel('processIdentifier')) : 0;
  });
}

// Своё приложение не активируем: панели острова принимают ввод, не забирая фокус у чужого окна.
function focusWindow(pid) {
  if (!pid || pid === process.pid) return !!pid;
  return pooled(() => {
    const app = msgObjInt(cls('NSRunningApplication'), sel('runningApplicationWithProcessIdentifier:'), pid);
    return !!app && msgBoolLong(app, sel('activateWithOptions:'), 2n);
  });
}

// Вставка в другое приложение: нужен доступ к «Универсальному доступу», main спрашивает его сам.
function sendPaste() {
  for (const down of [true, false]) {
    const e = CGEventCreateKeyboardEvent(null, 9, down); // kVK_ANSI_V
    CGEventSetFlags(e, 0x100000n); // Command
    CGEventPost(0, e);
    CFRelease(e);
  }
}

// Перетаскивание файла видно по системному буферу drag: он меняется, пока кнопка зажата.
const dragBoard = pooled(() => msgObj(msgObjObj(cls('NSPasteboard'), sel('pasteboardWithName:'), nsstr('Apple CFPasteboard drag')), sel('retain')));
const general = () => msgObj(cls('NSPasteboard'), sel('generalPasteboard'));
const count = (pb) => Number(msgLong(pb, sel('changeCount')));
const hasType = (pb, t) => { const l = msgObj(pb, sel('types')); return !!l && msgBoolObj(l, sel('containsObject:'), nsstr(t)); };

let dragBase = 0;
function mouseDown() {
  const down = CGEventSourceButtonState(SOURCE, 0) || CGEventSourceButtonState(SOURCE, 1);
  if (!down) dragBase = pooled(() => count(dragBoard));
  return down;
}
const fileDragging = () => pooled(() => count(dragBoard) !== dragBase && hasType(dragBoard, 'public.file-url'));

const capsLock = () => (BigInt(CGEventSourceFlagsState(SOURCE)) & 0x10000n) !== 0n;

function keyboardLayout() {
  const src = TISCopyCurrentKeyboardInputSource();
  try {
    const list = TISGetInputSourceProperty(src, K_LANGS);
    if (!list || !CFArrayGetCount(list)) return '';
    const buf = new Uint8Array(16);
    if (!CFStringGetCString(CFArrayGetValueAtIndex(list, 0), buf, 16, UTF8)) return '';
    return Buffer.from(buf).toString('utf8').split('\0')[0].slice(0, 2).toUpperCase();
  } finally { CFRelease(src); }
}

const clipboardSeq = () => pooled(() => count(general()));

// Договорённость менеджеров паролей: nspasteboard.org.
const clipboardIsPrivate = () => pooled(() => ['org.nspasteboard.ConcealedType', 'org.nspasteboard.TransientType', 'org.nspasteboard.AutoGeneratedType']
  .some((t) => hasType(general(), t)));
const clipboardHasFiles = () => pooled(() => hasType(general(), 'public.file-url'));

// Обычное окно приложения, самое верхнее. Права на запись экрана для рамок не нужны.
function windowRect(pid) {
  const list = CGWindowListCopyWindowInfo(1 | 16, 0); // только видимые, без рабочего стола
  if (!list) return null;
  try {
    const num = (d, k) => { const v = [0], n = CFDictionaryGetValue(d, k); return n && CFNumberGetValue(n, 3, v) ? v[0] : -1; };
    for (let i = 0, n = CFArrayGetCount(list); i < n; i++) {
      const w = CFArrayGetValueAtIndex(list, i);
      if (num(w, K_PID) !== pid || num(w, K_LAYER) !== 0) continue;
      const r = {};
      if (!CGRectMakeWithDictionaryRepresentation(CFDictionaryGetValue(w, K_BOUNDS), r)) return null;
      return { left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h };
    }
    return null;
  } finally { CFRelease(list); }
}

function processName(pid) {
  const buf = new Uint8Array(4096);
  const n = proc_pidpath(pid, buf, 4096);
  return n > 0 ? path.basename(Buffer.from(buf.subarray(0, n)).toString('utf8')).toLowerCase() : '';
}

const idleMs = () => CGEventSourceSecondsSinceLastEventType(SOURCE, 0xffffffff) * 1000;

// { percent, charging } или null, если батареи нет. Зовётся раз в 15 секунд.
function battery() {
  try {
    const out = execFileSync('/usr/bin/pmset', ['-g', 'batt'], { encoding: 'utf8', timeout: 2000 });
    const m = out.match(/(\d+)%;\s*([a-z ]+)/i);
    if (!m) return null;
    const saver = pooled(() => msgBool(msgObj(cls('NSProcessInfo'), sel('processInfo')), sel('isLowPowerModeEnabled')));
    return { percent: +m[1], charging: !/^discharging/i.test(m[2]), saver };
  } catch { return null; }
}

// ponytail: честный пик системного звука требует записи звука и фиолетовой точки в меню ради украшения.
// Пока волна качается в ровном ритме 120 BPM; настоящий пик — через Core Audio tap, если понадобится.
const audioPeak = () => 0.25 + 0.55 * (1 - (Date.now() / 500) % 1) ** 3;

const handleOf = () => process.pid;
const toolWindow = () => {};
const isMaximized = () => false;
const className = () => '';
const regDword = () => null;
const setRegDword = () => false;

module.exports = {
  foreground, focusWindow, sendPaste, capsLock, keyboardLayout,
  clipboardSeq, clipboardIsPrivate, clipboardHasFiles, windowRect, isMaximized, className, processName, handleOf, toolWindow,
  idleMs, battery, mouseDown, audioPeak, fileDragging, regDword, setRegDword,
};
