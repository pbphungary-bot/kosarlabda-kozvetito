// Deterministic Canvas 2D renderer for the broadcast templates.
// render(canvas, template, values, assets) draws the template's background 1:1
// and every element at the PSD's pixel geometry. Same inputs → same pixels.
//
// Effects: every layer effect in the source PSDs is a Photoshop "drop shadow"
// with 100% spread (a hard outline of `size` px, offset by `distance` px at the
// document's global angle 0° → shifted 1 px to the left). That is reproduced
// exactly as a dilated silhouette drawn behind the element.

import { safeFit, foldFit } from './layout.js';
import { fitParagraphs } from './paragraph.js';
export const FONT_FAMILIES = {
  regular: 'League Gothic Studio',
  italic: 'League Gothic Studio Italic',
};

export async function loadFonts(baseUrl = 'fonts/') {
  const faces = [
    new FontFace(FONT_FAMILIES.regular, `url(${baseUrl}LeagueGothic-Regular.otf)`),
    new FontFace(FONT_FAMILIES.italic, `url(${baseUrl}LeagueGothic-Italic.otf)`),
  ];
  for (const f of faces) {
    await f.load();
    document.fonts.add(f);
  }
  await document.fonts.ready;
  return Object.values(FONT_FAMILIES).every(fam => document.fonts.check(`40px "${fam}"`));
}

export function upper(s) { return String(s ?? '').toLocaleUpperCase('hu-HU'); }

function fontString(style, size) {
  return `${size}px "${FONT_FAMILIES[style.font || 'regular']}"`;
}

/** Off-screen canvas; older iPhones (before iOS 16.4) have no OffscreenCanvas, a detached <canvas> does the same job. */
function mkCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function setup(ctx, style, size) {
  ctx.font = fontString(style, size);
  // tracking is applied in the condensed (hscale) space → divide so the result is unscaled
  ctx.letterSpacing = `${((style.tracking || 0) / 1000) * size / (style.hscale || 1)}px`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
}

/** Width of a string as drawn (tracking after each glyph, like Photoshop, minus the final one). */
export function measure(ctx, style, text, size = style.size) {
  setup(ctx, style, size);
  const w = ctx.measureText(text).width * (style.hscale || 1);
  return text.length ? w - ((style.tracking || 0) / 1000) * size : 0;
}

function drawRuns(ctx, runs, x, y, size, style, color, outlineOnly) {
  // runs: [{text, color}] drawn left to right from x
  const hs = style.hscale || 1;
  let cx = x;
  for (const r of runs) {
    const rs = r.size || size; const rdy = r.dy || 0; // a run may have its own size (e.g. the small "(41.4%)" next to a shooting line)
    setup(ctx, style, rs);
    const o = style.outline;
    const ox = outlineOnly ? (o.dx || 0) : 0, oy = outlineOnly ? (o.dy || 0) : 0;
    ctx.save();
    ctx.translate(cx + ox, y + oy + rdy);
    ctx.scale(hs, 1);
    if (outlineOnly) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = o.size * 2;
      ctx.strokeStyle = o.color;
      ctx.fillStyle = o.color;
      ctx.strokeText(r.text, 0, 0);
      ctx.fillText(r.text, 0, 0);
    } else {
      ctx.fillStyle = r.color || color;
      ctx.fillText(r.text, 0, 0);
    }
    ctx.restore();
    cx += ctx.measureText(r.text).width * hs;
  }
}

/**
 * Lay out a text element: applies caps, explicit lines ("\n"), word wrapping
 * (moves trailing words down while lines remain) and shrink-to-fit.
 * Returns {lines, size, scaled, overflow}.
 */
export function layoutText(ctx, el, text) {
  let lines = String(text ?? '').split('\n');
  if (el.caps) lines = lines.map(upper);
  const max = el.maxWidth || Infinity;
  const maxLines = el.wrap?.maxLines || lines.length;
  // single over-long line that may wrap: balanced split (minimise the wider line)
  if (lines.length === 1 && maxLines >= 2 && measure(ctx, el, lines[0]) > max && lines[0].includes(' ')) {
    const words = lines[0].split(' ');
    let bestSplit = null, bestW = Infinity;
    for (let k = 1; k < words.length; k++) {
      const a = words.slice(0, k).join(' '), b = words.slice(k).join(' ');
      const w = Math.max(measure(ctx, el, a), measure(ctx, el, b));
      if (w < bestW) { bestW = w; bestSplit = [a, b]; }
    }
    lines = bestSplit;
  }
  // explicit lines: push trailing words of an over-long line onto the next line
  for (let i = 0; i < lines.length; i++) {
    while (measure(ctx, el, lines[i]) > max && lines[i].includes(' ')) {
      const cut = lines[i].lastIndexOf(' ');
      const moved = lines[i].slice(cut + 1);
      lines[i] = lines[i].slice(0, cut);
      if (i + 1 < lines.length) lines[i + 1] = moved + ' ' + lines[i + 1];
      else if (lines.length < maxLines) lines.push(moved);
      else { lines[i] += ' ' + moved; break; }
    }
  }
  const widest = Math.max(0, ...lines.map(l => measure(ctx, el, l)));
  let size = el.size;
  let overflow = false;
  if (widest > max) {
    if (el.fitLocked) {
      overflow = true; // the operator chose the size: never shrunk automatically, only reported
    } else {
      const s = max / widest;
      const min = el.minScale ?? 0.6;
      size = el.size * Math.max(s, min);
      overflow = s < min;
    }
  }
  return { lines, size, scaled: size !== el.size, overflow };
}

/** Paragraph text (el.paragraph: the coach's quote): paragraphs wrapped on their own, small caps or plain capitals (v.caseMode), shrunk to fit el.maxHeight. */
function drawParagraph(ctx, el, v, report) {
  const text = v.text ?? '';
  if (!String(text).trim()) return;
  const mode = v.caseMode || el.caseMode || 'caps';
  const style = { ...el, outline: v.outline === null ? null : (v.outline || el.outline) };
  const width = (t, sz) => { setup(ctx, style, sz); return ctx.measureText(t).width * (style.hscale || 1); };
  const lh0 = el.lineHeight || el.size * 1.2;
  const { s, lines, overflow } = fitParagraphs(text, mode, el.size, el.maxWidth || Infinity, el.maxHeight || Infinity, lh0, width, { minScale: el.minScale ?? 0.45, locked: !!el.fitLocked });
  const sz = el.size * s, lh = lh0 * s;
  if (overflow) report.overflow.push(el.id);
  if (s < 1) report.scaled.push(el.id);
  report.sizes[el.id] = sz;
  const placed = lines.map((ln, i) => ({ runs: ln.runs.map(r => ({ text: r.text, size: r.f === 1 ? undefined : sz * r.f })), x: el.x, y: el.y + i * lh, w: ln.w }));
  if (placed.length) report.boxes[el.id] = [el.x, el.y - sz * 0.8, Math.max(...placed.map(p => p.w)), lines.length * lh];
  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;
  const color = v.color || el.color;
  if (style.outline && style.outline.size > 0) for (const p of placed) drawRuns(ctx, p.runs, p.x, p.y, sz, style, color, true);
  for (const p of placed) drawRuns(ctx, p.runs, p.x, p.y, sz, style, color, false);
  ctx.restore();
}

function drawText(ctx, el, v, report) {
  if (el.paragraph) return drawParagraph(ctx, el, v, report);
  const ref = el.centerOn && report.boxes[el.centerOn]; // centred on the middle of another (earlier drawn) text, e.g. the head-to-head competition label under its date
  if (ref) el = { ...el, x: ref[0] + ref[2] / 2, align: 'center' };
  const text = v.text ?? '';
  if (text === '') return;
  const { lines, size, overflow, scaled } = layoutText(ctx, el, text);
  if (overflow) report.overflow.push(el.id);
  if (scaled) report.scaled.push(el.id);
  const lh = el.lineHeight || el.size * 1.2;
  // A two-line name with the rank line shown below it would collide with that line:
  // the block is then set 15% smaller and grows upward from the single-line baseline.
  const compact = !!el.rankOn && lines.length > 1 && !el.fitLocked; // a size chosen by hand is used as it is
  const sz = compact ? size * 0.85 : size;
  report.sizes[el.id] = sz; // effective font size (px), shown in the editor and used by the equalize buttons
  const lhs = compact ? sz * 0.9 : lh * (size / el.size);
  let y0 = el.y;
  if (compact) y0 = el.y - (lines.length - 1) * lhs;
  else if (el.wrap?.anchor === 'middle') y0 = el.y - ((lines.length - 1) * lhs) / 2;
  const style = { ...el, outline: v.outline === null ? null : (v.outline || el.outline) };
  const color = v.color || el.color;
  const placed = lines.map((line, i) => {
    const runs = el.runs && v.runs ? v.runs : [{ text: line }];
    const runsText = runs.map(r => (el.caps ? upper(r.text) : r.text));
    const shaped = runs.map((r, k) => ({ ...r, text: runsText[k], size: r.size ? r.size * (sz / el.size) : undefined, dy: r.dy ? r.dy * (sz / el.size) : undefined }));
    const w = shaped.reduce((a, r) => a + measure(ctx, style, r.text, r.size || sz), 0)
      + (shaped.length > 1 ? ((style.tracking || 0) / 1000) * sz * (shaped.length - 1) : 0);
    let x = el.x;
    if (el.align === 'center') x = el.x - w / 2;
    else if (el.align === 'right') x = el.x - w;
    return { runs: shaped, x, y: y0 + i * lhs, w };
  });
  if (placed.length) { // box of the drawn text, used by the layout editor (drag handles)
    const minX = Math.min(...placed.map(p => p.x)), maxX = Math.max(...placed.map(p => p.x + p.w));
    const top = placed[0].y - sz * 0.8, bottom = placed.at(-1).y + sz * 0.15;
    report.boxes[el.id] = [minX, top, maxX - minX, bottom - top];
  }
  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1; // layer opacity from the PSD (e.g. 98.8 %)
  if (style.outline && style.outline.size > 0) {
    for (const p of placed) drawRuns(ctx, p.runs, p.x, p.y, sz, style, color, true);
  }
  for (const p of placed) drawRuns(ctx, p.runs, p.x, p.y, sz, style, color, false);
  ctx.restore();
}

/** Box for an image of natural size (w,h) in a slot. slot.box = [cx, cy, maxW, maxH]. */
export function fitBox(slot, w, h) {
  const [cx, cy, mw, mh] = slot.box;
  let s;
  if (slot.fit === 'area' && slot.area) {
    s = Math.sqrt(slot.area / (w * h));
    s = Math.min(s, mw / w, mh / h);
  } else {
    s = Math.min(mw / w, mh / h);
  }
  const dw = w * s, dh = h * s;
  if (slot.anchor === 'bottom') return [cx - dw / 2, cy + mh / 2 - dh, dw, dh]; // e.g. player photos stand on the panel's bottom edge
  return [cx - dw / 2, cy - dh / 2, dw, dh];
}

function silhouette(img, w, h, color) {
  const c = mkCanvas(Math.ceil(w), Math.ceil(h));
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, w, h);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

function roundRectPath(g, [x0, y0, x1, y1], r) {
  g.moveTo(x0 + r, y0); g.arcTo(x1, y0, x1, y1, r); g.arcTo(x1, y1, x0, y1, r); g.arcTo(x0, y1, x0, y0, r); g.arcTo(x0, y0, x1, y0, r); g.closePath();
}

/** A rounded frame (fill + border) that holds an optional picture, e.g. the MKOSZ photo frame / QR frame. box = [cx, cy, w, h]. */
function drawFramed(ctx, el, v, assets, report) {
  const [cx, cy, w, h] = el.box, x0 = cx - w / 2, y0 = cy - h / 2, x1 = x0 + w, y1 = y0 + h;
  report.boxes[el.id] = [x0, y0, w, h];
  const sw = el.sw ?? 6, r = Math.min(el.r ?? 18, w / 2, h / 2);
  const fill = v.fill !== undefined ? v.fill : el.fill;
  const tex = el.texture && assets.images['tex/' + el.texture];
  ctx.save();
  ctx.globalAlpha = (el.useBase && assets.baseOpacity != null ? assets.baseOpacity : el.opacity) ?? 1; // panels follow the "base opacity" slider
  if (tex && fill !== '') { // the court: its upper and lower edge sit on the frame's upper and lower border, centred on the frame's axes; if the frame is wider than that, the court grows to cover it (aspect ratio always locked)
    ctx.save(); ctx.beginPath(); roundRectPath(ctx, [x0, y0, x1, y1], r); ctx.clip();
    const k = Math.max(h / tex.height, w / tex.width);
    ctx.drawImage(tex, cx - tex.width * k / 2, cy - tex.height * k / 2, tex.width * k, tex.height * k);
    ctx.restore();
  } else if (fill) { ctx.beginPath(); roundRectPath(ctx, [x0, y0, x1, y1], r); ctx.fillStyle = fill; ctx.fill(); }
  const img = v.src ? assets.images[v.src] : null;
  if (img) {
    const pad = sw + (v.pad ?? el.pad ?? 0);
    const ix = x0 + pad, iy = y0 + pad, iw = w - 2 * pad, ih = h - 2 * pad;
    if (iw > 0 && ih > 0) {
      const fit = v.fit || el.fit || 'contain';
      const s = (fit === 'cover' ? Math.max(iw / img.width, ih / img.height) : Math.min(iw / img.width, ih / img.height)) * (v.zoom > 0 ? v.zoom : 1);
      const dw = img.width * s, dh = img.height * s;
      ctx.save();
      ctx.beginPath(); roundRectPath(ctx, [ix, iy, ix + iw, iy + ih], Math.max(r - pad, 0)); ctx.clip();
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, ix + iw / 2 - dw / 2 + (v.px || 0), iy + ih / 2 - dh / 2 + (v.py || 0), dw, dh);
      ctx.restore();
    }
  }
  if (sw > 0 && el.stroke) {
    ctx.beginPath(); roundRectPath(ctx, [x0 + sw / 2, y0 + sw / 2, x1 - sw / 2, y1 - sw / 2], Math.max(r - sw / 2, 0));
    ctx.lineWidth = sw; ctx.strokeStyle = el.stroke; ctx.stroke();
  }
  ctx.restore();
}

function drawImage(ctx, el, v, assets, report, inner) {
  const img = assets.images[v.src];
  if (!img) return;
  const [x, y, w, h] = fitBox(el, img.width, img.height);
  report.boxes[el.id] = [x, y, w, h];
  let outline = v.outline !== undefined ? v.outline
    : (el.outlineBySrc && v.src in el.outlineBySrc) ? el.outlineBySrc[v.src]
      : el.logoOutline ? (assets.outlines?.[v.src] || null) : (el.outline || null);
  if (outline && el.maxOutline !== undefined && outline.size > el.maxOutline) outline = { ...outline, size: el.maxOutline };
  const layer = mkCanvas(ctx.canvas.width, ctx.canvas.height);
  const g = layer.getContext('2d');
  g.imageSmoothingQuality = 'high';
  if (outline && outline.size > 0) {
    const sil = silhouette(img, w, h, outline.color);
    const r = outline.size;
    const dx = outline.dx || 0, dy = outline.dy || 0;
    // dilation: stamp the silhouette around a disc of radius r
    for (let a = 0; a < 360; a += 10) {
      for (const rr of [r, r * 0.66, r * 0.33]) {
        const rad = (a * Math.PI) / 180;
        g.drawImage(sil, x + dx + Math.cos(rad) * rr, y + dy + Math.sin(rad) * rr, w, h);
      }
    }
  }
  g.drawImage(img, x, y, w, h);
  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

/**
 * Sets the opacity of the base graphic (court + panel). The PSDs differ (95 %, 98.8 %, 100 %);
 * `base` is the wanted opacity (0–1). Only pixels inside the panel are changed, so the logo strip
 * under the panel keeps its own opacity. base == null keeps the PSD's native opacity.
 */
export function applyBaseOpacity(ctx, template, base) {
  if (template.elements?.some(e => e.id === 'panel' && e.type === 'framed')) return; // the panel shape follows the opacity itself (drawFramed)
  const p = template.panel;
  if (base === null || base === undefined || !p) return;
  const f = base / p.alpha;
  if (Math.abs(f - 1) < 1e-6) return;
  const x0 = Math.max(0, p.box[0]), y0 = Math.max(0, p.box[1]);
  const x1 = Math.min(template.width, p.box[2]), y1 = Math.min(template.height, p.box[3]);
  const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) if (d[i]) d[i] = Math.min(255, Math.round(d[i] * f));
  ctx.putImageData(img, x0, y0);
}

/**
 * values: { [elementId]: {text?, color?, src?, visible?, outline?, runs?} }
 * assets: { background, images: {key: image}, outlines: {logoKey: {size,color,dx,dy}} }
 * Returns a report of elements that were shrunk or could not fit.
 */
export function render(canvas, template, values, assets) {
  canvas.width = template.width;
  canvas.height = template.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // base graphic (court + panel) with its opacity, on its own canvas so that the whole graphic can be moved / scaled
  let bgLayer = null;
  if (assets.background) {
    bgLayer = mkCanvas(template.width, template.height);
    const bctx = bgLayer.getContext('2d');
    bctx.drawImage(assets.background, 0, 0, template.width, template.height);
    applyBaseOpacity(bctx, template, assets.baseOpacity);
  }
  const G = values.__global || {};
  let gs = G.scale > 0 ? G.scale : 1, gdx = G.dx || 0, gdy = G.dy || 0;
  // keep the panel out of the broadcaster's score bug zone (assets.safeZone): the smallest shift / scale, folded into the global transform
  let fit = null;
  const pel = assets.safeZone && template.elements.find(e => e.id === 'panel' && e.type === 'framed');
  const psd = assets.safeZone && !pel && template.panel?.box; // designs without a frame shape (e.g. referees): the PSD's panel area
  if (pel || psd) {
    let cx, cy, w, h;
    if (pel) {
      const pv = values.panel || {}, e0 = pv.geom ? { ...pel, ...pv.geom } : pel, k = pv.scale > 0 ? pv.scale : 1, [pcx, pcy, pw, ph] = e0.box;
      w = (pv.w > 0 ? pv.w : pw) * k; h = (pv.h > 0 ? pv.h : ph) * k; cx = pcx + (pv.dx || 0); cy = pcy + (pv.dy || 0);
    } else { w = psd[2] - psd[0]; h = psd[3] - psd[1]; cx = (psd[0] + psd[2]) / 2; cy = (psd[1] + psd[3]) / 2; }
    const W = template.width, H = template.height, X = x => (x - W / 2) * gs + W / 2 + gdx, Y = y => (y - H / 2) * gs + H / 2 + gdy;
    fit = safeFit([X(cx - w / 2), Y(cy - h / 2), X(cx + w / 2), Y(cy + h / 2)], assets.safeZone);
    if (fit) { const g2 = foldFit({ dx: gdx, dy: gdy, scale: gs }, fit, W, H); gs = g2.scale; gdx = g2.dx; gdy = g2.dy; }
  }
  // content move / scale: everything inside the frame moves, the frame (background + outline) stays; the photo may be excluded
  const C = values.__content || {};
  const cs = C.scale > 0 ? C.scale : 1, cdx = C.dx || 0, cdy = C.dy || 0;
  const pb = template.panel?.box;
  const ccx = pb ? (pb[0] + pb[2]) / 2 : template.width / 2, ccy = pb ? (pb[1] + pb[3]) / 2 : template.height / 2;
  const contentOn = cs !== 1 || cdx !== 0 || cdy !== 0;
  const report = { overflow: [], scaled: [], sizes: {}, boxes: {}, global: { dx: gdx, dy: gdy, scale: gs }, fit, content: { dx: cdx, dy: cdy, scale: cs, cx: ccx, cy: ccy, photo: C.photo !== false } };
  ctx.save();
  ctx.translate(template.width / 2 + gdx, template.height / 2 + gdy);
  ctx.scale(gs, gs);
  ctx.translate(-template.width / 2, -template.height / 2);
  let liveInner = template.inner;
  const staticsOnTop = !!bgLayer && !!template.staticsOnTop; // fixed texts / logos of the PSD are drawn over the (shape) panel
  if (bgLayer && !staticsOnTop) ctx.drawImage(bgLayer, 0, 0);
  for (const base of template.elements) {
    const v = values[base.id] || {};
    let el = v.geom ? { ...base, ...v.geom } : base;
    // manual font size (px) of text
    if (el.type === 'text' && v.size > 0) {
      const k = v.size / el.size;
      el = { ...el, size: v.size, lineHeight: el.lineHeight ? el.lineHeight * k : undefined, fitLocked: true };
    }
    // manual move (px) and image scale from the layout editor
    if (el.type === 'text' && (v.dx || v.dy)) el = { ...el, x: el.x + (v.dx || 0), y: el.y + (v.dy || 0) };
    if (el.type === 'image' && el.stand > 0) { // stands on the panel's bottom edge at a default height (px); the layout editor scale grows it upwards, dx / dy move it
      const innerH = liveInner?.box ? liveInner.box[3] - liveInner.box[1] : Infinity, k = v.scale > 0 ? v.scale : 1, H = Math.min(el.stand, innerH) * k, bottom = (liveInner?.box?.[3] ?? template.height - 10) + (v.dy || 0);
      el = { ...el, box: [el.box[0] + (v.dx || 0), bottom - H / 2, (el.wide || el.box[2]) * k, H], area: undefined };
    } else if (el.type === 'image' && (v.dx || v.dy || (v.scale > 0 && v.scale !== 1))) {
      const k = v.scale > 0 ? v.scale : 1;
      const [cx, cy, mw, mh] = el.box;
      el = { ...el, box: [cx + (v.dx || 0), cy + (v.dy || 0), mw * k, mh * k], area: el.area ? el.area * k * k : el.area };
    }
    if (el.type === 'framed' && (v.dx || v.dy || v.w > 0 || v.h > 0 || (v.scale > 0 && v.scale !== 1))) {
      const k = v.scale > 0 ? v.scale : 1, [cx, cy, mw, mh] = el.box;
      el = { ...el, box: [cx + (v.dx || 0), cy + (v.dy || 0), (v.w > 0 ? v.w : mw) * k, (v.h > 0 ? v.h : mh) * k] };
    }
    if (el.compactWith) {
      const rv = values[el.compactWith] || {};
      const re = template.elements.find(e => e.id === el.compactWith);
      el = { ...el, rankOn: (rv.visible ?? re?.visible ?? true) && (rv.text ?? '') !== '' };
    }
    const visible = v.visible ?? el.visible ?? true;
    if (!visible) continue;
    if (el.id === 'panel' && el.type === 'framed') { const [pcx, pcy, pw, ph] = el.box, sw = el.sw ?? 0; liveInner = { box: [pcx - pw / 2 + sw, pcy - ph / 2 + sw, pcx + pw / 2 - sw, pcy + ph / 2 - sw], r: Math.max((el.r ?? 0) - sw, 0) }; } // photos stay inside the (resized) panel
    const clip = el.clipInner && liveInner; // the panel's outline is untouchable: the clip stays put even when the content moves
    if (clip) { ctx.save(); ctx.beginPath(); roundRectPath(ctx, template.inner.box, template.inner.r); ctx.clip(); }
    const moved = contentOn && !el.fixedFrame && (el.id !== 'photo' || C.photo !== false);
    if (moved) { ctx.save(); ctx.translate(ccx + cdx, ccy + cdy); ctx.scale(cs, cs); ctx.translate(-ccx, -ccy); }
    if (el.type === 'text') drawText(ctx, el, v, report);
    else if (el.type === 'image') drawImage(ctx, el, v, assets, report, template.inner);
    else if (el.type === 'framed') drawFramed(ctx, el, v, assets, report);
    if (moved) ctx.restore();
    if (clip) ctx.restore();
    if (staticsOnTop && el.id === 'panel') ctx.drawImage(bgLayer, 0, 0);
  }
  ctx.restore();
  return report;
}

/** logos.json (extracted from the logo sheets) → {key: {size, color, dx, dy}} */
export function logoOutlines(json) {
  const out = {};
  for (const [k, v] of Object.entries(json)) {
    const o = v.outline;
    if (!o || !o.size) continue;
    const a = ((o.useGlobalAngle ? 90 : o.angle) * Math.PI) / 180;
    out[k] = { size: o.size, color: o.color, dx: -(o.distance || 0) * Math.cos(a), dy: (o.distance || 0) * Math.sin(a) };
  }
  return out;
}
