/* Общий скрипт всех страниц. Каждый блок срабатывает, только если его разметка есть на странице. */
// Ссылки в одном месте: установщик лежит в релизе на GitHub, latest всегда ведёт на свежий.
const LINKS = { download: 'https://github.com/PlaybackG/islet/releases/latest/download/IsletSetup.exe', github: 'https://github.com/PlaybackG/islet' };

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
const $ = id => document.getElementById(id);
const root = document.documentElement;
root.classList.add('js');
const G = !reduce && window.gsap && window.ScrollTrigger;
if (G) { gsap.registerPlugin(ScrollTrigger); ScrollTrigger.config({ ignoreMobileResize: true }); }

document.querySelectorAll('[data-link]').forEach(a => {
  const url = LINKS[a.dataset.link];
  if (!url) return;
  a.href = url;
  if (a.dataset.link === 'download') a.setAttribute('download', '');
});

/* ---------- остров-навигация: раскрытие с задержкой, тап на тач-экране ---------- */
(() => {
  const nav = $('nav'), tg = $('navToggle');
  if (!nav || !tg) return;
  let t;
  const set = v => { nav.classList.toggle('open', v); tg.setAttribute('aria-expanded', v); };
  nav.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { clearTimeout(t); t = setTimeout(() => set(true), 140); } });
  nav.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { clearTimeout(t); t = setTimeout(() => set(false), 220); } });
  tg.addEventListener('click', () => set(!nav.classList.contains('open')));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
  nav.addEventListener('focusin', e => { if (e.target.matches(':focus-visible')) set(true); });
  document.addEventListener('pointerdown', e => { if (!nav.contains(e.target)) set(false); });
  nav.addEventListener('focusout', e => { if (!nav.contains(e.relatedTarget)) set(false); });
})();

/* ---------- заголовки: слова поднимаются из-под маски ---------- */
const splitWords = h => {
  h.setAttribute('aria-label', h.textContent.replace(/\s+/g, ' ').trim());
  let n = 0;
  // делим только по обычным пробелам: неразрывный держит пары слов вместе
  const walk = node => [...node.childNodes].forEach(c => {
    if (c.nodeType === 1) return walk(c);
    if (c.nodeType !== 3) return;
    const frag = document.createDocumentFragment();
    c.textContent.split(/([ \t\n\r]+)/).forEach(part => {
      if (!part) return;
      if (/^[ \t\n\r]+$/.test(part)) return frag.append(part);
      const w = document.createElement('span'), i = document.createElement('span');
      w.className = 'wd'; w.setAttribute('aria-hidden', 'true');
      i.textContent = part; i.style.setProperty('--i', n++);
      w.append(i); frag.append(w);
    });
    c.replaceWith(frag);
  });
  walk(h); h.classList.add('kin');
};

(() => {
  if (reduce) return;
  const heads = [...document.querySelectorAll('[data-kin]')];
  const first = heads.filter(h => h.matches('.hero h1, .phead h1'));
  const rest = heads.filter(h => !first.includes(h));
  heads.forEach(splitWords);
  first.forEach(h => h.style.setProperty('--d0', '120ms'));
  if (!('IntersectionObserver' in window)) return rest.forEach(h => h.classList.add('in'));
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -12% 0px' });
  rest.forEach(h => io.observe(h));
})();

(() => {
  const show = () => {
    root.classList.add('ready');
    document.querySelectorAll('.hero h1, .phead h1').forEach(h => h.classList.add('in'));
  };
  // Без таймера заголовки остаются пустыми, если браузер придержал кадры.
  const go = () => { requestAnimationFrame(() => requestAnimationFrame(show)); setTimeout(show, 300); };
  if (document.fonts && document.fonts.ready) Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 600))]).then(go);
  else go();
})();

/* ---------- появление блоков при прокрутке ---------- */
(() => {
  if (reduce || !('IntersectionObserver' in window)) return;
  const els = [...document.querySelectorAll('.rv')].filter(el => el.getBoundingClientRect().top > innerHeight * .92);
  els.forEach(el => el.classList.add('pre'));
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.remove('pre'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  els.forEach(el => io.observe(el));
})();

/* ---------- счётчики ---------- */
(() => {
  const els = [...document.querySelectorAll('[data-count]')];
  if (!els.length || reduce || !('IntersectionObserver' in window)) return;
  const run = el => {
    const to = +el.dataset.count, t0 = performance.now(), dur = 1400;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 4);
      el.textContent = Math.round(to * e);
      if (k < 1) requestAnimationFrame(step);
    };
    el.textContent = 0; requestAnimationFrame(step);
  };
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } }), { threshold: .6 });
  els.forEach(el => io.observe(el));
})();

/* ---------- кадры приложения: общая сцена для главной и «Возможностей» ---------- */
const addFrame = (stage, shot, label, i) => {
  const img = new Image();
  img.className = 'frame' + (shot === 'pill' ? ' pill' : '');
  img.src = `assets/${shot}.png`;
  img.alt = `Islet: ${label}`;
  img.decoding = 'async';
  if (i > 1) img.loading = 'lazy';
  stage.appendChild(img);
  return img;
};

/* ---------- главная: вкладки-слова ---------- */
(() => {
  const stage = $('tabStage'), cap = $('tabCap');
  if (!stage) return;
  const btns = [...document.querySelectorAll('#tabWords button')];
  const frames = btns.map((b, i) => addFrame(stage, b.dataset.shot, b.textContent, i));
  const select = i => {
    frames.forEach((f, k) => f.classList.toggle('on', k === i));
    btns.forEach((b, k) => b.setAttribute('aria-pressed', k === i));
    cap.textContent = btns[i].dataset.t;
  };
  btns.forEach((b, i) => {
    b.addEventListener('click', () => select(i));
    b.addEventListener('focus', () => select(i));
    if (fine) b.addEventListener('pointerenter', () => select(i));
  });
  select(0);
})();

/* ---------- главная: снимок сворачивается в капсулу-навигацию ---------- */
(() => {
  const shot = $('heroShot'), nav = $('nav');
  if (!G || !shot || !nav) return;
  gsap.matchMedia().add('(min-width: 960px)', () => {
    const body = document.body;
    body.classList.add('collapse'); body.classList.remove('still');
    const tl = gsap.timeline({ scrollTrigger: { start: 0, end: 420, scrub: true, invalidateOnRefresh: true } });
    tl.fromTo(shot, { scale: 1 }, { scale: () => nav.offsetWidth / shot.offsetWidth, duration: 1, ease: 'none' }, 0)
      .to(shot, { autoAlpha: 0, duration: .22, ease: 'none' }, .78)
      .fromTo(nav, { autoAlpha: 0 }, { autoAlpha: 1, duration: .22, ease: 'none' }, .78);
    gsap.fromTo('#res', { scale: .92 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: '.res-sec', start: 'top bottom', end: 'top top', scrub: true } });
    return () => { body.classList.remove('collapse'); body.classList.add('still'); };
  });
})();

/* ---------- главная: фраза загорается по словам ---------- */
(() => {
  const q = $('say');
  if (!G || !q) return;
  const text = q.textContent.trim();
  q.setAttribute('aria-label', text);
  q.innerHTML = text.split(/\s+/).map(w => `<span class="mw" aria-hidden="true">${w}</span>`).join(' ');
  const ws = [...q.children];
  ScrollTrigger.create({
    trigger: q, start: 'top 82%', end: 'bottom 45%', scrub: true,
    onUpdate: s => { const n = Math.round(s.progress * ws.length); ws.forEach((w, i) => w.classList.toggle('lit', i < n)); },
  });
})();

/* ---------- «Возможности»: тур по вкладкам ---------- */
(() => {
  const screen = $('screen'), list = $('tourList'), cap = $('tourCap');
  if (!screen) return;
  const S = [
    ['pill', 'Остров', 'В покое это аккуратная капсула: время, глазки, погода.'],
    ['home', 'Главная', 'Музыка, громкость, восемь быстрых действий и док с приложениями.'],
    ['clips', 'Буфер', 'Всё, что ты копировал, с поиском и закреплением.'],
    ['shelf', 'Полка', 'Перетащи файлы на остров и забери, когда понадобятся.'],
    ['notifs', 'Уведомления', 'Сообщения с иконками приложений. Клик открывает приложение.'],
    ['text', 'Текст', 'Раскладка, регистр, транслит, JSON, Base64 и ИИ-правка.'],
    ['chat', 'Чат', 'Чат с ИИ прямо в капсуле, с разметкой и списками.'],
    ['notes', 'Заметки', 'Быстрые заметки, которые всегда под рукой.'],
    ['weather', 'Погода', 'Прогноз на сегодня и ближайшие дни.'],
    ['system', 'Управление', 'Сеть, Bluetooth, тема, VPN, блокировка, сон и питание.'],
  ];
  const frames = S.map(([shot, t], i) => {
    const li = document.createElement('li');
    li.innerHTML = `<button type="button">${t}</button>`;
    list.appendChild(li);
    return { img: addFrame(screen, shot, t, i), btn: li.firstChild };
  });
  let cur = -1, st = null;
  const show = i => {
    if (i === cur) return;
    cur = i;
    frames.forEach((f, k) => { f.img.classList.toggle('on', k === i); f.btn.setAttribute('aria-current', k === i); });
    cap.textContent = S[i][2];
    const b = frames[i].btn;
    if (list.scrollWidth > list.clientWidth) list.scrollTo({ left: b.parentNode.offsetLeft - 16, behavior: reduce ? 'auto' : 'smooth' });
  };
  frames.forEach((f, i) => f.btn.addEventListener('click', () => {
    if (st) window.scrollTo({ top: st.start + (st.end - st.start) * ((i + .5) / S.length), behavior: reduce ? 'auto' : 'smooth' });
    else show(i);
  }));
  show(0);
  if (!G) return;
  st = ScrollTrigger.create({
    trigger: '#tourPin', pin: true, anticipatePin: 1, invalidateOnRefresh: true,
    start: () => innerWidth < 960 ? 'top 64px' : 'center center',
    end: () => '+=' + innerHeight * 3.2,
    onUpdate: s => show(Math.min(S.length - 1, Math.floor(s.progress * S.length))),
  });
})();

/* ---------- «Возможности»: демо загрузки ---------- */
(() => {
  const ring = $('ring'), wrap = $('dlRing'), line = $('dlLine'), ico = $('dlIco');
  if (!ring) return;
  const TOTAL = 140;
  const arrow = '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"/><path d="M7 11l5 5l5 -5"/><path d="M12 4l0 12"/>', check = '<path d="M5 12l5 5l10 -10"/>';
  let raf;
  const run = () => {
    cancelAnimationFrame(raf); wrap.classList.remove('done'); ico.innerHTML = arrow;
    const t0 = performance.now(), dur = reduce ? 1 : 5200;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur);
      const p = (1 - Math.pow(1 - k, 2.2)) * 100;   // к концу замедляется, как настоящая загрузка
      ring.style.setProperty('--p', p.toFixed(1));
      line.textContent = k < 1 ? `${Math.floor(p)}% · ${Math.round(TOTAL * p / 100)} из ${TOTAL} МБ` : `Готово · ${TOTAL} МБ`;
      if (k < 1) raf = requestAnimationFrame(step);
      else { wrap.classList.add('done'); ico.innerHTML = check; }
    };
    raf = requestAnimationFrame(step);
  };
  $('dlReplay').addEventListener('click', run);
  if (!('IntersectionObserver' in window)) return run();
  const io = new IntersectionObserver(es => { if (es[0].isIntersecting) { run(); io.disconnect(); } }, { threshold: .5 });
  io.observe($('dlDemo'));
})();

/* ---------- капсулы с глазками ---------- */
(() => {
  if (!window.IsletCapsule) return;
  const tiles = [...document.querySelectorAll('.eye-tile[data-style]')];
  const name = $('eyeName'), hero = [...document.querySelectorAll('#heroStyles button')];
  const say = n => {
    if (name) name.textContent = n;
    const i = IsletCapsule.STYLES.findIndex(s => s.name === n);
    tiles.forEach(t => t.setAttribute('aria-pressed', +t.dataset.style === i));
    hero.forEach((b, k) => b.setAttribute('aria-pressed', k === i));
  };
  if ($('cap')) {
    const c = IsletCapsule.mount3D({ canvas: $('cap'), host: $('stage3d'), fallback: $('capFallback'), onStyle: say });
    if (c) hero.forEach((b, i) => b.addEventListener('click', () => c.set(i)));
  }
  const play = $('playCap'), btns = [...document.querySelectorAll('#styles button')];
  if (play) {
    IsletCapsule.mount2D({ host: play, buttons: btns, onStyle: say });
    // Большая капсула висит там же, где навигация, поэтому навигация выходит, только когда та ушла с экрана.
    if ('IntersectionObserver' in window) new IntersectionObserver(es => document.body.classList.toggle('past', !es[0].isIntersecting)).observe(play);
  }
  if ($('eyeGrid')) {
    IsletCapsule.mountMinis({ host: $('eyeGrid'), tiles: tiles.map(t => ({ el: t.querySelector('.mini'), style: +t.dataset.style })) });
    tiles.forEach(t => t.addEventListener('click', () => {
      if (btns[+t.dataset.style]) btns[+t.dataset.style].click();
      if (play) play.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    }));
  }
})();
