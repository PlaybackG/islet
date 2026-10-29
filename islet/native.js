// Прямые вызовы WinAPI через koffi: без запуска процессов, за микросекунды.
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

koffi.alias('HWND', 'void *');
koffi.alias('HANDLE', 'void *');
koffi.alias('DWORD', 'uint32_t');
koffi.struct('RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });

const GetForegroundWindow = user32.func('HWND __stdcall GetForegroundWindow()');
const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(HWND hWnd)');
const BringWindowToTop = user32.func('bool __stdcall BringWindowToTop(HWND hWnd)');
const IsWindow = user32.func('bool __stdcall IsWindow(HWND hWnd)');
const GetWindowThreadProcessId = user32.func('DWORD __stdcall GetWindowThreadProcessId(HWND hWnd, _Out_ DWORD *pid)');
const AttachThreadInput = user32.func('bool __stdcall AttachThreadInput(DWORD a, DWORD b, bool attach)');
const GetCurrentThreadId = kernel32.func('DWORD __stdcall GetCurrentThreadId()');
const keybd_event = user32.func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, DWORD flags, uintptr_t extra)');
const GetKeyState = user32.func('int16_t __stdcall GetKeyState(int vk)');
const GetAsyncKeyState = user32.func('int16_t __stdcall GetAsyncKeyState(int vk)');
const GetKeyboardLayout = user32.func('void * __stdcall GetKeyboardLayout(DWORD thread)');
const GetClipboardSequenceNumber = user32.func('DWORD __stdcall GetClipboardSequenceNumber()');
const RegisterClipboardFormatW = user32.func('uint32_t __stdcall RegisterClipboardFormatW(const char16_t *name)');
const IsClipboardFormatAvailable = user32.func('bool __stdcall IsClipboardFormatAvailable(uint32_t fmt)');
const OpenClipboard = user32.func('bool __stdcall OpenClipboard(HWND owner)');
const CloseClipboard = user32.func('bool __stdcall CloseClipboard()');
const GetClipboardData = user32.func('HANDLE __stdcall GetClipboardData(uint32_t fmt)');
const GlobalLock = kernel32.func('void * __stdcall GlobalLock(HANDLE h)');
const GlobalUnlock = kernel32.func('bool __stdcall GlobalUnlock(HANDLE h)');
const GetWindowRect =user32.func('bool __stdcall GetWindowRect(HWND hWnd, _Out_ RECT *rect)');
const GetClassNameW = user32.func('int __stdcall GetClassNameW(HWND hWnd, _Out_ uint16_t *buf, int max)');
const OpenProcess = kernel32.func('HANDLE __stdcall OpenProcess(DWORD access, bool inherit, DWORD pid)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(HANDLE h)');
const QueryFullProcessImageNameW = kernel32.func('bool __stdcall QueryFullProcessImageNameW(HANDLE h, DWORD flags, _Out_ uint16_t *buf, _Inout_ DWORD *size)');
koffi.struct('LASTINPUTINFO', { cbSize: 'uint32_t', dwTime: 'uint32_t' });
koffi.struct('SYSTEM_POWER_STATUS', {
  ACLineStatus: 'uint8_t', BatteryFlag: 'uint8_t', BatteryLifePercent: 'uint8_t', SystemStatusFlag: 'uint8_t',
  BatteryLifeTime: 'uint32_t', BatteryFullLifeTime: 'uint32_t',
});
const GetLastInputInfo = user32.func('bool __stdcall GetLastInputInfo(_Inout_ LASTINPUTINFO *info)');
const GetTickCount = kernel32.func('uint32_t __stdcall GetTickCount()');
const GetSystemPowerStatus = kernel32.func('bool __stdcall GetSystemPowerStatus(_Out_ SYSTEM_POWER_STATUS *st)');

const VK = { CONTROL: 0x11, SHIFT: 0x10, MENU: 0x12, LWIN: 0x5b, RWIN: 0x5c, CAPITAL: 0x14, V: 0x56 };
const KEYUP = 2;

const fmtExclude = RegisterClipboardFormatW('ExcludeClipboardContentFromMonitorProcessing');
const fmtViewerIgnore = RegisterClipboardFormatW('Clipboard Viewer Ignore');
const fmtHistory = RegisterClipboardFormatW('CanIncludeInClipboardHistory');

function foreground() {
  return GetForegroundWindow();
}

function threadOf(hwnd) {
  return GetWindowThreadProcessId(hwnd, [0]);
}

function pidOf(hwnd) {
  const out = [0];
  GetWindowThreadProcessId(hwnd, out);
  return out[0];
}

// Вернуть фокус окну, в котором человек печатал.
function focusWindow(hwnd) {
  if (!hwnd || !IsWindow(hwnd)) return false;
  if (GetForegroundWindow() === hwnd) return true;
  const fg = GetForegroundWindow();
  const me = GetCurrentThreadId();
  const other = fg ? threadOf(fg) : 0;
  if (other && other !== me) AttachThreadInput(me, other, true);
  BringWindowToTop(hwnd);
  SetForegroundWindow(hwnd);
  if (other && other !== me) AttachThreadInput(me, other, false);
  return GetForegroundWindow() === hwnd;
}

function keyDown(vk) { return (GetAsyncKeyState(vk) & 0x8000) !== 0; }

// Отпустить модификаторы, если человек их ещё держит после горячей клавиши.
function releaseModifiers() {
  for (const vk of [VK.MENU, VK.SHIFT, VK.LWIN, VK.RWIN]) {
    if (keyDown(vk)) keybd_event(vk, 0, KEYUP, 0);
  }
}

function sendCtrlV() {
  releaseModifiers();
  keybd_event(VK.CONTROL, 0, 0, 0);
  keybd_event(VK.V, 0, 0, 0);
  keybd_event(VK.V, 0, KEYUP, 0);
  keybd_event(VK.CONTROL, 0, KEYUP, 0);
}

// Зажата ли основная кнопка мыши (нужно, чтобы ловить перетаскивание файлов на остров).
function mouseDown() {
  return keyDown(0x01) || keyDown(0x02);
}

// Где-то в системе тащат файл: проводник и браузеры показывают окно-призрак SysDragImage.
const FindWindowW = user32.func('HWND __stdcall FindWindowW(const char16_t *cls, const char16_t *title)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(HWND hWnd)');
function fileDragging() {
  const h = FindWindowW('SysDragImage', null);
  return !!h && IsWindowVisible(h);
}

function capsLock() {
  return (GetKeyState(VK.CAPITAL) & 1) === 1;
}

// Раскладка активного окна: 'RU', 'EN', ...
const LANGS = { 0x0419: 'RU', 0x0409: 'EN', 0x0809: 'EN', 0x0422: 'UK', 0x0423: 'BE', 0x043f: 'KK', 0x0407: 'DE', 0x040c: 'FR' };
function keyboardLayout() {
  const fg = GetForegroundWindow();
  const hkl = GetKeyboardLayout(fg ? threadOf(fg) : 0);
  const lang = Number(BigInt.asUintN(64, BigInt(hkl || 0)) & 0xffffn);
  return LANGS[lang] || lang.toString(16).toUpperCase();
}

function clipboardSeq() {
  return GetClipboardSequenceNumber();
}

// Менеджеры паролей помечают свои копии этими форматами или ставят CanIncludeInClipboardHistory = 0.
function clipboardIsPrivate() {
  if (IsClipboardFormatAvailable(fmtExclude) || IsClipboardFormatAvailable(fmtViewerIgnore)) return true;
  if (!IsClipboardFormatAvailable(fmtHistory)) return false;
  if (!OpenClipboard(null)) return false;
  try {
    const h = GetClipboardData(fmtHistory);
    const p = h && GlobalLock(h);
    if (!p) return false;
    try { return koffi.decode(p, 'uint32_t') === 0; } finally { GlobalUnlock(h); }
  } finally { CloseClipboard(); }
}

// В буфере файлы из проводника (CF_HDROP).
function clipboardHasFiles() {
  return IsClipboardFormatAvailable(15);
}

function windowRect(hwnd) {
  const r = {};
  if (!hwnd || !GetWindowRect(hwnd, r)) return null;
  return r;
}

function className(hwnd) {
  const buf = new Uint16Array(256);
  const n = GetClassNameW(hwnd, buf, 256);
  return n > 0 ? String.fromCharCode(...buf.subarray(0, n)) : '';
}

function processName(hwnd) {
  const pid = pidOf(hwnd);
  if (!pid) return '';
  const h = OpenProcess(0x1000, false, pid);
  if (!h) return '';
  try {
    const buf = new Uint16Array(1024);
    const size = [1024];
    if (!QueryFullProcessImageNameW(h, 0, buf, size)) return '';
    const full = String.fromCharCode(...buf.subarray(0, size[0]));
    return full.split('\\').pop().toLowerCase();
  } finally {
    CloseHandle(h);
  }
}

function handleOf(win) {
  const b = win.getNativeWindowHandle();
  return b.readBigUInt64LE(0);
}

// Сколько миллисекунд не было ввода с клавиатуры и мыши.
function idleMs() {
  const info = { cbSize: 8, dwTime: 0 };
  if (!GetLastInputInfo(info)) return 0;
  return (GetTickCount() - info.dwTime) >>> 0;
}

// { percent, charging } или null, если батареи нет.
function battery() {
  const st = {};
  if (!GetSystemPowerStatus(st)) return null;
  if (st.BatteryFlag === 128 || st.BatteryFlag === 255 || st.BatteryLifePercent === 255) return null;
  return { percent: st.BatteryLifePercent, charging: st.ACLineStatus === 1, saver: st.SystemStatusFlag === 1 };
}

// ---------- Пик громкости колонок (волна под бит) ----------
// IAudioMeterInformation напрямую через COM: один вызов — доли микросекунды.

koffi.struct('GUID', { d1: 'uint32_t', d2: 'uint16_t', d3: 'uint16_t', d4: koffi.array('uint8_t', 8) });
const ole32 = koffi.load('ole32.dll');
const CoInitializeEx = ole32.func('int32_t __stdcall CoInitializeEx(void *res, uint32_t flags)');
const CoCreateInstance = ole32.func('int32_t __stdcall CoCreateInstance(const GUID *clsid, void *outer, uint32_t ctx, const GUID *iid, _Out_ void **out)');

function guid(s) {
  const h = s.replace(/-/g, '');
  return {
    d1: parseInt(h.slice(0, 8), 16), d2: parseInt(h.slice(8, 12), 16), d3: parseInt(h.slice(12, 16), 16),
    d4: Array.from({ length: 8 }, (_, i) => parseInt(h.slice(16 + i * 2, 18 + i * 2), 16)),
  };
}
const CLSID_Enumerator = guid('BCDE0395-E52F-467C-8E3D-C4579291692E');
const IID_Enumerator = guid('A95664D2-9614-4F35-A746-DE8DB63617E6');
const IID_Meter = guid('C02216F6-8C67-4B5B-9D00-D008E73E0064');
const P_Release = koffi.proto('uint32_t __stdcall ComRelease(void *self)');
const P_DefaultEndpoint = koffi.proto('int32_t __stdcall GetDefaultAudioEndpoint(void *self, int flow, int role, _Out_ void **dev)');
const P_Activate = koffi.proto('int32_t __stdcall Activate(void *self, const GUID *iid, uint32_t ctx, void *params, _Out_ void **out)');
const P_Peak = koffi.proto('int32_t __stdcall GetPeakValue(void *self, _Out_ float *v)');

const vfn = (obj, i) => koffi.decode(koffi.decode(obj, 'void *'), i * 8, 'void *');
const release = (obj) => { if (obj) koffi.call(vfn(obj, 2), P_Release, obj); };

let meter = null, meterAt = 0, comReady = false;
function openMeter() {
  if (!comReady) { CoInitializeEx(null, 2); comReady = true; }
  const en = [null];
  if (CoCreateInstance(CLSID_Enumerator, null, 0x17, IID_Enumerator, en) < 0 || !en[0]) return null;
  try {
    const dev = [null];
    if (koffi.call(vfn(en[0], 4), P_DefaultEndpoint, en[0], 0, 1, dev) < 0 || !dev[0]) return null;
    try {
      const m = [null];
      if (koffi.call(vfn(dev[0], 3), P_Activate, dev[0], IID_Meter, 0x17, null, m) < 0) return null;
      return m[0];
    } finally { release(dev[0]); }
  } finally { release(en[0]); }
}

// 0…1. Колонки по умолчанию могли смениться — переоткрываем раз в 4 секунды.
function audioPeak() {
  try {
    const now = Date.now();
    if (!meter || now - meterAt > 4000) { release(meter); meter = openMeter(); meterAt = now; }
    if (!meter) return 0;
    const v = [0];
    if (koffi.call(vfn(meter, 3), P_Peak, meter, v) < 0) { release(meter); meter = null; return 0; }
    return v[0];
  } catch { meter = null; return 0; }
}

// DWORD-значения в HKEY_CURRENT_USER без запуска reg.exe. null — значения нет.
const advapi32 = koffi.load('advapi32.dll');
const RegGetValueW = advapi32.func('int32_t __stdcall RegGetValueW(intptr_t key, const char16_t *sub, const char16_t *name, DWORD flags, uint32_t *type, _Out_ uint32_t *data, _Inout_ uint32_t *cb)');
const RegSetKeyValueW = advapi32.func('int32_t __stdcall RegSetKeyValueW(intptr_t key, const char16_t *sub, const char16_t *name, DWORD type, uint32_t *data, DWORD cb)');
const RegDeleteKeyValueW = advapi32.func('int32_t __stdcall RegDeleteKeyValueW(intptr_t key, const char16_t *sub, const char16_t *name)');
const HKCU = -2147483647; // (HKEY)(LONG)0x80000001
const RRF_RT_REG_DWORD = 0x10, REG_DWORD = 4;

function regDword(sub, name) {
  try { const v = [0], cb = [4]; return RegGetValueW(HKCU, sub, name, RRF_RT_REG_DWORD, null, v, cb) === 0 ? v[0] : null; } catch { return null; }
}
function setRegDword(sub, name, v) {
  try { return (v == null ? RegDeleteKeyValueW(HKCU, sub, name) : RegSetKeyValueW(HKCU, sub, name, REG_DWORD, [v >>> 0], 4)) === 0; } catch { return false; }
}

module.exports = {
  foreground, focusWindow, sendCtrlV, capsLock, keyboardLayout,
  clipboardSeq, clipboardIsPrivate, clipboardHasFiles, windowRect, className, processName, handleOf,
  idleMs, battery, mouseDown, audioPeak, fileDragging, regDword, setRegDword,
};
