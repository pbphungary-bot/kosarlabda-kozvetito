import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, loadStore } from './helpers.mjs';
import { readXlsx, readCsv } from '../graphics/js/xlsx.js';
import { importWorkbook } from '../graphics/js/importer.js';
import { bindComparison, bindTeamstats, bindRowList } from '../graphics/js/binders.js';
import { templateById } from '../graphics/js/templates.js';

const sample = () => readXlsx(new Uint8Array(readFileSync(path.join(ROOT, 'tests/fixtures/import-sample.xlsx'))));

test('xlsx reader returns all visible sheets with cell values', () => {
  const wb = sample();
  assert.deepEqual(wb.sheets.map(s => s.name), ['Csapatok', 'Játékosok', 'Jegyzet']);
  assert.equal(wb.sheets[1].rows[1][2], 'AHO Tyra Nolwenn');
  assert.equal(wb.sheets[1].rows[1][4], '7,2');
});

test('import recognises team + player sheets by header, women league', () => {
  const r = importWorkbook(sample(), 'women');
  assert.equal(r.report.find(x => x.sheet === 'Csapatok').status, 'csapatstatisztika');
  assert.equal(r.report.find(x => x.sheet === 'Játékosok').status, 'játékosstatisztika');
  assert.equal(r.report.find(x => x.sheet === 'Jegyzet').status, 'kihagyva');
  assert.deepEqual(Object.keys(r.team).sort(), ['csatattk', 'dvtkhuntherm', 'sopronbasket']);
  assert.ok(r.unmatched.some(u => u.includes('Ismeretlen Csapat')), 'unknown team reported, not guessed');
  // fractions formatted as percent are scaled to percent points
  assert.equal(r.team.dvtkhuntherm.fg2_pct, 50.2);
  assert.equal(r.team.dvtkhuntherm.val, 102.8);
  assert.equal(r.playerCount, 3);
  const aho = r.players.dvtkhuntherm.find(p => p['Játékos'].startsWith('AHO'));
  assert.deepEqual([aho['#'], aho['M.'], aho['P.'], aho['ÖLP'], aho['GP'], aho['Idő']], ['0', '6', '7.2', '3.7', '4.2', '21.5']);
});

test('the same file imported into the men league never matches women clubs', () => {
  const r = importWorkbook(sample(), 'men');
  assert.equal(r.teamCount, 0);
  assert.equal(r.playerCount, 0);
  assert.ok(r.unmatched.length >= 3);
});

test('imported values are used by the comparison and team-stat templates, and labelled as Excel', async () => {
  const store = await loadStore();
  const before = bindComparison(store, 'women', 'dvtkhuntherm', 'csatattk');
  const r = importWorkbook(sample(), 'women');
  store.setExcel('women', { team: r.team, players: r.players, meta: { file: 'import-sample.xlsx' }, enabled: true });
  const v = bindComparison(store, 'women', 'dvtkhuntherm', 'csatattk');
  assert.equal(v['home.val'].text, '102.8');
  assert.match(v['home.val'].source, /^Excel/);
  assert.notEqual(before['home.val'].text, v['home.val'].text);
  const ts = bindTeamstats(store, 'women', 'dvtkhuntherm', templateById('teamstats-women'), (el, t) => t.length * 10);
  assert.equal(ts.values['r0.name'].text.length > 0, true);
  assert.match(ts.values['r0.name'].source, /^Excel/);
  assert.equal(ts.shown.length, 2);
  // switching it off restores the dashboard values
  store.setExcel('women', { team: r.team, players: r.players, meta: {}, enabled: false });
  assert.equal(bindComparison(store, 'women', 'dvtkhuntherm', 'csatattk')['home.val'].text, before['home.val'].text);
});

test('csv with semicolons and decimal commas', () => {
  const csv = 'Csapat;PTS;2P%;3P%;FT%;REB;AST\nDVTK HUNTHERM;77,5;50,2;33,6;65,8;46,3;22,0\nCsata TKK;74,7;46,0;30,8;71,3;39,1;17,2\n';
  const r = importWorkbook(readCsv(csv, 'stat'), 'women');
  assert.equal(r.team.dvtkhuntherm.ppg, 77.5);
  assert.equal(r.team.csatattk.fg3_pct, 30.8);
});

const bytes = f => new Uint8Array(readFileSync(path.join(ROOT, 'tests/fixtures', f)));

test('FullField team export reproduces the DVTK – Csata PSD (values and all 18 ranks), league auto-detected', async () => {
  const { detectLeague } = await import('../graphics/js/importer.js');
  const wb = readXlsx(bytes('boxscore_team_avg_women.xlsx'));
  const d = detectLeague(wb, 'men'); // wrong hint on purpose
  assert.equal(d.league, 'women');
  const r = importWorkbook(wb, d.league);
  assert.equal(r.teamCount, 11);
  assert.deepEqual(r.unmatched, []);
  const store = await loadStore();
  store.mergeExcel('women', r, { name: 'avg2.xlsx', modified: '2026-11-20T10:00:00Z' });
  const v = bindComparison(store, 'women', 'dvtkhuntherm', 'csatattk');
  const keys = ['ppg', 'fg2_pct', 'fg3_pct', 'ft_pct', 'reb', 'ast', 'stl', 'tov', 'val'];
  assert.deepEqual(keys.map(k => v['home.' + k].text), ['77.5', '50.2%', '33.6%', '65.8%', '46.3', '22.0', '10.8', '15.3', '102.8']);
  assert.deepEqual(keys.map(k => v['home.rank.' + k].text), ['(3.)', '(3.)', '(2.)', '(9.)', '(1.)', '(1.)', '(6.)', '(3.)', '(2.)']);
  assert.deepEqual(keys.map(k => v['away.rank.' + k].text), ['(4.)', '(7.)', '(5.)', '(4.)', '(6.)', '(6.)', '(8.)', '(2.)', '(4.)']);
  assert.match(v['home.val'].source, /^Excel/);
  assert.match(v.subtitle.text, /via FULLFIELD\.INFO$/);
  assert.equal(store.excelInfo('women').modified, '2026-11-20T10:00:00Z');
});

test('men team export fills the men EFF gap and never touches the women league', async () => {
  const wb = readXlsx(bytes('boxscore_team_avg_men.xlsx'));
  const r = importWorkbook(wb, 'men');
  assert.equal(r.teamCount, 14);
  assert.deepEqual(r.unmatched, []);
  const store = await loadStore();
  store.mergeExcel('men', r, { name: 'avg1.xlsx' });
  const v = bindComparison(store, 'men', 'falcokc', 'albafehervar');
  assert.equal(v['home.val'].text, '118.0');
  assert.ok(!v['home.val'].missing);
  assert.equal(v['home.rank.val'].text, '(2.)');
  assert.equal(store.excelInfo('women'), null);
  // the same file read as women never matches (exact names only)
  assert.equal(importWorkbook(wb, 'women').teamCount, 1); // only "NKA Universitas Pécs" is shared by name
});

test('multiple files merge: newer round overrides only the fields it has', async () => {
  const store = await loadStore();
  const wb = readXlsx(bytes('boxscore_team_avg_women.xlsx'));
  store.mergeExcel('women', importWorkbook(wb, 'women'), { name: 'a.xlsx' });
  store.mergeExcel('women', { team: { dvtkhuntherm: { ppg: 99.9 } }, players: {} }, { name: 'b.xlsx' });
  assert.equal(store.stat('women', 'dvtkhuntherm', 'ppg'), 99.9);
  assert.equal(store.stat('women', 'dvtkhuntherm', 'val'), 102.8);
  assert.equal(store.excelInfo('women').files.length, 2);
});

test('Statalapok layout: roster block + prefixed stats block, odd sheets handled', () => {
  const wb = readXlsx(bytes('statalap-layout.xlsx'));
  const r = importWorkbook(wb, 'women');
  const dvtk = r.players.dvtkhuntherm;
  assert.equal(dvtk.length, 3, 'placeholder zeros and the plain name list are not players');
  assert.deepEqual(dvtk.map(p => p['Játékos']), ['TESZT Bea', 'TESZT Cili', 'TESZT Dóra']);
  assert.deepEqual(dvtk.map(p => p['#']), ['0', '6', '30'], 'a "-" number is completed from the roster list');
  const bea = dvtk[0];
  assert.deepEqual(['M.', 'P.', 'ÖLP', 'GP', 'SZL', 'EL', 'VAL', 'Idő'].map(k => bea[k]), ['6', '7.2', '3.7', '4.2', '1.5', '1.3', '13.5', '21.5']);
  // BKG: the later averages table is used, not the totals table above it
  assert.equal(r.players.bkgprimaszigetszentmiklos.length, 1);
  assert.equal(r.players.bkgprimaszigetszentmiklos[0]['P.'], '7.8');
  // sheet without a club name is reported, not guessed
  assert.ok(r.unmatched.some(u => u.includes('Munka1')));
  // "Sopron" sheet in the women file = Sopron Basket, roster only (no stats)
  const sop = r.report.find(x => x.sheet === 'Sopron');
  assert.equal(sop.status, 'csak keret (nincs statisztika)');
  assert.equal(sop.club, 'sopronbasket');
  assert.equal(r.players.sopronbasket, undefined);
  // header text decides the league
  return import('../graphics/js/importer.js').then(({ detectLeague }) => assert.equal(detectLeague(wb, 'men').league, 'women'));
});

test('imported players replace the dashboard list for that team only', async () => {
  const store = await loadStore();
  const r = importWorkbook(readXlsx(bytes('statalap-layout.xlsx')), 'women');
  const before = store.players('women', 'csatattk').players.length;
  store.mergeExcel('women', r, { name: 'statalap-layout.xlsx' });
  assert.equal(store.players('women', 'dvtkhuntherm').source, 'excel');
  assert.equal(store.players('women', 'csatattk').source, 'dashboard');
  assert.equal(store.players('women', 'csatattk').players.length, before);
});

// ───────────── cup / European games sheet ─────────────
test('cup sheet: dates in every common format, competition → logo, foreign names kept, bad rows reported', async () => {
  const { detectLeague } = await import('../graphics/js/importer.js');
  const wb = readXlsx(bytes('cups-women.xlsx'));
  assert.equal(detectLeague(wb, 'men').league, 'women');
  const r = importWorkbook(wb, 'women');
  assert.equal(r.report[0].status, 'kupa-/európai meccsek');
  assert.equal(r.cupCount, 5);
  assert.deepEqual(r.cups.map(g => g.date), ['2026-09-30', '2026-10-14', '2026-10-22', '2026-11-25', '2026-12-02']);
  assert.equal(r.cups[3].time, '20:00');
  assert.equal(r.cups[4].time, '18:30', 'Excel date-time cell');
  assert.deepEqual(r.cups.map(g => g.compKey), ['comp/euroleague-women', 'comp/eurocup-women', 'comp/eurocup-women', 'comp/eurocup-women', '']);
  assert.deepEqual(r.compsNoLogo, ['Magyar Kupa']);
  assert.deepEqual(r.cups[0].score, { home: 66, away: 71 });
  assert.deepEqual(r.cups[1].score, { home: 56, away: 38 }, '56:38 with a colon');
  assert.equal(r.cups[3].status, 'scheduled');
  assert.equal(r.cups[0].awayId, null, 'foreign team stays a plain name');
  assert.equal(r.cups[0].away, 'Crvena Zvezda');
  assert.ok(r.unmatched.some(u => u.includes('Olympiacos')), 'row without an NB I/A club is reported, not imported');
  // competition marks are league specific: BCL is a men competition
  const m = importWorkbook(readXlsx(bytes('cups-men.xlsx')), 'men');
  assert.deepEqual(m.cups.map(g => g.compKey), ['comp/bcl', 'comp/bcl']);
});

test('cup games appear in results and schedule lists of the team, merged with NB I/A games by date', async () => {
  const store = await loadStore(); // "today" = 2026-11-20
  const nba = store.nextGames('women', 'dvtkhuntherm', 99).length;
  store.mergeExcel('women', importWorkbook(readXlsx(bytes('cups-women.xlsx')), 'women'), { name: 'cups-women.xlsx' });
  // schedule: upcoming cup games are mixed into date order
  const next = store.nextGames('women', 'dvtkhuntherm', 99);
  assert.equal(next.length, nba + 2);
  assert.deepEqual(next.map(m => m.date), [...next.map(m => m.date)].sort());
  const sched = bindRowList(store, 'women', 'dvtkhuntherm', templateById('schedule-women'));
  const idx = sched.games.findIndex(m => m.cup && m.away === 'Brod na Savi');
  assert.ok(idx >= 0, 'Brod na Savi game is on the schedule');
  assert.equal(sched.values[`r${idx}.comp`].src, 'comp/eurocup-women');
  assert.equal(sched.values[`r${idx}.match`].text, 'DVTK Huntherm - Brod na Savi');
  assert.equal(sched.values[`r${idx}.date`].text, '2026.11.25. - 20:00');
  assert.match(sched.values[`r${idx}.match`].source, /Feltöltött kupa/);
  // the Hungarian Cup game has no logo and says so
  const mk = sched.games.findIndex(m => m.cup && m.competition === 'Magyar Kupa');
  assert.equal(sched.values[`r${mk}.comp`].src, '');
  assert.ok(sched.values[`r${mk}.comp`].note);
  // results: the three played European games, colour by result for the focus team
  assert.equal(store.lastResults('women', 'dvtkhuntherm', 99).filter(m => m.cup).length, 3);
  const res = bindRowList(store, 'women', 'dvtkhuntherm', { ...templateById('results-women'), rows: 14 }); // longer list: all games
  const cups = res.games.filter(m => m.cup);
  assert.equal(cups.length, 3);
  const loss = res.games.findIndex(m => m.cup && m.away === 'Crvena Zvezda');
  assert.equal(res.values[`r${loss}.score`].text, '66-71');
  assert.equal(res.values[`r${loss}.score`].color, '#ec4036', 'DVTK lost');
  assert.equal(res.values[`r${loss}.comp`].src, 'comp/euroleague-women');
  const away = res.games.findIndex(m => m.cup && m.home === 'Brod na Savi');
  assert.equal(res.values[`r${away}.score`].text, '56-89');
  assert.equal(res.values[`r${away}.score`].color, '#1fbf1b', 'DVTK won away');
  const dates = res.games.map(m => m.date);
  assert.deepEqual(dates, [...dates].sort());
});

test('cup games belong to their league and switch off with the Excel toggle', async () => {
  const store = await loadStore();
  store.mergeExcel('women', importWorkbook(readXlsx(bytes('cups-women.xlsx')), 'women'), { name: 'w.xlsx' });
  store.mergeExcel('men', importWorkbook(readXlsx(bytes('cups-men.xlsx')), 'men'), { name: 'm.xlsx' });
  assert.equal(store.cupFixtures('men', 'dvtkhuntherm').length, 0);
  assert.equal(store.cupFixtures('men', 'falcokc').length, 2);
  assert.equal(store.excelInfo('women').cups, 5);
  const before = store.nextGames('women', 'dvtkhuntherm', 99).length;
  store.excel.women.enabled = false;
  assert.equal(store.nextGames('women', 'dvtkhuntherm', 99).length, before - 2);
  // a second upload of the same game replaces it instead of duplicating it
  store.excel.women.enabled = true;
  store.mergeExcel('women', importWorkbook(readXlsx(bytes('cups-women.xlsx')), 'women'), { name: 'w2.xlsx' });
  assert.equal(store.excelInfo('women').cups, 5);
});
