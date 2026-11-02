// Мост к helper.ps1: один процесс на всё время работы, запросы по строкам JSON.
const { spawn } = require('child_process');
const path = require('path');

// macOS: хелпер живёт внутри системного perl, только такому процессу отвечает MediaRemote.
const LOAD_DYLIB = 'require DynaLoader; my $l = DynaLoader::dl_load_file($ARGV[0], 0) or die DynaLoader::dl_error();'
  + ' DynaLoader::dl_install_xsub("main::run", DynaLoader::dl_find_symbol($l, "islet_helper"))->();';

let proc = null;
let buf = '';
let nextId = 1;
const pending = new Map();

function start() {
  const unpacked = (p) => p.replace('app.asar', 'app.asar.unpacked');
  proc = process.platform === 'darwin'
    ? spawn('/usr/bin/perl', ['-e', LOAD_DYLIB, unpacked(path.join(__dirname, 'mac', 'helper.dylib'))], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(__dirname.includes('app.asar') && { ISLET_BT: '1' }) },
    })
    : spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', unpacked(path.join(__dirname, 'helper.ps1'))], {
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
