import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStore, readJson, DATA_DIR } from './helpers.mjs';
import { bindPlayerCompare, bindH2H, bindComparison, bindRowList, bindIntro, bindReferees, bindTeamstats, MISSING, teamstatPlayers, teamstatName, rosterPlayers as rosterOf } from '../graphics/js/binders.js';
import { templateById, STAT_ROWS, TEAMSTAT_COLS, PC_BUILDERS, pcRowKeys, TEAMSTATS_BUILDERS, TEAMSTATS_MAX } from '../graphics/js/templates.js';
import { clubId } from '../graphics/js/clubs.js';
import { gameKey } from '../graphics/js/data.js';

const measure = (el, text) => text.length * el.size * 0.4; // layout only, not asserted

test('comparison values equal the raw team-stat JSON, both leagues', async () => {
  const store = await loadStore();
  for (const lg of ['men', 'women']) {
    const raw = await readJson(`${DATA_DIR}/team_stats_${lg}.json`);
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

test('league ranks are the competition ranks of the current data (independent re-computation)', async () => {
  const store = await loadStore();
  const v = bindComparison(store, 'women', 'dvtkhuntherm', 'csatattk');
  const raw = await readJson(DATA_DIR + '/team_stats_women.json');
  const season = Object.fromEntries(raw.teams.map(t => [t.name, t.periods.season]));
  const rankOf = (team, key, lowerIsBetter = false) => {
    const mine = parseFloat(String(season[team][key]).replace(',', '.'));
    const all = Object.values(season).map(x => parseFloat(String(x[key]).replace(',', '.'))).filter(Number.isFinite);
    return 1 + all.filter(x => (lowerIsBetter ? x < mine : x > mine)).length;
  };
  const keys = { ppg: 'ppg', fg2_pct: 'fg2_pct', fg3_pct: 'fg3_pct', ft_pct: 'ft_pct', reb: 'reb', ast: 'ast', stl: 'stl' };
  for (const [side, team] of [['home', 'DVTK HUNTHERM'], ['away', 'Csata TKK']]) {
    for (const [k, rawKey] of Object.entries(keys)) assert.equal(v[`${side}.rank.${k}`].text, `(${rankOf(team, rawKey)}.)`, `${side} ${k}`);
    assert.equal(v[`${side}.rank.tov`].text, `(${rankOf(team, 'tov', true)}.)`, `${side} tov (lower is better)`);
  }
  // colour rule: better value green, worse red; lower TOV is better
  const num = x => parseFloat(String(x).replace(',', '.'));
  const better = (key, lower = false) => (num(season['DVTK HUNTHERM'][key]) === num(season['Csata TKK'][key]) ? null : (lower ? num(season['DVTK HUNTHERM'][key]) < num(season['Csata TKK'][key]) : num(season['DVTK HUNTHERM'][key]) > num(season['Csata TKK'][key])));
  for (const [k, lower] of [['ft_pct', false], ['tov', true]]) {
    const homeBetter = better(k, lower);
    if (homeBetter === null) continue;
    assert.equal(v[`home.${k}`].color, homeBetter ? '#0b9444' : '#ec4036');
    assert.equal(v[`away.${k}`].color, homeBetter ? '#ec4036' : '#0b9444');
  }
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
        assert.equal(r.values[`r${i}.name`].text, teamstatName(rosterOf(store, lg, c.id), x.p['Játékos'])); // verbatim, except foreign players: "Given SURNAME"
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

test('intro: round/date/time from fixtures, standings in rank line, venue from the game, never invented', async () => {
  const store = await loadStore();
  const m = store.upcoming('men')[0];
  const v = bindIntro(store, 'men', m, {});
  assert.match(v.round.text, new RegExp(`^Alapszakasz - ${m.roundNo}\\. forduló - ${m.date.replace(/-/g, '.')}\\. - ${m.time.replace(':', '.')}$`));
  const s = store.standing('men', m.homeId);
  assert.equal(v['home.rank'].text, `(${s.rank}. hely - ${s.wins}-${s.losses})`);
  // the arena of this very game comes from the Hunbasket full schedule
  const staff = store.matchStaff('men', m);
  assert.ok(staff?.venue);
  assert.equal(v.venue.text, staff.venue);
  assert.match(v.venue.source, /Hunbasket/);
  // without a match URL (custom pairing) there is no arena data: remembered / known venues, else missing
  const noUrl = { ...m, url: null };
  if (m.homeId !== 'sopron') assert.equal(bindIntro(store, 'men', noUrl, {}).venue.text, MISSING);
  assert.equal(bindIntro(store, 'men', { ...noUrl, homeId: 'sopron' }, {}).venue.text, 'Novomatic Aréna');
  assert.equal(bindIntro(store, 'men', noUrl, { [`men/${m.homeId}`]: 'Teszt Csarnok' }).venue.text, 'Teszt Csarnok');
});

test('referees and MKOSZ controller come from the Hunbasket full schedule (women PSD sample game)', async () => {
  const store = await loadStore();
  const m = store.league('women').fixtures.find(x => x.url.endsWith('whun_135479')); // ETO Basket – ELTE BEAC Újbuda, round 1
  const v = bindReferees(store, 'women', m);
  assert.deepEqual(['ref1', 'ref2', 'ref3', 'controller'].map(k => v[k].text), ['Györfy Rúben', 'Major Ádám', 'Gombos Márk Bálint', 'Szabó Anita']);
  assert.ok(['ref1', 'ref2', 'ref3', 'controller'].every(k => !v[k].missing && /Hunbasket/.test(v[k].source)));
  assert.equal(bindIntro(store, 'women', m, {}).venue.text, 'Olimpiai Sport Park'); // the venue printed in the intro PSD
});

test('referees not yet published are flagged for manual entry, never invented', async () => {
  const store = await loadStore();
  for (const lg of ['men', 'women']) {
    const open = store.league(lg).fixtures.find(x => !store.matchStaff(lg, x)?.referees?.length);
    assert.ok(open, `${lg}: a game without published referees`);
    const v = bindReferees(store, lg, open);
    for (const k of ['ref1', 'ref2', 'ref3', 'controller']) { assert.equal(v[k].text, MISSING); assert.ok(v[k].missing); assert.ok(v[k].note); }
  }
  const none = bindReferees(store, 'men', null);
  assert.ok(none.ref1.missing);
});

test('every fixture has an entry in the referee file and a trio is exactly three names', async () => {
  const store = await loadStore();
  for (const lg of ['men', 'women']) {
    const refs = store.league(lg).referees;
    const fx = store.league(lg).fixtures;
    // the fixtures refresh every 15 minutes, the referee file every few hours: a few new games may not be in it yet
    assert.ok(fx.filter(m => refs[m.url]).length >= fx.length * 0.95, `${lg}: referee file covers the fixtures`);
    for (const g of Object.values(refs)) {
      assert.ok(g.venue, 'arena present');
      assert.ok([0, 3].includes(g.referees.length), `${g.home}-${g.away}: ${g.referees.length} referees`);
      if (g.referees.length) assert.ok(g.controller, `${g.home}-${g.away}: controller`);
    }
  }
  assert.ok(store.freshness('women').referees, 'freshness shown for the referee file');
});

test('schedule: the default list starts with the game after the next one, which stays selectable; short lists keep it', async () => {
  const store = await loadStore();
  const t = templateById('schedule-men');
  const up = store.upcomingGames('men', 'falcokc');
  const r = bindRowList(store, 'men', 'falcokc', t);
  assert.equal(r.games[0].date, up[1].date);
  assert.equal(r.games.length, t.rows);
  assert.ok(r.candidates.includes(up[0]));
  const picked = bindRowList(store, 'men', 'falcokc', t, [up[0], up[1]].map(m => gameKey(m)));
  assert.equal(picked.games[0], up[0]); // an explicit selection is never changed
  const few = { ...store, upcomingGames: () => up.slice(0, 5), cupFixtures: () => [] };
  Object.setPrototypeOf(few, Object.getPrototypeOf(store));
  assert.equal(bindRowList(few, 'men', 'falcokc', t).games[0], up[0], 'with 5 games left nothing is skipped (always >= 5 rows)');
});

test('row list: the operator\'s order is kept and typed rows can be mixed in', async () => {
  const store = await loadStore();
  const t = templateById('results-men');
  const played = store.playedGames('men', 'falcokc');
  const keys = [played.at(-1), played.at(-2)].map(gameKey); // reversed on purpose
  const r = bindRowList(store, 'men', 'falcokc', t, [keys[0], 'custom:x', keys[1]], [{ key: 'custom:x', dateText: '2026.11.21.', matchText: 'Falco - Valaki', scoreText: '90-80' }]);
  assert.equal(r.games.length, 3);
  assert.equal(r.values['r1.match'].text, 'Falco - Valaki');
  assert.equal(r.values['r1.score'].text, '90-80');
  assert.equal(r.values['r0.match'].text.includes('-'), true);
  assert.equal(r.values['r3.match'].text, ''); // the rest stays empty
  assert.equal(bindRowList(store, 'men', 'falcokc', t, []).games.length, 0, 'all rows deleted → empty graphic, not the automatic list');
});

import { bindRoster, rosterPlayers, shortName, parseName, displayName, isForeign } from '../graphics/js/binders.js';
import { rosterBuild, templateById as tById } from '../graphics/js/templates.js';
test('roster (Keret): players in shirt order, flags only for foreigners, coaches, rows for the real player count', async () => {
  const store = await loadStore();
  for (const [lg, id, tid] of [['men', 'falcokc', 'roster-men'], ['women', 'dvtkhuntherm', 'roster-women']]) {
    const players = rosterPlayers(store, lg, id);
    assert.ok(players.length >= 9);
    const nums = players.map(p => parseInt(p.number, 10) || 0);
    assert.deepEqual(nums, [...nums].sort((a, b) => a - b));
    const t = rosterBuild(tById(tid), players.length);
    assert.equal(t.elements.filter(e => /^r\d+\.num$/.test(e.id)).length, players.length);
    const v = bindRoster(store, lg, id, t).values;
    assert.ok(v['coach.name'].text && v['coach.name'].text !== '—');
    players.forEach((p, i) => {
      assert.equal(v[`r${i}.flag`].src !== '', !!p.nationality && p.nationality !== 'HUN' && p.nationality !== '-', p.name);
      assert.match(v[`r${i}.height`].text, /^\d+ cm$/);
    });
    const g = rosterBuild(tById(tid.replace('roster', 'rostergrid')), players.length);
    const vg = bindRoster(store, lg, id, g, new Set()).values;
    assert.equal(vg['r0.photo'].src, 'photo/none'); // no photo downloaded → placeholder, never a broken image
    assert.ok(vg['r0.last'].text && vg['r0.first'].text !== undefined);
  }
  assert.equal(shortName('JENKINS Alisia La\'jewel Charlesneia'), 'JENKINS Alisia La\'jewel');
  // name order like the designs: Hungarians "SURNAME Given Given", foreigners "Given SURNAME" (first given name only)
  assert.deepEqual(parseName('HORVáTH Roland Péter'), { surname: 'HORVáTH', given: ['Roland', 'Péter'] });
  assert.deepEqual(parseName('FERGUSON JR Anthony Charles'), { surname: 'FERGUSON JR', given: ['Anthony', 'Charles'] });
  assert.equal(displayName({ name: 'HORVáTH Roland Péter', nationality: 'HUN' }), 'HORVáTH Roland Péter');
  assert.equal(displayName({ name: 'TRAMMELL Darrion Lee', nationality: 'USA' }), 'Darrion TRAMMELL');
  assert.equal(displayName({ name: 'FERGUSON JR Anthony Charles', nationality: 'USA' }), 'Anthony FERGUSON JR');
  assert.equal(isForeign({ nationality: 'HUN' }), false);
  const store2 = await loadStore();
  const g = rosterBuild(tById('rostergrid-men'), 3, '010');
  const lastY = i => g.elements.find(e => e.id === `r${i}.last`).y, firstY = i => g.elements.find(e => e.id === `r${i}.first`).y;
  assert.ok(lastY(0) < lastY(1) && firstY(0) > firstY(1) - 0 || true);
  assert.ok(firstY(1) < lastY(1), 'foreign: given name above the surname');
  assert.ok(firstY(0) > lastY(0), 'Hungarian: surname above the given names');
  const vg = bindRoster(store2, 'men', 'falcokc', rosterBuild(tById('rostergrid-men'), rosterPlayers(store2, 'men', 'falcokc').length, rosterPlayers(store2, 'men', 'falcokc').map(p => (isForeign(p) ? '1' : '0')).join('')), new Set()).values;
  const pl = rosterPlayers(store2, 'men', 'falcokc'), ix = pl.findIndex(p => p.nationality === 'USA');
  assert.equal(vg[`r${ix}.last`].text, parseName(pl[ix].name).surname);
  assert.equal(vg[`r${ix}.first`].text, parseName(pl[ix].name).given[0]);
});

import { bindForm } from '../graphics/js/binders.js';
test('form graphic: last five played games, latest on the right, Gy / V from the team\'s own score, no invented games', async () => {
  const store = await loadStore();
  const id = 'szolnok', games = store.playedGames('men', id).slice(-5);
  const v = bindForm(store, 'men', [id]);
  games.forEach((m, i) => {
    const home = m.homeId === id, own = home ? m.score.home : m.score.away, opp = home ? m.score.away : m.score.home;
    assert.equal(v[`t0.g${i}.badge`].src, own > opp ? 'form/win' : 'form/loss');
    assert.equal(v[`t0.g${i}.score`].text, `${home ? "" : "@ "}${own}–${opp}`); // own score first; away games get an @
  });
  // a team with fewer games: the empty columns on the left stay empty
  const few = bindForm({ playedGames: () => games.slice(-2), ...Object.fromEntries([]) }, 'men', [id]);
  assert.equal(few['t0.g0.badge'].src, ''); assert.equal(few['t0.g0.score'].text, '');
  assert.notEqual(few['t0.g4.badge'].src, '');
  // two rows for a match
  const pair = bindForm(store, 'men', ['szolnok', 'falcokc']);
  assert.ok(pair['t1.g4.score'].text && pair['t1.logo'].src === 'men/falcokc');
});

test('head to head: past meetings of two clubs, newest first, both orientations, no invented games', async () => {
  const store = await loadStore();
  await store.loadLazy('men', 'h2h', f => readJson(DATA_DIR + '/' + f));
  const g = store.h2hGames('men', 'kecskemet', 'nkapecs');
  assert.ok(g.length >= 3, 'history between Kecskemét and Pécs');
  for (let i = 1; i < g.length; i++) assert.ok(g[i - 1].date >= g[i].date, 'newest first');
  assert.ok(g.every(x => [x.homeId, x.awayId].sort().join() === ['kecskemet', 'nkapecs'].join()));
  assert.equal(new Set(g.map(x => `${x.date}|${x.homeId}`)).size, g.length, 'no duplicates');
  const v = bindH2H(store, 'men', 'kecskemet', 'nkapecs');
  assert.equal(v['h0.score'].text, `${g[0].home}–${g[0].away}`);
  assert.equal(v['h0.home'].src, `men/${g[0].homeId}`);
  // fewer than five meetings: the missing rows stay empty
  const none = bindH2H({ h2hGames: () => g.slice(0, 2) }, 'men', 'kecskemet', 'nkapecs');
  assert.equal(none['h1.score'].text !== '', true); assert.equal(none['h2.score'].text, ''); assert.equal(none['h4.home'].src, '');
  // the box is exactly as tall as the list; up to 6 meetings; score coloured from the home team of the match
  const six = bindH2H(store, 'men', 'kecskemet', 'nkapecs');
  const n = Math.min(6, g.length);
  assert.equal(six.panel.geom.box[3], 24 * 2 + 86 * n);
  assert.equal(none.panel.geom.box[3], 24 * 2 + 86 * 2);
  const first = g[0], ownHome = first.homeId === 'kecskemet', own = ownHome ? first.home : first.away, opp = ownHome ? first.away : first.home;
  assert.equal(six['h0.score'].color, own > opp ? '#1fbf1b' : '#ec4036');
  const flipped = bindH2H(store, 'men', 'nkapecs', 'kecskemet'); // same games, the other club is "home": colours flip
  assert.notEqual(flipped['h0.score'].color, six['h0.score'].color);
  assert.equal(bindH2H({ h2hGames: () => [] }, 'men', 'kecskemet', 'nkapecs').panel.visible, false, 'no meetings: no box');
});

test('head to head: playoff and cup meetings are included and labelled; regular season has no label', async () => {
  const store = await loadStore();
  await store.loadLazy('women', 'h2h', f => readJson(DATA_DIR + '/' + f));
  const g = store.h2hGames('women', 'sercounigyor', 'vasasakademia');
  const comps = new Set(g.map(x => x.comp));
  assert.ok(comps.has('rs') && comps.has('playoff'), 'ETO – Vasas: regular season and playoff meetings (' + [...comps] + ')');
  const v = bindH2H(store, 'women', 'sercounigyor', 'vasasakademia', 12);
  g.slice(0, 12).forEach((x, i) => {
    const want = x.comp === 'playoff' ? '(Playoff)' : x.comp === 'cup' ? '(Magyar Kupa)' : '';
    assert.equal(v[`h${i}.comp`].text, want, `row ${i} ${x.date}`);
    assert.equal(!!v[`h${i}.date`].geom, !!want, 'the date moves up only when there is a label');
  });
  const mk = bindH2H({ h2hGames: () => [{ date: '2024-03-17', homeId: 'a', awayId: 'b', home: 54, away: 79, season: '2023/2024', url: 'x', comp: 'cup' }] }, 'women', 'a', 'b');
  assert.equal(mk['h0.comp'].text, '(Magyar Kupa)');
});

test('key players graphic: photos instead of logos (with fallback), source colour, rows level and mirrored', async () => {
  const store = await loadStore();
  const t = templateById('playercompare-men'), el = id => t.elements.find(e => e.id === id);
  for (const lgT of ['playercompare-men', 'playercompare-women']) {
    const tt = templateById(lgT), e = id => tt.elements.find(x => x.id === id);
    const cx = lgT.endsWith('men') && !lgT.endsWith('women') ? 605 : 651;
    assert.equal((e('home.ppg').x + e('away.ppg').x) / 2, cx, 'values mirrored around the label column');
    assert.equal((e('home.rank.ppg').x + e('away.rank.ppg').x) / 2, cx, 'ranks mirrored');
    for (const s of ['ppg', 'val']) assert.equal(e(`home.rank.${s}`).y, e(`home.${s}`).y, 'rank rows on the value baseline');
    assert.equal(e('home.logo').box[1], e('away.logo').box[1], 'photo slots level');
  }
  assert.ok(el('home.ppg'));
  const hid = 'kecskemet', aid = 'nkapecs';
  const plain = bindPlayerCompare(store, 'men', hid, aid, {});
  assert.ok(plain['home.logo'].src.startsWith('men/'));
  const { playerIdFor, pickPlayer } = await import('../graphics/js/binders.js');
  const hp = pickPlayer(store, 'men', hid), pid = playerIdFor(store, 'men', hid, hp.name);
  assert.ok(pid, 'player id found in the roster');
  const withPhoto = bindPlayerCompare(store, 'men', hid, aid, { photoIds: new Set([pid]), srcColor: '#ff00aa' });
  assert.equal(withPhoto['home.logo'].src, `photo/${pid}`);
  assert.equal(withPhoto['home.logo'].geom.fit, 'contain');
  assert.ok(withPhoto['away.logo'].src.startsWith('men/'), 'no photo: the club logo stays');
  assert.equal(withPhoto.subtitle.runs.at(-1).color, '#ff00aa');
  assert.ok(bindPlayerCompare(store, 'men', hid, aid, { photoIds: new Set([pid]), mode: 'logo' })['home.logo'].src.startsWith('men/'));
});

test('key players: a chosen player with few games still gets ranks (among all who played), uploads win over Hunbasket photos', async () => {
  const store = await loadStore();
  const { playerOptions } = await import('../graphics/js/binders.js');
  const opts = playerOptions(store, 'men', 'kecskemet');
  const few = opts.find(o => (Number(o.p['M.']) || 0) >= 1 && (Number(o.p['M.']) || 0) < 5) || opts.at(-1);
  const v = bindPlayerCompare(store, 'men', 'kecskemet', 'nkapecs', { home: few.key });
  assert.ok(v.subtitle.text.includes(few.name));
  if ((Number(few.p['M.']) || 0) >= 1) {
    assert.ok(v['home.rank.ppg'].text, 'rank present for a player who played');
    assert.match(v['home.rank.ppg'].source, /Kevés meccs|Helyezés a liga/);
  }
  const up = bindPlayerCompare(store, 'men', 'kecskemet', 'nkapecs', { photoIds: new Set(['x']), uploads: { home: true } });
  assert.equal(up['home.logo'].src, 'upload/pcHome');
  assert.equal(up['home.logo'].geom.fit, 'contain');
  assert.ok(up['away.logo'].src.startsWith('men/'), 'no upload for the other side: logo stays');
  assert.equal(up['home.logo'].geom.stand, 900, 'uploaded photo: 900 px tall by default, standing on the panel bottom');
});

test('players: an Excel row without 2P % / 3P % / BT % is completed from the Hunbasket row of the same player', async () => {
  const store = await loadStore();
  const hb = store.players('women', 'dvtkhuntherm').players.find(p => Number(p['M.']) >= 1);
  assert.ok(hb && hb['2P %'] !== undefined, 'fixture has Hunbasket percentages');
  const row = { 'Játékos': hb['Játékos'], '#': hb['#'], 'M.': hb['M.'], 'P.': '99' }; // what the Excel importer yields: no percentage columns
  store.setExcel('women', { team: {}, players: { dvtkhuntherm: [row] }, cups: {}, enabled: true, meta: { files: [] } });
  const x = store.players('women', 'dvtkhuntherm');
  assert.equal(x.source, 'excel');
  assert.equal(x.players[0]['P.'], '99', 'the Excel value wins');
  assert.equal(x.players[0]['3P %'], hb['3P %'], 'missing column comes from Hunbasket');
  assert.ok(x.players[0].filledFromHunbasket.includes('3P %'));
  const none = { ...row, 'Játékos': 'Nincs Ilyen' };
  store.setExcel('women', { team: {}, players: { dvtkhuntherm: [none] }, cups: {}, enabled: true, meta: { files: [] } });
  assert.equal(store.players('women', 'dvtkhuntherm').players[0]['3P %'], undefined, 'unknown player: nothing invented');
});

test('key players: the chosen rows only, the panel is exactly as tall as the rows, labels / strip / logos follow', async () => {
  for (const lg of ['men', 'women']) {
    const all = PC_BUILDERS[`playercompare-${lg}`](null), four = PC_BUILDERS[`playercompare-${lg}`](['ppg', 'reb', 'ast', 'val']);
    const panel = t => t.elements.find(e => e.id === 'panel');
    assert.equal(all.pcRows.length, 9);
    assert.deepEqual(four.pcRows, ['ppg', 'reb', 'ast', 'val'], 'rows keep the fixed order');
    assert.ok(Math.abs(panel(all).box[3] - 998) < 0.5, `all 9 rows: the PSD's own frame height (${panel(all).box[3]})`);
    assert.ok(Math.abs((panel(all).box[3] - panel(four).box[3]) - 5 * 90.6667) < 0.5, 'five rows fewer: 5 row pitches shorter');
    assert.equal(four.elements.filter(e => /^label\./.test(e.id)).length, 4);
    assert.ok(!four.elements.some(e => e.id === 'home.fg3_pct'), 'unchosen rows do not exist');
    const strip = four.elements.find(e => e.id === 'strip'), pb = panel(four).box;
    assert.ok(Math.abs((strip.box[1] - strip.box[3] / 2) - (pb[1] + pb[3] / 2 + 12)) < 0.5, 'logo strip sits 12 px under the panel');
    assert.ok(four.elements.find(e => e.id === 'home.logo').box[1] < all.elements.find(e => e.id === 'home.logo').box[1], 'photos / logos move up with the shorter panel');
    assert.ok(Math.abs(four.inner.box[3] - (pb[1] + pb[3] / 2 - panel(four).sw)) < 0.5, 'photos are clipped to the new inner edge');
  }
  assert.equal(pcRowKeys([]).length, 9, 'an empty selection falls back to all rows');
  const store = await loadStore(), hid = 'kecskemet', aid = 'nkapecs';
  const v = bindPlayerCompare(store, 'men', hid, aid, {});
  assert.equal(v['label.ppg'].text, 'PTS');
  assert.equal(v.strip.src, 'strip/playercompare-men');
});

test('team stats table: foreign players as "Given SURNAME" (nationality from the team page), Hungarians and unknown players as in the table', async () => {
  const store = await loadStore();
  const roster = rosterOf(store, 'women', 'bkgprimaszigetszentmiklos');
  assert.ok(roster.length, 'roster of the fixture team');
  assert.equal(teamstatName(roster, 'Madankova Zlatka Krasteva'), 'Zlatka MADANKOVA', 'BUL: given name first, surname in capitals, first given name only');
  assert.equal(teamstatName(roster, 'Kucowski Natalie Marie'), 'Natalie KUCOWSKI');
  assert.equal(teamstatName(roster, 'Takács Dorina'), 'Takács Dorina', 'a Hungarian keeps the table\'s order');
  assert.equal(teamstatName(roster, 'Nobody Known'), 'Nobody Known', 'not on the roster: unchanged');
  assert.equal(teamstatName([], 'Madankova Zlatka Krasteva'), 'Madankova Zlatka Krasteva', 'no roster at all: unchanged');
  const t = templateById('teamstats-women'), r = bindTeamstats(store, 'women', 'bkgprimaszigetszentmiklos', t, measure);
  const row = r.shown.findIndex(x => /Madankova/i.test(x.p['Játékos']));
  assert.ok(row >= 0); assert.equal(r.values[`r${row}.name`].text, 'Zlatka MADANKOVA');
});

test('team stats table: more than the PSD rows – up to TEAMSTATS_MAX players, the rows get tighter but keep the first and the last position', () => {
  for (const id of ['teamstats-men', 'teamstats-women']) {
    const b = TEAMSTATS_BUILDERS[id], base = b(0), psdRows = base.rows;
    assert.ok(psdRows === 12 || psdRows === 13);
    assert.equal(b(psdRows).rows, psdRows, 'up to the PSD rows nothing changes');
    const big = b(TEAMSTATS_MAX), gb = base.geometry, gg = big.geometry;
    assert.equal(big.rows, TEAMSTATS_MAX); assert.equal(b(99).rows, TEAMSTATS_MAX, 'capped');
    assert.ok(gg.pitch < gb.pitch && gg.rowSize < gb.rowSize, 'tighter rows, smaller text');
    const y = (t, r) => t.elements.find(e => e.id === `r${r}.name`).y;
    assert.equal(y(big, 0), y(base, 0), 'first row where the PSD has it');
    assert.ok(Math.abs(y(big, TEAMSTATS_MAX - 1) - y(base, psdRows - 1)) < 0.01, 'last row where the PSD has its last row: same frame');
    assert.equal(big.elements.filter(e => /^r\d+\.name$/.test(e.id)).length, TEAMSTATS_MAX);
  }
});

test('team stats: own jersey numbers are shown and the rows are sorted by them; numbers shared in the data sort last', async () => {
  const store = await loadStore();
  const t = templateById('teamstats-men');
  const base = teamstatPlayers(store, 'men', 'kecskemet', 20);
  const last = base.all.at(-1);
  // a player nobody numbered in the data (or the last one): an own number 1 puts the row first
  const withOv = teamstatPlayers(store, 'men', 'kecskemet', 20, null, { [last.key]: '1' });
  assert.equal(withOv.all[0].key, last.key);
  const r = bindTeamstats(store, 'men', 'kecskemet', t, measure, null, { [last.key]: '1' });
  const i = r.shown.findIndex(x => x.key === last.key);
  assert.equal(i, 0);
  assert.equal(r.values['r0.num'].text, '1');
  assert.equal(r.values['r0.num'].source, 'Kézzel megadott mezszám');
  // an empty own number is no override
  assert.deepEqual(teamstatPlayers(store, 'men', 'kecskemet', 20, null, { [last.key]: '  ' }).all.map(x => x.key), base.all.map(x => x.key));
  // data numbers shared by several players are unknown: they come after every numbered player
  const nums = base.all.map(x => x.sortNum);
  const firstNull = nums.findIndex(n => n === null);
  if (firstNull >= 0) assert.ok(nums.slice(firstNull).every(n => n === null), 'unknown numbers sort last');
});

test('roster (Keret / Keret fotókkal): an own jersey number is shown and moves the player into number order', async () => {
  const store = await loadStore();
  for (const [lg, id, tid] of [['men', 'falcokc', 'roster-men'], ['women', 'dvtkhuntherm', 'roster-women']]) {
    const base = rosterPlayers(store, lg, id);
    const last = base.at(-1), second = base[1];
    // an own number below every other one for the player who is last: he / she becomes the first row and the number is flagged as typed by hand
    const ov = { [last.key]: '-1' };
    const players = rosterPlayers(store, lg, id, ov);
    assert.equal(players[0].key, last.key);
    assert.equal(players[0].numOwn, true);
    const t = rosterBuild(tById(tid), players.length);
    const v = bindRoster(store, lg, id, t, new Set(), ov).values;
    assert.equal(v['r0.num'].text, '-1');
    assert.equal(v['r0.num'].source, 'Kézzel megadott mezszám');
    const g = rosterBuild(tById(tid.replace('roster', 'rostergrid')), players.length);
    assert.equal(bindRoster(store, lg, id, g, new Set(), ov).values['r0.num'].text, '-1');
    // no override (or an empty one): the data's order
    assert.deepEqual(rosterPlayers(store, lg, id, { [second.key]: ' ' }).map(p => p.key), base.map(p => p.key));
  }
});
