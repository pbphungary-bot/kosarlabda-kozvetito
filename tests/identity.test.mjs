import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { clubId, clubIdStrict, historyClubId, CLUBS } from '../graphics/js/clubs.js';
import { ROOT, readJson, loadStore, DATA_DIR } from './helpers.mjs';

const LG = ['men', 'women'];

test('every team name in every dashboard data file resolves to exactly one club of its league', async () => {
  for (const lg of LG) {
    const names = new Map();
    const add = (n, where) => names.set(n, [...(names.get(n) || []), where]);
    (await readJson(`${DATA_DIR}/${lg}.json`)).matches.forEach(m => { add(m.home, 'fixtures'); add(m.away, 'fixtures'); });
    (await readJson(`${DATA_DIR}/standings_${lg}.json`)).standings.forEach(s => add(s.name, 'standings'));
    (await readJson(`${DATA_DIR}/team_stats_${lg}.json`)).teams.forEach(t => add(t.name, 'team stats'));
    (await readJson(`${DATA_DIR}/player_stats_${lg}.json`)).teams.forEach(t => add(t.name, 'player stats'));
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
      const raw = await readJson(DATA_DIR + '/' + file);
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

// Head-to-head history (Hunbasket, 2020/21–): clubs changed their names with their sponsors. A name the studio does not know drops every meeting under it
// (the graphic then shows only a few games), so every name must resolve – except clubs that are no longer in the league. The daily data-health job runs this on the live file.
const GONE = { men: ['Zalakerámia ZTE KK', 'HÜBNER Nyíregyháza BS', 'Jászberényi KSE', 'PVSK-VEOLIA', 'Pécsi VSK-VEOLIA'], women: ['Darazsak Sportakadémia', 'ZTE Női Kosárlabda Klub', 'PINKK Pécsi 424', 'PINKK-Pécsi 424', 'Dávid Kornél KA', 'Dávid Kornél Kosárlabda Akadémia'] };
test('head-to-head history: every club name (also the earlier sponsor names) resolves to a current club, except clubs that left the league', async () => {
  const raw = await readJson(`${DATA_DIR}/h2h_hunbasket.json`);
  for (const lg of LG) {
    const names = new Set();
    raw.matches.filter(m => m.league === lg).forEach(m => { names.add(m.home); names.add(m.away); });
    const unknown = [...names].filter(n => !clubIdStrict(lg, n) && !GONE[lg].includes(n));
    assert.deepEqual(unknown, [], `${lg}: unknown club names in the head-to-head file (a rename? add it to EXACT in clubs.js, or to GONE here if the club left the league)`);
  }
});

test('head-to-head history: earlier names of the same club are the same club', () => {
  const same = {
    women: [['Aluinvent DVTK', 'dvtkhuntherm'], ['UNI Győr', 'sercounigyor'], ['Uni Győr MÉLY-ÚT', 'sercounigyor'], ['PEAC-Pécs', 'nkauniversitaspecs'],
      ['E.ON ELTE BEAC', 'eltebeacujbuda'], ['Ludovika-FCSM Csata', 'csatattk'], ['TFSE-MTK', 'tfse'], ['Atomerőmű KSC Szekszárd', 'tarrkscszekszard']],
    men: [['Arconic-Alba Fehérvár', 'albafehervar'], ['DEAC-Tungsram', 'deac'], ['Falco-Volvo Alpok Autó Szombathely', 'falcokc'], ['Naturtex-SZTE-Szedeák', 'szedeak']],
  };
  for (const lg of LG) for (const [name, id] of same[lg]) assert.equal(clubIdStrict(lg, name), id, `${lg}: ${name}`);
  assert.equal(clubIdStrict('men', 'UNI Győr'), null, 'club ids stay league-scoped');
  // other clubs (owner 2026-11-24): never merged into a current club
  for (const n of ['PVSK-VEOLIA', 'Pécsi VSK-VEOLIA']) assert.notEqual(historyClubId('men', n), 'nkapecs', n);
  for (const n of ['PINKK Pécsi 424', 'PINKK-Pécsi 424']) assert.notEqual(historyClubId('women', n), 'nkauniversitaspecs', n);
  for (const n of ['Dávid Kornél KA', 'Dávid Kornél Kosárlabda Akadémia']) assert.equal(historyClubId('women', n), null, n);
});

test('head-to-head history: pairs of current clubs have their meetings of all seasons (not only the ones under the current names)', async () => {
  const store = await loadStore();
  for (const lg of LG) await store.loadLazy(lg, 'h2h', f => readJson(`${DATA_DIR}/${f}`));
  assert.ok(store.h2hGames('women', 'sercounigyor', 'eltebeacujbuda').length >= 10, 'ETO – BEAC across the earlier names (was 2)');
  assert.ok(store.h2hGames('men', 'kecskemet', 'nkapecs').length >= 6, 'Kecskemét – NKA Pécs men (PVSK-VEOLIA is another club, not counted)');
});
