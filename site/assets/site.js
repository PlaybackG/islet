/* Общий скрипт всех страниц. Каждый блок срабатывает, только если его разметка есть на странице. */
// Ссылки в одном месте: файл установщика лежит рядом со страницами.
const LINKS = { download: './IsletSetup.exe', github: 'https://github.com/PlaybackG/islet' };
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = id => document.getElementById(id);
document.documentElement.classList.add('js');

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
  nav.addEventListener('focusin', () => set(true));
  nav.addEventListener('focusout', e => { if (!nav.contains(e.relatedTarget)) set(false); });
})();

/* ---------- появление при прокрутке (один раз, из видимого состояния) ---------- */
(() => {
  if (reduce || !('IntersectionObserver' in window)) return;
  const els = [...document.querySelectorAll('.lift')].filter(el => el.getBoundingClientRect().top > innerHeight * .9);
  els.forEach(el => el.classList.add('pre'));
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.remove('pre'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -8% 0px' });
  els.forEach(el => io.observe(el));
  if (window.gsap && document.querySelector('.hero .w')) gsap.from('.hero .w', { yPercent: 60, opacity: 0, duration: 1.1, ease: 'expo.out', stagger: .07, delay: .1 });
  if (window.gsap && document.querySelector('.phead h1')) gsap.from('.phead h1', { y: 40, opacity: 0, duration: 1.1, ease: 'expo.out', delay: .05 });
})();

/* ---------- тур по экранам ---------- */
(() => {
  const list = $('tourList'), screen = $('screen');
  if (!list || !screen) return;
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
  const cnt = $('cnt'), prog = $('prog'), cap = $('tourCap');
  $('cntAll').textContent = String(S.length).padStart(2, '0');
  const frames = S.map(([f, t, d], i) => {
    const li = document.createElement('li');
    li.innerHTML = `<button type="button"><span class="n">${String(i + 1).padStart(2, '0')}</span><span class="t">${t}</span><span class="d">${d}</span></button>`;
    list.appendChild(li);
    const img = new Image();
    img.className = 'frame' + (f === 'pill' ? ' pill' : '');
    img.src = `assets/${f}.png`; img.alt = `Islet: ${t}`; img.decoding = 'async';
    if (i > 1) img.loading = 'lazy';
    screen.appendChild(img);
    return { img, btn: li.firstChild };
  });
  let cur = -1, st = null;
  const show = i => {
    if (i === cur) return; cur = i;
    frames.forEach((f, k) => { f.img.classList.toggle('on', k === i); f.btn.setAttribute('aria-current', k === i); });
    cnt.textContent = String(i + 1).padStart(2, '0');
    prog.style.transform = `scaleX(${(i + 1) / S.length})`;
    cap.textContent = S[i][2];
    const b = frames[i].btn; if (list.scrollWidth > list.clientWidth) list.scrollTo({ left: b.parentNode.offsetLeft - 16, behavior: reduce ? 'auto' : 'smooth' });
  };
  show(0);
  frames.forEach((f, i) => f.btn.addEventListener('click', () => {
    if (st) { const y = st.start + (st.end - st.start) * ((i + .5) / S.length); window.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' }); }
    else show(i);
  }));
  if (reduce || !window.gsap || !window.ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);
  st = ScrollTrigger.create({
    trigger: '#tourPin', pin: true, start: () => innerWidth < 900 ? 'top 72px' : 'center center',
    end: () => '+=' + innerHeight * 3.2, invalidateOnRefresh: true, anticipatePin: 1,
    onUpdate: s => show(Math.min(S.length - 1, Math.floor(s.progress * S.length))),
  });
})();

/* ---------- демо загрузки ---------- */
(() => {
  const ring = $('ring'), wrap = $('dlRing'), line = $('dlLine'), ico = $('dlIco');
  if (!ring) return;
  const TOTAL = 140;
  const arrow = '<path d="M12 4v12m0 0-5-5m5 5 5-5M5 20h14"/>', check = '<path d="m5 12.5 4.5 4.5L19 7.5"/>';
  let raf;
  const run = () => {
    cancelAnimationFrame(raf); wrap.classList.remove('done'); ico.innerHTML = arrow;
    const t0 = performance.now(), dur = reduce ? 1 : 5200;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur);
      const p = (1 - Math.pow(1 - k, 2.2)) * 100;   // к концу замедляется, как настоящая загрузка
      const mb = TOTAL * p / 100, speed = k < 1 ? (8 + 6 * Math.sin(k * 9)).toFixed(1).replace('.', ',') : 0;
      ring.style.setProperty('--p', p.toFixed(1));
      line.textContent = k < 1 ? `${Math.floor(p)}% · ${Math.round(mb)} МБ из ${TOTAL} МБ · ${speed} МБ/с` : `Готово · ${TOTAL} МБ`;
      if (k < 1) raf = requestAnimationFrame(step); else { wrap.classList.add('done'); ico.innerHTML = check; }
    };
    raf = requestAnimationFrame(step);
  };
  $('dlReplay').addEventListener('click', run);
  if (!('IntersectionObserver' in window)) return run();
  const io = new IntersectionObserver(es => { if (es[0].isIntersecting) { run(); io.disconnect(); } }, { threshold: .5 });
  io.observe($('dlDemo'));
})();

/* ---------- капсулы ---------- */
(() => {
  if (!window.IsletCapsule) return;
  const name = $('eyeName'), say = n => { if (name) name.textContent = n; };
  if ($('cap')) IsletCapsule.mount3D({ canvas: $('cap'), host: $('stage3d'), fallback: $('capFallback'), onStyle: say });
  const play = $('playCap');
  if (play) IsletCapsule.mount2D({ host: play, buttons: [...document.querySelectorAll('#styles button')], onStyle: say });
})();
