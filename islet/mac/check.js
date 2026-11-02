// Проверка слоя macOS: npx electron mac/check.js. Падает, если вызов сломан или вернул чушь.
const assert = require('assert');
const { app } = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

app.whenReady().then(async () => {
  const n = require('../native.mac'), helper = require('../helper');
  const pid = n.foreground();
  assert(pid > 0, 'foreground');
  assert(n.processName(process.pid).length > 0, 'processName');
  assert(/^[A-Z]{2}$/.test(n.keyboardLayout()), 'keyboardLayout');
  assert(n.clipboardSeq() > 0, 'clipboardSeq');
  assert.equal(typeof n.capsLock(), 'boolean');
  assert(n.idleMs() >= 0, 'idleMs');
  assert.equal(typeof n.mouseDown(), 'boolean');
  assert.equal(typeof n.fileDragging(), 'boolean');
  assert.equal(typeof n.clipboardIsPrivate(), 'boolean');
  const rect = n.windowRect(pid);
  assert(rect === null || rect.right > rect.left, 'windowRect');
  const b = n.battery();
  assert(b === null || (b.percent >= 0 && b.percent <= 100), 'battery');

  // Разбор уведомлений: своя база той же схемы вместо закрытой системной.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'islet-'));
  const plist = path.join(dir, 'p.plist'), db = path.join(dir, 'db');
  fs.writeFileSync(plist, '<?xml version="1.0"?><plist version="1.0"><dict><key>req</key><dict><key>titl</key><string>Анна</string><key>body</key><string>Привет</string></dict></dict></plist>');
  execFileSync('plutil', ['-convert', 'binary1', plist]);
  execFileSync('sqlite3', [db, `create table app(app_id integer, identifier text); create table record(rec_id integer, app_id integer, data blob);
    insert into app values (1, 'com.test.app'); insert into record values (5, 1, readfile('${plist}'));`]);
  assert.equal((await helper.call('notifs.get', { after: -1, db })).last, 5);
  const r = await helper.call('notifs.get', { after: 0, db });
  assert.deepEqual(r.items, [{ app: 'com.test.app', title: 'Анна', body: 'Привет' }]);

  assert.equal(await helper.call('ping'), 'pong');
  const v = await helper.call('vol.get');
  assert(v.level >= 0 && v.level <= 1, 'vol.get');
  assert(Array.isArray((await helper.call('audio.list')).list), 'audio.list');
  assert((await helper.call('apps')).length > 0, 'apps');
  assert(/^data:image\/png/.test(await helper.call('appicon', { id: '/System/Applications/Notes.app' })), 'appicon');
  fs.rmSync(dir, { recursive: true });
  console.log('ok');
  helper.stop();
  app.exit(0);
}).catch((e) => { console.error(e); app.exit(1); });
