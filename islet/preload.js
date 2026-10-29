// Мост между интерфейсом и главным процессом: только перечисленные каналы.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const INVOKE = new Set([
  'state', 'win-focus',
  'clip-paste', 'clip-copy', 'clip-pin', 'clip-delete', 'clip-clear', 'clip-pause', 'text-copy', 'text-paste', 'text-read',
  'notif-open', 'notif-delete', 'notif-clear',
  'shelf-get', 'shelf-add', 'shelf-remove', 'shelf-copy', 'dock-get', 'dock-add', 'dock-remove', 'open-path', 'show-path', 'open-url', 'edit-image',
  'media-ctl', 'vol-get', 'vol-set', 'audio-list', 'audio-set', 'bright-get', 'bright-set','mic-get', 'mic-toggle', 'theme', 'radios-get', 'radios-set', 'net-get', 'lock', 'power',
  'ai-chat', 'ai-stop', 'ai-once', 'stt', 'weather', 'geo-search', 'notes-save',
  'timer-start', 'timer-stop', 'timer-pause', 'reminder-parse', 'reminder-add', 'reminder-remove', 'fmt-when',
  'cmd-query', 'cmd-run', 'capture', 'rec-start', 'rec-stop',
  'settings-get', 'settings-set', 'open-settings', 'win-ctl', 'cc-status', 'cc-install', 'cc-remove', 'cc-ask-install', 'cc-ask-remove', 'quit',
  'ai-models', 'ai-sources', 'lyrics', 'vpn-toggle', 'sounds-list', 'pick-sound', 'timer-add', 'claude-answer', 'claude-asks', 'agent-login',
]);
const SEND = new Set(['win-hit', 'win-eyes', 'shelf-drag', 'ov-result', 'rec-chunk']);
const EVENTS = new Set([
  'open', 'blur', 'hover', 'drag-near', 'cursor', 'idle', 'indicator', 'clips', 'media', 'timers', 'timer-done',
  'reminder', 'reminders', 'download', 'win-notif', 'vpn', 'battery', 'claude', 'toast', 'ocr-result', 'qr-result',
  'ai-delta', 'ai-done', 'settings', 'section', 'ov-start', 'ov-clear', 'near', 'vol', 'bright', 'dl-progress', 'level', 'file-drag', 'freeze', 'tuck', 'vpn-info',
  'claude-ask', 'notifs',
]);

contextBridge.exposeInMainWorld('islet', {
  invoke: (ch, ...a) => (INVOKE.has(ch) ? ipcRenderer.invoke(ch, ...a) : Promise.reject(new Error('channel ' + ch))),
  send: (ch, ...a) => { if (SEND.has(ch)) ipcRenderer.send(ch, ...a); },
  // Высота окна острова меняется синхронно: до того, как CSS начнёт анимацию.
  winHeight: (h) => ipcRenderer.sendSync('win-h', h),
  on: (ch, fn) => {
    if (!EVENTS.has(ch)) return () => {};
    const l = (e, d) => fn(d);
    ipcRenderer.on(ch, l);
    return () => ipcRenderer.removeListener(ch, l);
  },
  pathOf: (file) => webUtils.getPathForFile(file),
});
