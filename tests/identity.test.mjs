import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { clubId, CLUBS } from '../graphics/js/clubs.js';
import { ROOT, readJson, loadStore } from './helpers.mjs';

const LG = ['men', 'women'];

test('every team name in every dashboard data file resolves to exactly one club of its league', async () => {
  for (const lg of LG) {
    const names = new Map();
    const add = (n, where) => names.set(n, [...(names.get(n) || []), where]);
    (await readJson(`data/${lg}.json`)).matches.forEach(m => { add(m.home, 'fixtures'); add(m.away, 'fixtures'); });
    (await readJson(`data/standings_${lg}.json`)).standings.forEach(s => add(s.name, 'standings'));
    (await readJson(`data/team_stats_${lg}.json`)).teams.forEach(t => add(t.name, 'team stats'));
    (await readJson(`data/player_stats_${lg}.json`)).teams.forEach(t => add(t.name, 'player stats'));
    for (const [n, where] of names) assert.ok(clubId(lg, n), `${lg}: "${n}" (${where}) unresolved`);
  }
});

test('each dataset has exactly one entry per club, and every club has every dataset', async () => {
  const store = await loadStore();
  assert.deepEqual(store.unresolved, []);
  for (const lg of LG) {
    const L = store.league(lg);
    const ids = Object.keys(CLUBS[lg]);
    for (const [key, file] of [['standings', `standings_${lg}.json`], ['teamStats', `team_stats_${lg}.json`], ['players', `player_stats_${lg}.json`]]) {
      const raw = await readJson('data/' + file);
      const count = (raw.standings || raw.teams).length;
      assert.equal(Object.keys(L[key]).length, count, `${lg} ${key}: duplicate mapping`);
      for (const id of ids) assert.ok(L[key][id], `${lg} ${key}: no entry for ${id}`);
    }
    const fixtureIds = new Set(L.fixtures.flatMap(m => [m.homeId, m.awayId]));
    assert.deepEqual([...fixtureIds].sort(), [...ids].sort(), `${lg} fixtures cover all clubs`);
  }
});

test('similar names stay in their own league', () => {
  assert.equal(clubId('men', 'NKA Universitas Pécs'), 'nkapecs');
  assert.equal(clubId('women', 'NKA Universitas Pécs'), 'nkauniversitaspecs');
  assert.equal(clubId('men', 'Sopron KC'), 'sopron');
  assert.equal(clubId('women', 'Sopron Basket'), 'sopronbasket');
  assert.equal(clubId('men', 'Sopron'), 'sopron');
  assert.equal(clubId('women', 'ETO Basket'), 'sercounigyor');
  assert.equal(clubId('women', 'VBW CEKK Cegléd'), 'davidkornelka');
  assert.equal(clubId('men', 'Falco KC'), 'falcokc');
  assert.equal(clubId('men', 'Bp. Honvéd'), 'bphonved');
  assert.equal(clubId('men', 'Csata TKK'), null, 'a women club never resolves in the men league');
  assert.equal(clubId('women', 'Falco KC'), null);
  assert.equal(clubId('men', 'Unknown Team'), null);
});

test('every club has a logo from the designers logo sheet', () => {
  for (const lg of LG) for (const id of Object.keys(CLUBS[lg]))
    assert.ok(existsSync(path.join(ROOT, 'graphics/logos', lg, id + '.png')), `${lg}/${id}.png`);
});
