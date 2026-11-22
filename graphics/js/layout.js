// Layout = the operator's manual changes of a graphic: per element a move (dx, dy in px), a font size (text)
// or a scale (images), plus one entry '__global' that moves / scales the whole graphic.
// Effective layout of an element = benchmark ("alap", saved) overridden by the unsaved changes of the session.
// A key that is present in the session changes wins even when it is 0 (that is how a benchmark value is cancelled).

export const KEYS = ['dx', 'dy', 'size', 'scale', 'w', 'h']; // w / h: free width / height (px) of framed shapes (0 = the template's own)
export const GLOBAL = '__global';
// '__content' moves / scales everything inside the frame (all elements, optionally not the photo); the frame (background + outline) stays
export const CONTENT = '__content';

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Only the layout keys of an override entry. */
export function pick(o) {
  const r = {};
  if (!o) return r;
  for (const k of KEYS) if (num(o[k]) !== undefined) r[k] = o[k];
  return r;
}

/** benchmark = { items: { [id]: {dx,dy,size,scale} } } or null; ov = overrides of the template. */
export function effective(bench, ov, id) {
  return { ...pick(bench?.items?.[id]), ...pick(ov?.[id]) };
}

/** Does this layout entry change anything compared to the PSD? */
export function meaningful(e) {
  return !!e && ((e.dx || 0) !== 0 || (e.dy || 0) !== 0 || e.size > 0 || (e.scale > 0 && e.scale !== 1) || e.w > 0 || e.h > 0);
}

/** The complete effective layout of a template, ready to be saved: only entries that differ from the PSD. */
export function extract(template, bench, ov) {
  const items = {};
  for (const id of [...template.elements.map(e => e.id), GLOBAL, CONTENT]) {
    const e = effective(bench, ov, id);
    if (!meaningful(e)) continue;
    const c = {}; // compact: only the keys that differ from the PSD
    if (e.dx) c.dx = e.dx;
    if (e.dy) c.dy = e.dy;
    if (e.size > 0) c.size = e.size;
    if (e.scale > 0 && e.scale !== 1) c.scale = e.scale;
    if (e.w > 0) c.w = e.w;
    if (e.h > 0) c.h = e.h;
    items[id] = c;
  }
  return { items };
}

/** Remove the layout keys from the session overrides (other overrides – text, colour, visibility – stay). */
export function dropLayoutKeys(ov) {
  for (const id of Object.keys(ov)) {
    for (const k of KEYS) delete ov[id][k];
    if (!Object.keys(ov[id]).length) delete ov[id];
  }
}

/**
 * Make `layout` the effective layout by writing explicit session values: entries of the benchmark that the
 * layout does not mention are cancelled with explicit zeros, so the result equals the layout exactly.
 */
export function applyToOverrides(ov, layout, bench) {
  const ids = new Set([...Object.keys(layout?.items || {}), ...Object.keys(bench?.items || {})]);
  for (const id of ids) {
    const item = layout?.items?.[id];
    const cancel = { dx: 0, dy: 0, size: 0, scale: 1, w: 0, h: 0 };
    ov[id] = { ...(ov[id] || {}), ...(item ? { ...cancel, ...pick(item) } : cancel) };
  }
}

/** Snap a value to the nearest candidate (PSD position = 0, benchmark position) within the threshold. */
export function snap(value, candidates, threshold = 6) {
  let best = value, d = threshold + 1;
  for (const c of candidates) {
    const dist = Math.abs(value - c);
    if (dist <= threshold && dist < d) { best = c; d = dist; }
  }
  return best;
}

/** Number of elements with unsaved layout changes in the session. */
export function unsavedCount(ov) {
  return Object.values(ov || {}).filter(o => KEYS.some(k => num(o?.[k]) !== undefined)).length;
}

/** Position of a template-space box on the canvas after the content move / scale (c, optional) and the global one (for the editor overlay). */
export function toCanvas(box, g, w = 1920, h = 1080, c = null) {
  let [x, y, bw, bh] = box;
  if (c) {
    const k = c.scale > 0 ? c.scale : 1;
    x = (x - c.cx) * k + c.cx + (c.dx || 0); y = (y - c.cy) * k + c.cy + (c.dy || 0); bw *= k; bh *= k;
  }
  const gs = g?.scale > 0 ? g.scale : 1, gdx = g?.dx || 0, gdy = g?.dy || 0;
  return [(x - w / 2) * gs + w / 2 + gdx, (y - h / 2) * gs + h / 2 + gdy, bw * gs, bh * gs];
}
