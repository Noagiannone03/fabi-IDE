#!/usr/bin/env node
/**
 * Fabi — générateur d'assets logo (zéro dépendance).
 *
 * Source de vérité : le pixel-art "tête de renard" de fabi-cli
 * (packages/opencode/src/cli/mascot.ts), reproduit ici à l'identique.
 * Grille 14×12, palette officielle Fabi.
 *
 * Produit :
 *   branding/fox.svg              → renard vectoriel, fond transparent
 *   branding/fabi-icon.svg        → icône (renard + fond carré arrondi dégradé)
 *   branding/png/fox-<n>.png      → renard transparent, plusieurs tailles
 *   branding/png/icon-<n>.png     → icône complète, plusieurs tailles
 *   branding/icon.ico             → icône Windows (multi-tailles, PNG embarqué)
 *   branding/fabi.iconset/        → dossier prêt pour `iconutil` → .icns macOS
 *
 * Encodage PNG fait main (zlib natif + CRC32) : pas de sharp/canvas.
 */
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'branding');

// --- Source de vérité : palette + pixels (cf. fabi-cli/mascot.ts) ----------
const PALETTE = {
  '.': null,            // transparent
  '1': '#000000',       // yeux (pupille), truffe, bouche
  '2': '#A03A18',       // orange foncé : oreilles ext., contour
  '3': '#EC5B2B',       // orange brand Fabi : tête
  '4': '#F5E6D3',       // crème : joues, intérieur oreilles, museau
  '5': '#FFFFFF',       // blanc : highlight des yeux
};
const FOX = [
  '.2..........2.',
  '.22........22.',
  '.242......242.',
  '22433333333422',
  '.233333333332.',
  '.233351331532.',
  '.233311331132.',
  '.233344334432.',
  '.233344114432.',
  '.233344444432.',
  '..2334444332..',
  '...23344332...',
];
const GRID_W = 14, GRID_H = 12;

// Fond de l'icône : dégradé sombre chaud (charte Fabi)
const BG_TOP = [0x24, 0x1a, 0x14];   // #241a14
const BG_BOT = [0x0b, 0x08, 0x07];   // #0b0807

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// --- PNG encoder (RGBA, 8 bits) --------------------------------------------
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // scanlines avec filtre 0
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// --- Rasterisation ---------------------------------------------------------
function blank(size) { return Buffer.alloc(size * size * 4); }
function setPx(buf, size, x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const o = (y * size + x) * 4;
  // alpha-over : source (r,g,b,a) par-dessus destination existante
  const sa = a / 255, da = buf[o + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) { buf[o] = buf[o + 1] = buf[o + 2] = buf[o + 3] = 0; return; }
  const blend = (sc, dc) => Math.round((sc / 255 * sa + dc / 255 * da * (1 - sa)) / oa * 255);
  buf[o] = blend(r, buf[o]);
  buf[o + 1] = blend(g, buf[o + 1]);
  buf[o + 2] = blend(b, buf[o + 2]);
  buf[o + 3] = Math.round(oa * 255);
}

// renard seul, transparent
function rasterFox(size) {
  const buf = blank(size);
  const block = Math.floor((size * 0.86) / GRID_W);
  const foxW = block * GRID_W, foxH = block * GRID_H;
  const ox = Math.floor((size - foxW) / 2), oy = Math.floor((size - foxH) / 2);
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const c = PALETTE[FOX[gy][gx]];
      if (!c) continue;
      const rgb = hexToRgb(c);
      for (let py = 0; py < block; py++)
        for (let px = 0; px < block; px++)
          setPx(buf, size, ox + gx * block + px, oy + gy * block + py, rgb);
    }
  }
  return buf;
}

// icône : fond carré arrondi (dégradé) + renard centré
function rasterIcon(size) {
  const buf = blank(size);
  const r = size * 0.2235; // rayon "squircle" proche macOS
  for (let y = 0; y < size; y++) {
    const t = y / (size - 1);
    const bg = [0, 1, 2].map((i) => Math.round(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t));
    for (let x = 0; x < size; x++) {
      const cx = Math.min(Math.max(x, r), size - r);
      const cy = Math.min(Math.max(y, r), size - r);
      const d = Math.hypot(x - cx, y - cy);
      const a = Math.max(0, Math.min(1, r - d + 0.5)); // AA sur le bord arrondi
      if (a <= 0) continue;
      setPx(buf, size, x, y, bg, Math.round(a * 255));
    }
  }
  // renard ~66% de la largeur, légèrement remonté
  const block = Math.floor((size * 0.62) / GRID_W);
  const foxW = block * GRID_W, foxH = block * GRID_H;
  const ox = Math.floor((size - foxW) / 2);
  const oy = Math.floor((size - foxH) / 2 - size * 0.01);
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const c = PALETTE[FOX[gy][gx]];
      if (!c) continue;
      const rgb = hexToRgb(c);
      for (let py = 0; py < block; py++)
        for (let px = 0; px < block; px++)
          setPx(buf, size, ox + gx * block + px, oy + gy * block + py, rgb);
    }
  }
  return buf;
}

// --- SVG --------------------------------------------------------------------
function foxSvg() {
  let rects = '';
  for (let gy = 0; gy < GRID_H; gy++)
    for (let gx = 0; gx < GRID_W; gx++) {
      const c = PALETTE[FOX[gy][gx]];
      if (!c) continue;
      rects += `<rect x="${gx}" y="${gy}" width="1.02" height="1.02" fill="${c}"/>`;
    }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID_W} ${GRID_H}" shape-rendering="crispEdges">${rects}</svg>`;
}
function iconSvg() {
  const S = 1024, r = Math.round(S * 0.2235);
  const block = Math.floor((S * 0.62) / GRID_W);
  const foxW = block * GRID_W, foxH = block * GRID_H;
  const ox = Math.round((S - foxW) / 2), oy = Math.round((S - foxH) / 2 - S * 0.01);
  let rects = '';
  for (let gy = 0; gy < GRID_H; gy++)
    for (let gx = 0; gx < GRID_W; gx++) {
      const c = PALETTE[FOX[gy][gx]];
      if (!c) continue;
      rects += `<rect x="${ox + gx * block}" y="${oy + gy * block}" width="${block + 0.5}" height="${block + 0.5}" fill="${c}"/>`;
    }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" shape-rendering="crispEdges">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#241a14"/><stop offset="1" stop-color="#0b0807"/>
  </linearGradient></defs>
  <rect x="0" y="0" width="${S}" height="${S}" rx="${r}" ry="${r}" fill="url(#bg)"/>
  ${rects}
</svg>`;
}

// --- ICO (PNG embarqué) -----------------------------------------------------
function buildIco(entries) { // entries: [{size, png}]
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const datas = [];
  entries.forEach((e, i) => {
    const b = i * 16;
    dir[b] = e.size >= 256 ? 0 : e.size;
    dir[b + 1] = e.size >= 256 ? 0 : e.size;
    dir[b + 2] = 0; dir[b + 3] = 0;
    dir.writeUInt16LE(1, b + 4); dir.writeUInt16LE(32, b + 6);
    dir.writeUInt32LE(e.png.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += e.png.length; datas.push(e.png);
  });
  return Buffer.concat([header, dir, ...datas]);
}

// --- Run --------------------------------------------------------------------
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'png'), { recursive: true });
mkdirSync(join(OUT, 'fabi.iconset'), { recursive: true });

writeFileSync(join(OUT, 'fox.svg'), foxSvg());
writeFileSync(join(OUT, 'fabi-icon.svg'), iconSvg());

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const icoEntries = [];
for (const s of SIZES) {
  const fox = encodePNG(s, s, rasterFox(s));
  const icon = encodePNG(s, s, rasterIcon(s));
  writeFileSync(join(OUT, 'png', `fox-${s}.png`), fox);
  writeFileSync(join(OUT, 'png', `icon-${s}.png`), icon);
  if ([16, 24, 32, 48, 64, 128, 256].includes(s)) icoEntries.push({ size: s, png: icon });
}
writeFileSync(join(OUT, 'icon.ico'), buildIco(icoEntries));

// .iconset pour iconutil (macOS)
const ICONSET = {
  'icon_16x16.png': 16, 'icon_16x16@2x.png': 32,
  'icon_32x32.png': 32, 'icon_32x32@2x.png': 64,
  'icon_128x128.png': 128, 'icon_128x128@2x.png': 256,
  'icon_256x256.png': 256, 'icon_256x256@2x.png': 512,
  'icon_512x512.png': 512, 'icon_512x512@2x.png': 1024,
};
for (const [name, s] of Object.entries(ICONSET))
  writeFileSync(join(OUT, 'fabi.iconset', name), encodePNG(s, s, rasterIcon(s)));

console.log('✓ Assets générés dans branding/ :');
console.log('  fox.svg, fabi-icon.svg, png/ (fox-* & icon-*), icon.ico, fabi.iconset/');
