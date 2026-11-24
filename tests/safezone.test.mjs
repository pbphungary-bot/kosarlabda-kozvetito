import test from 'node:test';
import assert from 'node:assert/strict';
import { safeFit, foldFit, toCanvas } from '../graphics/js/layout.js';
import { TEMPLATES, BUG, LARGE_BUG_CLUBS, bugSizeOf, bugOf, LIVE_BUILDERS, LIVE_VARIANTS, livePlace } from '../graphics/js/templates.js';

const apply = (f, b) => { const p = (x, y) => [f.ax + f.s * (x - f.ax) + f.dx, f.ay + f.s * (y - f.ay) + f.dy]; const [x0, y0] = p(b[0], b[1]), [x1, y1] = p(b[2], b[3]); return [x0, y0, x1, y1]; };
const hits = (b, z) => b[0] < z[2] && b[2] > z[0] && b[1] < z[3] && b[3] > z[1];
const panelBox = t => { const e = t.elements.find(x => x.id === 'panel' && x.type === 'framed'); if (!e) return t.panel?.box || null; const [cx, cy, w, h] = e.box; return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]; }; // same source as the engine

test('score bug: only ETO Basket (women) and Falco (men) use the large one', () => {
  assert.equal(bugSizeOf('women', 'sercounigyor'), 'large');
  assert.equal(bugSizeOf('men', 'falcokc'), 'large');
  assert.equal(bugSizeOf('women', 'dvtkhuntherm'), 'small');
  assert.equal(bugSizeOf('men', 'kecskemet'), 'small');
  assert.equal(bugSizeOf('men', 'sercounigyor'), 'small', 'club ids are league-scoped');
  assert.equal(bugOf('nope'), BUG.large, 'unknown: the large zone (it contains the small one)');
  const [l, s] = [BUG.large.zone, BUG.small.zone];
  assert.ok(l[0] <= s[0] && l[1] <= s[1] && l[2] >= s[2] && l[3] >= s[3], 'the large zone contains the small one');
  // both measured score bug versions lie inside their zones
  assert.ok(l[0] <= 1211 && l[1] <= 931 && l[2] >= 1886 && l[3] >= 1044, 'large bug 1211–1886 x 931–1044');
  assert.ok(s[0] <= 1425 && s[1] <= 956 && s[2] >= 1876 && s[3] >= 1034, 'small bug 1425–1876 x 956–1034');
});

test('safeFit: nothing when clear; shift up, then left, then scale (gentlest)', () => {
  const z = BUG.large.zone;
  assert.equal(safeFit([69, 50, 1739, 956 - 100], z), null, 'clear of the zone');
  const up = safeFit([504, 696, 1417, 976], z); // referees-like: room above
  assert.equal(up.kind, 'up'); assert.equal(up.dy, -51);
  const left = safeFit([61, 2, 1240, 1000], z); // comparison (women): no room above, room on the left
  assert.equal(left.kind, 'left'); assert.equal(left.dx, -40);
  const sc = safeFit([97, 10, 1454, 967], z); // results: no room either way
  assert.equal(sc.kind, 'scale'); assert.ok(sc.s > 0.95 && sc.s < 0.96, `scale ${sc.s}`);
  for (const f of [up, left, sc]) assert.ok(!hits(apply(f, f === up ? [504, 696, 1417, 976] : f === left ? [61, 2, 1240, 1000] : [97, 10, 1454, 967]), z), `${f.kind}: clear after the fit`);
});

test('foldFit: the folded global transform equals "global, then the fit" for any point', () => {
  const g = { dx: 30, dy: -12, scale: 0.9 }, f = { kind: 'scale', s: 0.95, ax: 100, ay: 20, dx: 0, dy: 0 };
  const gf = foldFit(g, f);
  for (const [x, y] of [[0, 0], [500, 400], [1900, 1000]]) {
    const [cx, cy] = [(x - 960) * g.scale + 960 + g.dx, (y - 540) * g.scale + 540 + g.dy];
    const want = [f.ax + f.s * (cx - f.ax), f.ay + f.s * (cy - f.ay)];
    const got = [(x - 960) * gf.scale + 960 + gf.dx, (y - 540) * gf.scale + 540 + gf.dy];
    assert.ok(Math.abs(got[0] - want[0]) < 1e-6 && Math.abs(got[1] - want[1]) < 1e-6);
  }
  assert.deepEqual(foldFit(g, null), g);
});

test('every graphic with a panel stays out of BOTH score bug zones after the fit, and most are not changed at all', () => {
  const report = [];
  for (const t of TEMPLATES) {
    if (t.type === 'livestat') continue;
    const b = panelBox(t); if (!b) continue;
    for (const size of ['large', 'small']) {
      const z = BUG[size].zone, f = safeFit(b, z);
      const after = f ? apply(f, b) : b;
      assert.ok(!hits(after, z), `${t.id}/${size}: clear after the fit (${f?.kind})`);
      assert.ok(after[0] >= 0 && after[1] >= 0, `${t.id}/${size}: still inside the picture`);
      if (f?.kind === 'scale') assert.ok(f.s >= 0.9, `${t.id}/${size}: shrinks at most 10 % (${f.s.toFixed(3)})`);
      report.push(`${t.id}/${size}: ${f ? f.kind + (f.kind === 'scale' ? ' ' + f.s.toFixed(3) : ' ' + Math.round(f.dx + f.dy)) : 'unchanged'}`);
    }
  }
  assert.ok(report.some(r => /unchanged/.test(r)), 'many graphics are untouched');
  assert.ok(report.length >= 30, 'all panel graphics checked');
});

test('live strip: centred in the gap left of the score bug that applies, on its level', () => {
  for (const size of ['large', 'small']) {
    const z = BUG[size].zone;
    for (const [k, V] of Object.entries(LIVE_VARIANTS)) {
      const t = LIVE_BUILDERS['livestat-women'](k, 'gap', size), [cx, cy, w, h] = t.elements.find(e => e.id === 'panel').box;
      assert.ok(Math.abs(cx - z[0] / 2) <= 1, `${size}/${k}: centre x ${cx} = half of ${z[0]}`);
      assert.ok(Math.abs(cy - BUG[size].cy) <= 12, `${size}/${k}: on the score bug level (${cy})`);
      assert.ok(!hits([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], z), `${size}/${k}: clear of the zone`);
    }
  }
  assert.deepEqual(livePlace(480, 150, 'tl'), [40, 40]);
});
