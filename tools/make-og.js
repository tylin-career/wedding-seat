#!/usr/bin/env node
/* 產生 og.png（1200×630 LINE/FB 分享預覽圖）與 apple-touch-icon.png（180×180）
   純 Node 零依賴：自繪星空 + B-612 星球 + 玫瑰 + 星光路線（呼應頁面主題），
   2× supersample 抗鋸齒後輸出 PNG。重新產生：node tools/make-og.js */
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib");

/* ---------- PNG 編碼（RGB、filter 0） ---------- */
const CRC_T = (() => { const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0); out.write(type, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePNG(w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; /* 8-bit RGB */
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- 繪圖工具（在 2× 大圖上作畫） ---------- */
const hex = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
function makeCanvas(w, h) {
  const px = new Float64Array(w * h * 3);
  const blend = (x, y, [r, g, b], a) => {
    if (x < 0 || y < 0 || x >= w || y >= h || a <= 0) return;
    const i = (y * w + x) * 3;
    px[i] += (r - px[i]) * a; px[i + 1] += (g - px[i + 1]) * a; px[i + 2] += (b - px[i + 2]) * a;
  };
  return {
    w, h, px, blend,
    vGradient(stops) { /* stops: [t,色] 由上而下 */
      for (let y = 0; y < h; y++) {
        const t = y / (h - 1);
        let i = 0; while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
        const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
        const k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0 || 1)));
        const c = [0, 1, 2].map(j => c0[j] + (c1[j] - c0[j]) * k);
        for (let x = 0; x < w; x++) blend(x, y, c, 1);
      }
    },
    glow(cx, cy, R, col, amax) { /* 柔光 */
      for (let y = Math.max(0, cy - R | 0); y < Math.min(h, cy + R); y++)
        for (let x = Math.max(0, cx - R | 0); x < Math.min(w, cx + R); x++) {
          const d = Math.hypot(x - cx, y - cy) / R;
          if (d < 1) blend(x, y, col, amax * (1 - d) * (1 - d));
        }
    },
    circle(cx, cy, r, col, a = 1, cut = null) { /* cut: 挖掉另一圓（畫月牙/陰影用） */
      for (let y = Math.max(0, cy - r - 1 | 0); y < Math.min(h, cy + r + 2); y++)
        for (let x = Math.max(0, cx - r - 1 | 0); x < Math.min(w, cx + r + 2); x++) {
          const d = Math.hypot(x - cx, y - cy);
          const cov = Math.min(1, Math.max(0, r - d + 0.5));
          if (cov <= 0) continue;
          if (cut && Math.hypot(x - cut[0], y - cut[1]) < cut[2]) continue;
          blend(x, y, col, a * cov);
        }
    },
    ellipse(cx, cy, rx, ry, col, a = 1) {
      for (let y = Math.max(0, cy - ry - 1 | 0); y < Math.min(h, cy + ry + 2); y++)
        for (let x = Math.max(0, cx - rx - 1 | 0); x < Math.min(w, cx + rx + 2); x++) {
          const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
          if (d < 1) blend(x, y, col, a * Math.min(1, (1 - d) * rx));
        }
    },
    poly(pts, col, a = 1) { /* 偶奇填色 + 2×2 子取樣抗鋸齒 */
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const x0 = Math.max(0, Math.min(...xs) | 0), x1 = Math.min(w - 1, Math.max(...xs) + 1 | 0);
      const y0 = Math.max(0, Math.min(...ys) | 0), y1 = Math.min(h - 1, Math.max(...ys) + 1 | 0);
      const inside = (X, Y) => { let c = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i], [xj, yj] = pts[j];
          if ((yi > Y) !== (yj > Y) && X < (xj - xi) * (Y - yi) / (yj - yi) + xi) c = !c;
        } return c; };
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        let cov = 0;
        for (const [sx, sy] of [[.25, .25], [.75, .25], [.25, .75], [.75, .75]])
          if (inside(x + sx, y + sy)) cov += 0.25;
        if (cov > 0) blend(x, y, col, a * cov);
      }
    },
    toRGB() {
      const out = Buffer.alloc(w * h * 3);
      for (let i = 0; i < px.length; i++) out[i] = Math.round(Math.min(255, Math.max(0, px[i])));
      return out;
    },
  };
}
/* 四角星（凹邊 sparkle）：以二次貝茲取樣成多邊形 */
function sparklePts(cx, cy, s, k = 0.16) {
  const P = [[0, -s], [s, 0], [0, s], [-s, 0]], pts = [];
  const C = [[k * s, -k * s], [k * s, k * s], [-k * s, k * s], [-k * s, -k * s]];
  for (let i = 0; i < 4; i++) {
    const a = P[i], c = C[i], b = P[(i + 1) % 4];
    for (let t = 0; t < 1; t += 1 / 14) {
      const u = 1 - t;
      pts.push([cx + u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
                cy + u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
    }
  }
  return pts;
}
const mulberry32 = seed => () => {
  seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
function downsample2x(src, W, H) { /* 2× box filter → Buffer RGB */
  const w = W / 2, h = H / 2, out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    const i = (2 * y * W + 2 * x) * 3 + c;
    out[(y * w + x) * 3 + c] = Math.round(Math.min(255, Math.max(0,
      (src[i] + src[i + 3] + src[i + W * 3] + src[i + W * 3 + 3]) / 4)));
  }
  return out;
}

/* ---------- 調色盤（與 index.html 一致） ---------- */
const NIGHT0 = hex("#121A30"), NIGHT1 = hex("#1B2A4A"), NIGHT2 = hex("#22335A");
const GOLD = hex("#F2C94C"), WHITE = hex("#FFFFFF");
const PLANET = hex("#93A1C9"), PLANET_D = hex("#7E8CB8");
const ROSE = hex("#E4647A"), ROSE_D = hex("#D14B63"), ROSE_L = hex("#F2899B");
const GREEN = hex("#5E8C5A");

/* ---------- og.png 1200×630（畫在 2400×1260） ---------- */
(function makeOG() {
  const W = 2400, H = 1260, c = makeCanvas(W, H), rnd = mulberry32(20260718);
  c.vGradient([[0, NIGHT0], [0.55, NIGHT1], [1, NIGHT2]]);
  c.glow(420, 180, 560, GOLD, 0.10);
  c.glow(2100, 1120, 600, ROSE, 0.09);
  /* 星空 */
  for (let i = 0; i < 150; i++) {
    const x = rnd() * W, y = rnd() * H, r = 1.6 + rnd() * 3.6;
    const gold = rnd() < 0.3;
    c.circle(x, y, r, gold ? GOLD : WHITE, 0.25 + rnd() * 0.6);
  }
  /* 月牙（右上） */
  c.circle(2090, 220, 112, GOLD, 0.92, [2050, 196, 100]);
  /* B-612 星球（左下）＋玫瑰 */
  const px = 430, py = 1060, pr = 250;
  c.circle(px, py, pr, PLANET, 1);
  c.circle(px - pr * 0.32, py + pr * 0.30, pr * 0.78, PLANET_D, 0.55); /* 暗面 */
  c.ellipse(px - 80, py + 60, 44, 28, PLANET_D, 0.9);  /* 坑洞 */
  c.ellipse(px + 110, py + 130, 32, 20, PLANET_D, 0.9);
  /* 玫瑰：莖、葉、花瓣 */
  c.poly([[px + 168, py - 188], [px + 178, py - 186], [px + 172, py - 118], [px + 162, py - 120]], GREEN, 1);
  c.ellipse(px + 192, py - 150, 26, 12, GREEN, 0.95);
  c.circle(px + 152, py - 200, 18, ROSE_D, 1);
  c.circle(px + 190, py - 200, 18, ROSE_D, 1);
  c.circle(px + 170, py - 212, 24, ROSE, 1);
  c.circle(px + 170, py - 218, 11, ROSE_L, 1);
  /* 星光帶位路線：星球 → 大星（虛線圓點），呼應尋座動畫 */
  const A = [660, 920], B = [1510, 600], CC = [1050, 560];
  for (let t = 0.06; t < 0.97; t += 0.052) {
    const u = 1 - t;
    const x = u * u * A[0] + 2 * u * t * CC[0] + t * t * B[0];
    const y = u * u * A[1] + 2 * u * t * CC[1] + t * t * B[1];
    c.circle(x, y, 6.5, GOLD, 0.85);
  }
  /* 目的地大星＋陪襯小星 */
  c.glow(1560, 565, 220, GOLD, 0.30);
  c.poly(sparklePts(1560, 565, 170), GOLD, 1);
  c.poly(sparklePts(760, 330, 64), GOLD, 0.85);
  c.poly(sparklePts(1900, 880, 48), GOLD, 0.8);
  c.poly(sparklePts(1230, 220, 40), WHITE, 0.7);
  fs.writeFileSync(path.join(__dirname, "..", "og.png"), encodePNG(1200, 630, downsample2x(c.toRGB(), W, H)));
  console.log("✓ og.png 1200×630");
})();

/* ---------- apple-touch-icon.png 180×180（畫在 360×360） ---------- */
(function makeIcon() {
  const W = 360, H = 360, c = makeCanvas(W, H), rnd = mulberry32(612);
  c.vGradient([[0, NIGHT0], [0.6, hex("#16213E")], [1, NIGHT2]]);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W, y = rnd() * H;
    c.circle(x, y, 1.5 + rnd() * 2.2, rnd() < 0.4 ? GOLD : WHITE, 0.3 + rnd() * 0.5);
  }
  c.glow(180, 180, 150, GOLD, 0.22);
  c.poly(sparklePts(180, 180, 118), GOLD, 1);
  c.poly(sparklePts(285, 90, 26), WHITE, 0.85);
  c.poly(sparklePts(80, 280, 20), WHITE, 0.75);
  fs.writeFileSync(path.join(__dirname, "..", "apple-touch-icon.png"), encodePNG(180, 180, downsample2x(c.toRGB(), W, H)));
  console.log("✓ apple-touch-icon.png 180×180");
})();
