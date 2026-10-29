// Вкладки панели. Каждая: init(state) один раз, enter(opts) при показе, leave(), key(e) → true, если клавиша обработана.
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/').split('/').map((s, i) => (i ? encodeURIComponent(s) : s)).join('/');
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const errText = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const dataUrl = (blob) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => fail(r.error); r.readAsDataURL(blob); });
// Ошибку провайдера ИИ — человеческими словами, как в Island.
function aiError(s) {
  s = String(s || '');
  const code = +(/\b(40[0-9]|42[0-9]|5\d\d)\b/.exec(s) || [])[1];
  if (code === 401 || code === 403 || /api key|unauthori[sz]ed|invalid.*key/i.test(s)) return 'Ключ API не подошёл. Проверь его в настройках ИИ.';
  if (code === 402 || /credit|insufficient|balance|quota/i.test(s)) return 'На счёте провайдера закончились деньги или лимит.';
  if (code === 404 || /model.*not.*(found|exist)/i.test(s)) return 'Такой модели нет у провайдера. Выбери другую в настройках.';
  if (code === 429 || /rate.?limit|too many/i.test(s)) return 'Слишком много запросов. Подожди немного и попробуй снова.';
  if (code >= 500) return 'Сервер провайдера сейчас не отвечает. Попробуй позже.';
  if (/fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|network|timeout|abort/i.test(s)) return 'Нет связи с провайдером ИИ. Проверь интернет.';
  if (/no key|нет ключа|ключ/i.test(s)) return s;
  return s.length > 160 ? s.slice(0, 157) + '…' : s;
}
const hhmm = (ms) => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const setRange = (el, v) => { el.value = v; el.style.setProperty('--p', v + '%'); };

function fmtWhen(ms) {
  const d = new Date(ms), now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (d.toDateString() === now.toDateString()) return 'сегодня в ' + hhmm(ms);
  if (d.toDateString() === tomorrow.toDateString()) return 'завтра в ' + hhmm(ms);
  return d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' }) + ' в ' + hhmm(ms);
}

// Коротко, как в списке напоминаний Island: «через 25 мин», «завтра 9:00».
function fmtSoon(ms) {
  const m = Math.round((ms - Date.now()) / 60000);
  if (m < 1) return 'сейчас';
  if (m < 60) return `через ${m} мин`;
  return fmtWhen(ms).replace(' в ', ' ');
}

// Список с выделением стрелками.
function moveSel(list, sel, d) {
  const items = $$('.item', list);
  if (!items.length) return 0;
  const i = Math.max(0, Math.min(items.length - 1, sel + d));
  items.forEach((el, k) => el.classList.toggle('sel', k === i));
  items[i].scrollIntoView({ block: 'nearest' });
  return i;
}

// Кнопка, которая просит второй клик для подтверждения.
function armed(btn, ms = 2500) {
  if (btn.classList.contains('arm')) { btn.classList.remove('arm'); clearTimeout(btn._armT); return true; }
  $$('.arm').forEach((b) => b.classList.remove('arm'));
  btn.classList.add('arm');
  clearTimeout(btn._armT);
  btn._armT = setTimeout(() => btn.classList.remove('arm'), ms);
  return false;
}

// Ползунок громкости (один и тот же на «Главной» и в «Управлении»).
function volSlider(range, val, mute) {
  const o = { vol: null };
  const setVol = debounce((v) => api.invoke('vol-set', { level: v / 100 }), 40);
  o.paint = () => {
    if (!o.vol) return;
    const pct = Math.round(o.vol.level * 100);
    setRange(range, pct);
    val.textContent = pct;
    mute.innerHTML = icon(o.vol.muted || !pct ? 'mute' : 'vol', 18);
  };
  range.oninput = () => { range.style.setProperty('--p', range.value + '%'); val.textContent = range.value; if (o.vol) o.vol.level = range.value / 100; setVol(+range.value); };
  mute.onclick = async () => { if (o.vol) { o.vol = await api.invoke('vol-set', { mute: !o.vol.muted }); o.paint(); } };
  o.load = async () => { try { o.vol = await api.invoke('vol-get'); o.paint(); } catch {} };
  return o;
}

// ---------- Главная: музыка, громкость, инструменты ----------

const APP_NAMES = {
  spotify: 'Spotify', chrome: 'Chrome', msedge: 'Edge', firefox: 'Firefox', opera: 'Opera', browser: 'Яндекс Браузер',
  yandexmusic: 'Яндекс Музыка', 'microsoft.zunemusic': 'Медиаплеер', vlc: 'VLC', telegram: 'Telegram', discord: 'Discord',
  aimp: 'AIMP', foobar2000: 'foobar2000', itunes: 'iTunes', applemusic: 'Apple Music', vk: 'VK',
};
function appName(id) {
  const s = String(id || '').split('!').pop().replace(/\.exe$/i, '');
  if (!s || /^[0-9A-F]{12,}$/i.test(s)) return 'Плеер';
  const k = s.toLowerCase().replace(/_.*$/, '');
  return APP_NAMES[k] || APP_NAMES[k.split('.').pop()] || s.split('.').pop();
}

Views.home = {
  tick: 0, recorder: null,
  init() {
    $$('[data-media]').forEach((b) => {
      if (b.dataset.media !== 'playpause') b.innerHTML = icon(b.dataset.media, 22);
      b.onclick = () => api.invoke('media-ctl', b.dataset.media);
    });
    this.vol = volSlider($('#volRange'), $('#volVal'), $('#volMute'));
    api.on('media', () => { if (App.tab === 'home') this.paint(); });
    $('#mLyrBtn').innerHTML = icon('text', 16);
    $('#mLyrBtn').onclick = () => this.lyrShow(!this.lyrOn);
    $('#mLyrics').onclick = () => this.lyrShow(false);
    $('#toolGrid').onclick = (e) => {
      const b = e.target.closest('[data-tool]');
      if (!b) return;
      const t = b.dataset.tool;
      if (t === 'rec') return this.recorder ? this.stopRec() : this.startRec();
      if (t === 'cmd') return App.show('command');
      if (t === 'clean') return this.clean();
      App.close(true);
      api.invoke('capture', t);
    };

    // Док: клик — запустить, «×» при наведении или ПКМ дважды — убрать, «+» или перетаскивание — добавить.
    const dock = $('#dock');
    api.invoke('dock-get').then((it) => this.paintDock(it));
    dock.onclick = async (e) => {
      if (e.target.closest('.add')) { this.paintDock(await api.invoke('dock-add', [])); return; }
      const a = e.target.closest('.app');
      if (!a) return;
      if (e.target.closest('.rm')) { this.paintDock(await api.invoke('dock-remove', a.dataset.path)); return; }
      App.close(true);
      api.invoke('open-path', a.dataset.path);
    };
    dock.oncontextmenu = async (e) => {
      const a = e.target.closest('.app');
      if (!a || !armed(a)) return;
      this.paintDock(await api.invoke('dock-remove', a.dataset.path));
    };
    dock.addEventListener('dragover', () => dock.classList.add('over'));
    dock.addEventListener('dragleave', () => dock.classList.remove('over'));
    dock.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation();
      dock.classList.remove('over');
      const paths = App.dropPaths(e);
      if (paths.length) this.paintDock(await api.invoke('dock-add', paths));
    });

    // Устройство вывода звука.
    const menu = $('#outMenu');
    $('#volOut').onclick = async (e) => {
      e.stopPropagation();
      if (!menu.hidden) { menu.hidden = true; return; }
      this.outs = await api.invoke('audio-list').catch(() => []);
      menu.innerHTML = this.outs.length ? this.outs.map((d) => `<button data-id="${T.esc(d.id)}" class="${d.def ? 'on' : ''}" title="${T.esc(d.name)}">${icon('speaker', 16)}<span>${T.esc(d.name || d.desc)}</span><i class="ok-i">${icon('check', 15)}</i></button>`).join('')
        : '<div class="none">Устройства не найдены</div>';
      menu.hidden = false;
    };
    menu.onclick = async (e) => {
      const b = e.target.closest('[data-id]');
      if (!b) return;
      menu.hidden = true;
      try { await api.invoke('audio-set', b.dataset.id); } catch (err) { App.toast({ text: 'Не удалось переключить', sub: errText(err), left: App.iconSpan('x', 'var(--red)'), ms: 3000 }); }
      this.loadOut();
      this.vol.load();
    };
    document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });
  },
  paintDock(items) {
    $('#dock').innerHTML = items.map((d) => `<button class="app" data-path="${T.esc(d.path)}" title="${T.esc(d.name)}">${d.icon ? `<img src="${d.icon}" alt="">` : icon('app', 26)}<span class="rm" title="Убрать">${icon('x', 10)}</span></button>`).join('')
      + `<button class="add" title="Добавить приложение">${icon('plus', 20)}</button>`;
  },
  async loadOut() {
    const list = await api.invoke('audio-list').catch(() => []);
    const d = list.find((x) => x.def);
    $('#volOutName').textContent = d ? (d.desc || d.name) : 'Звук';
    $('#volOut').title = d ? d.name : 'Устройство вывода';
  },
  async enter() {
    this.paint();
    this.paintRec();
    clearInterval(this.tick);
    this.tick = setInterval(() => this.progress(), 500);
    this.vol.load();
    this.loadOut();
  },
  leave() { clearInterval(this.tick); $('#outMenu').hidden = true; },
  paint() {
    const m = App.media, card = $('#mediaCard');
    // Раскладка: center — обложка посередине с зеркалом, fill — обложка фоном, compact — старая.
    const st = ['center', 'fill', 'compact'].includes(App.settings.playerStyle) ? App.settings.playerStyle : 'center';
    for (const s of ['center', 'fill', 'compact']) card.classList.toggle('st-' + s, s === st);
    card.classList.toggle('none', !(m && m.active));
    if (!m || !m.active) { this.lyrShow(false); return; }
    $('#mApp').textContent = appName(m.app);
    $('#mTitle').textContent = m.title || 'Без названия';
    $('#mArtist').textContent = [m.artist, m.album].filter(Boolean).join(' — ') || '—';
    const bg = m.thumb ? `url("${m.thumb}")` : '';
    for (const id of ['#mArt', '#mBg', '#mMirL', '#mMirR']) if ($(id).style.backgroundImage !== bg) $(id).style.backgroundImage = bg;
    $('#mPlay').innerHTML = icon(m.status === 'Playing' ? 'pause' : 'play', 22);
    this.loadLyrics(m);
    this.progress();
  },
  pos() {
    const m = App.media;
    let pos = m.position || 0;
    if (m.status === 'Playing' && m.updated) pos += (Date.now() - m.updated) / 1000;
    return Math.min(pos, m.duration || pos);
  },
  progress() {
    const m = App.media;
    if (!m || !m.duration) { $('#mBar').style.width = '0'; $('#mPos').textContent = $('#mDur').textContent = ''; return; }
    const pos = this.pos();
    $('#mBar').style.width = (pos / m.duration * 100).toFixed(2) + '%';
    $('#mPos').textContent = T.clock(pos);
    $('#mDur').textContent = '-' + T.clock(m.duration - pos);
    this.lyrSync();
  },
  // Текст песни (lrclib): грузим один раз на трек, только пока открыта «Главная».
  lyr: null, lyrKey: null, lyrOn: false, lyrLine: -1,
  async loadLyrics(m) {
    const on = App.settings.lyrics !== false;
    const key = on && m.title ? `${m.artist || ''}\n${m.title}` : '';
    if (key === this.lyrKey) return;
    this.lyrKey = key; this.lyr = null;
    $('#mLyrBtn').hidden = true;
    this.lyrShow(false);
    if (!key) return;
    const r = await api.invoke('lyrics', { artist: m.artist, title: m.title, album: m.album, duration: m.duration }).catch(() => null);
    if (this.lyrKey !== key) return;
    this.lyr = r && (r.synced?.length || r.plain || r.instrumental) ? r : null;
    $('#mLyrBtn').hidden = !this.lyr;
    this.lyrPaint();
  },
  lyrPaint() {
    const el = $('#mLyrics'), l = this.lyr;
    this.lyrLine = -1;
    if (!l) { el.innerHTML = ''; return; }
    el.innerHTML = l.synced?.length ? l.synced.map((x, i) => `<p data-n="${i}">${T.esc(x.text) || '♪'}</p>`).join('')
      : l.plain ? `<div class="plain">${T.esc(l.plain)}</div>` : '<div class="note">Без слов</div>';
  },
  lyrShow(on) {
    this.lyrOn = !!on && !!this.lyr;
    $('#mLyrics').hidden = !this.lyrOn;
    $('#mLyrBtn').classList.toggle('on', this.lyrOn);
    if (this.lyrOn) { this.lyrLine = -1; this.lyrSync(); }
  },
  lyrSync() {
    const l = this.lyr;
    if (!this.lyrOn || !l?.synced?.length || !App.media) return;
    const pos = this.pos() + 0.25;
    let i = -1;
    while (i + 1 < l.synced.length && l.synced[i + 1].t <= pos) i++;
    if (i === this.lyrLine) return;
    const el = $('#mLyrics'), ps = el.children;
    if (ps[this.lyrLine]) ps[this.lyrLine].className = 'past';
    if (i < this.lyrLine) for (const p of ps) p.className = +p.dataset.n < i ? 'past' : '';
    this.lyrLine = i;
    const p = ps[i];
    if (!p) return;
    p.className = 'on';
    el.scrollTo({ top: p.offsetTop - el.clientHeight / 2 + p.offsetHeight / 2, behavior: 'smooth' });
  },
  async clean() {
    const s = (await api.invoke('text-read')) || '';
    App.close(true);
    if (!s.trim()) { App.toast({ text: 'В буфере нет текста', left: App.iconSpan('x', 'var(--dim)'), ms: 1800 }); return; }
    await api.invoke('text-copy', s);
    App.toast({ text: 'Формат убран', sub: 'чистый текст в буфере', left: App.iconSpan('eraser', '#8fc2ff'), ms: 2000, happy: true });
  },
  paintRec() {
    const b = $('#recBtn');
    b.classList.toggle('rec-on', !!this.recorder);
    b.querySelector('span').textContent = this.recorder ? 'Остановить' : 'Запись экрана';
    b.querySelector('i').innerHTML = icon(this.recorder ? 'stop' : 'camera', 22);
  },
  async startRec() {
    let stream;
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true }); }
    catch {
      try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false }); }
      catch (e) { App.toast({ text: 'Запись не началась', sub: errText(e), left: App.iconSpan('x', 'var(--red)'), ms: 3500 }); return; }
    }
    // Как у Island — MP4 (H.264 + AAC); если кодека нет, остаётся WebM.
    const type = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
      .find((t) => MediaRecorder.isTypeSupported(t));
    const ext = type.startsWith('video/mp4') ? 'mp4' : 'webm';
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8e6 });
    await api.invoke('rec-start', ext);
    let pending = Promise.resolve();
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      pending = pending.then(async () => api.send('rec-chunk', new Uint8Array(await e.data.arrayBuffer())));
    };
    rec.onstop = async () => {
      await pending;
      stream.getTracks().forEach((t) => t.stop());
      this.recorder = null; App.rec = null;
      this.paintRec();
      const file = await api.invoke('rec-stop');
      App.render();
      if (file) App.toast({ text: 'Запись сохранена', left: App.iconSpan('check', 'var(--green)'), ms: 4000, happy: true, click: () => api.invoke('show-path', file) });
    };
    stream.getVideoTracks()[0].onended = () => this.stopRec();
    rec.start(1000);
    this.recorder = rec;
    App.rec = { start: Date.now(), fmt: ext.toUpperCase() };
    this.paintRec();
    App.close(true);
  },
  stopRec() { if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop(); },
  key(e) {
    if (e.target.matches('input, textarea')) return;
    if (e.key === ' ') { e.preventDefault(); api.invoke('media-ctl', 'playpause'); return true; }
    if (e.key === 'ArrowRight') { api.invoke('media-ctl', 'next'); return true; }
    if (e.key === 'ArrowLeft') { api.invoke('media-ctl', 'prev'); return true; }
  },
};

// ---------- Буфер обмена ----------

Views.clips = {
  all: [], shown: [], sel: 0,
  init(st) {
    this.all = st.clips || [];
    $('#clipClear').innerHTML = icon('trash', 18);
    api.on('clips', (c) => { this.all = c; if (App.tab === 'clips') this.paint(); });
    $('#clipSearch').oninput = () => { this.sel = 0; this.paint(); };
    $('#clipClear').onclick = (e) => {
      const b = e.currentTarget;
      if (!b.classList.contains('warn')) {
        b.classList.add('warn'); b.title = 'Нажми ещё раз — очистить';
        clearTimeout(b._t); b._t = setTimeout(() => { b.classList.remove('warn'); b.title = 'Очистить историю (закреплённые останутся)'; }, 2500);
        return;
      }
      b.classList.remove('warn');
      api.invoke('clip-clear');
    };
    $('#clipList').onclick = (e) => {
      const it = e.target.closest('.item');
      if (!it) return;
      const id = it.dataset.id;
      const act = e.target.closest('[data-a]')?.dataset.a;
      if (act === 'pin') api.invoke('clip-pin', id);
      else if (act === 'del') api.invoke('clip-delete', id);
      else if (act === 'copy' || e.shiftKey) { api.invoke('clip-copy', id); App.close(true); }
      else api.invoke('clip-paste', id);
    };
  },
  enter() {
    $('#clipSearch').value = '';
    this.sel = 0;
    this.paint();
    setTimeout(() => $('#clipSearch').focus(), 30);
  },
  paint() {
    const q = $('#clipSearch').value.trim().toLowerCase();
    this.shown = this.all.filter((c) => {
      if (!q) return true;
      if (c.type === 'text') return c.text.toLowerCase().includes(q);
      if (c.type === 'files') return c.paths.some((p) => p.toLowerCase().includes(q));
      return false;
    });
    const list = $('#clipList');
    if (!this.shown.length) {
      list.innerHTML = `<div class="empty">${icon('clips', 26)}<br>${this.all.length ? 'Ничего не найдено' : 'Скопируй что-нибудь — оно появится здесь'}</div>`;
      return;
    }
    list.innerHTML = this.shown.map((c, i) => {
      let ic, t, kind;
      if (c.type === 'image') {
        ic = `<img src="${fileUrl(c.thumb || c.file)}" loading="lazy">`;
        t = 'Изображение'; kind = `${c.width}×${c.height}`;
      } else if (c.type === 'files') {
        ic = icon(c.paths.length > 1 ? 'folder' : 'file', 17);
        const names = c.paths.map((p) => p.split(/[\\/]/).pop());
        t = names.slice(0, 3).join(', ') + (names.length > 3 ? ` и ещё ${names.length - 3}` : '');
        kind = c.paths.length > 1 ? `${c.paths.length} файла` : 'Файл';
      } else {
        const link = /^(https?:\/\/|www\.)\S+$/i.test(c.text.trim());
        const color = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.text.trim()) ? c.text.trim() : null;
        ic = color ? `<span style="width:18px;height:18px;border-radius:5px;background:${color}"></span>` : icon(link ? 'link' : 'text', 17);
        t = c.text.replace(/\s+/g, ' ').trim().slice(0, 200);
        kind = '';
      }
      // Как в Island: только приложение и давность, у закреплённых — сиреневая булавка.
      const meta = [kind, c.app && c.app.replace(/\.exe$/i, ''), T.ago(c.time)].filter(Boolean).join(' · ');
      return `<div class="item${i === this.sel ? ' sel' : ''}" data-id="${c.id}">
        <div class="ic">${ic}</div>
        <div class="body"><div class="t">${T.esc(t)}</div><div class="s">${c.pinned ? `<span class="i pin-i">${icon('pin', 12)}</span>` : ''}${T.esc(meta)}</div></div>
        <div class="acts"><button data-a="copy" title="Только скопировать">${icon('copy', 15)}</button><button data-a="pin" class="${c.pinned ? 'on' : ''}" title="${c.pinned ? 'Открепить' : 'Закрепить'}">${icon('pin', 15)}</button><button data-a="del" title="Удалить">${icon('trash', 15)}</button></div>
      </div>`;
    }).join('');
  },
  key(e) {
    const list = $('#clipList');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.sel = moveSel(list, this.sel, e.key === 'ArrowDown' ? 1 : -1); return true; }
    const c = this.shown[this.sel];
    if (e.key === 'Enter' && c) {
      e.preventDefault();
      if (e.shiftKey) { api.invoke('clip-copy', c.id); App.close(true); } else api.invoke('clip-paste', c.id);
      return true;
    }
    if (e.ctrlKey && e.code === 'KeyP' && c) { e.preventDefault(); api.invoke('clip-pin', c.id); return true; }
    if (e.key === 'Delete' && c && document.activeElement !== $('#clipSearch')) { api.invoke('clip-delete', c.id); return true; }
    if (/^[1-9]$/.test(e.key) && e.altKey) { const x = this.shown[+e.key - 1]; if (x) api.invoke('clip-paste', x.id); return true; }
  },
};

// ---------- Уведомления Windows ----------

Views.notifs = {
  list: [], icons: {}, sel: 0, seen: 0,
  init(st) {
    try { this.seen = +localStorage.getItem('notifSeen') || 0; } catch {}
    this.set(st.notifs);
    $('#notifClear').innerHTML = icon('trash', 18);
    api.on('notifs', (d) => {
      this.set(d);
      if (App.tab === 'notifs' && App.expanded) { this.markSeen(); this.paint(); } else renderTabs();
    });
    $('#notifClear').onclick = (e) => {
      const b = e.currentTarget;
      if (!b.classList.contains('warn')) {
        b.classList.add('warn'); b.title = 'Нажми ещё раз — очистить';
        clearTimeout(b._t); b._t = setTimeout(() => { b.classList.remove('warn'); b.title = 'Очистить все уведомления'; }, 2500);
        return;
      }
      b.classList.remove('warn');
      api.invoke('notif-clear');
    };
    $('#notifList').onclick = (e) => {
      const it = e.target.closest('.item');
      if (!it) return;
      if (e.target.closest('[data-a="del"]')) { api.invoke('notif-delete', it.dataset.id); return; }
      api.invoke('notif-open', it.dataset.id);
      App.close(true);
    };
  },
  set(d) { this.list = d?.list || []; this.icons = d?.icons || {}; },
  unread() { return this.list.filter((n) => n.time > this.seen).length; },
  markSeen() {
    this.seen = Date.now();
    try { localStorage.setItem('notifSeen', String(this.seen)); } catch {}
    renderTabs();
  },
  enter() { this.sel = 0; this.markSeen(); this.paint(); },
  paint() {
    const list = $('#notifList');
    const c = this.list.length, m10 = c % 10, m100 = c % 100;
    const word = m10 === 1 && m100 !== 11 ? 'уведомление' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'уведомления' : 'уведомлений';
    $('#notifInfo').textContent = c ? `${c} ${word}` : '';
    if (!this.list.length) {
      list.innerHTML = `<div class="empty">${icon('bell', 26)}<br>Здесь появятся уведомления из Telegram, почты и других приложений</div>`;
      return;
    }
    this.sel = Math.min(this.sel, this.list.length - 1);
    list.innerHTML = this.list.map((n, i) => {
      const src = n.logo || this.icons[n.aumid];
      const ic = src ? `<img src="${src}" alt="">` : icon('bell', 17);
      const meta = [n.app, n.body, T.ago(n.time)].filter(Boolean).join(' · ');
      return `<div class="item${i === this.sel ? ' sel' : ''}" data-id="${n.id}">
        <div class="ic">${ic}</div>
        <div class="body"><div class="t">${T.esc(n.title)}</div><div class="s">${T.esc(meta)}</div></div>
        <div class="acts"><button data-a="del" title="Убрать">${icon('x', 15)}</button></div>
      </div>`;
    }).join('');
  },
  key(e) {
    const list = $('#notifList');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.sel = moveSel(list, this.sel, e.key === 'ArrowDown' ? 1 : -1); return true; }
    const n = this.list[this.sel];
    if (e.key === 'Enter' && n) { e.preventDefault(); api.invoke('notif-open', n.id); App.close(true); return true; }
    if (e.key === 'Delete' && n) { api.invoke('notif-delete', n.id); return true; }
  },
};

// ---------- Полка ----------

// Цветной «листок» с расширением, как у файлов на полке Island.
const DOC_COLORS = [
  [/^pdf$/, '#e5484d'], [/^(png|jpe?g|gif|webp|bmp|svg|ico|heic|tiff?)$/, '#3b9cff'], [/^(docx?|rtf|odt)$/, '#3b6fd8'],
  [/^(xlsx?|csv|ods)$/, '#2fa35a'], [/^(pptx?|odp|key)$/, '#e0702c'], [/^(zip|rar|7z|tar|gz|bz2|xz)$/, '#c9a227'],
  [/^(mp3|wav|flac|ogg|m4a|aac|opus)$/, '#b46cff'], [/^(mp4|mkv|mov|avi|webm|wmv)$/, '#ff5c8a'],
];
function fileExt(name) { const m = /\.([a-z0-9]{1,5})$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
function docIcon(ext, w = 32) {
  const c = (DOC_COLORS.find(([re]) => re.test(ext)) || [0, '#8a8a92'])[1];
  const label = ext.toUpperCase().slice(0, 4);
  return `<svg class="doc" width="${w}" height="${w * 1.25}" viewBox="0 0 32 40"><path d="M4 0h18l10 10v26a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4z" fill="${c}"/><path d="M22 0v6a4 4 0 0 0 4 4h6z" fill="#fff" fill-opacity=".35"/><text x="16" y="28" text-anchor="middle" font-size="${label.length > 3 ? 7 : 8.5}" font-weight="700" fill="#fff" font-family="Segoe UI, sans-serif">${T.esc(label)}</text></svg>`;
}

Views.shelf = {
  items: [], sel: new Set(),
  init() {
    api.invoke('shelf-get').then((it) => this.set(it));
    const grid = $('#shelfGrid');
    grid.addEventListener('dragover', () => grid.classList.add('over'));
    grid.addEventListener('dragleave', () => grid.classList.remove('over'));
    grid.addEventListener('drop', () => grid.classList.remove('over'));
    grid.onclick = async (e) => {
      const it = e.target.closest('.sh-item');
      if (!it) { this.sel.clear(); this.paint(); return; }
      const p = it.dataset.path;
      if (e.target.closest('.x')) { this.set(await api.invoke('shelf-remove', [p])); return; }
      if (!e.ctrlKey) this.sel.clear();
      this.sel.has(p) ? this.sel.delete(p) : this.sel.add(p);
      this.paint();
    };
    grid.ondblclick = (e) => { const it = e.target.closest('.sh-item'); if (it) api.invoke('open-path', it.dataset.path); };
    grid.addEventListener('dragstart', (e) => {
      const it = e.target.closest('.sh-item');
      if (!it) return;
      e.preventDefault();
      const p = it.dataset.path;
      api.send('shelf-drag', this.sel.has(p) ? [...this.sel] : [p]);
    });
    grid.oncontextmenu = (e) => { const it = e.target.closest('.sh-item'); if (it) { e.preventDefault(); api.invoke('show-path', it.dataset.path); } };
    $('#shelfDrag').addEventListener('dragstart', (e) => {
      e.preventDefault();
      const paths = this.pick();
      if (paths.length) api.send('shelf-drag', paths);
    });
    $('#shelfCopy').onclick = async () => {
      const paths = this.pick();
      if (!paths.length) return;
      await api.invoke('shelf-copy', paths);
      this.info(`Скопировано: ${paths.length} — вставь в любую папку`);
      clearTimeout(this.infoT);
      this.infoT = setTimeout(() => this.info(''), 2500);
    };
    $('#shelfClear').onclick = async () => {
      const paths = this.sel.size ? [...this.sel] : this.items.map((i) => i.path);
      this.sel.clear();
      this.set(await api.invoke('shelf-remove', paths));
    };
  },
  pick() { return this.sel.size ? [...this.sel] : this.items.filter((i) => i.exists).map((i) => i.path); },
  set(items) {
    this.items = items;
    for (const p of [...this.sel]) if (!items.some((i) => i.path === p)) this.sel.delete(p);
    App.renderTabs?.();
    App.render?.(); // счётчик полки в капсуле
    this.paint();
  },
  info(text) { $('#shelfInfo').textContent = text; },
  // Зона сброса, пока по Windows тащат файл.
  dropZone(on) { $('#shelfDrop').classList.toggle('on', on); },
  paint() {
    const grid = $('#shelfGrid');
    const n = this.items.length;
    // Пустая полка — пунктирная рамка на всю панель, шапка с кнопками прячется.
    grid.classList.toggle('vacant', !n);
    $('.shelf-head').style.display = n ? '' : 'none';
    if (!n) {
      grid.innerHTML = `<div class="sh-empty">${icon('shelf', 20)}<b>Полка пуста</b><span>Перетащи файлы на остров — они полежат<br>здесь, пока ты не вытащишь их в нужное окно</span></div>`;
    } else {
      grid.innerHTML = this.items.map((i) => {
        const ext = i.size != null ? fileExt(i.name) : '';
        const pic = ext ? docIcon(ext) : i.icon ? `<img src="${i.icon}" draggable="false">` : icon('folder', 32);
        return `<div class="sh-item${this.sel.has(i.path) ? ' sel' : ''}${i.exists ? '' : ' missing'}" draggable="true" data-path="${T.esc(i.path)}" title="${T.esc(i.path)}">
        <button class="x" title="Убрать">${icon('x', 12)}</button>
        <div class="pic">${pic}</div><div class="n">${T.esc(i.name)}</div>${i.size != null ? `<div class="z">${T.size(i.size)}</div>` : ''}</div>`;
      }).join('');
    }
    const k = this.sel.size || n;
    const drag = $('#shelfDrag');
    drag.hidden = !n;
    drag.innerHTML = `${icon('grip', 16)}${this.sel.size ? `Перетащить выбранные (${k})` : `Перетащить все (${k})`}`;
    $('#shelfCopy').hidden = $('#shelfClear').hidden = !n;
    $('#shelfCopy').innerHTML = icon('copy', 16);
    $('#shelfClear').innerHTML = `${icon('trash', 17)}${this.sel.size ? 'Убрать' : 'Очистить'}`;
  },
  key(e) {
    if (e.key === 'Delete' && this.sel.size) { $('#shelfClear').click(); return true; }
    if (e.ctrlKey && e.code === 'KeyA') { e.preventDefault(); this.items.forEach((i) => this.sel.add(i.path)); this.paint(); return true; }
  },
};

// ---------- Текст ----------

Views.text = {
  init() {
    const txt = $('#txt');
    $('#txtLoad').innerHTML = icon('paste', 18);
    $('#txtCopy').innerHTML = icon('copy', 18);
    $('#txtPaste').innerHTML = icon('enter', 18);
    this.info = () => {
      const s = txt.value;
      $('#txtInfo').textContent = s
        ? `${s.length} симв. · ${s.replace(/\s/g, '').length} без пробелов · ${(s.match(/\S+/g) || []).length} слов · ${s.split('\n').length} стр.`
        : 'Пусто';
    };
    txt.oninput = this.info;
    $('#txtSeg').onclick = (e) => {
      const b = e.target.closest('[data-seg]');
      if (!b) return;
      $$('#txtSeg button').forEach((x) => x.classList.toggle('on', x === b));
      $('#txtTools').hidden = b.dataset.seg !== 'tools';
      $('#txtAi').hidden = b.dataset.seg !== 'ai';
    };
    const run = async (e) => {
      const b = e.target.closest('[data-t]');
      if (!b || !txt.value) return;
      const k = b.dataset.t;
      if (!k.startsWith('ai-')) {
        try { txt.value = T.apply(k, txt.value); this.info(); }
        catch { $('#txtInfo').textContent = k.startsWith('json') ? 'Это не JSON' : 'Не получилось преобразовать'; }
        return;
      }
      if (b.classList.contains('busy')) return;
      b.classList.add('busy');
      $('#txtInfo').textContent = 'ИИ думает…';
      try { txt.value = String(await api.invoke('ai-once', T.AI[k], txt.value)).trim(); this.info(); }
      catch (err) { $('#txtInfo').textContent = errText(err); }
      finally { b.classList.remove('busy'); }
    };
    $('#txtTools').onclick = run;
    $('#txtAi').onclick = run;
    $('#txtLoad').onclick = async () => { txt.value = (await api.invoke('text-read')) || ''; this.info(); };
    $('#txtCopy').onclick = async () => { if (txt.value) { await api.invoke('text-copy', txt.value); $('#txtInfo').textContent = 'Скопировано ✓'; } };
    $('#txtPaste').onclick = () => { if (txt.value) api.invoke('text-paste', txt.value); };
  },
  async enter(opts) {
    const txt = $('#txt');
    if (opts?.text) txt.value = opts.text;
    else if (!txt.value) txt.value = (await api.invoke('text-read')) || '';
    this.info();
  },
  key(e) {
    if (e.ctrlKey && e.key === 'Enter') { $('#txtPaste').click(); return true; }
  },
};

// ---------- ИИ-чат ----------

Views.chat = {
  msgs: [], cur: null, rec: null, raf: 0, files: [], sources: null,
  // src — кто отвечает: { kind: 'api' } | { kind: 'local', id, model } | { kind: 'agent', id, name, resume, title }
  // agent — сессия агента в этом чате ({ session, cwd }): следующий вопрос продолжает её
  src: { kind: 'api' }, agent: {},
  init() {
    try { this.msgs = JSON.parse(localStorage.chat || '[]'); } catch { this.msgs = []; }
    try { this.src = JSON.parse(localStorage.chatSrc || 'null') || this.src; this.agent = JSON.parse(localStorage.chatAgent || '{}'); } catch {}
    this.paintSrc();
    $('#chatSrc').onclick = () => this.srcMenu();
    $('#chatSrcMenu').onclick = (e) => this.srcPick(e);
    document.addEventListener('mousedown', (e) => { if (!e.target.closest('#chatSrc, #chatSrcMenu')) this.srcClose(); });
    $('#chatNew').innerHTML = icon('compose', 20);
    $('#chatAttach').innerHTML = icon('attach', 18);
    $('#chatMic').innerHTML = icon('mic', 18);
    const inp = $('#chatIn');
    inp.oninput = () => { inp.style.height = 'auto'; inp.style.height = Math.min(110, inp.scrollHeight) + 'px'; this.paintSend(); };
    inp.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } };
    $('#chatSend').onclick = () => (this.cur ? this.stop() : this.send());
    $('#chatNew').onclick = () => { this.stop(); this.msgs = []; this.files = []; this.agent = {}; this.save(); this.paint(); this.paintFiles(); inp.focus(); };
    $('#chatMic').onclick = () => this.mic();
    $('#chatAttach').onclick = () => $('#chatFile').click();
    $('#chatFile').onchange = async (e) => {
      for (const f of [...e.target.files]) {
        // Картинки и PDF уходят модели как есть (base64), остальное — текстом.
        const kind = f.type.startsWith('image/') ? 'image' : /\.pdf$/i.test(f.name) ? 'pdf' : 'text';
        const max = kind === 'text' ? 400 * 1024 : 15 * 1024 * 1024;
        if (f.size > max) { inp.placeholder = `${f.name}: файл больше ${T.size(max)}`; continue; }
        if (kind === 'text') this.files.push({ name: f.name, size: f.size, text: await f.text() });
        else this.files.push({ name: f.name, size: f.size, kind, data: await dataUrl(f) });
      }
      e.target.value = '';
      this.paintFiles();
      inp.focus();
    };
    $('#chatFiles').onclick = (e) => {
      const x = e.target.closest('[data-rm]');
      if (x) { this.files.splice(+x.dataset.rm, 1); this.paintFiles(); }
    };
    $('#chatLog').onclick = (e) => {
      const act = e.target.closest('[data-act]');
      if (act?.dataset.act === 'settings') { App.close(false); api.invoke('open-settings', 'ai'); return; }
      if (act?.dataset.act === 'login') { api.invoke('agent-login').then(() => (act.textContent = 'Терминал открыт'), (err) => (act.textContent = errText(err))); return; }
      // «Повторить» после входа: убираем подсказку и снова задаём последний вопрос
      if (act?.dataset.act === 'again') {
        if (this.cur) return;
        while (this.msgs.length && this.msgs[this.msgs.length - 1].error) this.msgs.pop();
        if (this.msgs[this.msgs.length - 1]?.role === 'user') this.ask(); else { this.save(); this.paint(); }
        return;
      }
      if (act) {
        const last = this.msgs[this.msgs.length - 1];
        if (act.dataset.act === 'copy' && last) { api.invoke('text-copy', last.content); act.innerHTML = icon('check', 16); setTimeout(() => (act.innerHTML = icon('copy', 16)), 1500); }
        if (act.dataset.act === 'retry' && last && last.role === 'assistant' && !this.cur) { this.msgs.pop(); this.ask(); }
        return;
      }
      const cc = e.target.closest('.code-copy');
      if (cc) { api.invoke('text-copy', cc.parentElement.querySelector('code').textContent); cc.innerHTML = icon('check', 14); return; }
      const a = e.target.closest('a[data-url]');
      if (a) { e.preventDefault(); api.invoke('open-url', a.dataset.url); }
    };
    api.on('ai-delta', (d) => {
      if (!this.cur || d.id !== this.cur.id) return;
      this.cur.msg.content += d.text;
      if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.paintLast(); });
    });
    api.on('ai-done', (d) => {
      if (!this.cur || d.id !== this.cur.id) return;
      const m = this.cur.msg;
      // у ключа API ошибка ведёт в настройки, у агента и локальной модели — просто текст
      if (d.error && !m.content) { const key = this.src.kind === 'api'; m.content = key ? aiError(d.error) : d.error; m.error = key ? true : 'src'; }
      // Claude Code без входа отвечает «Not logged in · Please run /login» — обычным текстом
      if (this.isClaude() && /not logged in|please run \/login|invalid api key/i.test((m.content || '').slice(0, 300))) this.loginHint(m);
      if (d.session) { this.agent = { session: d.session, cwd: d.cwd || '' }; this.src.resume = ''; }
      this.cur = null;
      this.save();
      this.paint();
    });
  },
  enter(opts) {
    this.paint();
    if (opts?.ask) { $('#chatIn').value = opts.ask; this.send(); }
    setTimeout(() => $('#chatIn').focus(), 30);
  },
  leave() { if (this.rec) this.rec.stop(); },
  // Картинки и PDF в историю на диск не пишем — только имя и размер.
  save() {
    const strip = (m) => (m.files ? { ...m, files: m.files.map(({ data, ...f }) => f) } : m);
    try {
      localStorage.chat = JSON.stringify(this.msgs.slice(-60).map(strip));
      localStorage.chatSrc = JSON.stringify(this.src);
      localStorage.chatAgent = JSON.stringify(this.agent);
    } catch {}
  },
  fileCard(f, i) {
    const thumb = f.kind === 'image' && f.data ? `<span class="f-thumb" style="background-image:url('${f.data}')"></span>` : icon(f.kind === 'image' ? 'image' : 'doc', 22);
    return `<div class="f-card">${thumb}<div><div class="n">${T.esc(f.name)}</div><div class="z">${T.size(f.size)}</div></div>${i != null ? `<button class="x" data-rm="${i}" title="Убрать">${icon('x', 12)}</button>` : ''}</div>`;
  },
  html(m, typing, last) {
    if (m.role === 'user') {
      const files = m.files?.length ? `<div class="msg-files">${m.files.map((f) => this.fileCard(f)).join('')}</div>` : '';
      return `${files}${m.content ? `<div class="msg user">${T.esc(m.content)}</div>` : ''}`;
    }
    const acts = last && !typing && !m.error ? `<div class="msg-acts"><button data-act="copy" title="Копировать">${icon('copy', 16)}</button><button data-act="retry" title="Ответить заново">${icon('retry', 16)}</button></div>` : '';
    const fix = m.error === true ? `<div class="msg-acts"><button class="pill" data-act="settings">Настройки ИИ</button></div>`
      : m.error === 'login' ? `<div class="msg-acts"><button class="pill primary" data-act="login">Войти</button><button class="pill" data-act="again">Повторить</button></div>` : '';
    return `<div class="msg bot${m.error ? ' err' : ''}${typing ? ' typing' : ''}"><span class="av">${icon('sparkle', 15)}</span><div class="tx">${m.error ? T.esc(m.content) : T.md(m.content)}${acts}${fix}</div></div>`;
  },
  paint() {
    const log = $('#chatLog');
    const n = this.msgs.length;
    log.innerHTML = n
      ? this.msgs.map((m, i) => this.html(m, this.cur && i === n - 1, i === n - 1)).join('')
      : `<div class="empty">${icon('sparkle', 26)}<br>${this.src.resume ? 'Продолжение сессии из терминала' : 'Спроси что угодно'}<br><span class="small">${T.esc(this.srcHint())}</span></div>`;
    log.scrollTop = log.scrollHeight;
    this.paintSend();
  },
  paintSend() {
    const b = $('#chatSend');
    b.innerHTML = icon(this.cur ? 'stop' : 'send', 17);
    b.classList.toggle('ready', !!this.cur || !!$('#chatIn').value.trim() || this.files.length > 0);
  },
  paintFiles() {
    $('#chatFiles').innerHTML = this.files.map((f, i) => this.fileCard(f, i)).join('');
    this.paintSend();
  },
  paintLast() {
    const log = $('#chatLog');
    const last = log.lastElementChild;
    if (!last || !this.cur) return;
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    last.outerHTML = this.html(this.cur.msg, true, true);
    if (stick) log.scrollTop = log.scrollHeight;
  },
  send() {
    const inp = $('#chatIn');
    const text = inp.value.trim();
    if ((!text && !this.files.length) || this.cur) return;
    inp.value = ''; inp.style.height = 'auto';
    // /login в режиме -p не работает: вместо отправки — подсказка с кнопкой входа
    if (this.isClaude() && /^\/login\b/i.test(text)) {
      this.msgs.push({ role: 'user', content: text, error: 'cmd' }, this.loginHint({ role: 'assistant' }));
      this.save();
      this.paint();
      return;
    }
    const files = this.files.map((f) => (f.kind ? f : { name: f.name, size: f.size, text: f.text.slice(0, 60000) }));
    this.files = [];
    this.paintFiles();
    this.msgs.push(files.length ? { role: 'user', content: text, files } : { role: 'user', content: text });
    this.ask();
  },
  // Запрос ответа на текущую историю: файлы уходят в текст сообщения.
  ask() {
    const msg = { role: 'assistant', content: '' };
    this.msgs.push(msg);
    const id = uid();
    this.cur = { id, msg };
    this.paint();
    const history = this.msgs.slice(0, -1).filter((m) => !m.error).slice(-20).map(({ role, content, files }) => {
      const texts = (files || []).filter((f) => f.text != null).map((f) => `Файл «${f.name}»:\n\`\`\`\n${f.text}\n\`\`\`\n\n`).join('');
      const text = texts + (content || (files ? 'Посмотри файл.' : ''));
      // Картинки и PDF — частями сообщения в формате OpenAI (их понимают и OpenRouter, и Groq с vision-моделями).
      const bin = (files || []).filter((f) => f.data);
      if (!bin.length) return { role, content: text };
      return {
        role,
        content: [{ type: 'text', text }, ...bin.map((f) => (f.kind === 'image'
          ? { type: 'image_url', image_url: { url: f.data } }
          : { type: 'file', file: { filename: f.name, file_data: f.data } }))],
      };
    });
    const src = this.src.kind === 'agent' ? { ...this.src, session: this.agent.session, cwd: this.agent.cwd } : this.src;
    api.invoke('ai-chat', id, history, src).catch(() => {});
  },
  isClaude() { return this.src.kind === 'agent' && this.src.id === 'claude'; },
  loginHint(m) {
    m.content = 'Claude Code на этом компьютере не вошёл в аккаунт. Нажми «Войти»: откроется терминал с claude — набери там /login, войди в браузере, закрой терминал и нажми «Повторить».';
    m.error = 'login';
    return m;
  },
  srcHint() {
    const s = this.src;
    if (s.kind === 'local') return `Модель ${s.model} работает на этом компьютере — без интернета и ключей`;
    if (s.kind === 'agent') return s.resume ? `«${s.title}» — копия сессии, сама сессия в терминале не меняется` : `${s.name} отвечает со своими инструментами`;
    return 'Ответы идут через твой ключ API — он задаётся в настройках';
  },
  paintSrc() {
    const s = this.src, b = $('#chatSrc');
    b.textContent = s.kind === 'local' ? s.model : s.kind === 'agent' ? s.name : 'Ключ API';
    b.classList.toggle('agent', s.kind === 'agent');
  },
  srcClose() {
    $('#chatSrcMenu').hidden = true;
    $('#chatSrc').classList.remove('on');
  },
  // Агенты и локальные серверы ищутся только при открытии этого списка.
  async srcMenu(force) {
    const m = $('#chatSrcMenu');
    if (!m.hidden && !force) return this.srcClose();
    m.hidden = false;
    $('#chatSrc').classList.add('on');
    if (!this.sources || force) m.innerHTML = '<span class="muted">Ищу агентов и локальные модели…</span>';
    try { this.sources = await api.invoke('ai-sources', !!force); } catch (e) { m.innerHTML = `<span class="muted">${T.esc(errText(e))}</span>`; return; }
    const r = this.sources, s = this.src, E = T.esc;
    const item = (o, label, note, on, off) => `<button data-src="${E(JSON.stringify(o))}"${on ? ' class="on"' : ''}${off ? ' disabled' : ''}><span>${E(label)}</span>${note ? `<small>${E(note)}</small>` : ''}</button>`;
    let h = '<h6>Ключ API</h6>' + item({ kind: 'api' }, 'Модель из настроек', '', s.kind === 'api');
    h += '<h6>Локальные модели</h6>';
    const loc = r.local.filter((l) => l.ok && l.models.length);
    h += loc.length
      ? loc.map((l) => l.models.map((md) => item({ kind: 'local', id: l.id, model: md }, md, l.name, s.kind === 'local' && s.id === l.id && s.model === md)).join('')).join('')
      : '<span class="muted">Ollama и LM Studio не запущены</span>';
    h += '<h6>Агенты в терминале</h6>';
    for (const a of r.agents) {
      h += item({ kind: 'agent', id: a.id, name: a.name }, a.name, a.ok ? 'новый разговор' : 'не установлен', s.kind === 'agent' && s.id === a.id && !s.resume && !this.agent.session, !a.ok);
      if (a.id === 'claude') for (const ss of r.sessions) {
        const dir = ss.cwd.split(/[\\/]/).filter(Boolean).pop() || ss.cwd;
        h += item({ kind: 'agent', id: 'claude', name: a.name, resume: ss.id, title: ss.title }, '↳ ' + ss.title, dir, s.resume === ss.id);
      }
    }
    if (r.custom) h += item({ kind: 'agent', id: 'custom', name: 'Своя команда' }, 'Своя команда', 'из настроек', s.kind === 'agent' && s.id === 'custom');
    const mode = { read: 'только чтение', edit: 'правка файлов', all: 'всё без спроса' }[r.mode] || 'только чтение';
    h += `<div class="foot"><span>Права агента: ${mode}</span><span><button data-src-act="refresh">Обновить</button><button data-src-act="settings">Настройки</button></span></div>`;
    m.innerHTML = h;
  },
  srcPick(e) {
    const act = e.target.closest('[data-src-act]')?.dataset.srcAct;
    if (act === 'refresh') return this.srcMenu(true);
    if (act === 'settings') { App.close(false); api.invoke('open-settings', 'ai'); return; }
    const b = e.target.closest('button[data-src]');
    if (!b || b.disabled) return;
    const o = JSON.parse(b.dataset.src);
    this.srcClose();
    this.stop();
    // Сессия из терминала — другой разговор: чат начинается заново. Как и выход из неё.
    if (o.resume || this.src.resume || this.agent.session) this.msgs = [];
    this.src = o;
    this.agent = {};
    this.save();
    this.paintSrc();
    this.paint();
    $('#chatIn').focus();
  },
  stop() {
    if (!this.cur) return;
    api.invoke('ai-stop', this.cur.id);
  },
  async mic() {
    const btn = $('#chatMic');
    if (this.rec) { this.rec.stop(); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { $('#chatIn').placeholder = 'Нет доступа к микрофону'; return; }
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    const parts = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      this.rec = null;
      btn.classList.remove('rec');
      btn.innerHTML = icon('mic', 18);
      const inp = $('#chatIn');
      inp.placeholder = 'Распознаю речь…';
      try {
        const buf = new Uint8Array(await new Blob(parts, { type: 'audio/webm' }).arrayBuffer());
        const text = String(await api.invoke('stt', buf, 'audio/webm')).trim();
        inp.value = (inp.value ? inp.value + ' ' : '') + text;
        inp.oninput();
        inp.focus();
      } catch (err) { $('#chatIn').placeholder = errText(err); return; }
      inp.placeholder = 'Сообщение для ИИ…';
    };
    rec.start();
    this.rec = rec;
    btn.classList.add('rec');
    btn.innerHTML = icon('stop', 18);
  },
  key(e) {
    if (e.key === 'Escape' && !$('#chatSrcMenu').hidden) { this.srcClose(); return true; }
    if (e.key === 'Escape' && (this.cur || this.rec)) { this.stop(); this.rec?.stop(); return true; }
  },
};

// ---------- Диктовка (как «Голос в текст» у Island) ----------
// Капсула: полоски громкости и время слева, × и «Готово» справа. Потом карточка с текстом.

const Dictate = {
  rec: null, stream: null, ac: null, lvT: 0, cut: 0, cancelled: false,
  async start() {
    if (this.rec) return this.stop();
    try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { App.toast({ text: 'Нет доступа к микрофону', left: App.iconSpan('micoff', 'var(--red)'), ms: 2600, edge: 'var(--red)' }); return; }
    const parts = [];
    this.cancelled = false;
    this.rec = new MediaRecorder(this.stream, { mimeType: 'audio/webm;codecs=opus' });
    this.rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    this.rec.onstop = () => this.done(parts);
    this.rec.start();
    this.levels();
    this.cut = setTimeout(() => this.stop(), 3 * 60e3);
    App.dict = { t0: Date.now() };
    App.render();
  },
  // Полоски: анализатор раз в 60 мс, двигаем только высоту — без перерисовки капсулы.
  levels() {
    try {
      this.ac = new AudioContext();
      const an = this.ac.createAnalyser();
      an.fftSize = 256;
      this.ac.createMediaStreamSource(this.stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let s = 0;
        for (let i = 0; i < buf.length; i++) s += (buf[i] - 128) ** 2;
        const v = Math.min(1, Math.sqrt(s / buf.length) / 40);
        $$('#cLeft .dict-bars i').forEach((b, i) => b.style.setProperty('--v', Math.max(0.18, v * [0.6, 0.9, 1, 0.8, 0.55][i]).toFixed(2)));
        this.lvT = setTimeout(tick, 60);
      };
      tick();
    } catch {}
  },
  release() {
    clearTimeout(this.lvT); clearTimeout(this.cut);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ac?.close().catch(() => {});
    this.stream = this.ac = this.rec = null;
  },
  stop() { if (this.rec?.state === 'recording') this.rec.stop(); },
  cancel() { this.cancelled = true; this.stop(); },
  async done(parts) {
    this.release();
    if (this.cancelled || !parts.length) { App.dict = null; App.render(); return; }
    App.dict = { busy: true };
    App.render();
    let text = '', err = '';
    try {
      const buf = new Uint8Array(await new Blob(parts, { type: 'audio/webm' }).arrayBuffer());
      text = String(await api.invoke('stt', buf, 'audio/webm')).trim();
    } catch (e) { err = errText(e); }
    App.dict = null;
    if (!text) {
      App.toast({ text: err ? 'Не получилось распознать' : 'Ничего не услышал', sub: err ? aiError(err).slice(0, 60) : '', left: App.iconSpan('mic', 'var(--dim)'), ms: 3200 });
      return;
    }
    const short = text.length > 90 ? text.slice(0, 88) + '…' : text;
    App.toast({
      big: true, live: true, h: 96, w: 480, side: 104, ms: 15000, happy: true, edge: 'var(--green)',
      left: `<div class="live-ic round" style="--c:var(--green)">${icon('mic', 20)}</div>`,
      html: `Надиктованный текст<span class="sub dict-t">${T.esc(short)}</span>`,
      right: `<button class="live-round" data-act="copy" title="Копировать">${icon('copy', 16)}</button><button class="live-round white" data-act="paste" title="Вставить в окно">${icon('enter', 16)}</button>`,
      acts: { copy: () => api.invoke('text-copy', text), paste: () => api.invoke('text-paste', text) },
      click: () => App.open('text', { focus: true, text }),
    });
  },
};

// ---------- Заметки, таймеры и напоминания ----------

// «15:30» → «в 15:30», «10 мин» → «через 10 мин», «20» → «через 20 минут».
function normWhen(v) {
  v = v.trim();
  if (!v) return '';
  if (/^\d{1,2}[:.]\d{2}$/.test(v)) return 'в ' + v.replace('.', ':');
  if (/^\d+([.,]\d+)?$/.test(v)) return `через ${v} минут`;
  if (/^\d+([.,]\d+)?\s*(с|сек|м|мин|ч|час|д|дн|день|дня|дней|недел)/i.test(v)) return 'через ' + v;
  return v;
}

Views.notes = {
  list: [], idx: 0, rems: [], tick: 0, plan: null, note: '', min: 5,
  init(st) {
    this.list = (st.notes || []).filter((n) => n.text.trim());
    this.rems = st.reminders || [];
    this.save = debounce(() => api.invoke('notes-save', this.list.filter((n) => n.text.trim())), 500);
    try { this.min = +localStorage.getItem('tmMin') || 5; } catch {}
    $('#noteRemind').innerHTML = `${icon('bell', 15)}Напомнить`;
    $('#noteCopy').innerHTML = icon('copy', 16);
    $('#noteDel').innerHTML = icon('trash', 16);
    $('#noteOk').innerHTML = icon('check', 14);
    $('#remHead').innerHTML = `${icon('bell', 14)}Напоминания`;
    $('#noteText').oninput = () => {
      const v = $('#noteText').value;
      let n = this.list[this.idx];
      if (!n) { n = { id: uid(), text: '', time: Date.now() }; this.list.push(n); this.idx = this.list.length - 1; }
      n.text = v; n.time = Date.now();
      this.paintHead();
      this.paintTabs();
      this.save();
    };
    // Как в Island: над заметкой вкладки и «+», новая заметка встаёт в конец.
    $('#noteTabs').onclick = (e) => {
      if (e.target.closest('[data-new]')) {
        this.prune();
        this.list.push({ id: uid(), text: '', time: Date.now() });
        this.go(this.list.length - 1);
        return;
      }
      const b = e.target.closest('[data-i]');
      if (b) { this.prune(); this.go(+b.dataset.i); }
    };
    $('#noteCopy').onclick = () => { const v = $('#noteText').value; if (v) { api.invoke('text-copy', v); this.paintHead('Скопировано'); } };
    $('#noteDel').onclick = (e) => {
      if (!this.list[this.idx]) return;
      if (!e.currentTarget.classList.contains('warn')) {
        const b = e.currentTarget;
        b.classList.add('warn'); clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('warn'), 2500);
        return;
      }
      e.currentTarget.classList.remove('warn');
      this.list.splice(this.idx, 1);
      this.save();
      this.go(Math.min(this.idx, this.list.length - 1));
    };
    $('#noteRemind').onclick = () => {
      const v = $('#noteText').value.trim().split('\n')[0].slice(0, 60);
      const f = $('#remText');
      f.value = v ? v + ' ' : '';
      f.focus();
      this.preview();
    };

    // таймер: кольцо, «Старт» и «Своё время», пресеты в минутах
    $('#tmChips').onclick = (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      this.min = +b.dataset.m;
      try { localStorage.setItem('tmMin', this.min); } catch {}
      this.paintTime();
    };
    $('#tmGo').onclick = () => {
      const t = this.cur();
      api.invoke(t ? 'timer-pause' : 'timer-start', t ? t.id : this.min * 60, '');
    };
    $('#tmAlt').onclick = () => { const t = this.cur(); if (t) api.invoke('timer-stop', t.id); else this.editTime(true); };
    $('#tmEdit').onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.applyEdit(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.editTime(false); }
    };
    $('#tmEdit').onblur = () => this.editTime(false);
    // Колесо над кольцом: идущий таймер — ±минута, без таймера — время для «Старт».
    $('.tm-ring').addEventListener('wheel', (e) => {
      e.preventDefault();
      const d = e.deltaY < 0 ? 1 : -1, t = this.cur();
      if (t) { api.invoke('timer-add', t.id, d * 60); return; }
      this.min = Math.max(1, Math.min(180, this.min + d));
      try { localStorage.setItem('tmMin', this.min); } catch {}
      this.paintTime();
    }, { passive: false });

    // напоминания: одна строка «о чём и когда»
    $('#remList').onclick = (e) => {
      const it = e.target.closest('.item');
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!it || !a) return;
      if (a === 'del') api.invoke('reminder-remove', it.dataset.id);
      else api.invoke(a === 'stop' ? 'timer-stop' : 'timer-pause', it.dataset.id);
    };
    api.on('timers', () => { if (App.tab === 'notes') this.paintTime(); });
    api.on('reminders', (r) => { this.rems = r; if (App.tab === 'notes') this.paintList(); });
    // Чипы как у Island: о чём — из поля или первой строки заметки, когда — с чипа.
    $('#remChips').onclick = async (e) => {
      const b = e.target.closest('[data-q]');
      if (!b) return;
      const what = $('#remText').value.trim() || $('#noteText').value.trim().split('\n')[0].slice(0, 60) || 'Напоминание';
      const p = await api.invoke('reminder-parse', `${what} ${b.dataset.q}`);
      if (!p) return;
      await api.invoke('reminder-add', p);
      $('#remText').value = '';
      this.plan = null;
      const done = this.note = `Напомню ${fmtWhen(p.at)} ✓`;
      this.paintList();
      setTimeout(() => { if (this.note === done) { this.note = ''; this.paintList(); } }, 2200);
    };
    const preview = debounce(() => this.preview(), 150);
    $('#remText').oninput = preview;
    $('#remText').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); this.add(); } };
  },
  enter() {
    this.prune();
    this.go(Math.min(this.idx, Math.max(0, this.list.length - 1)), false);
    this.paintTime();
    clearInterval(this.tick);
    this.tick = setInterval(() => { if (App.timers.length) this.paintTime(); }, 1000);
  },
  leave() { this.prune(); clearInterval(this.tick); this.editTime(false); },
  prune() {
    const cur = this.list[this.idx];
    const n = this.list.length;
    this.list = this.list.filter((x) => x.text.trim() || x === cur && $('#noteText') === document.activeElement);
    if (this.list.length !== n) { this.idx = Math.max(0, this.list.indexOf(cur)); this.save(); }
  },
  go(i, focus = true) {
    this.idx = Math.max(0, Math.min(i, this.list.length - 1));
    $('#noteText').value = this.list[this.idx]?.text || '';
    this.paintHead();
    this.paintTabs();
    if (focus) setTimeout(() => $('#noteText').focus(), 30);
  },
  paintHead(status) {
    const v = $('#noteText').value;
    $('#noteOk').hidden = !v;
    $('#noteInfo').textContent = status || (v ? `Сохранено · ${v.length} симв.` : '');
    clearTimeout(this.infoT);
    if (status) this.infoT = setTimeout(() => this.paintHead(), 1800);
  },
  paintTabs() {
    const name = (n) => (n && n.text.trim().split('\n')[0].slice(0, 18)) || 'Заметка';
    const list = this.list.length ? this.list : [null];
    $('#noteTabs').innerHTML = list.map((n, i) => `<button class="${i === this.idx ? 'on' : ''}" data-i="${i}">${T.esc(name(n))}</button>`).join('')
      + `<button class="add" data-new title="Новая заметка">${icon('plus', 14)}</button>`;
  },
  cur() { return App.timers.length ? runningTimer() : null; },
  editTime(on) {
    const f = $('#tmEdit');
    if (on) { f.hidden = false; $('#tmLeft').hidden = true; f.value = ''; f.focus(); }
    else if (!f.hidden) { f.hidden = true; $('#tmLeft').hidden = false; }
  },
  // «7» — минуты, «1:30» — минуты и секунды, остальное («полчаса», «2 часа») разбирает командная строка.
  async applyEdit() {
    const v = $('#tmEdit').value.trim();
    const m = v.match(/^(\d+)(?::(\d{1,2}))?$/);
    let sec = m ? +m[1] * 60 + (+m[2] || 0) : 0;
    if (!m && v) sec = (await api.invoke('cmd-query', 'таймер ' + v)).find((x) => x.kind === 'timer')?.seconds || 0;
    this.editTime(false);
    if (sec > 0) api.invoke('timer-start', sec, '');
  },
  paintTime() {
    const t = this.cur();
    const left = t ? Math.max(0, Math.ceil(((t.paused ? t.left : t.end - Date.now()) / 1000))) : this.min * 60;
    const frac = t ? Math.min(1, left / t.total) : 1;
    const C = 2 * Math.PI * 37;
    const arc = $('#tmArc');
    arc.style.strokeDasharray = C;
    arc.style.strokeDashoffset = C * (1 - frac);
    $('.time-card').classList.toggle('run', !!t && !t.paused);
    $('#tmLeft').textContent = T.clock(left);
    $('#tmGo').innerHTML = !t ? `${icon('play', 15)}Старт` : t.paused ? `${icon('play', 15)}Дальше` : `${icon('pause', 15)}Пауза`;
    $('#tmAlt').innerHTML = t ? `${icon('x', 14)}Сбросить` : `${icon('pen', 14)}Своё время`;
    $$('#tmChips [data-m]').forEach((b) => b.classList.toggle('on', !t && +b.dataset.m === this.min));
    this.paintList();
  },
  async preview() {
    const v = $('#remText').value.trim();
    this.plan = null;
    if (!v) { this.note = ''; this.paintList(); return; }
    const p = await api.invoke('reminder-parse', v);
    if (p) { this.plan = p; this.note = `«${p.text}» — ${fmtWhen(p.at)}${p.repeat ? ' · повторяется' : ''} · Enter`; }
    else this.note = 'Укажи, когда: «в 15:30», «через 20 минут», «завтра в 9»';
    this.paintList();
  },
  async add() {
    await this.preview();
    if (!this.plan) return;
    await api.invoke('reminder-add', this.plan);
    $('#remText').value = '';
    this.plan = null;
    const done = this.note = 'Напоминание добавлено ✓';
    this.paintList();
    setTimeout(() => { if (this.note === done) { this.note = ''; this.paintList(); } }, 2000);
  },
  paintList() {
    const C = 2 * Math.PI * 6;
    const cur = this.cur();
    const timers = App.timers.filter((t) => t !== cur).map((t) => {
      const left = (t.paused ? t.left : t.end - Date.now()) / 1000;
      const frac = Math.max(0, Math.min(1, left / t.total));
      return `<div class="item" data-id="${t.id}">
        <svg class="t-ring" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="2"/><circle cx="8" cy="8" r="6" fill="none" stroke="${t.paused ? '#777' : '#ffb340'}" stroke-width="2" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}" transform="rotate(-90 8 8)"/></svg>
        <span class="w t-left">${T.clock(left)}</span><span class="t">${T.esc(t.label || 'Таймер')}${t.paused ? ' · пауза' : ''}</span>
        <div class="acts"><button data-a="pause" title="${t.paused ? 'Продолжить' : 'Пауза'}">${icon(t.paused ? 'play' : 'pause', 13)}</button><button data-a="stop" title="Удалить">${icon('x', 13)}</button></div></div>`;
    });
    const rems = this.rems.slice().sort((a, b) => a.at - b.at).map((r) => `<div class="item" data-id="${r.id}">
      <span class="w">${fmtSoon(r.at)}</span><span class="t">${T.esc(r.text)}${r.repeat ? ' · повтор' : ''}</span>
      <div class="acts"><button data-a="del" title="Удалить">${icon('x', 13)}</button></div></div>`);
    const html = timers.concat(rems).join('');
    $('#remList').innerHTML = html;
    $('#noteRemind').innerHTML = `${icon('bell', 15)}${this.rems.length ? `<b>${this.rems.length}</b>` : 'Напомнить'}`;
    const hint = $('#remHint');
    hint.classList.toggle('pv', !!this.note);
    if (this.note) hint.textContent = this.note;
    else hint.innerHTML = html ? '' : 'Напиши ниже, о чём и когда:<br>«позвонить маме завтра в 9»,<br>«таблетки каждый день в 23:00»,<br>«через 20 минут выключить плиту».';
  },
};

// ---------- Погода ----------

Views.weather = {
  data: null,
  init() {
    $('#weather').onclick = (e) => {
      if (e.target.closest('[data-w="refresh"]')) this.load(true);
      if (e.target.closest('[data-w="city"]')) { App.close(false); api.invoke('open-settings', 'weather'); }
    };
    api.on('settings', (s) => { if (this.data && s.weather.city !== this.data.city) this.data = null; });
  },
  enter() {
    if (this.data) this.paint();
    if (!this.data || Date.now() - this.data.time > 20 * 60e3) this.load(false);
  },
  async load(force) {
    try { this.data = await api.invoke('weather', force); this.paint(); }
    catch (e) { $('#weather').innerHTML = `<div class="empty">Не удалось загрузить погоду<br><span class="small">${T.esc(errText(e))}</span><br><br><button class="pill" data-w="refresh">Повторить</button></div>`; }
  },
  paint() {
    const w = this.data;
    // Как у Island: без плюса у температуры, плоские иконки, дни «Пн»/«Вт».
    const sign = (t) => String(t);
    const now = Date.now();
    const night = w.sunrise && w.sunset && (now < w.sunrise || now > w.sunset);
    const sky = night ? ' night' : /гроз/i.test(w.text || '') ? ' storm' : /снег/i.test(w.text || '') ? ' snow'
      : /дожд|ливень|морось/i.test(w.text || '') ? ' rain' : /пасмур|туман|облач/i.test(w.text || '') ? ' gray' : '';
    const wd = w.days.slice(0, 7);
    const lo = Math.min(...wd.map((d) => d.min)), hi = Math.max(...wd.map((d) => d.max));
    const span = Math.max(1, hi - lo);
    const hours = w.hours.slice(0, 8).map((h, i) => `<div class="w-hour">${i ? new Date(h.time).getHours() + ':00' : 'Сейчас'}<span class="e">${wIcon(h.icon, 20)}</span><b>${sign(h.temp)}°</b></div>`).join('');
    const days = wd.map((d, i) => {
      const wk = new Date(d.date).toLocaleDateString('ru-RU', { weekday: 'short' });
      const name = i === 0 ? 'Сегодня' : wk[0].toUpperCase() + wk.slice(1, 2);
      const l = (d.min - lo) / span * 100, r = (hi - d.max) / span * 100;
      return `<div class="w-day"><span>${name}</span><span class="e">${d.icon ? wIcon(d.icon, 18) : ''}</span><span class="mn">${sign(d.min)}°</span>
        <div class="track"><div class="rng" style="left:${l}%;right:${r}%"></div></div><span>${sign(d.max)}°</span><span class="mm">${d.mm ? String(d.mm).replace('.', ',') + ' мм' : ''}</span></div>`;
    }).join('');
    const stat = (ic, k, v) => `<div class="w-stat"><div class="k">${icon(ic, 12)}${k}</div><div class="v">${v}</div></div>`;
    $('#weather').innerHTML = `
      <div class="w-main${sky}">
        <div class="w-top">
          <span class="w-city grow">${T.esc(w.city || 'Погода')}</span>
          <button class="hbtn" data-w="city" title="Сменить город">${icon('gear', 15)}</button>
          <button class="hbtn" data-w="refresh" title="Обновить">${icon('refresh', 15)}</button>
        </div>
        <div class="w-now"><div class="w-icon">${wIcon(w.icon, 52)}</div><div class="w-temp">${sign(w.temp)}°</div>
          <div><div class="w-text">${T.esc(w.text)}</div>${w.feels != null ? `<div class="w-feels">Ощущается как ${sign(w.feels)}°</div>` : ''}</div></div>
        <div class="w-stats">
          ${stat('wind', 'Ветер', `${w.wind} м/с${w.windDir ? ' ' + w.windDir : ''}`)}
          ${stat('drop', 'Влажность', `${w.humidity}%`)}
          ${stat('umbrella', 'Осадки', `${w.precip ?? 0} мм`)}
        </div>
        <div class="w-sun">${w.sunrise ? `<span>${icon('sunrise', 14)}${hhmm(w.sunrise)}</span><span>${icon('sunset', 14)}${hhmm(w.sunset)}</span>` : ''}<span class="w-src">MET Norway · ${hhmm(w.time)}</span></div>
      </div>
      <div class="w-side">
        <div class="card w-hours">${hours}</div>
        <div class="card w-days">${days}</div>
      </div>`;
  },
};

// ---------- Управление ----------

Views.system = {
  init() {
    $('#sysTiles').onclick = async (e) => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      const k = b.dataset.k;
      if (k === 'mic') this.mic = await api.invoke('mic-toggle');
      else if (k === 'theme') this.theme = await api.invoke('theme', true);
      else if (k === 'WiFi' || k === 'Bluetooth') {
        const r = this.radios.find((x) => x.kind === k);
        const on = !(r && r.state === 'On');
        if (r) r.state = on ? 'On' : 'Off';
        this.paintTiles();
        try { this.radios = [].concat(await api.invoke('radios-set', k, on) || []); } catch {}
      } else if (k === 'battery') { App.close(false); api.invoke('open-settings'); return; }
      else if (k === 'vpn') {
        b.querySelector('.st').textContent = App.vpn ? 'Отключаю…' : 'Подключаю…';
        const r = await App.vpnToggle();
        if (r?.opened) { App.close(false); return; }
        this.net = await api.invoke('net-get').catch(() => this.net);
      }
      this.paintTiles();
    };
    $('#sysPower').onclick = (e) => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      const p = b.dataset.p;
      if (p === 'lock') { App.close(false); api.invoke('lock'); return; }
      if (!armed(b)) { b.querySelector('span').textContent = 'Точно?'; setTimeout(() => this.paintPower(), 2500); return; }
      this.paintPower();
      App.close(false);
      api.invoke('power', p);
    };
    this.radios = []; this.mic = null; this.theme = null;
  },
  async enter() {
    this.paintPower();
    this.paintTiles();
    const [mic, theme, radios, net] = await Promise.allSettled([api.invoke('mic-get'), api.invoke('theme', false), api.invoke('radios-get'), api.invoke('net-get')]);
    this.mic = mic.value || null;
    this.theme = theme.value || null;
    this.radios = [].concat(radios.value || []);
    this.net = net.value || {};
    this.paintTiles();
  },
  paintPower() {
    const names = { lock: 'Блокировка', sleep: 'Сон', restart: 'Перезагрузка', shutdown: 'Выключение' };
    $$('#sysPower [data-p]').forEach((b) => { if (!b.classList.contains('arm')) b.querySelector('span').textContent = names[b.dataset.p]; });
  },
  paintTiles() {
    // Как в Island: четыре высокие плитки — сеть (Wi-Fi или Ethernet), Bluetooth, тема и батарея / VPN / микрофон.
    const tiles = [];
    const tile = (k, ic, n, on, st, cls = '') => tiles.push(`<button class="s-tile${on ? ' on' : ''}${cls}" data-k="${k}"><span class="c">${icon(ic, 20)}</span><div><div class="n">${n}</div><div class="st">${st}</div></div></button>`);
    const radio = (kind) => this.radios.find((r) => r.kind === kind);
    const wifi = radio('WiFi'), bt = radio('Bluetooth'), net = this.net || {};
    if (wifi) tile('WiFi', 'wifi', 'Wi-Fi', wifi.state === 'On', wifi.state === 'On' ? 'Включён' : 'Выключен');
    else if (net.eth) tile('eth', 'ethernet', 'Ethernet', net.eth.up, net.eth.up ? 'Включён' : 'Не подключён', ' static');
    if (bt) tile('Bluetooth', 'bt', 'Bluetooth', bt.state === 'On', bt.state === 'On' ? 'Включён' : 'Выключен');
    else if (this.theme) tile('nobt', 'bt', 'Bluetooth', false, 'Нет адаптера', ' static na');
    if (this.theme) tile('theme', 'contrast', 'Тёмная тема', !!this.theme.dark, this.theme.dark ? 'Включена' : 'Выключена');
    const bat = App.battery;
    if (bat && bat.percent != null) {
      const w = Math.max(2, Math.round(bat.percent / 100 * 17));
      tiles.push(`<button class="s-tile static bat" data-k="battery"><span class="b"><svg width="30" height="16" viewBox="0 0 30 16"><rect x="1" y="1.5" width="24" height="13" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".55"/><rect x="26.5" y="5.5" width="2" height="5" rx="1" fill="currentColor" opacity=".55"/><rect x="4" y="4.5" width="${w}" height="7" rx="1.5" fill="${bat.percent <= 15 && !bat.charging ? '#ff4d5e' : bat.charging ? '#4cd964' : '#fff'}"/></svg>${bat.percent}%</span><div><div class="n">Батарея</div><div class="st">${bat.charging ? 'Заряжается' : 'Работа от батареи'}</div></div></button>`);
    } else if (net.vpn || !this.mic) tile('vpn', 'shield', 'VPN', !!net.vpn, net.vpn ? T.esc(net.vpn) : 'Выключен');
    else if (this.mic) tile('mic', this.mic.muted ? 'micoff' : 'mic', 'Микрофон', !this.mic.muted, this.mic.muted ? 'Выключен' : 'Включён');
    $('#sysTiles').innerHTML = tiles.join('');
  },
};

// ---------- Командная строка ----------

Views.command = {
  res: [], sel: 0, seq: 0,
  init() {
    const inp = $('#cmdIn');
    const query = debounce(async () => {
      const n = ++this.seq;
      const r = await api.invoke('cmd-query', inp.value);
      if (n !== this.seq) return;
      this.res = r; this.sel = 0; this.paint();
    }, 60);
    inp.oninput = query;
    $('#cmdList').onclick = (e) => {
      const it = e.target.closest('.item');
      if (it) this.run(this.res[+it.dataset.i]);
    };
  },
  enter() {
    const inp = $('#cmdIn');
    $('#cmdKbd').textContent = (App.settings.hotkeysActive?.command || App.settings.hotkeys?.command || 'Esc').replace(/\+/g, ' + ');
    inp.value = ''; this.res = []; this.paint();
    setTimeout(() => inp.focus(), 30);
  },
  paint() {
    const ic = { calc: 'calc', timer: 'time', reminder: 'bell', url: 'link', app: 'app', ai: 'sparkle', web: 'globe' };
    $('#cmdList').innerHTML = this.res.length ? this.res.map((r, i) => `<div class="item${i === this.sel ? ' sel' : ''}" data-i="${i}">
      <div class="ic${r.on ? ' on' : ''}">${r.icon ? `<img src="${r.icon}" style="width:26px;height:26px">` : icon(r.icon2 || ic[r.kind] || 'bolt', 20)}</div>
      <div class="body"><div class="t">${T.esc(r.title)}</div>${r.sub ? `<div class="s">${T.esc(r.sub)}</div>` : ''}</div>
      <span class="enter">${icon('enter', 16)}</span></div>`).join('')
      : '<div class="cmd-hint">скр · вкл · 2+2*3 · 100 usd в рублях · таймер 10 минут · напомни завтра в 9 позвонить · telegram</div>';
    // Панель растёт под число результатов, как в Spotlight.
    if (App.tab === 'command') setSize(PANEL_W, Math.min(PANEL_H.command, this.res.length ? 84 + this.res.length * 48 : 116), 28);
  },
  run(r) {
    if (!r) return;
    if (r.kind === 'ai') { App.show('chat', { ask: r.q || r.sub }); return; }
    if (r.kind === 'act' && r.id === 'rec') { App.close(true); Views.home.startRec(); return; }
    if (r.kind === 'act' && r.id === 'dictate') { App.close(true); Dictate.start(); return; }
    api.invoke('cmd-run', r);
    App.close(!['app', 'url', 'web'].includes(r.kind));
  },
  key(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.sel = Math.max(0, Math.min(this.res.length - 1, this.sel + (e.key === 'ArrowDown' ? 1 : -1)));
      this.paint();
      return true;
    }
    if (e.key === 'Enter') { e.preventDefault(); this.run(this.res[this.sel]); return true; }
  },
};
