// Webshop insert: editor + preview + export (page graphics/webshop.html). Everything on the picture can be swapped: the title plate (text or image),
// the QR code (image) and the photos on the phone. The animation itself is graphics/js/webshop-anim.js (a pure function of time).
import { WEBSHOP_DEFAULTS, stateAt, timeline } from './webshop-anim.js';
import { loadFonts, FONT_FAMILIES } from './engine.js';

const W = 1920, H = 1080, KEY = { magenta: '#ff00ff', green: '#00b140', transparent: null };
const STORE = 'nbia.webshop.v1';
const $ = id => document.getElementById(id);
const canvas = $('c');
let ctx = canvas.getContext('2d'); // the helpers below draw into this; drawFrame() points it at its target for one frame
const clone = o => JSON.parse(JSON.stringify(o));
let cfg = load(), t = 0, playing = true, last = 0, bgView = 'checker';
const imgs = new Map(); // dataURL → decoded image (drawing never waits for a decode)

function load() {
  const d = clone(WEBSHOP_DEFAULTS);
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (s && typeof s === 'object') return { ...d, ...s, title: { ...d.title, ...(s.title || {}) }, qr: { ...d.qr, ...(s.qr || {}) }, photos: Array.isArray(s.photos) ? s.photos.filter(p => p && p.src) : [] };
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

// ───────────────────────── drawing ─────────────────────────
const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
function fit(im, x, y, w, h, cover) {
  const k = (cover ? Math.max : Math.min)(w / im.naturalWidth, h / im.naturalHeight), iw = im.naturalWidth * k, ih = im.naturalHeight * k;
  ctx.drawImage(im, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}
function tile(x, y, w, h) { // white rounded tile with the thin gold edge of the broadcast design
  ctx.fillStyle = '#ffffff'; rr(x, y, w, h, 12); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = '#c99a4b'; rr(x + 1.5, y + 1.5, w - 3, h - 3, 11); ctx.stroke();
}
function plate(cx, top, c) {
  const w = 343, h = 115, x = cx - w / 2; tile(x, top, w, h);
  const ti = c.title;
  if (ti.mode === 'image') { const im = pic(ti.image); if (im) fit(im, x + 8, top + 8, w - 16, h - 16, false); return; }
  const ic = pic(ti.icon), tx = ic ? x + 118 : x + 20, tw = w - (tx - x) - 14;
  if (ic) fit(ic, x + 12, top + 10, 98, h - 20, false);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
  const line = (s, y, col) => {
    s = String(s || '').toLocaleUpperCase('hu-HU'); if (!s) return;
    const fam = `"${FONT_FAMILIES.regular}"`; let px = 58; ctx.font = `${px}px ${fam}`;
    const m = ctx.measureText(s).width; if (m > tw) { px = px * tw / m; ctx.font = `${px}px ${fam}`; }
    ctx.fillStyle = col; ctx.fillText(s, tx + tw / 2, y);
  };
  line(ti.line1, top + 60, ti.c1); line(ti.line2, top + 106, ti.c2);
}
function qr(cx, top, c) {
  const w = 177, h = 175, x = cx - w / 2; tile(x, top, w, h);
  const im = pic(c.qr.image);
  if (im) fit(im, x + 12, top + 12, w - 24, h - 24, false);
  else { ctx.fillStyle = '#b8b8b8'; ctx.font = `64px "${FONT_FAMILIES.regular}"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('QR', cx, top + h / 2); }
}
function phone(cx, cy, c, st) {
  const p = st.phone; if (!p.a) return;
  const w = 238, h = 476, cs = Math.cos(p.ang), back = cs < 0, sx = Math.abs(cs) < 0.035 ? 0.035 * (cs < 0 ? -1 : 1) : cs;
  ctx.save(); ctx.translate(cx + p.dx, cy + p.dy); ctx.rotate(p.sway);
  ctx.transform(Math.abs(sx), Math.sin(p.ang) * 0.09, 0, 1, 0, 0); // a cheap turn about the vertical axis: squeeze + a little perspective shear
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
    const a = pic((c.photos[st.photo.i] || {}).src), b = st.photo.mix > 0 ? pic((c.photos[st.photo.j] || {}).src) : null;
    if (a) fit(a, -sw / 2, -sh / 2, sw, sh, true);
    if (b) { ctx.globalAlpha = st.photo.mix; fit(b, -sw / 2, -sh / 2, sw, sh, true); ctx.globalAlpha = 1; }
    ctx.restore();
    ctx.fillStyle = '#0b0c0e'; rr(-34, -h / 2 + 18, 68, 18, 9); ctx.fill(); // speaker slot
  }
  ctx.restore();
}
/** One frame at `time` into `target` on `bg` (a colour, or null = transparent). Nothing but the config and the time decide the picture. */
export function drawFrame(target, time, c, bg) {
  const keep = ctx; ctx = target.getContext('2d');
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.clearRect(0, 0, W, H);
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }
    const st = stateAt(time, c), s = (+c.scale || 100) / 100, cx = +c.x, top = +c.y;
    ctx.save(); ctx.translate(cx, top); ctx.scale(s, s); ctx.translate(-cx, -top); // the column is scaled about its top-centre point
    ctx.globalAlpha = st.plate.a; plate(cx + st.plate.dx, top, c);
    ctx.globalAlpha = st.qr.a; qr(cx, top + 133 + st.qr.dy, c);
    ctx.globalAlpha = 1; phone(cx, top + 603, c, st);
    ctx.restore();
    return st;
  } finally { ctx = keep; }
}

// ───────────────────────── preview ─────────────────────────
const BGVIEW = { checker: null, magenta: KEY.magenta, green: KEY.green };
function paint() {
  drawFrame(canvas, t, cfg, null);
  const wrap = $('stage'); wrap.dataset.bg = bgView;
  const total = timeline(cfg).total;
  $('seek').max = total.toFixed(2); $('seek').value = t; $('time').textContent = `${t.toFixed(1)} / ${total.toFixed(1)} s`;
}
function tick(now) {
  if (playing && last) { t += (now - last) / 1000; const total = timeline(cfg).total; if (t >= total) t -= total; paint(); }
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
function changed() { save(); renderPhotoList(); updateStatus(); paint(); }
function updateStatus() {
  const miss = [];
  if (!cfg.qr.image) miss.push('QR-kód');
  if (cfg.title.mode === 'image' && !cfg.title.image) miss.push('címkép');
  if (!cfg.photos.length) miss.push('fotók');
  $('status').textContent = miss.length ? `Hiányzik: ${miss.join(', ')} (üresen jelenik meg).` : '';
  $('titleText').hidden = cfg.title.mode !== 'text'; $('titleImg').hidden = cfg.title.mode !== 'image';
}
function renderPhotoList() {
  const box = $('photoList'); box.innerHTML = '';
  cfg.photos.forEach((p, i) => {
    const row = document.createElement('div'); row.className = 'photo-row';
    row.innerHTML = `<img src="${p.src}" alt=""><span>${i + 1}. ${String(p.name || 'kép').replace(/[<>&]/g, '')}</span><button data-a="up" title="Feljebb">↑</button><button data-a="down" title="Lejjebb">↓</button><button data-a="del" title="Törlés">✕</button>`;
    row.onclick = e => {
      const a = e.target.dataset && e.target.dataset.a; if (!a) return;
      const L = cfg.photos;
      if (a === 'del') L.splice(i, 1);
      else { const j = i + (a === 'up' ? -1 : 1); if (j < 0 || j >= L.length) return; [L[i], L[j]] = [L[j], L[i]]; }
      changed();
    };
    box.appendChild(row);
  });
}
function bind() {
  const num = (id, key, min, max) => { const el = $(id); el.value = cfg[key]; el.oninput = () => { const v = +el.value; if (Number.isFinite(v)) { cfg[key] = Math.max(min, Math.min(max, v)); changed(); } }; };
  num('px', 'x', 0, W); num('py', 'y', 0, H); num('scale', 'scale', 20, 300); num('hold', 'hold', 0.5, 30); num('fade', 'fade', 0, 5);
  $('motion').value = cfg.motion === 'slide' ? 'slide' : 'rotate'; $('motion').onchange = () => { cfg.motion = $('motion').value; changed(); };
  $('tilt').checked = cfg.tilt !== false; $('tilt').onchange = () => { cfg.tilt = $('tilt').checked; changed(); };
  for (const [id, k] of [['line1', 'line1'], ['line2', 'line2'], ['c1', 'c1'], ['c2', 'c2']]) { const el = $(id); el.value = cfg.title[k]; el.oninput = () => { cfg.title[k] = el.value; changed(); }; }
  for (const r of document.querySelectorAll('input[name=tMode]')) { r.checked = r.value === cfg.title.mode; r.onchange = () => { if (r.checked) { cfg.title.mode = r.value; changed(); } }; }
  const pick = (id, max, png, set) => { $(id).onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; for (const f of fs) { try { set(await readImage(f, max, png), f.name); } catch (err) { $('warn').textContent = `Nem olvasható kép: ${f.name}`; } } changed(); }; };
  pick('titleImage', 900, true, src => { cfg.title.image = src; cfg.title.mode = 'image'; document.querySelector('input[name=tMode][value=image]').checked = true; });
  pick('titleIcon', 400, true, src => { cfg.title.icon = src; });
  pick('qrFile', 800, true, src => { cfg.qr.image = src; });
  pick('photoFiles', 900, false, (src, name) => { cfg.photos.push({ src, name }); });
  $('clearIcon').onclick = () => { cfg.title.icon = null; changed(); };
  $('clearQr').onclick = () => { cfg.qr.image = null; changed(); };
  $('clearTitleImg').onclick = () => { cfg.title.image = null; changed(); };
  $('play').onclick = () => { playing = !playing; $('play').textContent = playing ? 'Szünet' : 'Lejátszás'; last = 0; };
  $('seek').oninput = () => { playing = false; $('play').textContent = 'Lejátszás'; t = +$('seek').value; paint(); };
  $('bgView').value = bgView; $('bgView').onchange = () => { bgView = $('bgView').value; paint(); };
  $('keyBg').value = cfg.bg; $('keyBg').onchange = () => { cfg.bg = $('keyBg').value; save(); };
  $('reset').onclick = () => { if (confirm('Minden beállítás és feltöltött kép törlése?')) { cfg = clone(WEBSHOP_DEFAULTS); try { localStorage.removeItem(STORE); } catch (e) { /* ignore */ } bind(); changed(); } };
  $('png').onclick = () => download(canvasToBlobFrame(t), 'webshop.png');
  $('video').onclick = recordVideo;
  renderPhotoList(); updateStatus();
}

// ───────────────────────── export ─────────────────────────
const off = document.createElement('canvas'); off.width = W; off.height = H;
function canvasToBlobFrame(time) { drawFrame(off, time, cfg, null); return new Promise(res => off.toBlob(res, 'image/png')); }
async function download(blobOrPromise, name) {
  const b = await blobOrPromise, a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
let recording = false;
/** Records one loop in real time as a video on the chosen key colour (like the sample: magenta), 25 fps, 1920×1080. */
async function recordVideo() {
  if (recording) return;
  const key = KEY[cfg.bg] || KEY.magenta, total = timeline(cfg).total;
  const types = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'], mime = types.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  if (!mime) { $('warn').textContent = 'Ez a böngésző nem tud videót rögzíteni – használd a PNG-képet vagy egy Chrome / Edge böngészőt.'; return; }
  recording = true; $('video').disabled = true;
  const rec = new MediaRecorder(off.captureStream(25), { mimeType: mime, videoBitsPerSecond: 12e6 }), chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(res => { rec.onstop = res; });
  rec.start(); const t0 = performance.now();
  await new Promise(res => { const step = () => { const el = (performance.now() - t0) / 1000; drawFrame(off, Math.min(el, total - 0.001), cfg, key); $('status').textContent = `Felvétel… ${Math.round(100 * el / total)} %`; el >= total ? res() : requestAnimationFrame(step); }; step(); });
  rec.stop(); await done;
  await download(new Blob(chunks, { type: mime.split(';')[0] }), 'webshop.' + (mime.startsWith('video/mp4') ? 'mp4' : 'webm'));
  recording = false; $('video').disabled = false; updateStatus();
}

// ───────────────────────── start ─────────────────────────
(async () => {
  try { await loadFonts('fonts/'); } catch (e) { /* the plate falls back to a system font; the page still works */ }
  bind(); paint(); requestAnimationFrame(tick);
  // hooks for the tests: pure time travel, no timers
  window.__webshop = { seek: x => { playing = false; t = x; paint(); }, config: () => cfg, state: () => stateAt(t, cfg), total: () => timeline(cfg).total, draw: (x, bg) => { drawFrame(off, x, cfg, bg); return off; }, ready: true };
})();
