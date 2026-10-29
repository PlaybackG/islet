// Значок трея без файлов: чёрная капсула с двумя глазками, PNG собирается в памяти.
const zlib = require('zlib');

function png(w, h, rgba) {
  const crc = (buf) => zlib.crc32(buf) >>> 0;
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Покрытие пикселя фигурой (4x4 подвыборки) для сглаживания краёв.
function cover(x, y, inside) {
  let n = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (inside(x + (i + 0.5) / 4, y + (j + 0.5) / 4)) n++;
  return n / 16;
}

function trayIcon(size = 32) {
  const s = size / 32;
  const buf = Buffer.alloc(size * size * 4);
  const pill = (x, y) => {
    const r = 9 * s, cx1 = 11 * s, cx2 = 21 * s, cy = 16 * s;
    const px = Math.max(cx1, Math.min(cx2, x));
    return (x - px) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const eye = (cx) => (x, y) => ((x - cx * s) / (2.2 * s)) ** 2 + ((y - 16 * s) / (3.4 * s)) ** 2 <= 1;
  const e1 = eye(12.5), e2 = eye(19.5);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = cover(x, y, pill);
      const w = Math.max(cover(x, y, e1), cover(x, y, e2));
      const i = (y * size + x) * 4;
      const v = Math.round(255 * w);
      buf[i] = v; buf[i + 1] = v; buf[i + 2] = v; buf[i + 3] = Math.round(255 * a);
    }
  }
  return png(size, size, buf);
}

module.exports = { trayIcon };
