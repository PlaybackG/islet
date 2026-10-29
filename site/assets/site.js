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
  const tiles = [...document.querySelectorAll('.eye-tile[data-style]')];
  const name = $('eyeName'), say = n => {
    if (name) name.textContent = n;
    const i = IsletCapsule.STYLES.findIndex(s => s.name === n);
    tiles.forEach(t => t.setAttribute('aria-pressed', +t.dataset.style === i));
  };
  if ($('cap')) IsletCapsule.mount3D({ canvas: $('cap'), host: $('stage3d'), fallback: $('capFallback'), onStyle: say });
  const play = $('playCap'), btns = [...document.querySelectorAll('#styles button')];
  if (play) IsletCapsule.mount2D({ host: play, buttons: btns, onStyle: say });
  // галерея стилей: нажатие надевает стиль на большую капсулу
  if ($('eyeGrid')) {
    IsletCapsule.mountMinis({ host: $('eyeGrid'), tiles: tiles.map(t => ({ el: t.querySelector('.mini'), style: +t.dataset.style })) });
    tiles.forEach(t => t.addEventListener('click', () => {
      if (btns[+t.dataset.style]) btns[+t.dataset.style].click();
      if (play) play.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    }));
  }
  // карточка на главной: одна капсула сама перебирает стили
  if ($('eyeDemo')) IsletCapsule.mountMinis({ host: $('eyeDemo'), tiles: [{ el: $('eyeDemoPill'), style: 0 }], cycle: 2200, onCycle: n => { $('eyeDemoName').textContent = n; } });
})();

/* ---------- живой остров: сам меняет занятия, пока его видно; наведение замораживает ---------- */
(() => {
  const desk = $('desk'), isl = $('isl');
  if (!desk || !isl) return;
  const order = ['idle', 'music', 'dl', 'msg'];
  const tabs = [...$('islTabs').children], ring = $('islRing'), line = $('islLine');
  let cur = 0, timer, raf, seen = false, held = false;
  const dl = () => {
    cancelAnimationFrame(raf);
    const t0 = performance.now(), dur = reduce ? 1 : 2600;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), p = 18 + 80 * (1 - Math.pow(1 - k, 2));
      ring.style.setProperty('--p', p.toFixed(1));
      line.textContent = `${Math.floor(p)}% · ${Math.round(140 * p / 100)} МБ из 140 МБ`;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };
  const set = i => {
    cur = i; isl.dataset.state = order[i];
    tabs.forEach((b, k) => b.setAttribute('aria-pressed', k === i));
    if (order[i] === 'dl') dl(); else cancelAnimationFrame(raf);
  };
  const tick = () => {
    clearTimeout(timer);
    if (reduce || !seen || held || document.hidden) return;
    timer = setTimeout(() => { set((cur + 1) % order.length); tick(); }, 3200);
  };
  tabs.forEach((b, i) => b.addEventListener('click', () => { set(i); tick(); }));
  desk.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { held = true; tick(); } });
  desk.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { held = false; tick(); } });
  document.addEventListener('visibilitychange', tick);
  if (!('IntersectionObserver' in window)) { seen = true; desk.classList.add('on'); return tick(); }
  new IntersectionObserver(es => { seen = es[0].isIntersecting; desk.classList.toggle('on', seen); tick(); }, { threshold: .35 }).observe(desk);
})();

/* ---------- бегущая строка: вторая копия для бесшовного круга, едет только на экране ---------- */
(() => {
  const m = $('marq');
  if (!m) return;
  const t = m.firstElementChild;
  t.innerHTML += t.innerHTML;
  if (!('IntersectionObserver' in window)) return m.classList.add('on');
  new IntersectionObserver(es => m.classList.toggle('on', es[0].isIntersecting)).observe(m);
})();

/* ---------- фон: три медленных световых пятна ---------- */
(() => {
  const a = document.createElement('div');
  a.className = 'aurora'; a.setAttribute('aria-hidden', 'true'); a.innerHTML = '<i></i><i></i><i></i>';
  document.body.prepend(a);
  document.documentElement.classList.add('has-aurora');
})();

/* ---------- курсор: свет на карточках, магнитные кнопки, лёгкий наклон ---------- */
(() => {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  document.addEventListener('pointermove', e => {
    const el = e.target.closest && e.target.closest('.shell, .eye-tile');
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', e.clientX - r.left + 'px');
    el.style.setProperty('--my', e.clientY - r.top + 'px');
  }, { passive: true });
  if (reduce) return;
  document.querySelectorAll('.btn').forEach(b => {
    b.addEventListener('pointermove', e => {
      const r = b.getBoundingClientRect();
      b.style.translate = `${(e.clientX - r.left - r.width / 2) * .18}px ${(e.clientY - r.top - r.height / 2) * .3}px`;
    });
    b.addEventListener('pointerleave', () => { b.style.translate = ''; });
  });
  document.querySelectorAll('.desk-screen, .gal .shell').forEach(el => {
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--ry', ((e.clientX - r.left) / r.width - .5) * 6 + 'deg');
      el.style.setProperty('--rx', (.5 - (e.clientY - r.top) / r.height) * 5 + 'deg');
    });
    el.addEventListener('pointerleave', () => { el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); });
  });
})();

/* ---------- заголовки секций поднимаются по словам ---------- */
(() => {
  if (reduce || !('IntersectionObserver' in window)) return;
  const hs = [...document.querySelectorAll('.section-head h2, .final h2')].filter(h => h.getBoundingClientRect().top > innerHeight * .9);
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -10% 0px' });
  hs.forEach(h => {
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
        i.textContent = part; i.style.transitionDelay = n++ * 60 + 'ms';
        w.append(i); frag.append(w);
      });
      c.replaceWith(frag);
    });
    walk(h); h.classList.add('kin'); io.observe(h);
  });
})();
