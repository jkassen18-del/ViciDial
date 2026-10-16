// Dependency-free PNG icon renderer. Each extension's glyph is described with
// signed-distance shapes in a 0..1 unit square and rendered anti-aliased on
// a rounded tile in the brand's primary colour, so a new brand kit re-colours
// every toolbar icon at build time.

import zlib from 'node:zlib';

// ---------- PNG encoding ----------
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(buf, crc = 0xffffffff) {
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- signed distance functions (negative = inside) ----------
const len = (x, y) => Math.hypot(x, y);
export const sd = {
  circle: (cx, cy, r) => (x, y) => len(x - cx, y - cy) - r,
  ring: (cx, cy, r, w) => (x, y) => Math.abs(len(x - cx, y - cy) - r) - w / 2,
  roundRect: (cx, cy, hw, hh, r) => (x, y) => {
    const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
    return len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  },
  segment: (ax, ay, bx, by, w) => (x, y) => {
    const pax = x - ax, pay = y - ay, bax = bx - ax, bay = by - ay;
    const t = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
    return len(pax - bax * t, pay - bay * t) - w / 2;
  },
  polygon: (pts) => (x, y) => {
    let d = Infinity, inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      const ex = xj - xi, ey = yj - yi, wx = x - xi, wy = y - yi;
      const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
      d = Math.min(d, len(wx - ex * t, wy - ey * t));
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside ? -d : d;
  },
  stroke: (f, w) => (x, y) => Math.abs(f(x, y)) - w / 2,
  rotate: (f, cx, cy, deg) => {
    const a = (-deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    return (x, y) => f(cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c);
  },
  union: (...fs) => (x, y) => Math.min(...fs.map((f) => f(x, y))),
  subtract: (a, b) => (x, y) => Math.max(a(x, y), -b(x, y)),
};

// ---------- glyphs: arrays of [sdf, colour] layered in order ----------
const WHITE = '#FFFFFF';
export const GLYPHS = {
  'ticket-snap': (c) => [
    [sd.subtract(
      sd.union(sd.roundRect(0.5, 0.56, 0.27, 0.19, 0.06), sd.roundRect(0.5, 0.36, 0.1, 0.06, 0.03)),
      sd.circle(0.5, 0.56, 0.115)), WHITE],
    [sd.circle(0.5, 0.56, 0.06), WHITE],
    [sd.circle(0.69, 0.45, 0.022), c.primary],
  ],
  'dlp-guard': (c) => [
    [sd.polygon([[0.5, 0.2], [0.75, 0.29], [0.75, 0.5], [0.72, 0.62], [0.64, 0.72], [0.5, 0.81], [0.36, 0.72], [0.28, 0.62], [0.25, 0.5], [0.25, 0.29]]), WHITE],
    [sd.subtract(sd.stroke(sd.roundRect(0.5, 0.46, 0.065, 0.085, 0.065), 0.04), sd.roundRect(0.5, 0.62, 0.2, 0.1, 0)), c.primary],
    [sd.roundRect(0.5, 0.58, 0.11, 0.085, 0.025), c.primary],
    [sd.circle(0.5, 0.575, 0.022), WHITE],
  ],
  'saas-reporter': () => [
    [sd.roundRect(0.33, 0.6, 0.055, 0.13, 0.03), WHITE],
    [sd.roundRect(0.5, 0.52, 0.055, 0.21, 0.03), WHITE],
    [sd.roundRect(0.67, 0.44, 0.055, 0.29, 0.03), WHITE],
    [sd.segment(0.24, 0.79, 0.76, 0.79, 0.04), WHITE],
  ],
  'env-labeler': () => [
    [sd.roundRect(0.5, 0.5, 0.15, 0.31, 0.13), WHITE],
    [sd.circle(0.5, 0.31, 0.072), '#EF4444'],
    [sd.circle(0.5, 0.5, 0.072), '#F59E0B'],
    [sd.circle(0.5, 0.69, 0.072), '#22C55E'],
  ],
  'go-links': () => [
    [sd.rotate(sd.stroke(sd.roundRect(0.4, 0.5, 0.17, 0.085, 0.085), 0.06), 0.5, 0.5, -45), WHITE],
    [sd.rotate(sd.stroke(sd.roundRect(0.6, 0.5, 0.17, 0.085, 0.085), 0.06), 0.5, 0.5, -45), WHITE],
  ],
};

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }

/** Renders an icon PNG of `size` px for glyph `name` in the given brand colours. */
export function renderIcon(name, size, { primary = '#4F46E5', accent = '#0EA5E9' } = {}) {
  const glyph = GLYPHS[name] || GLYPHS['go-links'];
  const layers = glyph({ primary, accent });
  const P = hexToRgb(primary), A = hexToRgb(accent);
  const tile = sd.roundRect(0.5, 0.5, 0.47, 0.47, size <= 16 ? 0.16 : 0.22);
  const px = 1 / size;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size, v = (y + 0.5) / size;
      const cov = (d) => Math.max(0, Math.min(1, 0.5 - d / px));
      let a = cov(tile(u, v));
      // diagonal gradient primary -> slightly accent-tinted
      let rgb = mix(P, mix(P, A, 0.55), (u + v) / 2);
      for (const [f, colour] of layers) {
        const c = cov(f(u, v));
        if (c > 0) rgb = mix(rgb, hexToRgb(colour), c);
      }
      const i = (y * size + x) * 4;
      out[i] = rgb[0]; out[i + 1] = rgb[1]; out[i + 2] = rgb[2]; out[i + 3] = Math.round(a * 255);
    }
  }
  return encodePng(size, size, out);
}
