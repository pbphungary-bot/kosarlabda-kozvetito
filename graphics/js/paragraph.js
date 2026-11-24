// Paragraph text of the coach graphic (the interview quote): paragraphs are wrapped independently, the text can be set in the PSD's small caps
// (lower-case letters drawn as smaller capitals) or in plain capitals, and the size shrinks until the text fits the box height.
// Pure logic: the caller (engine.js) supplies `width(text, size)` = the width of a string as drawn.

export const SMALL_CAPS = 0.8; // Photoshop's small caps scale
const upper = s => String(s ?? '').toLocaleUpperCase('hu-HU');

/** Small caps: consecutive letters of the same kind become one run; a lower-case letter is drawn as its capital at `sc` x the size. */
export function capRuns(word, sc = SMALL_CAPS) {
  const out = [];
  for (const ch of String(word)) {
    const low = ch !== upper(ch); // a letter that has a capital form = lower case
    const t = low ? upper(ch) : ch, f = low ? sc : 1, last = out.at(-1);
    if (last && last.f === f) last.text += t; else out.push({ text: t, f });
  }
  return out;
}

/** Runs of one word: 'smallcaps' (PSD look), 'caps' (all capitals, one size) or 'plain'. */
export function wordRuns(word, mode, sc = SMALL_CAPS) {
  if (mode === 'smallcaps') return capRuns(word, sc);
  return [{ text: mode === 'caps' ? upper(word) : String(word), f: 1 }];
}

/** Greedy word wrap of every paragraph (a line break in the text starts a new paragraph; an empty line stays empty). Returns [{ runs, w }]. */
export function wrapParagraphs(text, mode, size, maxW, width, sc = SMALL_CAPS) {
  const paras = String(text ?? '').replace(/\r/g, '').split('\n');
  const spaceW = width(' ', size);
  const lines = [];
  for (const p of paras) {
    const words = p.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push({ runs: [], w: 0 }); continue; }
    let cur = [], curW = 0;
    for (const word of words) {
      const runs = wordRuns(word, mode, sc), ww = runs.reduce((a, r) => a + width(r.text, size * r.f), 0);
      if (cur.length && curW + spaceW + ww > maxW) { lines.push({ runs: cur, w: curW }); cur = []; curW = 0; }
      if (cur.length) { cur.push({ text: ' ', f: 1 }); curW += spaceW; }
      cur.push(...runs); curW += ww;
    }
    lines.push({ runs: cur, w: curW });
  }
  return lines;
}

/**
 * The largest size (down to `minScale` x) at which the wrapped text fits `maxH`. Returns { s, lines, overflow }: s = scale of `size` / `lineH`,
 * overflow = it does not fit even at the smallest size. `locked` keeps s = 1 (a size chosen by hand is never shrunk, only reported).
 */
export function fitParagraphs(text, mode, size, maxW, maxH, lineH, width, { minScale = 0.45, step = 0.97, sc = SMALL_CAPS, locked = false } = {}) {
  let s = 1, lines = wrapParagraphs(text, mode, size, maxW, width, sc);
  if (!locked) {
    while (lines.length * lineH * s > maxH && s > minScale) {
      s = Math.max(minScale, s * step);
      lines = wrapParagraphs(text, mode, size * s, maxW, width, sc);
    }
  }
  return { s, lines, overflow: lines.length * lineH * s > maxH + 0.5 };
}
