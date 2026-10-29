// Терминальные ИИ-агенты (Claude Code, Codex, Gemini, Qwen, своя команда) и локальные модели (Ollama, LM Studio).
// Агент запускается без окна в режиме «один запрос»: промпт идёт через stdin, ответ читается потоком из stdout.
// Ищем всё только по запросу (открыл выбор в чате), результат держим минуту.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SID = /^[\w-]{6,80}$/;

const CLIS = [
  { id: 'claude', name: 'Claude Code', bin: 'claude' },
  { id: 'codex', name: 'Codex', bin: 'codex' },
  { id: 'gemini', name: 'Gemini CLI', bin: 'gemini' },
  { id: 'qwen', name: 'Qwen Code', bin: 'qwen' },
];
const LOCAL = [
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' },
  { id: 'lmstudio', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' },
];

function where(bin) {
  return new Promise((res) => {
    execFile('where.exe', [bin], { windowsHide: true, timeout: 4000 }, (e, out) => {
      const all = e ? [] : String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      // .cmd/.exe раньше файла без расширения (npm кладёт рядом shell-скрипт для bash)
      res(all.find((p) => /\.(exe|cmd|bat)$/i.test(p)) || '');
    });
  });
}

async function localModels(baseUrl) {
  try {
    const r = await fetch(baseUrl + '/models', { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.data || []).map((m) => m.id).filter(Boolean).sort();
  } catch { return null; }
}

// Последние сессии Claude Code из терминала: ~/.claude/projects/<папка>/<uuid>.jsonl
function claudeSessions(max = 6) {
  const root = path.join(os.homedir(), '.claude', 'projects');
  const files = [];
  try {
    for (const d of fs.readdirSync(root)) {
      const dir = path.join(root, d);
      let names;
      try { names = fs.readdirSync(dir); } catch { continue; }
      for (const n of names) {
        if (!n.endsWith('.jsonl') || !UUID.test(n.slice(0, -6))) continue;
        try { files.push({ f: path.join(dir, n), t: fs.statSync(path.join(dir, n)).mtimeMs }); } catch {}
      }
    }
  } catch { return []; }
  return files.sort((a, b) => b.t - a.t).slice(0, max).map(({ f, t }) => {
    const info = sessionInfo(f);
    return info && { id: path.basename(f, '.jsonl'), cwd: info.cwd, title: info.title, t };
  }).filter(Boolean);
}

// Из начала файла: рабочая папка и первый вопрос пользователя.
function sessionInfo(f) {
  let head = '';
  try {
    const fd = fs.openSync(f, 'r');
    const buf = Buffer.alloc(96 * 1024);
    head = buf.toString('utf8', 0, fs.readSync(fd, buf, 0, buf.length, 0));
    fs.closeSync(fd);
  } catch { return null; }
  let cwd = '', title = '';
  for (const line of head.split('\n')) {
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (!cwd && typeof j.cwd === 'string') cwd = j.cwd;
    if (!title && j.type === 'user' && !j.isMeta) {
      const c = j.message?.content;
      const s = typeof c === 'string' ? c : Array.isArray(c) ? c.find((p) => p.type === 'text')?.text || '' : '';
      // служебный пересказ после сжатия контекста — не заголовок
      if (s && !s.startsWith('<') && !s.startsWith('This session is being continued')) title = s.replace(/\s+/g, ' ').slice(0, 80);
    }
    if (cwd && title) break;
  }
  return cwd ? { cwd, title: title || path.basename(cwd) } : null;
}

let cache = null, cacheT = 0;
async function detect(force) {
  if (!force && cache && Date.now() - cacheT < 60000) return cache;
  const [bins, locals] = await Promise.all([
    Promise.all(CLIS.map((c) => where(c.bin))),
    Promise.all(LOCAL.map((l) => localModels(l.baseUrl))),
  ]);
  const agents = CLIS.map((c, i) => ({ id: c.id, name: c.name, ok: !!bins[i] }));
  cache = {
    agents,
    local: LOCAL.map((l, i) => ({ id: l.id, name: l.name, ok: !!locals[i], models: locals[i] || [] })),
    sessions: bins[0] ? claudeSessions() : [],
    bins: Object.fromEntries(CLIS.map((c, i) => [c.id, bins[i]])),
  };
  cacheT = Date.now();
  return cache;
}

const localUrl = (id) => LOCAL.find((l) => l.id === id)?.baseUrl;

// Аргументы запуска. mode: read — только читать, edit — править файлы, all — всё без спроса.
function argsFor(id, { mode, session, fork }) {
  if (id === 'claude') {
    const perm = { read: 'default', edit: 'acceptEdits', all: 'bypassPermissions' }[mode] || 'default';
    return ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', perm,
      ...(session ? ['--resume', session, ...(fork ? ['--fork-session'] : [])] : [])];
  }
  if (id === 'codex') {
    const sb = { read: 'read-only', edit: 'workspace-write', all: 'danger-full-access' }[mode] || 'read-only';
    return ['exec', ...(session ? ['resume', session] : []), '--json', '--skip-git-repo-check', '-s', sb, '-'];
  }
  if (id === 'gemini' || id === 'qwen') {
    const ap = { read: 'default', edit: 'auto_edit', all: 'yolo' }[mode] || 'default';
    return ['--output-format', 'stream-json', '--approval-mode', ap];
  }
  return [];
}

// Одна строка вывода → { text, session, tool, error }. Знает форматы Claude, Codex и Gemini; прочее — как есть.
function parseLine(line, st) {
  let j;
  try { j = JSON.parse(line); } catch { return { text: line + '\n' }; }
  const out = {};
  const sid = j.session_id || j.thread_id || j.sessionId;
  if (typeof sid === 'string') out.session = sid;
  // Claude Code
  if (j.type === 'stream_event') {
    const ev = j.event || {};
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { out.text = ev.delta.text; st.streamed = true; }
    if (ev.type === 'message_start') st.streamed = false;
  } else if (j.type === 'assistant' && j.message?.content) {
    for (const p of j.message.content) {
      if (p.type === 'text' && !st.streamed) out.text = (out.text || '') + p.text;
      if (p.type === 'tool_use') out.tool = toolLine(p.name, p.input);
    }
  } else if (j.type === 'result') {
    if (j.is_error) out.error = String(j.result || j.subtype || 'ошибка агента');
    st.done = true;
  // Codex: новый формат (item.*) и старый (msg)
  } else if (j.type === 'item.completed' || j.type === 'item.started') {
    const it = j.item || {};
    if (j.type === 'item.completed' && (it.type === 'agent_message' || it.item_type === 'assistant_message')) out.text = (it.text || '') + '\n';
    if (j.type === 'item.started' && it.type === 'command_execution') out.tool = toolLine('Shell', { command: it.command });
  } else if (j.msg) {
    if (j.msg.type === 'agent_message') out.text = (j.msg.message || '') + '\n';
    if (j.msg.type === 'exec_command_begin') out.tool = toolLine('Shell', { command: [].concat(j.msg.command).join(' ') });
    if (j.msg.type === 'error') out.error = j.msg.message;
  } else if (j.type === 'error' || j.type === 'turn.failed') {
    out.error = j.message || j.error?.message || 'ошибка агента';
  // Gemini / Qwen
  } else if (j.type === 'message' && j.role === 'assistant' && typeof j.content === 'string') {
    out.text = j.content;
  } else if (j.type === 'tool_use') {
    out.tool = toolLine(j.tool_name || j.name, j.parameters || j.input);
  }
  return out;
}

function toolLine(name, input = {}) {
  const v = input.command || input.file_path || input.path || input.pattern || input.url || input.description || '';
  return `${name || 'tool'}${v ? ': ' + String(v).replace(/\s+/g, ' ').slice(0, 90) : ''}`;
}

const procs = new Map(); // id -> ChildProcess

// Запуск агента. o: { agent, prompt, mode, session, fork, cwd, command } → промис { text, session }
async function run(id, o, onDelta) {
  const info = await detect();
  let cmd, args;
  if (o.agent === 'custom') {
    if (!o.command) throw new Error('Своя команда агента не задана в настройках');
    cmd = o.command; args = [];
  } else {
    const bin = info.bins[o.agent];
    if (!bin) throw new Error(`${CLIS.find((c) => c.id === o.agent)?.name || 'Агент'} не найден — установи его или проверь PATH`);
    if (o.session && !SID.test(o.session)) throw new Error('Неверный id сессии');
    cmd = `"${bin}"`; args = argsFor(o.agent, o);
  }
  let cwd = o.cwd && fs.existsSync(o.cwd) ? o.cwd : os.homedir();
  // .cmd от npm запускается только через оболочку; промпт идёт в stdin, а не в командную строку
  const p = spawn(cmd, args, { cwd, shell: true, windowsHide: true, env: { ...process.env, NO_COLOR: '1' } });
  procs.set(id, p);
  const st = {};
  let full = '', session = '', err = '', buf = '', lastTool = '';
  const emit = (s) => { if (s) { full += s; onDelta(s); } };
  const take = (line) => {
    if (!line.trim()) return;
    const r = parseLine(line, st);
    if (r.session) session = r.session;
    if (r.tool && r.tool !== lastTool) { lastTool = r.tool; emit(`${full && !full.endsWith('\n') ? '\n' : ''}\`› ${r.tool.replace(/`/g, "'")}\`\n\n`); }
    if (r.text) emit(r.text);
    if (r.error) err = r.error;
  };
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { take(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
  });
  let stderr = '';
  p.stderr.setEncoding('utf8');
  p.stderr.on('data', (d) => { if (stderr.length < 4000) stderr += d; });
  p.stdin.on('error', () => {});
  p.stdin.end(o.prompt);
  const code = await new Promise((res) => { p.on('close', res); p.on('error', (e) => { stderr += e.message; res(-1); }); });
  procs.delete(id);
  if (buf) take(buf);
  if (p.killedByUser) return { text: full, session };
  if (err && !full) throw new Error(err);
  if (code && !full) throw new Error(stderr.trim().split('\n').slice(-3).join(' ').slice(0, 400) || `агент завершился с кодом ${code}`);
  return { text: full, session };
}

function stop(id) {
  const p = procs.get(id);
  if (!p || p.exitCode != null) return false;
  p.killedByUser = true;
  execFile('taskkill', ['/pid', String(p.pid), '/t', '/f'], { windowsHide: true }, () => {});
  return true;
}

module.exports = { detect, run, stop, localUrl, UUID };
