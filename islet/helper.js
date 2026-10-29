// Мост к helper.ps1: один процесс на всё время работы, запросы по строкам JSON.
const { spawn } = require('child_process');
const path = require('path');

let proc = null;
let buf = '';
let nextId = 1;
const pending = new Map();

function start() {
  const script = path.join(__dirname, 'helper.ps1').replace('app.asar', 'app.asar.unpacked');
  proc = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', script], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line.replace(/^﻿/, '')); } catch { continue; }
      const p = pending.get(msg.id);
      if (!p) continue;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error || 'helper error'));
    }
  });
  proc.stderr.on('data', (d) => console.error('[helper]', String(d).trim()));
  proc.on('exit', () => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('helper exited')); }
    pending.clear();
    proc = null;
    buf = '';
    if (!stopped) setTimeout(start, 1000);
  });
}

let stopped = false;

function call(cmd, args = {}, timeout = 15000) {
  if (!proc) start();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('helper timeout: ' + cmd)); }, timeout);
    pending.set(id, { resolve, reject, timer });
    proc.stdin.write(JSON.stringify({ id, cmd, args }) + '\n');
  });
}

function stop() {
  stopped = true;
  if (proc) proc.kill();
}

module.exports = { start, call, stop };
