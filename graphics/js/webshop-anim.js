// Webshop insert (title plate + QR code + a phone that shows a photo slideshow): the timeline.
// Pure functions of time (no DOM, no clock): the same t always gives the same picture, so the preview, the video export and the tests agree.
// Phases of one loop: plate + QR slide in → the phone tumbles in → every photo (hold s, cross-fade) → the phone spins out → plate + QR fade out.

export const WEBSHOP_DEFAULTS = {
  title: { mode: 'text', line1: 'HUNBASKET', line2: 'WEBSHOP', c1: '#a3191f', c2: '#0b6b3a', image: null, icon: null },
  qr: { image: null },
  photos: [], // [{ src: dataURL, name }]
  hold: 2, // seconds per photo
  fade: 0.4, // cross-fade seconds between photos
  tilt: true, // the phone sways a little while it shows a photo
  motion: 'rotate', // how the phone arrives / leaves: 'rotate' (turns in from the side, like the sample) | 'slide' (slides up from below the picture edge)
  x: 244, y: 165, scale: 100, // column centre x, top of the plate (px of 1920×1080), size in %
  bg: 'magenta', // key colour of the video export: magenta | green | transparent (PNG only)
};

export const SLIDE_DIST = 700; // px the phone travels below its place when it is off screen (motion 'slide')
export const T = { plateIn: 0.5, qrIn: 0.5, qrDelay: 0.3, phoneIn: 1.2, phoneDelay: 0.8, phoneOut: 0.9, plateOut: 0.4, tail: 0.7 };

const clamp01 = x => Math.max(0, Math.min(1, x));
const easeOut = x => 1 - Math.pow(1 - clamp01(x), 3);
const easeInOut = x => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };

/** Number of photo slots (an empty slideshow still shows the phone with a blank screen for one hold). */
export const slots = cfg => Math.max(1, (cfg.photos || []).length);

/** Phase boundaries in seconds (+ the total loop length). */
export function timeline(cfg) {
  const hold = Math.max(0.5, +cfg.hold || 2);
  const phoneStart = T.phoneDelay, showStart = phoneStart + T.phoneIn;
  const showEnd = showStart + slots(cfg) * hold;
  const outEnd = showEnd + T.phoneOut;
  return { hold, phoneStart, showStart, showEnd, outEnd, total: outEnd + T.plateOut + T.tail };
}

/**
 * What is on screen at time t (the loop repeats after `total`).
 * plate {a, dx}, qr {a, dy}, phone {a, ang (rad, 0 = front), dx, dy, sway (rad)}, photo {i, j, mix} (i fades into j; mix 0..1).
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
  const n = slots(cfg), ts = t - tl.showStart;
  let i = 0, j = 0, mix = 0;
  if (ts > 0 && t < tl.showEnd) {
    i = Math.min(n - 1, Math.floor(ts / tl.hold));
    const into = ts - i * tl.hold, fade = Math.min(Math.max(0.05, +cfg.fade || 0), tl.hold / 2);
    j = i + 1 < n ? i + 1 : i; // the last photo does not fade into anything
    mix = j === i ? 0 : clamp01((into - (tl.hold - fade)) / fade);
  }
  return {
    t, total: tl.total,
    plate: { a: a * plateIn, dx: -(1 - plateIn) * 260 },
    qr: { a: a * qrIn, dy: -(1 - qrIn) * 40 },
    phone: { a: visible ? 1 : 0, ang, dx: slide ? 0 : -(1 - enter) * 230 - leave * 230, dy: slide ? ((1 - enter) + leave) * SLIDE_DIST : 0, sway },
    photo: { i, j, mix },
  };
}
