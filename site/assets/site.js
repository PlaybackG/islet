/* Скрипт витрины. Главное здесь: сцена с рабочим столом, где прокрутка ведёт курсор и раскрывает остров. */
// Ссылки в одном месте: установщик лежит в релизе на GitHub, latest всегда ведёт на свежий.
const LINKS = { download: 'https://github.com/PlaybackG/islet/releases/latest/download/IsletSetup.exe', github: 'https://github.com/PlaybackG/islet' };

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = id => document.getElementById(id);
const G = !reduce && window.gsap && window.ScrollTrigger;
if (G) { gsap.registerPlugin(ScrollTrigger); ScrollTrigger.config({ ignoreMobileResize: true }); }
else document.body.classList.add('static');

document.querySelectorAll('[data-link]').forEach(a => {
  const url = LINKS[a.dataset.link];
  if (!url) return;
  a.href = url;
  if (a.dataset.link === 'download') a.setAttribute('download', '');
});

/* ---------- остров-навигация: раскрытие с задержкой, тап на тач-экране ---------- */
(() => {
  const nav = $('nav'), tg = $('navToggle');
  let t;
  const set = v => { nav.classList.toggle('open', v); tg.setAttribute('aria-expanded', v); };
  nav.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { clearTimeout(t); t = setTimeout(() => set(true), 140); } });
  nav.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { clearTimeout(t); t = setTimeout(() => set(false), 220); } });
  tg.addEventListener('click', () => set(!nav.classList.contains('open')));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
  document.addEventListener('pointerdown', e => { if (!nav.contains(e.target)) set(false); });
  $('navLinks').addEventListener('click', () => set(false));
})();

/* ---------- появление блоков при прокрутке ---------- */
(() => {
  if (reduce || !('IntersectionObserver' in window)) return;
  const els = [...document.querySelectorAll('.rv')].filter(el => el.getBoundingClientRect().top > innerHeight * .92);
  els.forEach(el => el.classList.add('pre'));
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.remove('pre'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  els.forEach(el => io.observe(el));
})();

/* ---------- счётчик ---------- */
(() => {
  const el = document.querySelector('[data-count]');
  if (!el || reduce || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(es => {
    if (!es[0].isIntersecting) return;
    io.disconnect();
    const to = +el.dataset.count, t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / 1400);
      el.textContent = Math.round(to * (1 - Math.pow(1 - k, 4)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, { threshold: .6 });
  io.observe(el);
})();

/* ---------- первый экран: при уходе капсула летит вверх ---------- */
if (G) {
  gsap.to('#stage3d', { yPercent: -46, scale: .55, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
  gsap.to('#heroCopy', { y: -90, autoAlpha: 0, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'center top', end: 'bottom top', scrub: true } });
}

/* ---------- сцена: рабочий стол. Семь эпизодов, по единице времени на каждый ---------- */
(() => {
  const cues = [...document.querySelectorAll('.cue')], steps = [...document.querySelectorAll('#steps li')];
  const N = cues.length;
  let cur = -1;
  const show = i => {
    if (i === cur) return;
    cur = i;
    cues.forEach((c, k) => c.classList.toggle('on', k === i));
    steps.forEach((s, k) => s.classList.toggle('on', k === i));
  };
  if (!G) return;
  show(0);
  const desk = $('desk'), pill = $('islPill'), cursor = $('cursor'), file = $('pFile'), note = $('pCopy'), dlh = $('dlh');
  const k = .344;   // во сколько раз капсула меньше панели
  const at = (x, y) => ({ x: () => desk.offsetWidth * x, y: () => desk.offsetHeight * y });
  const panels = ['pHome', 'pClips', 'pShelf', 'pNotifs', 'pChat'].map($);
  gsap.set(panels, { scale: k });
  gsap.set([file, note], { autoAlpha: 0 });

  gsap.fromTo(desk, { scale: .82, borderRadius: 36 }, { scale: 1, borderRadius: 0, ease: 'none', scrollTrigger: { trigger: '#deskPin', start: 'top bottom', end: 'top top', scrub: true } });

  const tl = gsap.timeline({
    defaults: { ease: 'power2.inOut' },
    scrollTrigger: {
      trigger: '#deskPin', pin: true, anticipatePin: 1, start: 'top top', end: () => '+=' + innerHeight * N * .9, scrub: .5, invalidateOnRefresh: true,
      onToggle: s => document.body.classList.toggle('on-desk', s.isActive),
      onUpdate: s => show(Math.min(N - 1, Math.floor(s.progress * N))),
    },
  });
  const open = (el, t) => tl.to(el, { scale: 1, duration: .22 }, t)
    .to(el, { autoAlpha: 1, duration: .04, ease: 'none' }, t)
    .to(pill, { autoAlpha: 0, duration: .04, ease: 'none' }, t);
  const close = (el, t) => tl.to(el, { scale: k, duration: .16 }, t)
    .to(el, { autoAlpha: 0, duration: .04, ease: 'none' }, t + .12)
    .to(pill, { autoAlpha: 1, duration: .04, ease: 'none' }, t + .12);
  const move = (x, y, t, d = .2) => tl.to(cursor, { ...at(x, y), duration: d }, t);

  tl.fromTo(cursor, at(.66, .62), { ...at(.66, .62), duration: .01 }, 0);

  // музыка: мышь наверх, панель раскрывается
  move(.5, .05, .08); open(panels[0], .28); move(.5, .34, .86, .1); close(panels[0], .84);

  // буфер: окно с текстом, копирование, текст улетает в остров
  tl.fromTo(note, { ...at(.5, .42), autoAlpha: 0, y: () => desk.offsetHeight * .46 }, { ...at(.5, .42), autoAlpha: 1, duration: .1 }, 1.02);
  tl.to(note, { y: 0, scale: .2, autoAlpha: 0, duration: .16, ease: 'power2.in' }, 1.3);
  open($('pClips'), 1.42); close($('pClips'), 1.86);

  // полка: файл тащат на остров
  tl.fromTo(file, { ...at(.2, .5), autoAlpha: 0 }, { ...at(.2, .5), autoAlpha: 1, duration: .06 }, 2.02);
  move(.2, .5, 2.02, .12);
  tl.to(file, { ...at(.5, .06), scale: .6, duration: .22 }, 2.16);
  move(.5, .06, 2.16, .22);
  tl.to(file, { autoAlpha: 0, duration: .04, ease: 'none' }, 2.38);
  open($('pShelf'), 2.4); close($('pShelf'), 2.86);
  move(.72, .52, 2.9, .1);

  // сообщение: капсула вздрагивает и раскрывается
  tl.to(pill, { scale: 1.14, duration: .05, ease: 'power1.out' }, 3.1).to(pill, { scale: 1, duration: .08, ease: 'back.out(3)' }, 3.15);
  open($('pNotifs'), 3.28); close($('pNotifs'), 3.86);

  // загрузка: кольцо заполняется прокруткой
  const dl = { p: 0 }, ring = $('dhRing'), line = $('dhLine');
  tl.to(pill, { autoAlpha: 0, duration: .04, ease: 'none' }, 4.04).to(dlh, { autoAlpha: 1, duration: .04, ease: 'none' }, 4.04);
  tl.to(dl, { p: 100, duration: .7, ease: 'none', onUpdate: () => { ring.style.setProperty('--p', dl.p.toFixed(1)); line.textContent = `${Math.floor(dl.p)}% · ${Math.round(14 * dl.p)} из 1400 МБ`; } }, 4.1);
  tl.to(dlh, { autoAlpha: 0, duration: .04, ease: 'none' }, 4.9).to(pill, { autoAlpha: 1, duration: .04, ease: 'none' }, 4.9);

  // чат
  move(.5, .05, 5.06); open($('pChat'), 5.26); close($('pChat'), 5.86);

  // покой
  move(.66, .62, 6.04, .3); tl.to({}, { duration: .9 }, 6.1);
})();

/* ---------- лента: вертикальная прокрутка двигает её вбок ---------- */
(() => {
  const track = $('hsTrack');
  if (!G) return;
  const dist = () => Math.max(0, track.scrollWidth - innerWidth);
  gsap.to(track, { x: () => -dist(), ease: 'none', scrollTrigger: { trigger: '#hsPin', pin: true, anticipatePin: 1, start: 'top top', end: () => '+=' + dist(), scrub: .4, invalidateOnRefresh: true } });
  gsap.to('#hsBar', { scaleX: 1, ease: 'none', scrollTrigger: { trigger: '#hsPin', start: 'top top', end: () => '+=' + dist(), scrub: true } });
})();

/* ---------- ресурсы: потоки появляются по очереди, потом закрашивается доля Islet ---------- */
if (G) {
  gsap.from('#cpu span', { opacity: 0, scale: .7, stagger: .05, ease: 'none', scrollTrigger: { trigger: '#cpu', start: 'top 90%', end: 'top 55%', scrub: true } });
  gsap.from('#cpu b', { scaleX: 0, ease: 'none', scrollTrigger: { trigger: '#cpu', start: 'top 55%', end: 'top 40%', scrub: true } });
}

/* ---------- фраза загорается по словам ---------- */
(() => {
  const q = $('say');
  if (!G) return;
  const text = q.textContent.trim();
  q.setAttribute('aria-label', text);
  q.innerHTML = text.split(/\s+/).map(w => `<span class="mw" aria-hidden="true">${w}</span>`).join(' ');
  const ws = [...q.children];
  ScrollTrigger.create({
    trigger: q, start: 'top 82%', end: 'bottom 45%', scrub: true,
    onUpdate: s => { const n = Math.round(s.progress * ws.length); ws.forEach((w, i) => w.classList.toggle('lit', i < n)); },
  });
})();

/* ---------- 3D-капсула и выбор глазок ---------- */
(() => {
  if (!window.IsletCapsule) return;
  IsletCapsule.mount3D({ canvas: $('cap'), host: $('stage3d'), fallback: $('capFallback') });
  IsletCapsule.mount2D({ host: $('playCap'), buttons: [...document.querySelectorAll('#heroStyles button')] });
})();
