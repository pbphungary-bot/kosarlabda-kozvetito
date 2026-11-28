// Webshop insert: editor + preview + export (page graphics/webshop.html). Everything on the picture can be swapped: the title plate (text or image),
// the QR code (image) and the slides on the phone (photos AND short videos). The animation itself is graphics/js/webshop-anim.js (a pure function of time).
import { WEBSHOP_DEFAULTS, stateAt, timeline, columnLayout, baseSeconds, slideFit, migrateSizes, rgba, objSize, BASE } from './webshop-anim.js';
import { loadFonts, FONT_FAMILIES } from './engine.js';

const W = 1920, H = 1080, KEY = { magenta: '#ff00ff', green: '#00b140' };
const STORE = 'nbia.webshop.v1', MAX_VIDEO_MB = 80;
const $ = id => document.getElementById(id);
const canvas = $('c');
let ctx = canvas.getContext('2d'); // the helpers below draw into this; drawFrame() points it at its target for one frame
const clone = o => JSON.parse(JSON.stringify(o));
let cfg = load(), t = 0, playing = true, last = 0, bgView = 'checker', recording = false;
const imgs = new Map(); // dataURL → decoded image (drawing never waits for a decode)
const vids = new Map(); // video id → { el: <video>, url } (the video files themselves live in IndexedDB, see below)

function load() {
  const d = clone(WEBSHOP_DEFAULTS);
  try {
    const s = migrateSizes(JSON.parse(localStorage.getItem(STORE) || 'null'));
    if (s && typeof s === 'object') return { ...d, ...s, title: { ...d.title, ...(s.title || {}) }, qr: { ...d.qr, ...(s.qr || {}) }, photos: Array.isArray(s.photos) ? s.photos.filter(p => p && (p.src || (p.kind === 'video' && p.vid))) : [] };
  } catch (e) { /* private mode / bad data: defaults */ }
  return d;
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(cfg)); $('warn').textContent = ''; }
  catch (e) { $('warn').textContent = 'A böngésző tárhelye megtelt: a beállítások újraindítás után elvesznek (kevesebb / kisebb képet tölts fel).'; }
}
function pic(src) {
  if (!src) return null;
  let im = imgs.get(src);
  if (!im) { im = new Image(); im.src = src; imgs.set(src, im); im.onload = () => paint(); }
  return im.complete && im.naturalWidth ? im : null;
}

// ───────────────────────── videos (kept as files in IndexedDB; the settings only hold their id) ─────────────────────────
const idb = {
  db: null,
  open() { return this.db || (this.db = new Promise((res, rej) => { const r = indexedDB.open('nbia-webshop', 1); r.onupgradeneeded = () => r.result.createObjectStore('videos'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })); },
  async tx(mode, fn) { const db = await this.open(); return new Promise((res, rej) => { const q = fn(db.transaction('videos', mode).objectStore('videos')); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  put(id, blob) { return this.tx('readwrite', s => s.put(blob, id)); },
  get(id) { return this.tx('readonly', s => s.get(id)); },
  del(id) { return this.tx('readwrite', s => s.delete(id)); },
};
/** Length of a video in seconds; 0 when the browser does not know it (a recorded WebM can report Infinity). */
const finiteDur = el => (Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0);
function makeVideo(blob) {
  const el = document.createElement('video'), url = URL.createObjectURL(blob);
  el.muted = true; el.loop = true; el.playsInline = true; el.preload = 'auto'; el.src = url;
  return new Promise((res, rej) => { el.onloadedmetadata = () => res({ el, url }); el.onerror = () => rej(new Error('video')); });
}
/** Re-opens the stored video files of the saved slides; a slide whose file is gone is dropped (and said so). */
async function restoreVideos() {
  let lost = 0;
  for (const p of [...cfg.photos]) {
    if (p.kind !== 'video') continue;
    try { const blob = await idb.get(p.vid); if (!blob) throw new Error('missing'); vids.set(p.vid, await makeVideo(blob)); p.vdur = finiteDur(vids.get(p.vid).el) || p.vdur; }
    catch (e) { cfg.photos.splice(cfg.photos.indexOf(p), 1); lost++; }
  }
  if (lost) { $('warn').textContent = `${lost} videó nem található a böngésző tárhelyében (törölték?): töltsd fel újra.`; save(); }
}
function dropVideo(p) { // a deleted video slide frees its file too
  const v = vids.get(p.vid); if (v) { v.el.pause(); URL.revokeObjectURL(v.url); vids.delete(p.vid); }
  idb.del(p.vid).catch(() => {});
}
/** The drawable of a slide: a decoded photo, or the current frame of a video kept in step with the slide's own clock `local` (seconds into the slide). */
const used = new Set();
let driving = false; // true while the picture runs in real time (preview playing, recording): videos then play by themselves and are only nudged back into step
function slideImage(p, local) {
  if (!p) return null;
  if (p.kind !== 'video') return pic(p.src);
  const v = vids.get(p.vid); if (!v) return null;
  const el = v.el; used.add(p.vid);
  if (el.readyState < 2) return null;
  const d = finiteDur(el) || p.vdur || 1, target = local % d;
  if (driving) { if (el.paused) el.play().catch(() => {}); if (Math.abs(el.currentTime - target) > 0.4 && !el.seeking) el.currentTime = target; }
  else { if (!el.paused) el.pause(); if (Math.abs(el.currentTime - target) > 0.04 && !el.seeking) el.currentTime = target; }
  return el;
}

// ───────────────────────── drawing ─────────────────────────
const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
const dim = im => [im.naturalWidth || im.videoWidth, im.naturalHeight || im.videoHeight];
function fit(im, x, y, w, h, cover) {
  const [nw, nh] = dim(im), k = (cover ? Math.max : Math.min)(w / nw, h / nh), iw = nw * k, ih = nh * k;
  ctx.drawImage(im, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}
/** A rounded box: the inside colour with its own opacity, and (optional) the thin gold edge of the broadcast design. */
function tile(x, y, w, h, fill, alpha, border) {
  const r = Math.min(12, w / 4, h / 4);
  if (+alpha !== 0) { ctx.fillStyle = rgba(fill, alpha); rr(x, y, w, h, r); ctx.fill(); }
  if (border) { ctx.lineWidth = 3; ctx.strokeStyle = '#c99a4b'; rr(x + 1.5, y + 1.5, w - 3, h - 3, Math.max(0, r - 1)); ctx.stroke(); }
}
/** The title plate (w × h), drawn with its top-centre at the origin. The text follows the plate's height and is squeezed to its width. */
function plate(c, w, h) {
  const x = -w / 2, k = h / 115; tile(x, 0, w, h, c.plateBg, c.plateBgA, c.plateBorder !== false);
  const ti = c.title;
  if (ti.mode === 'image') { const im = pic(ti.image); if (im) fit(im, x + 8, 8, w - 16, h - 16, false); return; }
  const ic = pic(ti.icon), iw = Math.min(98 * k, w * 0.3), tx = ic ? x + 12 + iw + 8 : x + 20, tw = Math.max(10, w - (tx - x) - 14);
  if (ic) fit(ic, x + 12, 10 * k, iw, h - 20 * k, false);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
  const line = (s, y, col) => {
    s = String(s || '').toLocaleUpperCase('hu-HU'); if (!s) return;
    const fam = `"${FONT_FAMILIES.regular}"`; let px = 58 * k; ctx.font = `${px}px ${fam}`;
    const m = ctx.measureText(s).width; if (m > tw) { px = px * tw / m; ctx.font = `${px}px ${fam}`; }
    ctx.fillStyle = col; ctx.fillText(s, tx + tw / 2, y);
  };
  line(ti.line1, 60 * k, ti.c1); line(ti.line2, 106 * k, ti.c2);
}
/** The QR tile (w × h), top-centre at the origin. */
function qr(c, w, h) {
  const x = -w / 2; tile(x, 0, w, h, c.qrBg, c.qrBgA, c.qrBorder !== false);
  const im = pic(c.qr.image);
  if (im) fit(im, x + 12, 12, w - 24, h - 24, false);
  else { ctx.fillStyle = '#b8b8b8'; ctx.font = `${64 * Math.min(w / 177, h / 175)}px "${FONT_FAMILIES.regular}"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('QR', 0, h / 2); }
}

// ── the colour of a picture's own edges, for the strips beside / above a picture that does not fill the screen ──
const mid = document.createElement('canvas'), small = document.createElement('canvas'); small.width = small.height = 32;
const gm = mid.getContext('2d', { willReadFrequently: true }), gs = small.getContext('2d', { willReadFrequently: true });
gm.imageSmoothingQuality = gs.imageSmoothingQuality = 'high';
const edgeCache = new WeakMap(); // image / video element → { at, colours } (a video is sampled again every 0.3 s)
/** The average colour of a part of the picture (alpha-weighted; null where it is transparent). A big picture is first shrunk to ≤ 256 px, then to 32 × 32, and averaged by hand:
 *  one drawImage straight down to 1 × 1 only picks a few pixels of a large picture and gives a wrong colour. */
function sampleAvg(im, sx, sy, sw, sh) {
  const k = Math.min(1, 256 / Math.max(sw, sh)), mw = Math.max(1, Math.round(sw * k)), mh = Math.max(1, Math.round(sh * k));
  mid.width = mw; mid.height = mh; gm.imageSmoothingQuality = 'high'; gm.drawImage(im, sx, sy, sw, sh, 0, 0, mw, mh);
  gs.clearRect(0, 0, 32, 32); gs.drawImage(mid, 0, 0, mw, mh, 0, 0, 32, 32);
  const d = gs.getImageData(0, 0, 32, 32).data; let r = 0, g = 0, b = 0, a = 0;
  for (let i = 0; i < d.length; i += 4) { const w = d[i + 3]; r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; a += w; }
  return a < 32 * 32 * 255 * 0.15 ? null : [Math.round(r / a), Math.round(g / a), Math.round(b / a)];
}
function edgeColours(im) {
  const now = performance.now(), hit = edgeCache.get(im), isVid = !!im.videoWidth;
  if (hit && (!isVid || now - hit.at < 300)) return hit.c;
  const [nw, nh] = dim(im), bw = Math.max(1, Math.round(nw * 0.02)), bh = Math.max(1, Math.round(nh * 0.02));
  const c = { l: sampleAvg(im, 0, 0, bw, nh), r: sampleAvg(im, nw - bw, 0, bw, nh), t: sampleAvg(im, 0, 0, nw, bh), b: sampleAvg(im, 0, nh - bh, nw, bh) };
  edgeCache.set(im, { at: now, c }); return c;
}
const css = c => (c ? `rgb(${c[0]},${c[1]},${c[2]})` : null);
/** Fills the part of the screen box (bx, by, bw, bh) that the picture (rect) leaves empty with the colour of the picture's nearest edge, so it blends in. */
function drawBars(im, p, rect, bx, by, bw, bh) {
  if (p && p.edge === false) return;
  const [x, y, iw, ih] = rect, e = edgeColours(im);
  if (x <= bx + 0.5 && y <= by + 0.5 && x + iw >= bx + bw - 0.5 && y + ih >= by + bh - 0.5) return; // it fills the screen
  const known = [e.l, e.r, e.t, e.b].filter(Boolean);
  if (known.length) { const m = [0, 1, 2].map(i => Math.round(known.reduce((a, c) => a + c[i], 0) / known.length)); ctx.fillStyle = css(m); ctx.fillRect(bx, by, bw, bh); } // the corners: the mean of the edges
  const y0 = Math.max(by, y), y1 = Math.min(by + bh, y + ih), x0 = Math.max(bx, x), x1 = Math.min(bx + bw, x + iw);
  const bar = (col, rx, ry, rw, rh) => { if (col && rw > 0 && rh > 0) { ctx.fillStyle = css(col); ctx.fillRect(rx, ry, rw, rh); } };
  bar(e.l, bx, y0, x - bx, y1 - y0); bar(e.r, x + iw, y0, bx + bw - (x + iw), y1 - y0);
  bar(e.t, x0, by, x1 - x0, y - by); bar(e.b, x0, y + ih, x1 - x0, by + bh - (y + ih));
}
function phone(cx, cy, c, st) {
  const p = st.phone; if (!p.a) return;
  const L = columnLayout(c).phone, w = L.w, h = L.h, rs = Math.min(w / 238, h / 476); // rs: the corners, the inset and the speaker follow the smaller side
  const cs = Math.cos(p.ang), back = cs < 0, sx = Math.abs(cs) < 0.035 ? 0.035 : Math.abs(cs);
  ctx.save(); ctx.translate(cx + p.dx, cy + p.dy); ctx.rotate(p.sway);
  ctx.transform(sx, Math.sin(p.ang) * 0.09, 0, 1, 0, 0); // a cheap turn about the vertical axis: squeeze + a little perspective shear
  const m = 9 * rs, sw = w - 2 * m, sh = h - 2 * m, R = 38 * rs;
  ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 24 * rs; ctx.shadowOffsetY = 8 * rs;
  ctx.fillStyle = '#16181c';
  if (back) { rr(-w / 2, -h / 2, w, h, R); ctx.fill(); }
  else { ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, R); ctx.roundRect(-sw / 2, -sh / 2, sw, sh, 30 * rs); ctx.fill('evenodd'); } // the body with a hole where the screen is, so a transparent screen is see-through
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 3; ctx.strokeStyle = '#3a3e46'; rr(-w / 2 + 1.5, -h / 2 + 1.5, w - 3, h - 3, Math.max(0, R - 1)); ctx.stroke();
  if (back) { // the back of the phone: camera block
    ctx.fillStyle = '#23262c'; rr(-w / 2 + 22 * rs, -h / 2 + 22 * rs, 88 * rs, 88 * rs, 20 * rs); ctx.fill();
    ctx.fillStyle = '#0b0c0e';
    for (const [x, y] of [[48, 48], [84, 48], [66, 84]]) { ctx.beginPath(); ctx.arc(-w / 2 + x * rs, -h / 2 + y * rs, 15 * rs, 0, 7); ctx.fill(); }
  } else { // the screen with the slideshow
    ctx.save(); rr(-sw / 2, -sh / 2, sw, sh, 30 * rs); ctx.clip();
    if (+c.screenBgA !== 0) { ctx.fillStyle = rgba(c.screenBg, c.screenBgA); ctx.fillRect(-sw / 2, -sh / 2, sw, sh); }
    const ph = st.photo;
    const show = (idx, local, alpha) => {
      const sl = c.photos[idx], im = slideImage(sl, local); if (!im) return;
      const [nw, nh] = dim(im), rect = slideFit(nw, nh, -sw / 2, -sh / 2, sw, sh, sl || {});
      ctx.globalAlpha = alpha; drawBars(im, sl, rect, -sw / 2, -sh / 2, sw, sh); ctx.drawImage(im, ...rect); ctx.globalAlpha = 1;
    };
    show(ph.i, ph.li, 1);
    if (ph.mix > 0 && ph.j !== ph.i) show(ph.j, ph.lj, ph.mix);
    ctx.restore();
    ctx.fillStyle = '#0b0c0e'; rr(-34 * rs, -h / 2 + 18 * rs, 68 * rs, 18 * rs, 9 * rs); ctx.fill(); // speaker slot
  }
  ctx.restore();
}
/** One frame at `time` into `target` on `bg` (a colour, or null = transparent). Nothing but the config and the time decide the picture. */
export function drawFrame(target, time, c, bg) {
  const keep = ctx; ctx = target.getContext('2d'); used.clear();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.clearRect(0, 0, W, H);
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }
    const st = stateAt(time, c), s = (+c.scale || 100) / 100, cx = +c.x, top = +c.y, L = columnLayout(c);
    ctx.save(); ctx.translate(cx, top); ctx.scale(s, s); ctx.translate(-cx, -top); // the whole column is scaled about its top-centre point
    ctx.save(); ctx.translate(cx + st.plate.dx, L.plateTop); ctx.globalAlpha = st.plate.a; plate(c, L.plate.w, L.plate.h); ctx.restore();
    ctx.save(); ctx.translate(cx, L.qrTop + st.qr.dy); ctx.globalAlpha = st.qr.a; qr(c, L.qr.w, L.qr.h); ctx.restore();
    phone(cx, L.phoneCy, c, st);
    ctx.restore();
    for (const [id, v] of vids) if (!used.has(id) && !v.el.paused) v.el.pause(); // a video that is not on screen does not keep playing
    return st;
  } finally { ctx = keep; }
}

// ───────────────────────── preview ─────────────────────────
function paint() {
  drawFrame(canvas, t, cfg, null);
  $('stage').dataset.bg = bgView;
  const total = timeline(cfg).total;
  $('seek').max = total.toFixed(2); $('seek').value = t; $('time').textContent = `${t.toFixed(1)} / ${total.toFixed(1)} s`;
}
function tick(now) {
  if (playing && last) { t += (now - last) / 1000; const total = timeline(cfg).total; if (t >= total) t -= total; driving = true; paint(); }
  else if (!recording) driving = false;
  last = now; requestAnimationFrame(tick);
}

// ───────────────────────── editor ─────────────────────────
/** Reads an image file as a (down-scaled) data URL: photos as JPEG, plate / icon / QR as PNG so edges and transparency stay crisp. */
async function readImage(file, max, png) {
  const bmp = await createImageBitmap(file), k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  if (!png) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.88);
}
/** A video file becomes a slide: the file goes to IndexedDB, the slide only keeps its id, name and length. */
async function addVideo(file) {
  if (file.size > MAX_VIDEO_MB * 1048576) { $('warn').textContent = `A videó túl nagy (${Math.round(file.size / 1048576)} MB, legfeljebb ${MAX_VIDEO_MB} MB): ${file.name}`; return; }
  const id = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const v = await makeVideo(file); vids.set(id, v);
  let kept = true; try { await idb.put(id, file); } catch (e) { kept = false; }
  if (!kept) $('warn').textContent = 'A videó csak erre a munkamenetre marad meg (a böngésző nem engedi tárolni): újratöltés után újra fel kell tölteni.';
  cfg.photos.push({ kind: 'video', vid: id, name: file.name, vdur: finiteDur(v.el) });
}
/** The three objects: their size fields (in % of the default, width px, height px), inside colour + opacity, optional gold edge. */
const OBJ = [
  { k: 'plate', pct: 'sPlate', w: 'plateWPx', h: 'plateHPx', bg: 'plateBg', a: 'plateBgA', border: 'plateBorder' },
  { k: 'qr', pct: 'sQr', w: 'qrWPx', h: 'qrHPx', bg: 'qrBg', a: 'qrBgA', border: 'qrBorder' },
  { k: 'phone', pct: 'sPhone', w: 'phoneWPx', h: 'phoneHPx', bg: 'screenBg', a: 'screenBgA' },
];
const lim = v => Math.max(20, Math.min(1500, v));
function syncPx() {
  for (const o of OBJ) {
    const sz = objSize(cfg, o.k), set = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = v; };
    set(o.w, Math.round(sz.w)); set(o.h, Math.round(sz.h)); set(o.pct, Math.round(sz.w / BASE[o.k][0] * 1000) / 10);
  }
}
/** The natural width / height of the picture that sits inside an object (plate: the title image; QR: the QR image; phone: the first slide); null when there is none. */
function insidePicture(k) {
  const im = k === 'plate' ? (cfg.title.mode === 'image' ? pic(cfg.title.image) : null) : k === 'qr' ? pic(cfg.qr.image) : (() => { const f = cfg.photos[0]; return f ? (f.kind === 'video' ? (vids.get(f.vid) || {}).el : pic(f.src)) : null; })();
  if (!im) return null; const [nw, nh] = dim(im); return nw > 0 && nh > 0 ? [nw, nh] : null;
}
/** The box takes the proportions of its picture: the width stays, the height follows (so the picture fills it without bars or cropping). */
function fitToPicture(k) {
  const d = insidePicture(k);
  if (!d) { $('warn').textContent = k === 'plate' ? 'A cím-táblának nincs képe (a „Kép” módban tölts fel címképet).' : k === 'qr' ? 'Előbb tölts fel QR-kódot.' : 'Előbb tölts fel egy fotót vagy videót a telefonra.'; return; }
  const sz = objSize(cfg, k), aspect = d[0] / d[1];
  if (k === 'phone') { let h = sz.h; for (let n = 0; n < 3; n++) { const m = 9 * Math.min(sz.w / 238, h / 476); h = (sz.w - 2 * m) / aspect + 2 * m; } cfg.phoneH = Math.round(lim(h)); }
  else { const pad = k === 'plate' ? 16 : 24; cfg[k + 'H'] = Math.round(lim((sz.w - pad) / aspect + pad)); }
  $('warn').textContent = ''; changed();
}
function changed() { save(); renderSlideList(); updateStatus(); syncPx(); paint(); }
function updateStatus() {
  const miss = [];
  if (!cfg.qr.image) miss.push('QR-kód');
  if (cfg.title.mode === 'image' && !cfg.title.image) miss.push('címkép');
  if (!cfg.photos.length) miss.push('fotók / videók');
  $('status').textContent = miss.length ? `Hiányzik: ${miss.join(', ')} (üresen jelenik meg).` : '';
  $('titleText').hidden = cfg.title.mode !== 'text'; $('titleImg').hidden = cfg.title.mode !== 'image';
  const tl = timeline(cfg);
  $('lenInfo').textContent = +cfg.total > 0
    ? (tl.fits ? `A kész videó pontosan ${tl.total.toFixed(1)} mp.` : `Ennyi idő alatt nem fér el: legalább ${tl.minTotal.toFixed(1)} mp kell ennyi képhez / videóhoz (most ${tl.total.toFixed(1)} mp lesz).`)
    : `Automatikus hossz: ${tl.total.toFixed(1)} mp (a részek összege).`;
}
function renderSlideList() {
  const box = $('photoList'); box.innerHTML = '';
  const tl = timeline(cfg);
  cfg.photos.forEach((p, i) => {
    const isVid = p.kind === 'video', wrap = document.createElement('div'), row = document.createElement('div'); row.className = 'photo-row'; wrap.className = 'slide'; wrap.appendChild(row);
    const thumb = isVid ? '<span class="vthumb" title="Videó">▶</span>' : `<img src="${p.src}" alt="">`;
    const auto = baseSeconds({ ...p, dur: 0 }, cfg), shown = tl.durs[i];
    row.innerHTML = `${thumb}<span>${i + 1}. ${String(p.name || 'kép').replace(/[<>&]/g, '')}${isVid ? ` <small>(videó, ${(+p.vdur || 0).toFixed(1)} mp)</small>` : ''}</span><label class="dur" title="Ennyi másodpercig látszik (üresen: ${auto.toFixed(1)} mp automatikusan; a teljes hossz megadásakor arányosan igazodik: most ${shown.toFixed(1)} mp)"><input type="number" class="durIn" min="0.5" step="0.5" placeholder="${auto.toFixed(1)}" value="${p.dur > 0 ? p.dur : ''}"> mp</label><button data-a="up" title="Feljebb">↑</button><button data-a="down" title="Lejjebb">↓</button><button data-a="del" title="Törlés">✕</button>`;
    row.querySelector('.durIn').oninput = e => { const n = parseFloat(e.target.value); if (n > 0) p.dur = n; else delete p.dur; save(); updateStatus(); paint(); };
    row.onclick = e => {
      const a = e.target.dataset && e.target.dataset.a; if (!a) return;
      const L = cfg.photos;
      if (a === 'del') { const [gone] = L.splice(i, 1); if (gone.kind === 'video') dropVideo(gone); }
      else { const j = i + (a === 'up' ? -1 : 1); if (j < 0 || j >= L.length) return; [L[i], L[j]] = [L[j], L[i]]; }
      changed();
    };
    const adj = document.createElement('div'); adj.className = 'slide-adj'; // how this picture sits on the phone's screen
    adj.innerHTML = `<label>Illesztés <select class="fitSel"><option value="cover">Kitölti a képernyőt</option><option value="contain">Az egész kép látszik</option></select></label><label>Nagyítás % <input type="number" class="zoomIn" min="10" max="500" step="5" placeholder="100"></label><label>↔ % <input type="number" class="oxIn" min="-100" max="100" step="5" placeholder="0"></label><label>↕ % <input type="number" class="oyIn" min="-100" max="100" step="5" placeholder="0"></label><label class="edgeLbl" title="Ha a kép nem tölti ki a képernyőt, az üres sávok a kép szélének színét kapják"><input type="checkbox" class="edgeIn"> Sávok a kép széle színével</label><button type="button" class="ghost fitReset" title="Vissza az alap méretre">↺</button>`;
    const sel = adj.querySelector('.fitSel'), zi = adj.querySelector('.zoomIn'), xi = adj.querySelector('.oxIn'), yi = adj.querySelector('.oyIn');
    sel.value = p.fit === 'contain' ? 'contain' : 'cover'; zi.value = p.zoom > 0 && p.zoom !== 100 ? p.zoom : ''; xi.value = p.ox || ''; yi.value = p.oy || '';
    const put = (key, el, min, max) => { el.oninput = () => { const n = parseFloat(el.value); if (Number.isFinite(n) && (key !== 'zoom' || n > 0)) p[key] = Math.max(min, Math.min(max, n)); else delete p[key]; save(); paint(); }; };
    put('zoom', zi, 10, 500); put('ox', xi, -100, 100); put('oy', yi, -100, 100);
    const ei = adj.querySelector('.edgeIn'); ei.checked = p.edge !== false; ei.onchange = () => { if (ei.checked) delete p.edge; else p.edge = false; save(); paint(); };
    sel.onchange = () => { if (sel.value === 'contain') p.fit = 'contain'; else delete p.fit; save(); paint(); };
    adj.querySelector('.fitReset').onclick = () => { delete p.fit; delete p.zoom; delete p.ox; delete p.oy; delete p.edge; save(); renderSlideList(); paint(); };
    wrap.appendChild(adj); box.appendChild(wrap);
  });
}
function bind() {
  const num = (id, key, min, max) => { const el = $(id); el.value = cfg[key] || (key === 'total' ? '' : cfg[key]); el.oninput = () => { const v = el.value === '' && key === 'total' ? 0 : +el.value; if (Number.isFinite(v)) { cfg[key] = v === 0 && key === 'total' ? 0 : Math.max(min, Math.min(max, v)); changed(); } }; };
  num('px', 'x', 0, W); num('py', 'y', 0, H); num('scale', 'scale', 20, 300); num('hold', 'hold', 0.5, 30); num('fade', 'fade', 0, 5);
  num('videoMax', 'videoMax', 1, 120); num('total', 'total', 3, 600);
  for (const o of OBJ) {
    const size = () => objSize(cfg, o.k), put = (key, v) => { cfg[key] = Math.round(lim(v) * 10) / 10; };
    $(o.w).oninput = () => { const v = parseFloat($(o.w).value); if (v > 0) { put(o.k + 'W', v); changed(); } };
    $(o.h).oninput = () => { const v = parseFloat($(o.h).value); if (v > 0) { put(o.k + 'H', v); changed(); } };
    $(o.pct).oninput = () => { const p = parseFloat($(o.pct).value); if (!(p > 0)) return; const f = p / (size().w / BASE[o.k][0] * 100); put(o.k + 'W', size().w * f); put(o.k + 'H', size().h * f); changed(); }; // % scales width and height together
    $(o.bg).value = cfg[o.bg]; $(o.bg).oninput = () => { cfg[o.bg] = $(o.bg).value; save(); paint(); };
    $(o.a).value = cfg[o.a]; $(o.a).oninput = () => { const v = parseFloat($(o.a).value); cfg[o.a] = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 100; save(); paint(); };
    if (o.border) { $(o.border).checked = cfg[o.border] !== false; $(o.border).onchange = () => { cfg[o.border] = $(o.border).checked; save(); paint(); }; }
  }
  document.querySelectorAll('.fitPic').forEach(btn => { btn.onclick = () => fitToPicture(btn.dataset.obj); });
  syncPx();
  $('motion').value = cfg.motion === 'slide' ? 'slide' : 'rotate'; $('motion').onchange = () => { cfg.motion = $('motion').value; changed(); };
  $('tilt').checked = cfg.tilt !== false; $('tilt').onchange = () => { cfg.tilt = $('tilt').checked; changed(); };
  for (const [id, k] of [['line1', 'line1'], ['line2', 'line2'], ['c1', 'c1'], ['c2', 'c2']]) { const el = $(id); el.value = cfg.title[k]; el.oninput = () => { cfg.title[k] = el.value; changed(); }; }
  for (const r of document.querySelectorAll('input[name=tMode]')) { r.checked = r.value === cfg.title.mode; r.onchange = () => { if (r.checked) { cfg.title.mode = r.value; changed(); } }; }
  const pick = (id, max, png, set) => { $(id).onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; for (const f of fs) { try { await set(f, await readImage(f, max, png)); } catch (err) { $('warn').textContent = `Nem olvasható kép: ${f.name}`; } } changed(); }; };
  pick('titleImage', 900, true, (f, src) => { cfg.title.image = src; cfg.title.mode = 'image'; document.querySelector('input[name=tMode][value=image]').checked = true; });
  pick('titleIcon', 400, true, (f, src) => { cfg.title.icon = src; });
  pick('qrFile', 800, true, (f, src) => { cfg.qr.image = src; });
  $('photoFiles').onchange = async e => { // photos and videos in one box, added in the order they were chosen
    const fs = [...e.target.files]; e.target.value = '';
    for (const f of fs) {
      try { if (f.type.startsWith('video/')) await addVideo(f); else cfg.photos.push({ src: await readImage(f, 900, false), name: f.name }); }
      catch (err) { $('warn').textContent = `Nem olvasható fájl: ${f.name}`; }
    }
    changed();
  };
  $('clearIcon').onclick = () => { cfg.title.icon = null; changed(); };
  $('clearQr').onclick = () => { cfg.qr.image = null; changed(); };
  $('clearTitleImg').onclick = () => { cfg.title.image = null; changed(); };
  $('play').onclick = () => { playing = !playing; $('play').textContent = playing ? 'Szünet' : 'Lejátszás'; last = 0; if (!playing) { driving = false; paint(); } };
  $('seek').oninput = () => { playing = false; driving = false; $('play').textContent = 'Lejátszás'; t = +$('seek').value; paint(); };
  $('bgView').value = bgView; $('bgView').onchange = () => { bgView = $('bgView').value; paint(); };
  $('keyBg').value = cfg.bg; $('keyBg').onchange = () => { cfg.bg = $('keyBg').value; save(); };
  $('reset').onclick = () => { if (confirm('Minden beállítás és feltöltött kép / videó törlése?')) { for (const p of cfg.photos) if (p.kind === 'video') dropVideo(p); cfg = clone(WEBSHOP_DEFAULTS); try { localStorage.removeItem(STORE); } catch (e) { /* ignore */ } bind(); changed(); } };
  $('png').onclick = () => download(canvasToBlobFrame(t), 'webshop.png');
  $('video').onclick = recordVideo;
  renderSlideList(); updateStatus();
}

// ───────────────────────── export ─────────────────────────
const off = document.createElement('canvas'); off.width = W; off.height = H;
function canvasToBlobFrame(time) { drawFrame(off, time, cfg, null); return new Promise(res => off.toBlob(res, 'image/png')); }
async function download(blobOrPromise, name) {
  const b = await blobOrPromise, a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
/** Records one loop in real time as a video, 1920×1080, 60 fps, silent: on the chosen key colour (like the sample: magenta) or with a TRANSPARENT background (VP9 WebM with alpha, for OBS). Its length is the loop's length (cfg.total when set). */
async function recordVideo() {
  if (recording) return;
  const clear = cfg.bg === 'transparent', key = clear ? null : (KEY[cfg.bg] || KEY.magenta), total = timeline(cfg).total;
  // transparent: VP9 WebM keeps the alpha channel (Chrome / Edge); a key-colour video can be MP4 or WebM
  const types = clear ? ['video/webm;codecs=vp9'] : ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'], mime = types.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  if (!mime) { $('warn').textContent = clear ? 'Az átlátszó videót csak Chrome / Edge tudja menteni (VP9 WebM) – vagy válassz magenta / zöld hátteret.' : 'Ez a böngésző nem tud videót rögzíteni – használd a PNG-képet vagy egy Chrome / Edge böngészőt.'; return; }
  recording = true; driving = true; $('video').disabled = true;
  const rec = new MediaRecorder(off.captureStream(60), { mimeType: mime, videoBitsPerSecond: 12e6 }), chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(res => { rec.onstop = res; });
  rec.start(); const t0 = performance.now();
  await new Promise(res => { const step = () => { const el = (performance.now() - t0) / 1000; drawFrame(off, Math.min(el, total - 0.001), cfg, key); $('status').textContent = `Felvétel… ${Math.round(100 * el / total)} %`; el >= total ? res() : requestAnimationFrame(step); }; step(); });
  rec.stop(); await done;
  recording = false; driving = false; paint();
  await download(new Blob(chunks, { type: mime.split(';')[0] }), 'webshop.' + (mime.startsWith('video/mp4') ? 'mp4' : 'webm'));
  $('video').disabled = false; updateStatus();
}

// ───────────────────────── start ─────────────────────────
(async () => {
  try { await loadFonts('fonts/'); } catch (e) { /* the plate falls back to a system font; the page still works */ }
  await restoreVideos();
  bind(); paint(); requestAnimationFrame(tick);
  // hooks for the tests: pure time travel, no timers
  window.__webshop = { seek: x => { playing = false; driving = false; t = x; paint(); }, config: () => cfg, state: () => stateAt(t, cfg), total: () => timeline(cfg).total, timeline: () => timeline(cfg), draw: (x, bg) => { driving = false; drawFrame(off, x, cfg, bg); return off; }, videoReady: id => { const v = vids.get(id); return !!v && v.el.readyState >= 2; }, ready: true };
})();
