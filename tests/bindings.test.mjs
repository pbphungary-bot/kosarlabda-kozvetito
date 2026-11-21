import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStore, readJson } from './helpers.mjs';
import { bindComparison, bindRowList, bindIntro, bindReferees, bindTeamstats, MISSING, teamstatPlayers } from '../graphics/js/binders.js';
import { templateById, STAT_ROWS, TEAMSTAT_COLS } from '../graphics/js/templates.js';
import { clubId } from '../graphics/js/clubs.js';

const measure = (el, text) => text.length * el.size * 0.4; // layout only, not asserted

test('comparison values equal the raw team-stat JSON, both leagues', async () => {
  const store = await loadStore();
  for (const lg of ['men', 'women']) {
    const raw = await readJson(`data/team_stats_${lg}.json`);
    const up = store.upcoming(lg);
    assert.ok(up.length > 0, `${lg}: upcoming matches`);
    for (const m of up.slice(0, 5)) {
      const v = bindComparison(store, lg, m.homeId, m.awayId);
      for (const side of ['home', 'away']) {
        const id = side === 'home' ? m.homeId : m.awayId;
        const team = raw.teams.find(t => clubId(lg, t.name) === id);
        for (const s of STAT_ROWS) {
          const rawV = team.periods.season[s.key];
          const f = v[`${side}.${s.key}`];
          if (rawV === undefined || rawV === null) { assert.equal(f.text, MISSING); assert.ok(f.missing); }
          else assert.equal(f.text, rawV.toFixed(1) + (s.pct ? '%' : ''), `${lg} ${id} ${s.key}`);
        }
      }
    }
  }
});

test('men EFF is not invented (KosárStat has no VAL)', async () => {
  const store = await loadStore();
  const m = store.upcoming('men')[0];
  const v = bindComparison(store, 'men', m.homeId, m.awayId);
  assert.equal(v['home.val'].text, MISSING);
  assert.ok(v['home.val'].missing);
  assert.equal(v['home.rank.val'].text, MISSING);
});

test('league ranks reproduce the ranks printed in the DVTK – Csata PSD', async () => {
  const store = await loadStore();
  const v = bindComparison(store, 'women', 'dvtkhuntherm', 'csatattk');
  // PSD (22 Nov) – identical where the stat value in the data equals the PSD value
  const psd = { home: { ppg: 3, fg2_pct: 3, fg3_pct: 2, ft_pct: 9, reb: 1, ast: 1, stl: 6, val: 2 }, away: { ppg: 4, fg2_pct: 7, fg3_pct: 5, ft_pct: 4, reb: 6, stl: 8, val: 4 } };
  for (const side of ['home', 'away']) for (const [k, r] of Object.entries(psd[side])) assert.equal(v[`${side}.rank.${k}`].text, `(${r}.)`, `${side} ${k}`);
  // colour rule: better value green, worse red; lower TOV is better
  assert.equal(v['home.ft_pct'].color, '#ec4036');
  assert.equal(v['away.ft_pct'].color, '#0b9444');
  assert.equal(v['home.tov'].color, '#ec4036'); // DVTK 15.0 vs Csata 14.0
});

test('results rows: real scores, win/loss colouring, focus team in every row', async () => {
  const store = await loadStore();
  for (const lg of ['men', 'women']) {
    const t = templateById(`results-${lg}`);
    for (const c of store.clubs(lg)) {
      const r = bindRowList(store, lg, c.id, t);
      r.games.forEach((m, i) => {
        assert.ok(m.homeId === c.id || m.awayId === c.id);
        assert.equal(r.values[`r${i}.score`].text, `${m.score.home}-${m.score.away}`);
        const won = m.homeId === c.id ? m.score.home > m.score.away : m.score.away > m.score.home;
        assert.equal(r.values[`r${i}.score`].color, won ? '#1fbf1b' : '#ec4036');
      });
      const dates = r.games.map(m => m.date);
      assert.deepEqual(dates, [...dates].sort(), 'chronological');
    }
  }
});

test('schedule rows only contain future matches; stale results are reported', async () => {
  const store = await loadStore();
  for (const lg of ['men', 'women']) {
    const t = templateById(`schedule-${lg}`);
    for (const c of store.clubs(lg)) {
      const r = bindRowList(store, lg, c.id, t);
      for (const m of r.games) assert.ok(m.date >= '2026-11-20' && m.status !== 'finished');
    }
  }
});

test('a played match without a result is flagged, never shown as a result', async () => {
  const { Store } = await import('../graphics/js/data.js');
  const fixtures = { updated_at: '2026-11-01T00:00:00Z', matches: [
    { round: '1.', home: 'Sopron Basket', away: 'TFSE', result: '80–70', date: '2026. 10. 01.', time: '18:00', status: 'finished' },
    { round: '2.', home: 'TFSE', away: 'Sopron Basket', result: 'Előzetes', date: '2026. 11. 10.', time: '18:00', status: 'scheduled' },
    { round: '3.', home: 'Sopron Basket', away: 'TFSE', result: 'Előzetes', date: '2026. 11. 30.', time: '18:00', status: 'scheduled' },
  ] };
  const store = new Store({ women: { fixtures }, men: {} }, new Date('2026-11-20T12:00:00Z'));
  assert.equal(store.missingResults('women', 'sopronbasket').length, 1);
  assert.equal(store.lastResults('women', 'sopronbasket', 6).length, 1);
  assert.equal(store.nextGames('women', 'sopronbasket', 6).length, 1);
  assert.ok(store.freshness('women').fixtures.stale);
  const r = bindRowList(store, 'women', 'sopronbasket', templateById('results-women'));
  assert.equal(r.missingResults.length, 1);
});

test('team stats: values copied verbatim, leaders highlighted, duplicate jersey numbers not shown as fact', async () => {
  const store = await loadStore();
  for (const lg of ['men', 'women']) {
    const t = templateById(`teamstats-${lg}`);
    for (const c of store.clubs(lg)) {
      const r = bindTeamstats(store, lg, c.id, t, measure);
      assert.ok(r.shown.length <= t.rows);
      const nums = {};
      r.players.forEach(x => { nums[x.p['#']] = (nums[x.p['#']] || 0) + 1; });
      r.shown.forEach((x, i) => {
        assert.equal(r.values[`r${i}.name`].text, x.p['Játékos']);
        if (nums[x.p['#']] > 1) assert.equal(r.values[`r${i}.num`].text, MISSING);
        else assert.equal(r.values[`r${i}.num`].text, x.p['#']);
        for (const col of TEAMSTAT_COLS[lg]) {
          const n = parseFloat(x.p[col.key]);
          const txt = r.values[`r${i}.${col.key}`].text;
          if (Number.isFinite(n)) assert.equal(parseFloat(txt), col.key === 'M.' ? Math.round(n) : Math.round(n * 10) / 10, `${c.id} ${col.key}`);
        }
      });
    }
  }
  // DVTK sample from the PSD (round 7): Aho Tyra 6 / 7.2 / 3.7 / 4.2 (green, team best GP)
  const t = templateById('teamstats-women');
  const r = bindTeamstats(store, 'women', 'dvtkhuntherm', t, measure);
  const i = r.shown.findIndex(x => x.p['Játékos'].startsWith('Aho Tyra'));
  assert.deepEqual(['M.', 'P.', 'ÖLP', 'GP'].map(k => r.values[`r${i}.${k}`].text), ['6', '7.2', '3.7', '4.2']);
  assert.equal(r.values[`r${i}.GP`].color, '#1fbf1b');
});

test('team stats: more players than rows keeps those with most minutes', async () => {
  const store = await loadStore();
  const t = templateById('teamstats-men');
  const { all, shown } = teamstatPlayers(store, 'men', 'kecskemet', t.rows);
  assert.equal(all.length, 16);
  assert.equal(shown.length, 13);
  const minShown = Math.min(...shown.map(x => parseFloat(x.p['Idő'])));
  const hidden = all.filter(x => !shown.includes(x));
  for (const h of hidden) assert.ok(parseFloat(h.p['Idő']) <= minShown);
});

test('intro: round/date/time from fixtures, standings in rank line, venue never invented', async () => {
  const store = await loadStore();
  const m = store.upcoming('men')[0];
  const v = bindIntro(store, 'men', m, {});
  assert.match(v.round.text, new RegExp(`^Alapszakasz - ${m.roundNo}\\. forduló - ${m.date.replace(/-/g, '.')}\\. - ${m.time.replace(':', '.')}$`));
  const s = store.standing('men', m.homeId);
  assert.equal(v['home.rank'].text, `(${s.rank}. hely - ${s.wins}-${s.losses})`);
  if (m.homeId !== 'sopron') assert.equal(v.venue.text, MISSING);
  const sop = { ...m, homeId: 'sopron' };
  assert.equal(bindIntro(store, 'men', sop, {}).venue.text, 'Novomatic Aréna');
  assert.equal(bindIntro(store, 'men', m, { [`men/${m.homeId}`]: 'Teszt Csarnok' }).venue.text, 'Teszt Csarnok');
});

test('referees are manual and flagged until entered', () => {
  const v = bindReferees();
  for (const k of ['ref1', 'ref2', 'ref3', 'controller']) { assert.equal(v[k].text, MISSING); assert.ok(v[k].missing); }
});

test('schedule graphics hold at least 5 rows and every club gets at least 5 games from the data', async () => {
  const store = await loadStore();
  for (const lg of ['men', 'women']) {
    const t = templateById(`schedule-${lg}`);
    assert.ok(t.rows >= 5, `${lg} schedule design has ${t.rows} rows`);
    for (const c of store.clubs(lg)) {
      const r = bindRowList(store, lg, c.id, t);
      const filled = Array.from({ length: t.rows }, (_, i) => r.values[`r${i}.match`]?.text).filter(Boolean);
      assert.ok(filled.length >= 5, `${lg} ${c.id}: ${filled.length} games shown`);
      assert.equal(filled.length, Math.min(t.rows, store.nextGames(lg, c.id, 99).length));
    }
  }
});
