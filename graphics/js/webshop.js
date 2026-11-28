// Webshop insert: editor + preview + export (page graphics/webshop.html). Everything on the picture can be swapped: the title plate (text or image),
// the QR code (image) and the slides on the phone (photos AND short videos). The animation itself is graphics/js/webshop-anim.js (a pure function of time).
import { WEBSHOP_DEFAULTS, stateAt, timeline, columnLayout, baseSeconds } from './webshop-anim.js';
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
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
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
function tile(x, y, w, h) { // white rounded tile with the thin gold edge of the broadcast design
  ctx.fillStyle = '#ffffff'; rr(x, y, w, h, 12); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = '#c99a4b'; rr(x + 1.5, y + 1.5, w - 3, h - 3, 11); ctx.stroke();
}
/** The title plate, drawn with its top-centre at the origin (the caller has moved / scaled the context). */
function plate(c) {
  const w = 343, h = 115, x = -w / 2; tile(x, 0, w, h);
  const ti = c.title;
  if (ti.mode === 'image') { const im = pic(ti.image); if (im) fit(im, x + 8, 8, w - 16, h - 16, false); return; }
  const ic = pic(ti.icon), tx = ic ? x + 118 : x + 20, tw = w - (tx - x) - 14;
  if (ic) fit(ic, x + 12, 10, 98, h - 20, false);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
  const line = (s, y, col) => {
    s = String(s || '').toLocaleUpperCase('hu-HU'); if (!s) return;
    const fam = `"${FONT_FAMILIES.regular}"`; let px = 58; ctx.font = `${px}px ${fam}`;
    const m = ctx.measureText(s).width; if (m > tw) { px = px * tw / m; ctx.font = `${px}px ${fam}`; }
    ctx.fillStyle = col; ctx.fillText(s, tx + tw / 2, y);
  };
  line(ti.line1, 60, ti.c1); line(ti.line2, 106, ti.c2);
}
/** The QR tile, top-centre at the origin. */
function qr(c) {
  const w = 177, h = 175, x = -w / 2; tile(x, 0, w, h);
  const im = pic(c.qr.image);
  if (im) fit(im, x + 12, 12, w - 24, h - 24, false);
  else { ctx.fillStyle = '#b8b8b8'; ctx.font = `64px "${FONT_FAMILIES.regular}"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('QR', 0, h / 2); }
}
function phone(cx, cy, s, c, st) {
  const p = st.phone; if (!p.a) return;
  const w = 238, h = 476, cs = Math.cos(p.ang), back = cs < 0, sx = Math.abs(cs) < 0.035 ? 0.035 : Math.abs(cs);
  ctx.save(); ctx.translate(cx + p.dx, cy + p.dy); ctx.scale(s, s); ctx.rotate(p.sway);
  ctx.transform(sx, Math.sin(p.ang) * 0.09, 0, 1, 0, 0); // a cheap turn about the vertical axis: squeeze + a little perspective shear
  ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#16181c'; rr(-w / 2, -h / 2, w, h, 38); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 3; ctx.strokeStyle = '#3a3e46'; rr(-w / 2 + 1.5, -h / 2 + 1.5, w - 3, h - 3, 37); ctx.stroke();
  if (back) { // the back of the phone: camera block
    ctx.fillStyle = '#23262c'; rr(-w / 2 + 22, -h / 2 + 22, 88, 88, 20); ctx.fill();
    ctx.fillStyle = '#0b0c0e';
    for (const [x, y] of [[48, 48], [84, 48], [66, 84]]) { ctx.beginPath(); ctx.arc(-w / 2 + x, -h / 2 + y, 15, 0, 7); ctx.fill(); }
  } else { // the screen with the slideshow
    const m = 9, sw = w - 2 * m, sh = h - 2 * m;
    ctx.save(); rr(-sw / 2, -sh / 2, sw, sh, 30); ctx.clip();
    ctx.fillStyle = '#6b6f78'; ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
    const ph = st.photo, a = slideImage(c.photos[ph.i], ph.li), b = ph.mix > 0 && ph.j !== ph.i ? slideImage(c.photos[ph.j], ph.lj) : null;
    if (a) fit(a, -sw / 2, -sh / 2, sw, sh, true);
    if (b) { ctx.globalAlpha = ph.mix; fit(b, -sw / 2, -sh / 2, sw, sh, true); ctx.globalAlpha = 1; }
    ctx.restore();
    ctx.fillStyle = '#0b0c0e'; rr(-34, -h / 2 + 18, 68, 18, 9); ctx.fill(); // speaker slot
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
    ctx.save(); ctx.translate(cx + st.plate.dx, L.plateTop); ctx.scale(L.sp, L.sp); ctx.globalAlpha = st.plate.a; plate(c); ctx.restore();
    ctx.save(); ctx.translate(cx, L.qrTop + st.qr.dy); ctx.scale(L.sq, L.sq); ctx.globalAlpha = st.qr.a; qr(c); ctx.restore();
    phone(cx, L.phoneCy, L.sh, c, st);
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
function changed() { save(); renderSlideList(); updateStatus(); paint(); }
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
    const isVid = p.kind === 'video', row = document.createElement('div'); row.className = 'photo-row';
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
    box.appendChild(row);
  });
}
function bind() {
  const num = (id, key, min, max) => { const el = $(id); el.value = cfg[key] || (key === 'total' ? '' : cfg[key]); el.oninput = () => { const v = el.value === '' && key === 'total' ? 0 : +el.value; if (Number.isFinite(v)) { cfg[key] = v === 0 && key === 'total' ? 0 : Math.max(min, Math.min(max, v)); changed(); } }; };
  num('px', 'x', 0, W); num('py', 'y', 0, H); num('scale', 'scale', 20, 300); num('hold', 'hold', 0.5, 30); num('fade', 'fade', 0, 5);
  num('videoMax', 'videoMax', 1, 120); num('total', 'total', 3, 600); num('sPlate', 'sPlate', 20, 300); num('sQr', 'sQr', 20, 300); num('sPhone', 'sPhone', 20, 300);
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
/** Records one loop in real time as a video on the chosen key colour (like the sample: magenta), 1920×1080, silent. Its length is the loop's length (cfg.total when set). */
async function recordVideo() {
  if (recording) return;
  const key = KEY[cfg.bg] || KEY.magenta, total = timeline(cfg).total;
  const types = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'], mime = types.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  if (!mime) { $('warn').textContent = 'Ez a böngésző nem tud videót rögzíteni – használd a PNG-képet vagy egy Chrome / Edge böngészőt.'; return; }
  recording = true; driving = true; $('video').disabled = true;
  const rec = new MediaRecorder(off.captureStream(25), { mimeType: mime, videoBitsPerSecond: 12e6 }), chunks = [];
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
