import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Store } from '../graphics/js/data.js';
import { bindPlayerSpecial } from '../graphics/js/binders.js';
import { templateById } from '../graphics/js/templates.js';

import { DATA_DIR, ROOT } from './helpers.mjs';
const read = f => readFile(`${ROOT}/${DATA_DIR}/${f}`, 'utf8').then(JSON.parse);
const raw = { men: { players: await read('player_stats_men.json') }, women: { players: await read('player_stats_women.json') } };
const store = new Store(raw, new Date('2026-11-21T12:00:00Z'));

test('player special: name and current-season column come from the data, other columns stay empty', () => {
  const t = templateById('playerspecial-men');
  const v = bindPlayerSpecial(store, 'men', 'falcokc', undefined, t);
  assert.ok(v.title.text && v.title.text !== '—');
  assert.match(v['r0.c3'].text, /^\d+\.\d$/);
  assert.equal(v['r0.c1'].text, '');
  assert.equal(v['r0.c2'].text, '');
  assert.equal(v.subtitle.text, '');
  assert.match(v.h3.text, /^\d+ idei\nmeccs$/);
  assert.equal(v['r1.label'].text, '3P%');
});

test('player special (women): shooting row is made/attempted with a small percentage', () => {
  const t = templateById('playerspecial-women');
  const v = bindPlayerSpecial(store, 'women', 'dvtkhuntherm', undefined, t);
  const x = v['r1.c2'];
  assert.match(x.runs[0].text, /^\d+\.\d\/\d+\.\d$/);
  assert.match(x.runs[1].text, /^\(\d+\.\d%\)$/);
  assert.equal(x.runs[1].size, 40);
});

import { psBuild, psNormalize } from '../graphics/js/templates.js';
test('player special: layering puts the photo between the groups; the photo never exceeds the panel inside the outline', () => {
  const base = templateById('playerspecial-men');
  const ids = t => t.elements.map(e => e.id);
  const front = psBuild(base, { front: {} });
  assert.ok(ids(front).indexOf('photo') < ids(front).indexOf('title'), 'default: photo behind all text');
  const mixed = psBuild(base, { front: { c1: false } });
  assert.ok(ids(mixed).indexOf('r0.c1') < ids(mixed).indexOf('photo'), 'c1 numbers behind the photo');
  assert.ok(ids(mixed).indexOf('photo') < ids(mixed).indexOf('r0.c2'), 'c2 numbers in front of it');
  const [, y0, , y1] = base.inner.box;
  assert.equal(base.elements.find(e => e.id === 'photo').box[3], y1 - y0, 'as tall as the inside of the outline');
  assert.equal(psBuild(base, { photoH: 5000 }).elements.find(e => e.id === 'photo').box[3], y1 - y0);
});
test('player special: configuration is normalised', () => {
  const c = psNormalize('women', { cols: 99, rows: ['nope'], labelAfter: 9, auto: -3 });
  assert.equal(c.cols, 4); assert.equal(c.labelAfter, 4); assert.equal(c.auto, 0); assert.equal(c.rows.length, 1);
});

test('player special: font sizes are adjustable (group settings and every text has size fields)', () => {
  const base = templateById('playerspecial-men');
  const t = psBuild(base, { fsRows: 70, fsHeaders: 30, fsTitle: 90, fsSub: 36 });
  assert.equal(t.elements.find(e => e.id === 'r0.c1').size, 70);
  assert.equal(t.elements.find(e => e.id === 'r2.label').size, 70);
  assert.equal(t.elements.find(e => e.id === 'h1').size, 30);
  assert.equal(t.elements.find(e => e.id === 'title').size, 90);
  assert.equal(t.elements.find(e => e.id === 'subtitle').size, 36);
  assert.ok(t.elements.filter(e => e.type === 'text').every(e => e.adjust));
});

import { lastGamesMap, careerMap, playerIdFor } from '../graphics/js/binders.js';
const sample = JSON.parse(await readFile(`${ROOT}/tests/fixtures/player-page-sample.json`, 'utf8'));
test('player page data: last N games and career averages are computed from the real page, percentages from the sums', () => {
  const l = lastGamesMap(sample, 3);
  const g = sample.gamelog.slice(-3);
  const pts = g.map(x => +x.stats[1]);
  assert.equal(l['M.'], '3');
  assert.ok(Math.abs(+l['P.'] - pts.reduce((a, b) => a + b, 0) / 3) < 1e-9);
  const s2 = g.reduce((a, x) => a + +x.stats[3], 0), k2 = g.reduce((a, x) => a + +x.stats[4], 0);
  assert.ok(Math.abs(+l['2P %'] - 100 * s2 / k2) < 1e-9);
  assert.equal(lastGamesMap({ gamelog: [] }, 5), null); // nothing is invented
  const c = careerMap(sample);
  assert.equal(c.map['P.'], '15.6');
  assert.deepEqual(c.seasons, ['2026/2027']);
});
test('player page: the studio finds the Hunbasket player id from the name in the statistics list', async () => {
  const store = new Store({ men: {}, women: { teamPages: JSON.parse(await readFile(`${ROOT}/${DATA_DIR}/team_pages_women.json`, 'utf8')) }, errors: [] }, new Date('2026-11-21T20:00:00Z'));
  assert.equal(playerIdFor(store, 'women', 'eltebeacujbuda', 'Fisher Malia'), 'B152349');
  assert.equal(playerIdFor(store, 'women', 'eltebeacujbuda', 'Nincs Ilyen'), null);
});
