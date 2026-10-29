// Окно настроек: всё сохраняется сразу при изменении.
const api = window.islet;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let S = null;

const HOTKEYS = [
  ['clips', 'История буфера обмена'],
  ['command', 'Командная строка'],
  ['chat', 'ИИ-чат'],
  ['shot', 'Скриншот области'],
  ['ocr', 'Текст с экрана'],
  ['color', 'Пипетка'],
  ['toggle', 'Спрятать / показать остров'],
];

const PRESETS = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', sttModel: 'whisper-1' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', sttModel: '' },
  { id: 'groq', name: 'Groq (бесплатно)', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', sttModel: 'whisper-large-v3-turbo' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', sttModel: '' },
  { id: 'ollama', name: 'Ollama (локально)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2', sttModel: '' },
  { id: 'lmstudio', name: 'LM Studio (локально)', baseUrl: 'http://localhost:1234/v1', model: 'local-model', sttModel: '' },
];

let savedTimer = 0;
async function save(patch) {
  S = await api.invoke('settings-set', patch);
  $('#saved').classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => $('#saved').classList.remove('show'), 1200);
  paintHotkeyErrors();
  return S;
}

// Путь вида "eyes.follow" → патч { eyes: { follow } }
const getK = (k) => k.split('.').reduce((o, p) => (o == null ? o : o[p]), S);
const patchK = (k, v) => { const [a, b] = k.split('.'); return b ? { [a]: { [b]: v } } : { [a]: v }; };

// ---------- Разделы ----------

function show(id) {
  if (id === 'welcome') return startWizard();
  if (!$(`section[data-s="${id}"]`)) id = 'general';
  $$('nav a').forEach((a) => a.classList.toggle('on', a.dataset.s === id));
  $$('section').forEach((s) => s.classList.toggle('on', s.dataset.s === id));
  if (id === 'claude') ccRefresh();
  if (id === 'weather') $('#citySearch').focus();
}
$('#nav').onclick = (e) => { const a = e.target.closest('a[data-s]'); if (a) show(a.dataset.s); };
api.on('section', show);

// ---------- Простые поля ----------

// Что ещё поменять в окне, когда поле получило значение.
const FIELD_HOOKS = {
  searchUrl: (v) => { $('#searchCustomRow').hidden = v !== 'custom'; },
};
const OUTS = { islandScale: (v) => v + '%', islandOffset: (v) => (+v > 0 ? '+' : '') + v };

function bindFields() {
  for (const el of $$('[data-k]')) {
    const k = el.dataset.k;
    const v = getK(k);
    const out = $(`[data-out="${k}"]`);
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v ?? '';
    if (out) { out.textContent = OUTS[k](el.value); el.oninput = () => { out.textContent = OUTS[k](el.value); }; }
    FIELD_HOOKS[k]?.(el.value);
    // У ползунка change приходит при отпускании — остров двигается один раз, а не на каждом шаге.
    el.onchange = () => {
      let val = el.type === 'checkbox' ? el.checked : el.value;
      if (el.type === 'number' || el.type === 'range') {
        val = Math.max(el.min === '' ? 0 : +el.min, Math.min(+el.max || 1e9, Math.round(+el.value || 0)));
        el.value = val;
      }
      if (typeof val === 'string') val = val.trim();
      FIELD_HOOKS[k]?.(val);
      save(patchK(k, val));
    };
  }
  // Списки: одно значение на запятую или строку.
  for (const el of $$('[data-list]')) {
    const k = el.dataset.list, v = S[k];
    el.value = (Array.isArray(v) ? v : String(v || '').split(/[,;\n]+/)).join(', ');
    el.onchange = () => {
      const list = el.value.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
      save({ [k]: [...new Set(k === 'dlIgnore' ? list : list.map((s) => s.toLowerCase()))] });
    };
  }
  $$('[data-open]').forEach((b) => { b.onclick = () => api.invoke('open-path', getK(b.dataset.open)); });
}

// ---------- Звук таймера ----------

const fileUrl = (p) => 'file:///' + encodeURI(String(p).replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F');
const baseName = (p) => String(p).split(/[\\/]/).pop().replace(/\.wav$/i, '');
let sounds = [];
function paintSounds() {
  const cur = S.alertSound || 'beep';
  const known = cur === 'beep' || cur === 'none' || sounds.some((s) => s.path === cur);
  $('#sndSel').innerHTML = '<option value="beep">Короткий сигнал</option><option value="none">Без звука</option>'
    + (sounds.length ? '<optgroup label="Звуки Windows">' + sounds.map((s) => `<option value="${esc(s.path)}">${esc(s.name)}</option>`).join('') + '</optgroup>' : '')
    + (known ? '' : `<option value="${esc(cur)}">Свой: ${esc(baseName(cur))}</option>`)
    + '<option value="__pick">Свой WAV…</option>';
  $('#sndSel').value = cur;
  $('#sndTest').disabled = cur === 'none';
}
$('#sndSel').onchange = async () => {
  let v = $('#sndSel').value;
  if (v === '__pick') {
    v = await api.invoke('pick-sound');
    if (!v) { paintSounds(); return; }
  }
  await save({ alertSound: v });
  paintSounds();
};
let testAudio = null;
function testBeep() {
  const ctx = new AudioContext();
  for (let i = 0; i < 2; i++) {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * 0.22;
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + 0.18);
  }
  setTimeout(() => ctx.close(), 800);
}
$('#sndTest').onclick = () => {
  const v = S.alertSound || 'beep';
  testAudio?.pause();
  if (v === 'beep') return testBeep();
  if (v === 'none') return;
  testAudio = new Audio(fileUrl(v));
  testAudio.play().catch(() => { $('#sndTest').textContent = 'Не играет'; setTimeout(() => { $('#sndTest').textContent = 'Проверить'; }, 1500); });
};

// ---------- Горячие клавиши ----------

const CODES = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
};
function accelOf(e) {
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  const c = e.code;
  let k = null;
  if (/^Key[A-Z]$/.test(c)) k = c.slice(3);
  else if (/^Digit\d$/.test(c)) k = c.slice(5);
  else if (/^Numpad\d$/.test(c)) k = 'num' + c.slice(6);
  else if (/^F\d{1,2}$/.test(c)) k = c;
  else k = CODES[c] || null;
  if (!k) return null;
  if (!mods.length && !/^F\d/.test(k)) return null; // одиночная клавиша сломала бы обычный ввод
  return [...mods, k].join('+');
}

function paintHotkeys() {
  $('#hotkeys').innerHTML = HOTKEYS.map(([id, name]) =>
    `<div class="row"><label>${name}</label><input type="text" class="hk" data-hk="${id}" readonly value="${esc(S.hotkeys[id] || '')}" placeholder="не задано"></div>`).join('');
  for (const el of $$('[data-hk]')) {
    el.onfocus = () => { el.classList.add('rec'); el.dataset.old = el.value; el.value = 'Нажми сочетание…'; };
    el.onblur = () => { el.classList.remove('rec'); if (el.value === 'Нажми сочетание…') el.value = el.dataset.old; };
    el.onkeydown = (e) => {
      e.preventDefault();
      if (e.key === 'Escape') { el.blur(); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') { el.value = ''; el.dataset.old = ''; el.blur(); save({ hotkeys: { [el.dataset.hk]: '' } }); return; }
      const acc = accelOf(e);
      if (!acc) return;
      el.value = acc; el.dataset.old = acc;
      el.blur();
      save({ hotkeys: { [el.dataset.hk]: acc } });
    };
  }
  paintHotkeyErrors();
}
function paintHotkeyErrors() {
  const errs = S.hotkeyErrors || [];
  $$('[data-hk]').forEach((el) => {
    const bad = errs.includes(el.dataset.hk);
    const alt = S.hotkeysActive?.[el.dataset.hk];
    el.classList.toggle('err', bad);
    el.title = bad ? 'Это сочетание уже занято другой программой'
      : alt && alt !== el.value ? `Занято другой программой — пока работает ${alt}` : '';
  });
}

// ---------- ИИ ----------

function paintAi() {
  const a = S.ai;
  $('#presets').innerHTML = PRESETS.map((p) => `<button data-p="${p.id}" class="${a.preset === p.id ? 'on' : ''}">${p.name}</button>`).join('');
  $('#aiBase').value = a.baseUrl || '';
  $('#aiModel').value = a.model || '';
  $('#aiSystem').value = a.system || '';
  $('#sttBase').value = a.sttBaseUrl || '';
  $('#sttModel').value = a.sttModel || '';
  $('#aiKey').value = ''; $('#sttKey').value = '';
  $('#aiKeyState').innerHTML = a.hasKey ? '<span class="ok">Ключ сохранён</span> — введи новый, чтобы заменить' : 'Для локальных Ollama / LM Studio не нужен';
  $('#sttKeyState').innerHTML = a.hasSttKey ? '<span class="ok">Ключ сохранён</span>' : 'Необязательно';
  $('#agentMode').value = a.agentMode || 'read';
  $('#agentCwd').value = a.agentCwd || '';
  $('#agentCmd').value = a.agentCmd || '';
  paintAgentMode();
}
function paintAgentMode() {
  $('#agentModeNote').innerHTML = {
    read: 'Отвечает и читает файлы, ничего не меняет',
    edit: 'Меняет файлы в рабочей папке, команды — нет',
    all: '<span class="bad">Запускает любые команды без вопросов</span>',
  }[$('#agentMode').value];
}
$('#agentMode').onchange = paintAgentMode;
$('#presets').onclick = (e) => {
  const b = e.target.closest('[data-p]');
  if (!b) return;
  const p = PRESETS.find((x) => x.id === b.dataset.p);
  $$('#presets button').forEach((x) => x.classList.toggle('on', x === b));
  $('#aiBase').value = p.baseUrl;
  $('#aiModel').value = p.model;
  if (p.sttModel) $('#sttModel').value = p.sttModel;
  $('#presets').dataset.sel = p.id;
  $('#aiMsg').textContent = 'Проверь поля и нажми «Сохранить»';
};
// Проверка ключа: просим у сервиса список моделей (с таймаутом) — заодно из него можно выбрать модель.
$('#aiCheck').onclick = async () => {
  const b = $('#aiCheck'), msg = $('#aiMsg');
  b.disabled = true; msg.textContent = 'Проверяю…';
  try {
    const list = await api.invoke('ai-models', { baseUrl: $('#aiBase').value.trim().replace(/\/+$/, ''), key: $('#aiKey').value.trim() });
    const cur = $('#aiModel').value.trim();
    $('#aiModels').innerHTML = '<option value="">— выбрать —</option>' + list.map((m) => `<option${m === cur ? ' selected' : ''}>${esc(m)}</option>`).join('');
    $('#aiModelsN').textContent = list.length + ' шт.';
    $('#aiModelsRow').hidden = !list.length;
    msg.innerHTML = list.length
      ? `<span class="ok">Ключ работает</span>${cur && !list.includes(cur) ? ' — но модели «' + esc(cur) + '» у сервиса нет' : ''}`
      : '<span class="ok">Ключ работает</span>, но сервис не отдал список моделей';
  } catch (e) {
    $('#aiModelsRow').hidden = true;
    msg.innerHTML = `<span class="bad">${esc(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))}</span>`;
  } finally { b.disabled = false; }
};
$('#aiModels').onchange = () => {
  if (!$('#aiModels').value) return;
  $('#aiModel').value = $('#aiModels').value;
  $('#aiMsg').textContent = 'Модель выбрана — нажми «Сохранить»';
};
$('#aiSave').onclick = async () => {
  const ai = {
    preset: $('#presets').dataset.sel || S.ai.preset,
    baseUrl: $('#aiBase').value.trim().replace(/\/+$/, ''),
    model: $('#aiModel').value.trim(),
    system: $('#aiSystem').value.trim(),
    sttBaseUrl: $('#sttBase').value.trim().replace(/\/+$/, ''),
    sttModel: $('#sttModel').value.trim(),
    agentMode: $('#agentMode').value,
    agentCwd: $('#agentCwd').value.trim(),
    agentCmd: $('#agentCmd').value.trim(),
  };
  // Ключи отправляем, только если их ввели заново.
  if ($('#aiKey').value.trim()) ai.key = $('#aiKey').value.trim();
  if ($('#sttKey').value.trim()) ai.sttKey = $('#sttKey').value.trim();
  await save({ ai });
  paintAi();
  $('#aiMsg').textContent = 'Сохранено';
};

// ---------- Погода ----------

async function findCity() {
  const q = $('#citySearch').value.trim();
  if (!q) return;
  const box = $('#cityResults');
  box.innerHTML = '<div class="row note">Ищу…</div>';
  try {
    const list = await api.invoke('geo-search', q);
    box.innerHTML = list.length
      ? list.map((r, i) => `<button data-i="${i}">${esc(r.name)}</button>`).join('')
      : '<div class="row note">Ничего не нашлось</div>';
    box.onclick = async (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      const r = list[+b.dataset.i];
      await save({ weather: { city: r.city, lat: r.lat, lon: r.lon } });
      $('#cityNow').textContent = r.city;
      box.innerHTML = '';
      $('#citySearch').value = '';
    };
  } catch { box.innerHTML = '<div class="row note bad">Поиск не удался — проверь интернет</div>'; }
}
$('#cityFind').onclick = findCity;
$('#citySearch').onkeydown = (e) => { if (e.key === 'Enter') findCity(); };

// ---------- Буфер обмена ----------

$('#clipExclude').onchange = () => {
  const list = $('#clipExclude').value.split(/[,\n;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  save({ clip: { exclude: [...new Set(list)] } });
};
$('#clipClear').onclick = async () => {
  await api.invoke('clip-clear');
  $('#clipClear').textContent = 'Очищено';
  setTimeout(() => { $('#clipClear').textContent = 'Очистить'; }, 1500);
};

// ---------- Claude Code ----------

function paintCc(st) {
  $('#ccState').innerHTML = st.installed ? '<span class="ok">подключено</span>' : 'не подключено';
  $('#ccInstall').style.display = st.installed ? 'none' : '';
  $('#ccRemove').style.display = st.installed ? '' : 'none';
  $('#ccMsg').innerHTML = st.error ? `<span class="bad">${esc(st.error)}</span>` : st.installed ? 'Новые сессии Claude Code будут видны на острове.' : '';
  // Хук ответов пользователь ставит сам — кнопкой «Добавить хук» или вписав JSON вручную.
  $('#ccAskState').innerHTML = st.ask ? '<span class="ok">добавлен</span>' : 'не добавлен';
  $('#ccAskInstall').style.display = st.ask ? 'none' : '';
  $('#ccAskRemove').style.display = st.ask ? '' : 'none';
  $('#ccAskMsg').innerHTML = st.askError ? `<span class="bad">${esc(st.askError)}</span>` : st.ask ? 'Вопросы Claude будут приходить на остров. Сработает в новых сессиях.' : '';
  if (st.askHooks) $('#ccAskJson').textContent = JSON.stringify(st.askHooks, null, 2);
}
async function ccRefresh() { paintCc(await api.invoke('cc-status')); }
const ccDo = (ch, key) => async () => { try { paintCc(await api.invoke(ch)); } catch (e) { paintCc({ ...(await api.invoke('cc-status')), [key]: e.message }); } };
$('#ccInstall').onclick = ccDo('cc-install', 'error');
$('#ccRemove').onclick = ccDo('cc-remove', 'error');
$('#ccAskInstall').onclick = ccDo('cc-ask-install', 'askError');
$('#ccAskRemove').onclick = ccDo('cc-ask-remove', 'askError');

// ---------- Стиль глазок ----------

function paintEyes() {
  const E = window.EyeStyles, g = $('#eyeGallery');
  g.innerHTML = E.cats.map((c) => `<div class="eyecat">${esc(c)}</div><div class="eyegrid">`
    + E.list.filter((s) => s.c === c).map((s) => `<div class="eyetile" data-eye="${s.id}" title="${esc(s.n)}"><div class="cap">`
      + '<div class="eyes"><div class="eye"></div><div class="eye"></div></div></div>'
      + `<div class="nm">${esc(s.n)}</div></div>`).join('') + '</div>').join('');
  for (const t of $$('.eyetile', g)) t.dataset.fx = E.apply($('.eyes', t), t.dataset.eye) || '';
  markEye();
  g.onclick = (e) => { const t = e.target.closest('.eyetile'); if (t) pickEye(t.dataset.eye); };
  // наведение: показать фокус стиля или просто моргнуть
  g.onmouseover = (e) => {
    const t = e.target.closest('.eyetile'); if (!t || t.contains(e.relatedTarget)) return;
    const c = $('.eyes', t).classList, k = t.dataset.fx ? 'fx' : 'blink';
    c.add(k); setTimeout(() => c.remove(k), k === 'fx' ? 950 : 130);
  };
  $('#eyeRandom').onclick = () => pickEye(E.random(S.eyes.style));
}
function markEye() {
  const id = S.eyes.style || 'nusa';
  $$('.eyetile').forEach((t) => t.classList.toggle('on', t.dataset.eye === id));
  $('#eyeNow').textContent = window.EyeStyles.get(id).n;
}
async function pickEye(id) { await save({ eyes: { style: id } }); markEye(); }

// ---------- Первый запуск ----------
// Мастер переносит в себя те же карточки и строки настроек — обработчики остаются их же.
// После мастера окно закрывается или перезагружается, так что возвращать узлы на место не нужно.
// Мастер живёт в своём окне без рамки; открытый из настроек (?again) по окончании возвращает обычное окно.

const wizDone = () => (location.search.includes('again') ? api.invoke('open-settings', 'general') : window.close());
let wiz = null;
function startWizard() {
  if (wiz) return;
  api.invoke('settings-set', { onboarded: true }); // закрыл окно — значит, устраивает как есть
  document.body.classList.add('wizard');
  document.title = 'Islet — первый запуск';
  $$('section').forEach((s) => s.classList.toggle('on', s.dataset.s === 'welcome'));
  const row = (k) => $(`[data-k="${k}"]`).closest('.row');
  const card = (keys) => { const c = document.createElement('div'); c.className = 'card'; keys.forEach((k) => c.append(row(k))); return c; };
  const html = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
  const hero = html('<div class="whero"><div class="cap"><div class="eyes"><div class="eye"></div><div class="eye"></div></div></div></div>');
  window.EyeStyles.apply($('.eyes', hero), S.eyes.style);
  wiz = { i: 0, steps: [
    { t: 'Привет! Это Islet', s: 'Остров живёт у верхнего края экрана: музыка, буфер обмена, скриншоты, таймеры, заметки, ИИ-чат и уведомления. Настроим под тебя — это минута.',
      body: [hero, html('<ul class="wlist"><li>Наведи на остров — он раскроется</li><li>Правый клик по острову — настройки</li><li>Всё, что выберешь сейчас, можно поменять потом</li></ul>')] },
    { t: 'Что показывать в капсуле', s: 'Слева и справа от глазок, пока ничего не происходит. Можно выключить всё — останутся одни глазки.',
      body: [$('[data-k="pill.clock"]').closest('.card')] },
    { t: 'Какие глазки', s: 'Наведи на плитку — глазки покажут себя. Клик — выбрать.',
      body: [...$('section[data-s="eyes"]').children].filter((e) => e.tagName !== 'H1') },
    { t: 'Город для погоды', s: 'Найди свой город — погода будет в капсуле и на вкладке погоды.', skip: () => getK('pill.weather') === false,
      body: [$('#citySearch').closest('.card')] },
    { t: 'Как острову себя вести', s: '',
      body: [card(['hoverOpen', 'autoHide', 'hideFullscreen', 'autostart'])] },
    { t: 'Уведомления и индикаторы', s: 'Что остров показывает сам, без твоих действий.',
      body: [card(['winNotifs', 'hideWinBanners', 'watchDownloads']), $('[data-k="indicators.caps"]').closest('.card')] },
    { t: 'Claude Code', s: 'Если работаешь с Claude Code в терминале — остров покажет, когда он думает, ждёт тебя или закончил, а на его вопросы можно ответить прямо с острова. Не нужно — просто жми «Дальше».',
      body: [$('#ccState').closest('.card'), $('#ccMsg'), $('#ccAskInstall').closest('.card'), $('#ccAskMsg')] },
    { t: 'Готово', s: 'Горячие клавиши — их можно переназначить в настройках.',
      body: [html('<div class="card">' + HOTKEYS.map(([k, n]) => `<div class="row"><span class="lbl">${esc(n)}</span><code>${esc(S.hotkeys[k] || '—')}</code></div>`).join('') + '</div>')] },
  ] };
  $('#wizDots').innerHTML = wiz.steps.map(() => '<i></i>').join('');
  ccRefresh();
  new ResizeObserver(wizFit).observe($('.wiz')); // шаг сменился, нашлись города, раскрылся JSON — окно следом
  $('#wizSkip').onclick = wizDone;
  $('#wizBack').onclick = () => wizGo(-1);
  $('#wizNext').onclick = () => (wiz.i === wiz.steps.length - 1 ? wizDone() : wizGo(1));
  wizGo(0);
}
function wizGo(d) {
  let i = wiz.i + d;
  while (d && wiz.steps[i]?.skip?.()) i += d;
  wiz.i = i = Math.max(0, Math.min(wiz.steps.length - 1, i));
  const st = wiz.steps[i], last = i === wiz.steps.length - 1;
  $('#wizT').textContent = st.t;
  $('#wizS').textContent = st.s;
  $('#wizS').hidden = !st.s;
  const b = $('#wizBody');
  b.replaceChildren(...st.body);
  $$('#wizDots i').forEach((e, k) => e.classList.toggle('on', k <= i));
  $('#wizEye').textContent = `Шаг ${i + 1} из ${wiz.steps.length}`;
  $('#wizBack').style.visibility = i ? '' : 'hidden';
  $('#wizSkip').style.visibility = last ? 'hidden' : '';
  $('#wizNextT').textContent = i === 0 ? 'Начать' : last ? 'Поехали' : 'Дальше';
  $('main').scrollTop = 0;
}
// окно мастера по высоте шага: ни пустоты снизу, ни прокрутки, пока шаг помещается на экран
let wizFitRaf = 0;
function wizFit() {
  cancelAnimationFrame(wizFitRaf);
  wizFitRaf = requestAnimationFrame(() => {
    const top = parseFloat(getComputedStyle($('main')).paddingTop) || 0;
    api.invoke('win-ctl', 'fit', Math.ceil($('.wiz').getBoundingClientRect().height + top));
  });
}

// ---------- Прочее ----------

$('#quit').onclick = () => api.invoke('quit');
$('#wizAgain').onclick = () => api.invoke('open-settings', 'welcome', true);

// Полоса заголовка мастера. Над областью перетаскивания страница не получает событий мыши,
// (даже mouseleave приходит), поэтому прячем её, только когда мышь вернулась в содержимое ниже полосы.
let tbHide = 0;
const tbShow = (on) => { clearTimeout(tbHide); if (on) document.body.classList.add('tb-on'); else tbHide = setTimeout(() => document.body.classList.remove('tb-on'), 350); };
$('#tbHot').onmouseenter = () => tbShow(true);
$('#tbar').onmouseenter = () => tbShow(true);
document.addEventListener('mousemove', (e) => { if (e.clientY > 44 && document.body.classList.contains('tb-on')) tbShow(false); });$$('#tbar button').forEach((b) => { b.onclick = () => api.invoke('win-ctl', b.dataset.w); });

(async function init() {
  S = await api.invoke('settings-get');
  $('#ver').textContent = 'Версия ' + S.version;
  $('#cityNow').textContent = S.weather.city;
  $('#clipExclude').value = (S.clip.exclude || []).join(', ');
  $('#dispSel').innerHTML = '<option value="">Основной</option><option value="cursor">Где курсор</option>'
    + (S.displays || []).map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
  $('#musicChar').innerHTML = '<option value="none">Никто — обычные глазки</option>'
    + window.EyeStyles.list.map((s) => `<option value="${s.id}">${esc(s.n)}</option>`).join('');
  bindFields();
  api.invoke('sounds-list').then((l) => { sounds = l || []; }).catch(() => {}).finally(paintSounds);
  paintHotkeys();
  paintAi();
  paintEyes();
  show(location.hash.slice(1) || 'general');
})();
