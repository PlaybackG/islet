// Оверлей поверх замороженного кадра: выделение области, пипетка, поиск QR.
const api = window.islet;
const $ = (s) => document.querySelector(s);
const shot = $('#shot'), shade = $('#shade'), bar = $('#bar'), info = $('#info'), hint = $('#hint'), loupe = $('#loupe');
const sctx = shot.getContext('2d', { alpha: false });
const hctx = shade.getContext('2d');
const zctx = $('#zoom').getContext('2d');

let st = null; // { mode, w, h, rgba, k }
let sel = null; // { x, y, w, h } в пикселях снимка
let drag = null; // { kind: 'new'|'move', x0, y0, sel0 }
let cur = { x: 0, y: 0 };
let done = false;

const HINTS = {
  shot: 'Выдели область · клик — весь экран · Esc — отмена',
  ocr: 'Выдели область с текстом',
  qr: 'Выдели QR-код',
  color: 'Кликни, чтобы взять цвет · стрелки — точнее · Esc — отмена',
};

api.on('ov-start', (d) => {
  done = false; sel = null; drag = null;
  const { width: w, height: h } = d;
  const src = d.bitmap;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < rgba.length; i += 4) { // BGRA → RGBA
    rgba[i] = src[i + 2]; rgba[i + 1] = src[i + 1]; rgba[i + 2] = src[i]; rgba[i + 3] = 255;
  }
  shot.width = shade.width = w;
  shot.height = shade.height = h;
  sctx.putImageData(new ImageData(rgba, w, h), 0, 0);
  st = { mode: d.mode, w, h, rgba, k: w / innerWidth };
  hint.textContent = HINTS[d.mode] || '';
  hint.style.display = '';
  bar.style.display = 'none';
  info.style.display = 'none';
  loupe.style.display = d.mode === 'color' ? 'block' : 'none';
  document.body.style.cursor = 'crosshair';
  paint();
  if (d.mode === 'qr') setTimeout(() => { if (st && !done) { const t = decodeQR(0, 0, w, h); if (t) finish({ action: 'qr', text: t }); } }, 0);
});

api.on('ov-clear', () => {
  st = null; sel = null; drag = null;
  shot.width = shot.height = shade.width = shade.height = 1; // отдаём память
  bar.style.display = 'none';
  loupe.style.display = 'none';
});

function finish(res) {
  if (done) return;
  done = true;
  api.send('ov-result', res);
}

const toImg = (e) => ({ x: Math.round(e.clientX * st.k), y: Math.round(e.clientY * st.k) });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function paint() {
  if (!st) return;
  const { w, h, k } = st;
  hctx.clearRect(0, 0, w, h);
  if (st.mode === 'color') return;
  hctx.fillStyle = 'rgba(0,0,0,0.42)';
  hctx.fillRect(0, 0, w, h);
  if (!sel || sel.w < 1 || sel.h < 1) { info.style.display = 'none'; return; }
  hctx.clearRect(sel.x, sel.y, sel.w, sel.h);
  hctx.strokeStyle = '#fff';
  hctx.lineWidth = Math.max(1, Math.round(k));
  hctx.strokeRect(sel.x + 0.5, sel.y + 0.5, sel.w - 1, sel.h - 1);
  info.textContent = `${sel.w} × ${sel.h}`;
  info.style.display = 'block';
  const ix = sel.x / k, iy = sel.y / k;
  info.style.left = ix + 'px';
  info.style.top = (iy > 28 ? iy - 26 : iy + 6) + 'px';
}

function normSel(a, b) {
  const x = clamp(Math.min(a.x, b.x), 0, st.w), y = clamp(Math.min(a.y, b.y), 0, st.h);
  const x2 = clamp(Math.max(a.x, b.x), 0, st.w), y2 = clamp(Math.max(a.y, b.y), 0, st.h);
  return { x, y, w: x2 - x, h: y2 - y };
}

function showBar() {
  const k = st.k;
  bar.style.display = 'flex';
  const bw = bar.offsetWidth, bh = bar.offsetHeight;
  let left = (sel.x + sel.w) / k - bw;
  let top = (sel.y + sel.h) / k + 8;
  if (top + bh > innerHeight - 8) top = Math.max(8, sel.y / k - bh - 8);
  if (top < 8) top = (sel.y + sel.h) / k - bh - 8;
  left = clamp(left, 8, innerWidth - bw - 8);
  bar.style.left = left + 'px';
  bar.style.top = top + 'px';
}

// Цвет и лупа
function pixel(x, y) {
  const i = (clamp(y, 0, st.h - 1) * st.w + clamp(x, 0, st.w - 1)) * 4;
  return [st.rgba[i], st.rgba[i + 1], st.rgba[i + 2]];
}
const hexOf = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

function paintLoupe() {
  const img = zctx.createImageData(11, 11);
  for (let dy = 0; dy < 11; dy++) {
    for (let dx = 0; dx < 11; dx++) {
      const [r, g, b] = pixel(cur.x + dx - 5, cur.y + dy - 5);
      const i = (dy * 11 + dx) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  zctx.putImageData(img, 0, 0);
  const hex = hexOf(pixel(cur.x, cur.y));
  $('#hex').textContent = hex;
  $('#sw').style.background = hex;
  const cx = cur.x / st.k, cy = cur.y / st.k;
  const lw = 132, lh = loupe.offsetHeight || 162;
  loupe.style.left = (cx + 24 + lw > innerWidth ? cx - 24 - lw : cx + 24) + 'px';
  loupe.style.top = (cy + 24 + lh > innerHeight ? cy - 24 - lh : cy + 24) + 'px';
  // перекрестие в центре лупы
  zctx.strokeStyle = 'rgba(255,255,255,.9)';
  zctx.lineWidth = 0.12;
  zctx.strokeRect(5, 5, 1, 1);
}

// QR
function decodeQR(x, y, w, h) {
  if (typeof jsQR !== 'function' || w < 8 || h < 8) return null;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    const s = ((y + row) * st.w + x) * 4;
    data.set(st.rgba.subarray(s, s + w * 4), row * w * 4);
  }
  const r = jsQR(data, w, h, { inversionAttempts: 'attemptBoth' });
  return r && r.data ? r.data : null;
}

function act(action) {
  if (!st || done) return;
  if (action === 'cancel') return finish({ action: 'cancel' });
  if (!sel || sel.w < 2 || sel.h < 2) return;
  if (action === 'qr') {
    const t = decodeQR(sel.x, sel.y, sel.w, sel.h);
    if (t) return finish({ action: 'qr', text: t });
    hint.textContent = 'QR-код не найден — выдели его точнее';
    hint.style.display = '';
    return;
  }
  finish({ action, rect: { x: sel.x, y: sel.y, width: sel.w, height: sel.h } });
}

// Мышь
addEventListener('mousedown', (e) => {
  if (!st || done || e.button !== 0 || e.target.closest('.bar')) return;
  const p = toImg(e);
  if (st.mode === 'color') { cur = p; return finish({ action: 'color', hex: hexOf(pixel(p.x, p.y)) }); }
  hint.style.display = 'none';
  bar.style.display = 'none';
  if (sel && p.x > sel.x && p.x < sel.x + sel.w && p.y > sel.y && p.y < sel.y + sel.h) drag = { kind: 'move', x0: p.x, y0: p.y, sel0: { ...sel } };
  else { drag = { kind: 'new', x0: p.x, y0: p.y }; sel = { x: p.x, y: p.y, w: 0, h: 0 }; }
});

addEventListener('mousemove', (e) => {
  if (!st || done) return;
  const p = toImg(e);
  cur = p;
  if (st.mode === 'color') { paintLoupe(); return; }
  if (!drag) {
    const inside = sel && p.x > sel.x && p.x < sel.x + sel.w && p.y > sel.y && p.y < sel.y + sel.h;
    document.body.style.cursor = inside ? 'move' : 'crosshair';
    return;
  }
  if (drag.kind === 'new') sel = normSel({ x: drag.x0, y: drag.y0 }, p);
  else {
    const s = drag.sel0;
    sel = { ...s, x: clamp(s.x + p.x - drag.x0, 0, st.w - s.w), y: clamp(s.y + p.y - drag.y0, 0, st.h - s.h) };
  }
  paint();
});

addEventListener('mouseup', (e) => {
  if (!st || done || !drag || e.button !== 0) return;
  const kind = drag.kind;
  drag = null;
  if (kind === 'new' && (!sel || sel.w < 4 || sel.h < 4)) {
    if (st.mode !== 'shot') { sel = null; paint(); hint.style.display = ''; return; }
    sel = { x: 0, y: 0, w: st.w, h: st.h }; // клик без выделения — весь экран
  }
  paint();
  if (st.mode === 'ocr') return act('ocr');
  if (st.mode === 'qr') return act('qr');
  showBar();
});

bar.addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (b) act(b.dataset.a); });
addEventListener('contextmenu', (e) => { e.preventDefault(); if (!done) finish({ action: 'cancel' }); });

addEventListener('keydown', (e) => {
  if (!st || done) return;
  if (e.key === 'Escape') { e.preventDefault(); return act('cancel'); }
  if (st.mode === 'color') {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (d) { e.preventDefault(); const m = e.shiftKey ? 10 : 1; cur = { x: clamp(cur.x + d[0] * m, 0, st.w - 1), y: clamp(cur.y + d[1] * m, 0, st.h - 1) }; paintLoupe(); }
    if (e.key === 'Enter' || e.key === ' ') finish({ action: 'color', hex: hexOf(pixel(cur.x, cur.y)) });
    return;
  }
  if (e.key === 'Enter') { e.preventDefault(); act(e.ctrlKey || e.shiftKey ? 'save' : 'copy'); }
  else if (e.ctrlKey && e.code === 'KeyS') { e.preventDefault(); act('save'); }
  else if (e.ctrlKey && e.code === 'KeyC') { e.preventDefault(); act('copy'); }
  else if (!e.ctrlKey && e.code === 'KeyT') act('ocr');
  else if (e.ctrlKey && e.code === 'KeyA') { e.preventDefault(); sel = { x: 0, y: 0, w: st.w, h: st.h }; paint(); showBar(); }
});

addEventListener('resize', () => { if (st) { st.k = st.w / innerWidth; paint(); } });
