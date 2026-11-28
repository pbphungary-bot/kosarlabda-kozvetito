// Webshop insert (title plate + QR code + a phone that shows a slideshow of photos and short videos): the timeline.
// Pure functions of time (no DOM, no clock): the same t always gives the same picture, so the preview, the video export and the tests agree.
// Phases of one loop: plate + QR slide in → the phone arrives → every slide (cross-fade) → the phone leaves → plate + QR fade out.
// A slide is a photo { src, name } or a video { kind: 'video', vid, name, vdur }; `dur` (optional) is the operator's own seconds for that slide.
// The whole loop can be given a fixed length (cfg.total): the slides' times are then scaled to fill exactly that.

export const WEBSHOP_DEFAULTS = {
  title: { mode: 'text', line1: 'HUNBASKET', line2: 'WEBSHOP', c1: '#a3191f', c2: '#0b6b3a', image: null, icon: null },
  qr: { image: null },
  photos: [], // the slides, in order: [{ src, name, dur? }] photos, [{ kind: 'video', vid, name, vdur, dur? }] videos
  hold: 2, // seconds per photo (unless the slide has its own)
  videoMax: 6, // a video plays at most this many seconds (unless the slide has its own)
  total: 0, // length of the whole loop in seconds; 0 = automatic (the sum of the parts)
  fade: 0.4, // cross-fade seconds between slides
  tilt: true, // the phone sways a little while it shows a slide
  motion: 'rotate', // how the phone arrives / leaves: 'rotate' (turns in from the side, like the sample) | 'slide' (slides up from below the picture edge)
  x: 244, y: 165, scale: 100, // column centre x, top of the plate (px of 1920×1080), size of everything in %
  sPlate: 100, sQr: 100, sPhone: 100, // size of the title plate / the QR tile / the phone, each in % (the column re-stacks itself)
  bg: 'transparent', // background of the video export: transparent (VP9 WebM with alpha, for OBS) | magenta | green (key colours)
};

export const SLIDE_DIST = 700; // px the phone travels below its place when it is off screen (motion 'slide')
export const T = { plateIn: 0.5, qrIn: 0.5, qrDelay: 0.3, phoneIn: 1.2, phoneDelay: 0.8, phoneOut: 0.9, plateOut: 0.4, tail: 0.7 };
/** Seconds of one loop that are not slides (the plate / QR / phone coming and going). */
export const OVERHEAD = T.phoneDelay + T.phoneIn + T.phoneOut + T.plateOut + T.tail;
export const MIN_SLIDE = 0.3;

const clamp01 = x => Math.max(0, Math.min(1, x));
const easeOut = x => 1 - Math.pow(1 - clamp01(x), 3);
const easeInOut = x => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };

/** Number of slide slots (an empty slideshow still shows the phone with a blank screen for one hold). */
export const slots = cfg => Math.max(1, (cfg.photos || []).length);

/** Seconds a slide would run on its own: the operator's number, else a photo's hold / a video's own length (at most videoMax). */
export function baseSeconds(p, cfg) {
  const own = +(p && p.dur);
  if (own > 0) return Math.max(MIN_SLIDE, own);
  if (p && p.kind === 'video') return Math.max(MIN_SLIDE, Math.min(+p.vdur > 0 ? +p.vdur : +cfg.videoMax || 6, +cfg.videoMax > 0 ? +cfg.videoMax : 6));
  return Math.max(0.5, +cfg.hold || 2);
}

/** Phase boundaries in seconds (+ the total loop length, + whether a requested total length fits at all). */
export function timeline(cfg) {
  const list = cfg.photos && cfg.photos.length ? cfg.photos : [{}];
  const base = list.map(p => baseSeconds(p, cfg)), sum = base.reduce((a, b) => a + b, 0), want = +cfg.total;
  let durs = base, fits = true;
  if (want > 0) { // fixed total: the slides share what is left after the plate / phone coming and going
    const room = want - OVERHEAD, k = room / sum;
    durs = base.map(b => Math.max(MIN_SLIDE, b * k));
    fits = room >= MIN_SLIDE * list.length - 1e-9;
  }
  const starts = []; let acc = 0; for (const d of durs) { starts.push(acc); acc += d; }
  const phoneStart = T.phoneDelay, showStart = phoneStart + T.phoneIn, showEnd = showStart + acc, outEnd = showEnd + T.phoneOut;
  return { hold: Math.max(0.5, +cfg.hold || 2), durs, starts, phoneStart, showStart, showEnd, outEnd, total: outEnd + T.plateOut + T.tail, fits, minTotal: OVERHEAD + MIN_SLIDE * list.length };
}

/**
 * What is on screen at time t (the loop repeats after `total`).
 * plate {a, dx}, qr {a, dy}, phone {a, ang (rad, 0 = front), dx, dy, sway (rad)},
 * photo {i, j, mix, li, lj}: slide i fades into slide j (mix 0..1); li / lj = seconds into slide i / j (what a video has to show).
 */
export function stateAt(tRaw, cfg) {
  const tl = timeline(cfg), t = ((tRaw % tl.total) + tl.total) % tl.total;
  const plateIn = easeOut(t / T.plateIn), plateOut = 1 - clamp01((t - tl.outEnd) / T.plateOut);
  const qrIn = easeOut((t - T.qrDelay) / T.qrIn);
  const a = Math.min(plateOut, 1);
  const enter = easeOut((t - tl.phoneStart) / T.phoneIn), leave = easeInOut((t - tl.showEnd) / T.phoneOut);
  // 'rotate': the phone arrives edge-on, shows its back first (angle 200° → 0°) and leaves by turning away again (0° → -150°)
  // 'slide': it stays front-on, rises from below the picture edge and sinks back the same way
  const slide = cfg.motion === 'slide';
  const ang = slide ? 0 : (200 * (1 - enter) - 150 * leave) * Math.PI / 180;
  const visible = t >= tl.phoneStart && t < tl.outEnd;
  const sway = cfg.tilt === false || t < tl.showStart || t >= tl.showEnd ? 0 : Math.sin((t - tl.showStart) * 1.3) * 0.035;
  const n = tl.durs.length, ts = Math.max(0, Math.min(t, tl.showEnd) - tl.showStart);
  let i = 0;
  while (i + 1 < n && ts >= tl.starts[i + 1]) i++; // before the show starts: the first slide; after it: the last one
  const into = ts - tl.starts[i], dur = tl.durs[i];
  const j = i + 1 < n ? i + 1 : i; // the last slide does not fade into anything
  const fade = Math.min(Math.max(0.05, +cfg.fade || 0), dur / 2, tl.durs[j] / 2);
  const mix = j === i || t >= tl.showEnd ? 0 : clamp01((into - (dur - fade)) / fade);
  return {
    t, total: tl.total,
    plate: { a: a * plateIn, dx: -(1 - plateIn) * 260 },
    qr: { a: a * qrIn, dy: -(1 - qrIn) * 40 },
    phone: { a: visible ? 1 : 0, ang, dx: slide ? 0 : -(1 - enter) * 230 - leave * 230, dy: slide ? ((1 - enter) + leave) * SLIDE_DIST : 0, sway },
    photo: { i, j, mix, li: into, lj: Math.max(0, into - (dur - fade)) },
  };
}

/** Where the three parts of the column sit (px, before the overall scale): each has its own size, the column stacks itself with the gaps of the sample. */
export function columnLayout(cfg) {
  const k = v => Math.max(0.2, Math.min(3, (+v || 100) / 100));
  const sp = k(cfg.sPlate), sq = k(cfg.sQr), sh = k(cfg.sPhone), top = +cfg.y;
  const plateH = 115 * sp, qrH = 175 * sq, phoneH = 476 * sh;
  const qrTop = top + plateH + 18, phoneTop = qrTop + qrH + 57;
  return { sp, sq, sh, plateTop: top, qrTop, phoneCy: phoneTop + phoneH / 2 };
}
