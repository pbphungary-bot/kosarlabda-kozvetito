import test from 'node:test';
import assert from 'node:assert/strict';
import { WEBSHOP_DEFAULTS, stateAt, timeline, slots, T } from '../graphics/js/webshop-anim.js';

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
  assert.deepEqual(stateAt(tl.showStart + 0.5, c).photo, { i: 0, j: 1, mix: 0 });
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
