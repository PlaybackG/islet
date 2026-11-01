/* Лицо капсулы (время, глазки, погода) в координатах 1024x288.
   Одно и то же лицо рисуется на 3D-капсуле главной, на большой 2D-капсуле страницы глазок
   и (только глазки) на маленьких капсулах галереи. */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const STYLES = [
    { id: 'normal', name: 'обычные' }, { id: 'anger', name: 'злые' }, { id: 'sad', name: 'грустные' },
    { id: 'cat', name: 'кот' }, { id: 't800', name: 'T-800' }, { id: 'hearts', name: 'сердечки' }, { id: 'scanner', name: 'сканер' },
  ];
  const FW = 1024, FH = 288;

  function face(g, eyesOnly) {
    const look = { x: 0, y: 0, tx: 0, ty: 0 };
    let style = 0, blink = 1, nextBlink = performance.now() + 1200 + Math.random() * 3000, scan = Math.random() * 6;

    const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); g.fill(); };
    const heart = (cx, cy, s) => {
      g.beginPath(); g.moveTo(cx, cy + s * .9);
      g.bezierCurveTo(cx - s * 1.6, cy - s * .1, cx - s * .8, cy - s * 1.3, cx, cy - s * .45);
      g.bezierCurveTo(cx + s * .8, cy - s * 1.3, cx + s * 1.6, cy - s * .1, cx, cy + s * .9); g.fill();
    };

    const step = now => {
      look.x += (look.tx - look.x) * .08; look.y += (look.ty - look.y) * .08;
      if (now > nextBlink) { const k = (now - nextBlink) / 160; blink = k < 1 ? 1 - k * .9 : k < 2 ? .1 + (k - 1) * .9 : 1; if (k >= 2) nextBlink = now + 2600 + Math.random() * 2600; }
      scan += .045;
    };

    const draw = () => {
      g.clearRect(0, 0, FW, FH);
      const mid = FH / 2;
      g.font = '600 64px "Golos Text", "Segoe UI", sans-serif'; g.textBaseline = 'middle';
      if (!eyesOnly) {
        // слева значок полки, справа счётчик — как капсула в покое
        const tx = 96, ty = mid - 30, tw = 66, th = 60;
        g.strokeStyle = '#f2f3f7'; g.lineWidth = 6.5; g.lineJoin = g.lineCap = 'round'; g.shadowBlur = 0;
        g.beginPath(); if (g.roundRect) g.roundRect(tx, ty, tw, th, 16); else g.rect(tx, ty, tw, th); g.stroke();
        g.beginPath(); g.moveTo(tx, mid + 4); g.lineTo(tx + 17, mid + 4); g.lineTo(tx + 23, mid + 15); g.lineTo(tx + 43, mid + 15); g.lineTo(tx + 49, mid + 4); g.lineTo(tx + tw, mid + 4); g.stroke();
        g.fillStyle = '#f2f3f7'; g.textAlign = 'right'; g.fillText('4', 928, mid + 2); g.textAlign = 'left';
      }
      // глазки
      const ox = look.x * 22, oy = look.y * 14, gap = 104, cx = 512, ew = 46, eh = 68 * blink;
      const st = STYLES[style].id;
      g.save();
      if (st === 'normal' || st === 'anger' || st === 'sad') {
        g.fillStyle = '#fff'; g.shadowColor = 'rgba(120,190,255,.85)'; g.shadowBlur = 26;
        [-1, 1].forEach(s => {
          const x = cx + s * gap / 2 - ew / 2 + ox, y = mid - eh / 2 + oy;
          g.beginPath(); g.ellipse(x + ew / 2, mid + oy, ew / 2, Math.max(2, eh / 2), 0, 0, Math.PI * 2); g.fill();
          if (st !== 'normal' && blink > .5) {   // срезаем косое веко
            g.save(); g.globalCompositeOperation = 'destination-out'; g.shadowBlur = 0; g.beginPath();
            const inner = st === 'anger' ? s < 0 : s > 0;
            const yA = y - 2, drop = 30;
            g.moveTo(x - 4, yA - 40); g.lineTo(x + ew + 4, yA - 40);
            g.lineTo(x + ew + 4, yA + (inner ? (s < 0 ? drop : 0) : (s < 0 ? 0 : drop)));
            g.lineTo(x - 4, yA + (inner ? (s < 0 ? 0 : drop) : (s < 0 ? drop : 0)));
            g.fill(); g.restore();
          }
        });
      } else if (st === 'cat') {
        g.fillStyle = '#ffc531'; g.shadowColor = 'rgba(255,197,49,.8)'; g.shadowBlur = 20;
        [-1, 1].forEach(s => {
          const x = cx + s * gap / 2 + ox, y = mid + oy;
          g.beginPath(); g.ellipse(x, y, 30, Math.max(3, 30 * blink), 0, 0, Math.PI * 2); g.fill();
          g.save(); g.shadowBlur = 0; g.fillStyle = '#000'; g.beginPath(); g.ellipse(x + look.x * 6, y, 5, Math.max(2, 26 * blink), 0, 0, Math.PI * 2); g.fill(); g.restore();
        });
      } else if (st === 't800') {
        g.fillStyle = '#ff2a2a'; g.shadowColor = 'rgba(255,40,40,.95)'; g.shadowBlur = 34;
        g.beginPath(); g.arc(cx + ox * 1.4, mid + oy, 26 * Math.max(.15, blink), 0, Math.PI * 2); g.fill();
        g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(cx + ox * 1.4 + 8, mid + oy - 8, 6 * blink, 0, Math.PI * 2); g.fill();
      } else if (st === 'hearts') {
        g.fillStyle = '#ff5f8f'; g.shadowColor = 'rgba(255,95,143,.85)'; g.shadowBlur = 22;
        [-1, 1].forEach(s => heart(cx + s * gap / 2 + ox, mid + oy, 26 * (.6 + .4 * blink)));
      } else if (st === 'scanner') {
        g.fillStyle = 'rgba(255,40,40,.18)'; rr(cx - 110, mid - 18, 220, 36, 18);
        g.fillStyle = '#ff3030'; g.shadowColor = 'rgba(255,48,48,.95)'; g.shadowBlur = 28;
        rr(cx - 26 + Math.sin(scan) * 70, mid - 9, 52, 18, 9);
      }
      g.restore();
    };

    return {
      look, step, draw,
      get style() { return style; },
      set style(i) { style = (i + STYLES.length) % STYLES.length; },
      get name() { return STYLES[style].name; },
    };
  }

  // Цикл живёт, только пока элемент на экране и вкладка видна.
  function visibleLoop(host, frame) {
    let visible = true, running = false;
    const loop = () => {
      if (running) return; running = true;
      const tick = now => {
        if (!visible || document.hidden) { running = false; return; }
        frame(now); requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    if ('IntersectionObserver' in window) new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) loop(); }).observe(host);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loop(); });
    return loop;
  }

  const aim = (f, host, e, ky) => {
    const r = host.getBoundingClientRect();
    f.look.tx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width * .6)));
    f.look.ty = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height * ky)) / (r.height * .7)));
  };

  /* ---------- 3D-капсула (главная) ---------- */
  function mount3D({ canvas, host, fallback, onStyle }) {
    if (!window.THREE) return;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); }
    catch (e) { return; }
    if (fallback) fallback.hidden = true;
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, .1, 100);
    camera.position.set(0, 0, 9.2);

    // студия для отражений: тёмная комната и четыре софтбокса
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.MeshBasicMaterial({ color: 0x050608, side: THREE.BackSide })));
    const box = (c, w, h, x, y, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m); };
    box(0xffffff, 14, 2.2, 0, 9, 6);
    box(0x8c86ff, 6, 10, -11, 1, 3);
    box(0xffb43f, 4, 8, 11, -2, 4);
    box(0x9aa6ff, 18, 1.2, 0, -8, 5);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(env, .02).texture;

    // корпус: силуэт выреза из приложения. Плоский верх, вогнутые ушки по бокам, круглый низ
    const W = 3.1, H = 1.04, R = H / 2, PI = Math.PI;
    const sh = new THREE.Shape();
    sh.moveTo(-W / 2 - R, H / 2); sh.lineTo(W / 2 + R, H / 2);
    sh.absarc(W / 2 + R, 0, R, PI / 2, PI, false);
    sh.absarc(W / 2 - R, 0, R, 0, -PI / 2, true);
    sh.lineTo(-W / 2 + R, -H / 2);
    sh.absarc(-W / 2 + R, 0, R, -PI / 2, -PI, true);
    sh.absarc(-W / 2 - R, 0, R, 0, PI / 2, false);
    const depth = .34, bev = .1;
    const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bev, bevelSize: .05, bevelSegments: 8, curveSegments: 48 });
    geo.center();
    const body = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: 0x030304, metalness: .35, roughness: .28, clearcoat: 1, clearcoatRoughness: .12, envMapIntensity: 1.3 }));
    const group = new THREE.Group();
    group.add(body);

    const fc = document.createElement('canvas'); fc.width = FW; fc.height = FH;
    const f = face(fc.getContext('2d'));
    const tex = new THREE.CanvasTexture(fc); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 4;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(W - .2, (W - .2) * FH / FW), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
    plate.position.z = depth / 2 + bev + .002;
    group.add(plate);
    scene.add(group);

    const size = () => {
      const r = host.getBoundingClientRect();
      renderer.setSize(r.width, r.height, false);
      camera.aspect = r.width / r.height;
      camera.position.z = camera.aspect < 1.2 ? 9.2 * 1.2 / camera.aspect * .82 : 9.2;
      camera.updateProjectionMatrix();
    };
    size(); addEventListener('resize', size);

    addEventListener('pointermove', e => aim(f, host, e, .45), { passive: true });
    canvas.addEventListener('click', () => {
      f.style = f.style + 1; if (onStyle) onStyle(f.name);
      if (window.gsap && !reduce) gsap.fromTo(group.scale, { x: .94, y: 1.06 }, { x: 1, y: 1, duration: .9, ease: 'elastic.out(1, .4)' });
    });

    const rot = { x: 0, y: 0 };
    const frame = now => {
      f.step(now);
      const bob = reduce ? 0 : Math.sin(now / 1400) * .06;
      rot.y += (f.look.x * .42 - rot.y) * .06; rot.x += (f.look.y * .26 - rot.x) * .06;
      group.rotation.set(rot.x + .08, rot.y - .18, -.03 + f.look.x * .02);
      group.position.y = .25 + bob;
      f.draw(); tex.needsUpdate = true;
      renderer.render(scene, camera);
    };
    const loop = visibleLoop(host, frame);
    if (document.fonts) document.fonts.ready.then(() => frame(performance.now()));
    loop();
    if (window.gsap && !reduce) gsap.from(group.rotation, { y: -1.4, x: .6, duration: 1.8, ease: 'expo.out' });
  }

  /* ---------- плоская капсула (страница глазок) ---------- */
  function mount2D({ host, buttons, onStyle }) {
    const c = document.createElement('canvas');
    const k = Math.min(2, Math.max(1, devicePixelRatio || 1));
    c.width = FW * k; c.height = FH * k;
    c.setAttribute('aria-hidden', 'true');
    host.appendChild(c);
    const g = c.getContext('2d'); g.scale(k, k);
    const f = face(g);
    const sync = () => {
      buttons.forEach((b, i) => b.setAttribute('aria-pressed', i === f.style));
      if (onStyle) onStyle(f.name);
    };
    buttons.forEach((b, i) => b.addEventListener('click', () => { f.style = i; sync(); }));
    host.addEventListener('click', () => {
      f.style = f.style + 1; sync();
      if (window.gsap && !reduce) gsap.fromTo(host, { scaleX: .97, scaleY: 1.04 }, { scaleX: 1, scaleY: 1, duration: .9, ease: 'elastic.out(1, .4)' });
    });
    addEventListener('pointermove', e => aim(f, host, e, .5), { passive: true });
    sync();
    const loop = visibleLoop(host, now => { f.step(now); f.draw(); });
    if (document.fonts) document.fonts.ready.then(() => f.draw());
    loop();
  }

  /* ---------- маленькие капсулы: одни глазки, один общий цикл на всю группу ---------- */
  const MW = 360, MH = 150;
  function mountMinis({ host, tiles, cycle, onCycle }) {
    const k = Math.min(2, Math.max(1, devicePixelRatio || 1));
    const items = tiles.map(({ el, style }) => {
      const c = document.createElement('canvas');
      c.width = MW * k; c.height = MH * k;
      c.setAttribute('aria-hidden', 'true');
      el.appendChild(c);
      const g = c.getContext('2d'); g.scale(k, k); g.translate(MW / 2 - FW / 2, MH / 2 - FH / 2);
      const f = face(g, true); f.style = style || 0;
      return { el, f };
    });
    addEventListener('pointermove', e => items.forEach(it => aim(it.f, it.el, e, .5)), { passive: true });
    let last = performance.now();
    const loop = visibleLoop(host, now => {
      if (cycle && !reduce && now - last > cycle) {
        last = now;
        items.forEach(it => { it.f.style = it.f.style + 1; });
        if (onCycle) onCycle(items[0].f.name);
      }
      items.forEach(it => { it.f.step(now); it.f.draw(); });
    });
    items.forEach(it => it.f.draw());
    loop();
  }

  window.IsletCapsule = { STYLES, mount3D, mount2D, mountMinis };
})();
