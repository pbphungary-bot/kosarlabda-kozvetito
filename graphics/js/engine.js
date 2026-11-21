// Deterministic Canvas 2D renderer for the broadcast templates.
// render(canvas, template, values, assets) draws the template's background 1:1
// and every element at the PSD's pixel geometry. Same inputs → same pixels.
//
// Effects: every layer effect in the source PSDs is a Photoshop "drop shadow"
// with 100% spread (a hard outline of `size` px, offset by `distance` px at the
// document's global angle 0° → shifted 1 px to the left). That is reproduced
// exactly as a dilated silhouette drawn behind the element.

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
    setup(ctx, style, size);
    const o = style.outline;
    const ox = outlineOnly ? (o.dx || 0) : 0, oy = outlineOnly ? (o.dy || 0) : 0;
    ctx.save();
    ctx.translate(cx + ox, y + oy);
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

function drawText(ctx, el, v, report) {
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
    const shaped = runs.map((r, k) => ({ ...r, text: runsText[k] }));
    const w = shaped.reduce((a, r) => a + measure(ctx, style, r.text, sz), 0)
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
  return [cx - dw / 2, cy - dh / 2, dw, dh];
}

function silhouette(img, w, h, color) {
  const c = new OffscreenCanvas(Math.ceil(w), Math.ceil(h));
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, w, h);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

function drawImage(ctx, el, v, assets, report) {
  const img = assets.images[v.src];
  if (!img) return;
  const [x, y, w, h] = fitBox(el, img.width, img.height);
  report.boxes[el.id] = [x, y, w, h];
  let outline = v.outline !== undefined ? v.outline
    : (el.outlineBySrc && v.src in el.outlineBySrc) ? el.outlineBySrc[v.src]
      : el.logoOutline ? (assets.outlines?.[v.src] || null) : (el.outline || null);
  if (outline && el.maxOutline !== undefined && outline.size > el.maxOutline) outline = { ...outline, size: el.maxOutline };
  const layer = new OffscreenCanvas(ctx.canvas.width, ctx.canvas.height);
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
    bgLayer = new OffscreenCanvas(template.width, template.height);
    const bctx = bgLayer.getContext('2d');
    bctx.drawImage(assets.background, 0, 0, template.width, template.height);
    applyBaseOpacity(bctx, template, assets.baseOpacity);
  }
  const G = values.__global || {};
  const gs = G.scale > 0 ? G.scale : 1, gdx = G.dx || 0, gdy = G.dy || 0;
  const report = { overflow: [], scaled: [], sizes: {}, boxes: {}, global: { dx: gdx, dy: gdy, scale: gs } };
  ctx.save();
  ctx.translate(template.width / 2 + gdx, template.height / 2 + gdy);
  ctx.scale(gs, gs);
  ctx.translate(-template.width / 2, -template.height / 2);
  if (bgLayer) ctx.drawImage(bgLayer, 0, 0);
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
    if (el.type === 'image' && (v.dx || v.dy || (v.scale > 0 && v.scale !== 1))) {
      const k = v.scale > 0 ? v.scale : 1;
      const [cx, cy, mw, mh] = el.box;
      el = { ...el, box: [cx + (v.dx || 0), cy + (v.dy || 0), mw * k, mh * k], area: el.area ? el.area * k * k : el.area };
    }
    if (el.compactWith) {
      const rv = values[el.compactWith] || {};
      const re = template.elements.find(e => e.id === el.compactWith);
      el = { ...el, rankOn: (rv.visible ?? re?.visible ?? true) && (rv.text ?? '') !== '' };
    }
    const visible = v.visible ?? el.visible ?? true;
    if (!visible) continue;
    if (el.type === 'text') drawText(ctx, el, v, report);
    else if (el.type === 'image') drawImage(ctx, el, v, assets, report);
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
