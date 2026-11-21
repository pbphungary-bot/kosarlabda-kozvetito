import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Store } from '../graphics/js/data.js';
import { bindPlayerSpecial } from '../graphics/js/binders.js';
import { templateById } from '../graphics/js/templates.js';

const read = f => readFile(new URL(`../data/${f}`, import.meta.url), 'utf8').then(JSON.parse);
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
