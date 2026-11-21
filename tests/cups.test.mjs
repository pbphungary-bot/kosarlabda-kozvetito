import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractGames, toFixtures } from '../scripts/update_cups.mjs';

const html = await readFile(new URL('./fixtures/fiba-games-sample.html', import.meta.url), 'utf8');
const page = { competition: 'EuroCup Women', compKey: 'comp/eurocup-women' };

test('game objects are read from the flight payload, even across chunks', () => {
  assert.equal(extractGames(html).length, 3);
});
test('only games with an NB I/A club are kept, in the right league', () => {
  const games = extractGames(html);
  const w = toFixtures(games, page, 'women');
  assert.equal(w.length, 2);
  assert.deepEqual(toFixtures(games, page, 'men'), []);
  assert.equal(w[0].homeId, 'dvtkhuntherm');
  assert.equal(w[0].awayId, null);
  assert.deepEqual(w[0].score, { home: 56, away: 38 });
  assert.equal(w[0].status, 'finished');
  assert.equal(w[0].date, '2026-10-14'); assert.equal(w[0].time, '18:00');
});
test('0-0 means not played yet, never a result', () => {
  const w = toFixtures(extractGames(html), page, 'women');
  assert.equal(w[1].status, 'scheduled'); assert.equal(w[1].score, null); assert.equal(w[1].awayId, 'dvtkhuntherm');
});

import { Store } from '../graphics/js/data.js';
test('Store merges automatic cup games; the operator\'s own entry wins', () => {
  const g = { date: '2026-11-25', time: '18:00', home: 'Brod', away: 'DVTK HUNTHERM', homeId: null, awayId: 'dvtkhuntherm', status: 'scheduled', score: null, competition: 'EuroCup Women', compKey: 'comp/eurocup-women' };
  const s = new Store({ men: {}, women: { cups: { updated_at: '2026-11-21T05:00:00Z', games: [g] } } }, new Date('2026-11-21T10:00:00Z'));
  assert.equal(s.cupFixtures('women', 'dvtkhuntherm').length, 1);
  assert.equal(s.cupFixtures('women', 'dvtkhuntherm')[0].auto, true);
  assert.equal(s.cupFixtures('men', 'dvtkhuntherm').length, 0);
  s.addCup('women', { ...g, time: '19:00' }); // same key → manual wins
  const f = s.cupFixtures('women', 'dvtkhuntherm');
  assert.equal(f.length, 1); assert.equal(f[0].time, '19:00'); assert.equal(!!f[0].auto, false);
  assert.ok(s.upcomingGames('women', 'dvtkhuntherm').some(m => m.cup));
});
