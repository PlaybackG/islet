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

/* ---------- фон: свет, сетка точек и контуры выреза, которые расходятся от острова ---------- */
(() => {
  const a = document.createElement('div');
  a.className = 'aurora'; a.setAttribute('aria-hidden', 'true');
  a.innerHTML = '<div class="glow"><i></i><i></i><i></i></div><div class="dots"></div><div class="rings"><i></i><i></i><i></i><i></i></div>';
  document.body.prepend(a);
  const vis = () => root.classList.toggle('hidden-tab', document.hidden);
  document.addEventListener('visibilitychange', vis); vis();
  if (!G) return;
  gsap.to(a.querySelector('.glow'), { yPercent: -12, ease: 'none', scrollTrigger: { trigger: document.body, start: 'top top', end: 'bottom bottom', scrub: 1 } });
  gsap.to(a.querySelector('.rings'), { opacity: .22, ease: 'none', scrollTrigger: { trigger: document.body, start: 'top top', end: '+=1200', scrub: 1 } });
})();

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
  const top = [...document.querySelectorAll('.hero h1, .phead h1')];
  top.forEach(h => { splitWords(h); h.style.setProperty('--d0', '120ms'); });
  if (!('IntersectionObserver' in window)) return;
  const hs = [...document.querySelectorAll('.section-head h2, .final h2, .split-txt h2, .zoom-head h2')];
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -12% 0px' });
  hs.forEach(h => { splitWords(h); io.observe(h); });
})();

/* ---------- первый экран: всё проявляется по очереди после загрузки ---------- */
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

/* ---------- появление при прокрутке (один раз, из видимого состояния) ---------- */
(() => {
  document.querySelectorAll('[data-stagger]').forEach(g => {
    const step = +g.dataset.stagger || 80;
    [...g.children].forEach((c, i) => { c.classList.add('rv'); c.style.setProperty('--d', i * step + 'ms'); });
  });
  if (reduce || !('IntersectionObserver' in window)) return;
  const els = [...document.querySelectorAll('.rv, .lift')].filter(el => el.getBoundingClientRect().top > innerHeight * .92);
  els.forEach(el => el.classList.add('rv', 'pre'));
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.remove('pre'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -8% 0px' });
  els.forEach(el => io.observe(el));
})();

/* ---------- сцены, привязанные к прокрутке ---------- */
(() => {
  if (!G) { document.querySelectorAll('.mani').forEach(m => m.classList.add('no-scrub')); return; }
  // экран с островом выпрямляется, пока подъезжает к центру
  const ds = document.querySelector('.stage .desk-screen');
  if (ds) gsap.fromTo(ds, { rotateX: 24, scale: .9, transformPerspective: 1600 }, {
    rotateX: 0, scale: 1, ease: 'none',
    scrollTrigger: { trigger: '.stage', start: 'top 92%', end: 'top 22%', scrub: .6 },
  });
  // скриншот вырастает из маленькой карточки
  document.querySelectorAll('.zoom-frame').forEach(f => gsap.fromTo(f, { scale: .72, rotateX: 16, y: 40, transformPerspective: 1400 }, {
    scale: 1, rotateX: 0, y: 0, ease: 'none',
    scrollTrigger: { trigger: f.parentNode, start: 'top 95%', end: 'center 55%', scrub: .6 },
  }));
  // манифест загорается слово за словом
  document.querySelectorAll('.mani-q').forEach(q => {
    const text = q.textContent.trim();
    q.setAttribute('aria-label', text);
    q.innerHTML = text.split(/\s+/).map(w => `<span class="mw" aria-hidden="true">${w}</span>`).join(' ');
    const ws = [...q.children];
    ScrollTrigger.create({
      trigger: q, start: 'top 82%', end: 'bottom 45%', scrub: true,
      onUpdate: s => { const n = Math.round(s.progress * ws.length); ws.forEach((w, i) => w.classList.toggle('lit', i < n)); },
    });
  });
  // большое слово в подвале выезжает снизу
  document.querySelectorAll('.foot-big').forEach(b => gsap.fromTo(b, { yPercent: 40, opacity: .2 }, {
    yPercent: 0, opacity: 1, ease: 'none', scrollTrigger: { trigger: b, start: 'top bottom', end: 'bottom bottom', scrub: .6 },
  }));
  // свечение за финалом дышит в такт прокрутке
  document.querySelectorAll('.final .orb').forEach(o => gsap.fromTo(o, { scale: .6 }, {
    scale: 1.1, ease: 'none', scrollTrigger: { trigger: o.parentNode, start: 'top bottom', end: 'center center', scrub: 1 },
  }));
})();

/* ---------- цифры считают до своего значения ---------- */
(() => {
  const els = [...document.querySelectorAll('[data-count]')];
  if (!els.length || reduce || !('IntersectionObserver' in window)) return;
  const run = el => {
    const to = +el.dataset.count, from = +(el.dataset.from || 0), t0 = performance.now(), dur = 1400;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 4);
      el.textContent = Math.round(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    el.textContent = from; requestAnimationFrame(step);
  };
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { run(e.target); io.unobserve(e.target); }
  }), { threshold: .6 });
  els.forEach(el => io.observe(el));
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
  if (!G) return;
  st = ScrollTrigger.create({
    trigger: '#tourPin', pin: true, start: () => innerWidth < 960 ? 'top 64px' : 'center center',
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
  const scr = desk.querySelector('.desk-screen') || desk;
  scr.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { held = true; tick(); } });
  scr.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { held = false; tick(); } });
  document.addEventListener('visibilitychange', tick);
  if (!('IntersectionObserver' in window)) { seen = true; desk.classList.add('on'); return tick(); }
  new IntersectionObserver(es => { seen = es[0].isIntersecting; desk.classList.toggle('on', seen); tick(); }, { threshold: .35 }).observe(desk);
})();

/* ---------- бегущие строки: вторая копия для бесшовного круга, едут только на экране ---------- */
(() => {
  const m = $('marq');
  if (!m) return;
  m.querySelectorAll('.marq-track').forEach(t => {
    const copy = t.innerHTML;
    t.insertAdjacentHTML('beforeend', copy);
    [...t.children].slice(t.children.length / 2).forEach(c => c.setAttribute('aria-hidden', 'true'));
  });
  if (!('IntersectionObserver' in window)) return m.classList.add('on');
  new IntersectionObserver(es => m.classList.toggle('on', es[0].isIntersecting)).observe(m);
})();

/* ---------- вопросы: ответ плавно раскрывается по высоте ---------- */
(() => {
  document.querySelectorAll('.faq details').forEach(d => {
    const s = d.querySelector('summary'), a = d.querySelector('.faq-a');
    if (!s || !a || reduce || !a.animate) return;
    let anim;
    s.addEventListener('click', e => {
      e.preventDefault();
      if (anim) anim.cancel();
      const opening = !d.open || d.classList.contains('closing');
      if (opening) {
        d.classList.remove('closing'); d.open = true;
        const h = a.scrollHeight;
        anim = a.animate([{ height: '0px', opacity: 0 }, { height: h + 'px', opacity: 1 }], { duration: 520, easing: 'cubic-bezier(.32,.72,0,1)' });
        anim.onfinish = () => { anim = null; };
      } else {
        d.classList.add('closing');
        anim = a.animate([{ height: a.offsetHeight + 'px', opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 380, easing: 'cubic-bezier(.32,.72,0,1)' });
        anim.onfinish = () => { d.open = false; d.classList.remove('closing'); anim = null; };
      }
    });
  });
})();

/* ---------- курсор: свет на карточках, магнитные кнопки, лёгкий наклон ---------- */
(() => {
  if (!fine) return;
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
  document.querySelectorAll('.gal .shell').forEach(el => {
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--ry', ((e.clientX - r.left) / r.width - .5) * 8 + 'deg');
      el.style.setProperty('--rx', (.5 - (e.clientY - r.top) / r.height) * 6 + 'deg');
    });
    el.addEventListener('pointerleave', () => { el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); });
  });
})();
