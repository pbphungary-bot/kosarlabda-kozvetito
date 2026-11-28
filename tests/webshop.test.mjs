import test from 'node:test';
import assert from 'node:assert/strict';
import { WEBSHOP_DEFAULTS, stateAt, timeline, slots, T, OVERHEAD, columnLayout, baseSeconds, objSize, migrateSizes, rgba, BASE } from '../graphics/js/webshop-anim.js';

const cfg = (over = {}) => ({ ...JSON.parse(JSON.stringify(WEBSHOP_DEFAULTS)), ...over });
const photos = n => Array.from({ length: n }, (_, i) => ({ src: 'x' + i }));

test('webshop: the loop length follows the number of photos (8 photos × 2 s ≈ the 20 s of the sample)', () => {
  const tl = timeline(cfg({ photos: photos(8) }));
  assert.ok(Math.abs(tl.total - 20) < 0.05, tl.total);
  assert.equal(slots(cfg()), 1, 'no photo: one blank hold, the phone still appears');
  assert.ok(timeline(cfg({ photos: photos(3), hold: 4 })).total > timeline(cfg({ photos: photos(3) })).total);
  assert.ok(timeline(cfg({ hold: 0 })).hold >= 0.5, 'a silly hold is clamped');
});
test('webshop: the picture is a pure function of time and the loop repeats', () => {
  const c = cfg({ photos: photos(4) }), total = timeline(c).total;
  assert.deepEqual(stateAt(3.3, c), stateAt(3.3, c));
  assert.deepEqual(stateAt(3.3, c).photo, stateAt(3.3 + total, c).photo);
  assert.deepEqual(stateAt(-1, c).phone, stateAt(total - 1, c).phone);
});
test('webshop: plate and QR slide in, the phone arrives after them and everything is gone at the end of the loop', () => {
  const c = cfg({ photos: photos(2) }), tl = timeline(c);
  const s0 = stateAt(0, c); assert.equal(s0.plate.a, 0); assert.equal(s0.phone.a, 0);
  const s1 = stateAt(T.plateIn + 0.01, c); assert.ok(s1.plate.a > 0.95 && s1.qr.a > 0);
  assert.equal(stateAt(tl.showStart + 0.1, c).phone.a, 1);
  const end = stateAt(tl.total - 0.01, c); assert.equal(end.plate.a, 0); assert.equal(end.phone.a, 0);
});
test('webshop: photos run in order, each cross-fades into the next, the last one does not fade into anything', () => {
  const c = cfg({ photos: photos(3), hold: 2, fade: 0.5 }), tl = timeline(c);
  const p0 = stateAt(tl.showStart + 0.5, c).photo; assert.deepEqual([p0.i, p0.j, p0.mix], [0, 1, 0]); assert.ok(Math.abs(p0.li - 0.5) < 1e-9, 'seconds into the slide');
  const mid = stateAt(tl.showStart + 1.75, c).photo; assert.equal(mid.i, 0); assert.equal(mid.j, 1); assert.ok(mid.mix > 0.4 && mid.mix < 0.6, mid.mix);
  assert.equal(stateAt(tl.showStart + 2.5, c).photo.i, 1);
  const last = stateAt(tl.showStart + 5.9, c).photo; assert.equal(last.i, 2); assert.equal(last.mix, 0);
});
test('webshop: the phone either turns in from the side or slides up from below (motion)', () => {
  const rot = cfg({ photos: photos(2) }), sl = cfg({ photos: photos(2), motion: 'slide' }), tl = timeline(rot);
  const a = stateAt(tl.phoneStart + 0.05, rot).phone; assert.ok(Math.abs(a.ang) > 2.5, 'starts turned away (back of the phone)'); assert.ok(a.dx < 0 && a.dy === 0);
  assert.equal(stateAt(tl.showStart + 1, rot).phone.ang, 0, 'front-on while the photos run');
  const b = stateAt(tl.phoneStart + 0.05, sl).phone; assert.equal(b.ang, 0); assert.equal(b.dx, 0); assert.ok(b.dy > 500, 'starts below the picture edge');
  const mid = stateAt(tl.showStart + 1, sl).phone; assert.equal(mid.dy, 0, 'in place while the photos run');
  const out = stateAt(tl.showEnd + tl.hold * 0 + 0.8, sl).phone; assert.ok(out.dy > 300, 'sinks back down at the end');
});
test('webshop: the sway can be switched off', () => {
  const c = cfg({ photos: photos(2), tilt: false }), tl = timeline(c);
  assert.equal(stateAt(tl.showStart + 1, c).phone.sway, 0);
  assert.notEqual(stateAt(tl.showStart + 1, cfg({ photos: photos(2) })).phone.sway, 0);
});

const video = (vdur, extra = {}) => ({ kind: 'video', vid: 'v1', name: 'a.mp4', vdur, ...extra });
test('webshop: a video slide runs for its own length (at most videoMax), the operator can give any slide its own seconds', () => {
  const c = cfg({ photos: [{ src: 'a' }, video(3), video(20), { src: 'b', dur: 5 }, video(4, { dur: 1.5 })], hold: 2, videoMax: 6 });
  assert.deepEqual([0, 1, 2, 3, 4].map(i => baseSeconds(c.photos[i], c)), [2, 3, 6, 5, 1.5]);
  const tl = timeline(c); assert.deepEqual(tl.durs, [2, 3, 6, 5, 1.5]); assert.deepEqual(tl.starts, [0, 2, 5, 11, 16]);
  const at = tl.showStart + 5.5; const ph = stateAt(at, c).photo;
  assert.equal(ph.i, 2); assert.ok(Math.abs(ph.li - 0.5) < 1e-9, 'a video is asked for the second it has to show');
  const fadeIn = stateAt(tl.showStart + 2 + 2.8, c).photo; // 0.2 s before the next slide starts: video 1 fades into video 2, which starts at its own 0
  assert.equal(fadeIn.i, 1); assert.equal(fadeIn.j, 2); assert.ok(fadeIn.lj >= 0 && fadeIn.lj < 0.3, fadeIn.lj);
});
test('webshop: a fixed total length scales the slides so that the loop lasts exactly that long', () => {
  const c = cfg({ photos: [{ src: 'a' }, video(4), { src: 'c' }], total: 30 });
  const tl = timeline(c);
  assert.ok(Math.abs(tl.total - 30) < 1e-9 && tl.fits, tl.total);
  assert.ok(Math.abs(tl.durs.reduce((a, b) => a + b, 0) - (30 - OVERHEAD)) < 1e-9, 'the slides fill what is left');
  assert.ok(tl.durs[1] > tl.durs[0], 'proportional: the longer slide stays the longer one');
  assert.equal(timeline(cfg({ photos: [{ src: 'a' }], total: 0 })).total, timeline(cfg({ photos: [{ src: 'a' }] })).total, '0 = automatic');
  const tooShort = timeline(cfg({ photos: photos(8), total: 6 })); assert.equal(tooShort.fits, false); assert.ok(tooShort.total > 6 && tooShort.minTotal > 6);
});
test('webshop: plate, QR and phone each have their own width AND height and the column re-stacks itself', () => {
  const d = columnLayout(cfg());
  assert.deepEqual([d.plateTop, d.qrTop, d.phoneCy], [165, 298, 768], 'default: the positions of the sample');
  assert.deepEqual([d.plate.w, d.plate.h, d.qr.w, d.qr.h, d.phone.w, d.phone.h], [343, 115, 177, 175, 238, 476]);
  const tall = columnLayout(cfg({ plateW: 200, plateH: 250 })); // "200 x 250"
  assert.deepEqual([tall.plate.w, tall.plate.h], [200, 250], 'width and height are independent');
  assert.equal(tall.qrTop, 165 + 250 + 18, 'a taller plate pushes the QR tile down');
  assert.equal(tall.qr.w, 177, 'the other objects are untouched');
  const wide = columnLayout(cfg({ phoneW: 400, phoneH: 300 })); assert.ok(wide.phone.w === 400 && wide.phone.h === 300 && wide.phoneCy === 298 + 175 + 57 + 150);
  assert.deepEqual(objSize(cfg({ qrW: 0, qrH: 'x' }), 'qr'), { w: 177, h: 175 }, 'no / silly value = the default');
  assert.equal(objSize(cfg({ plateW: 99999 }), 'plate').w, 1500); assert.equal(objSize(cfg({ plateH: 3 }), 'plate').h, 20, 'limited to 20–1500 px');
});
test('webshop: settings saved by the earlier version (one % per object) become the same sizes in px', () => {
  const m = migrateSizes({ sPlate: 200, sQr: 50, sPhone: 100, hold: 3 });
  assert.deepEqual([m.plateW, m.plateH, m.qrW, m.qrH, m.phoneW, m.phoneH], [686, 230, 89, 88, 238, 476]);
  assert.ok(!('sPlate' in m) && m.hold === 3);
  assert.equal(migrateSizes({ plateW: 300, sPlate: 200 }).plateW, 300, 'a px size already saved wins');
  assert.equal(migrateSizes(null), null);
});
test('webshop: box colours with an opacity, a transparent box has 0 %', () => {
  assert.equal(rgba('#ff0000', 50), 'rgba(255,0,0,0.5)'); assert.equal(rgba('#00ff00', 0), 'rgba(0,255,0,0)'); assert.equal(rgba('#0000ff'), 'rgba(0,0,255,1)');
  assert.equal(rgba('nonsense', 100), 'rgba(255,255,255,1)', 'a silly colour counts as white'); assert.equal(rgba('#112233', 999), 'rgba(17,34,51,1)', 'opacity is limited to 0–100');
  assert.deepEqual([WEBSHOP_DEFAULTS.plateBg, WEBSHOP_DEFAULTS.plateBgA, WEBSHOP_DEFAULTS.screenBg, WEBSHOP_DEFAULTS.screenBgA], ['#ffffff', 100, '#6b6f78', 100], 'the defaults are the sample\'s look');
  assert.deepEqual(BASE, { plate: [343, 115], qr: [177, 175], phone: [238, 476] });
});

test('webshop: every picture can be fitted, zoomed and shifted on the phone screen', async () => {
  const { slideFit } = await import('../graphics/js/webshop-anim.js');
  const box = [0, 0, 220, 458]; // the phone's screen
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
  // a landscape photo: 'cover' fills the screen (the sides are cropped), 'contain' shows all of it
  const cov = slideFit(1500, 1000, ...box, {}), con = slideFit(1500, 1000, ...box, { fit: 'contain' });
  assert.ok(Math.abs(cov[3] - 458) < 1e-6 && cov[2] > 220, 'cover: as tall as the screen, wider than it');
  assert.ok(Math.abs(con[2] - 220) < 1e-6 && con[3] < 458, 'contain: as wide as the screen, shorter than it');
  assert.ok(near([cov[0] + cov[2] / 2, cov[1] + cov[3] / 2], [110, 229]), 'centred');
  // zoom scales about the centre; shifts are percentages of the screen
  const z = slideFit(1500, 1000, ...box, { zoom: 50 }); assert.ok(Math.abs(z[2] - cov[2] / 2) < 1e-6 && near([z[0] + z[2] / 2, z[1] + z[3] / 2], [110, 229]));
  const s = slideFit(1500, 1000, ...box, { ox: 10, oy: -20 }); assert.ok(near([s[0] - cov[0], s[1] - cov[1]], [22, -91.6]));
  assert.ok(near(slideFit(800, 600, ...box, { zoom: 0 }), slideFit(800, 600, ...box, {})), 'no / zero zoom = 100 %');
  assert.ok(slideFit(800, 600, ...box, { zoom: 9999 })[2] <= slideFit(800, 600, ...box, {})[2] * 5.0001, 'zoom is limited');
});
