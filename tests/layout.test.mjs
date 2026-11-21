import test from 'node:test';
import assert from 'node:assert/strict';
import { effective, extract, dropLayoutKeys, applyToOverrides, snap, unsavedCount, meaningful, toCanvas, GLOBAL } from '../graphics/js/layout.js';

const tpl = { elements: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };

test('effective layout = benchmark overridden by the session; an explicit 0 cancels a benchmark value', () => {
  const bench = { items: { a: { dx: 10, dy: 5 }, b: { size: 60 } } };
  assert.deepEqual(effective(bench, {}, 'a'), { dx: 10, dy: 5 });
  assert.deepEqual(effective(bench, { a: { dx: 20, text: 'x' } }, 'a'), { dx: 20, dy: 5 }, 'text overrides are not layout');
  assert.deepEqual(effective(bench, { a: { dx: 0 } }, 'a'), { dx: 0, dy: 5 });
  assert.deepEqual(effective(null, {}, 'c'), {});
});

test('extract keeps only entries that differ from the PSD, including the global entry', () => {
  const ov = { a: { dx: 0, dy: 0 }, b: { dy: 12, color: '#fff' }, c: { scale: 1 }, [GLOBAL]: { dx: 30, scale: 0.9 } };
  const l = extract(tpl, null, ov);
  assert.deepEqual(Object.keys(l.items).sort(), [GLOBAL, 'b']);
  assert.deepEqual(l.items.b, { dy: 12 });
  assert.deepEqual(l.items[GLOBAL], { dx: 30, scale: 0.9 });
});

test('saving the session as benchmark, then dropping the session keeps the benchmark', () => {
  const ov = { a: { dx: 7, text: 'keep' }, b: { dy: 3 } };
  const bench = extract(tpl, null, ov);
  dropLayoutKeys(ov);
  assert.deepEqual(ov, { a: { text: 'keep' } }, 'text override stays, empty entries are removed');
  assert.deepEqual(effective(bench, ov, 'a'), { dx: 7 });
  assert.equal(unsavedCount(ov), 0);
});

test('loading a saved layout replaces the benchmark exactly (benchmark values it does not mention are cancelled)', () => {
  const bench = { items: { a: { dx: 10 }, b: { size: 60, dy: 4 } } };
  const saved = { items: { a: { dy: -8 } } };
  const ov = {};
  applyToOverrides(ov, saved, bench);
  assert.deepEqual(extract(tpl, bench, ov).items, { a: { dy: -8 } }, 'a keeps only the saved move, b is back at the PSD');
  assert.equal(meaningful(effective(bench, ov, 'b')), false, 'b is back at the PSD position and automatic size');
  assert.equal(effective(bench, ov, 'a').dx, 0);
});

test('snap goes to the PSD position or the benchmark position within 6 px', () => {
  assert.equal(snap(4, [0, 40]), 0);
  assert.equal(snap(-5.9, [0, 40]), 0);
  assert.equal(snap(36, [0, 40]), 40);
  assert.equal(snap(20, [0, 40]), 20);
});

test('global move / scale maps template boxes to the canvas', () => {
  assert.deepEqual(toCanvas([100, 100, 50, 20], {}), [100, 100, 50, 20]);
  assert.deepEqual(toCanvas([960, 540, 10, 10], { dx: 20, dy: -10, scale: 0.5 }), [980, 530, 5, 5]);
  const [x, y, w, h] = toCanvas([0, 0, 100, 100], { scale: 0.5 });
  assert.deepEqual([x, y, w, h], [480, 270, 50, 50]);
});

import { CONTENT } from '../graphics/js/layout.js';
test('content move is part of the layout and maps boxes about the frame centre', () => {
  const tpl = { elements: [{ id: 'a' }] };
  const l = extract(tpl, null, { [CONTENT]: { dx: 20, scale: 0.9 } });
  assert.deepEqual(l.items[CONTENT], { dx: 20, scale: 0.9 });
  assert.equal(unsavedCount({ [CONTENT]: { dy: 5 } }), 1);
  // a box at the frame centre only shifts; scaling is about the centre of the frame
  const c = { dx: 10, dy: 0, scale: 0.5, cx: 600, cy: 500 };
  assert.deepEqual(toCanvas([600, 500, 100, 100], null, 1920, 1080, c), [610, 500, 50, 50]);
  assert.deepEqual(toCanvas([0, 0, 100, 100], { dx: 5 }, 1920, 1080, null), [5, 0, 100, 100]);
});
