import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ROOT } from './helpers.mjs';
import path from 'node:path';
import { decodeFeed, parseGame, topByEff, gameCode, gameClock, playedPlayers, efficiency, mmss, feedUrl, feedProblem } from '../graphics/js/live.js';
import { loadStore } from './helpers.mjs';
import { bindLiveStat, bindLiveTeam, bindLiveLeaders, normHex, leaderColors, leaderShadow, livePeriodLabel, liveTimeLabel, liveChoice } from '../graphics/js/binders.js';
import { LIVE_BUILDERS, LIVE_VARIANTS, LIVE_CORNERS, LIVE_COLORS, BUG, liveVariant, liveCorner, liveWidth, liveDims, liveKeys, LIVE_STATS, templateById, TEMPLATE_TYPES, LIVE_TEAM_BUILDERS, LIVE_LEADER_BUILDERS, liveLeaderSize, liveLeaderCells, LIVE_TEAM_STATS, LIVE_TEAM_COLORS, liveTeamKeys, liveTeamSize } from '../graphics/js/templates.js';

// A finished game (ETO Basket – VBW CEKK Cegléd, women, 2026-11-22, final 90–48) saved from the public netcasting feed.
const raw = await readFile(path.join(ROOT, 'tests/fixtures/live/whun_135563.full.txt'), 'utf8');

test('live feed: game code from a netcasting link / plain code', () => {
  assert.equal(gameCode('https://netcasting4.webpont.com/?whun_135563'), 'whun_135563');
  assert.equal(gameCode('  WHUN_135563 '), 'whun_135563');
  assert.equal(gameCode('hun_134947'), 'hun_134947');
  assert.equal(gameCode('nothing'), null);
  assert.equal(gameCode('https://netcasting4.webpont.com/?hunu18_142679'), 'hunu18_142679', 'junior games (hunu18_…)');
  assert.equal(feedUrl('hunu18_142679'), 'https://netcasting4.webpont.com/storage/fullhunu18_142679.html');
  assert.equal(gameCode('https://hunbasket.hu/merkozes/x2324/whun_ply/whun_ply_68632'), null, 'a playoff match page is not a netcasting code');
  assert.equal(gameCode(''), null);
});

test('live feed: a truncated / empty / foreign text is rejected, never half-parsed', () => {
  assert.equal(decodeFeed(''), null);
  assert.equal(decodeFeed(null), null);
  assert.equal(decodeFeed('<html>not a feed</html>'), null);
  assert.equal(decodeFeed(raw.slice(0, 5000)), null, 'a feed cut in the middle is invalid');
  assert.ok(decodeFeed(raw));
});

test('live feed: score, teams and period come out right', () => {
  const g = parseGame(decodeFeed(raw), 'whun_135563');
  assert.equal(g.id, 'whun_135563');
  assert.deepEqual(g.score, { home: 90, away: 48 });
  assert.deepEqual(g.scoreFromEvents, { home: 90, away: 48 }, 'the counted points equal the official score');
  assert.equal(g.teams.home.name, 'ETO BASKET');
  assert.equal(g.teams.away.name, 'VBW CEKK CEGLÉD');
  assert.equal(g.teams.home.hunbasketId, '51119');
  assert.equal(g.date, '2026-11-22');
  assert.equal(g.finished, true);
  assert.deepEqual(g.clock, { period: 4, elapsed: 600, seconds: 2400 });
  assert.equal(g.referees.length, 3);
});

test('live feed: player points add up to the team, per-player lines are consistent', () => {
  const g = parseGame(decodeFeed(raw), 'whun_135563');
  for (const side of ['home', 'away']) {
    const sum = g.players.filter(p => p.side === side).reduce((a, p) => a + p.stat.pts, 0);
    assert.equal(sum, g.score[side], `${side}: the players' points make the team score`);
  }
  for (const p of g.players) {
    const s = p.stat;
    assert.equal(s.pts, 2 * s.fg2m + 3 * s.fg3m + s.ftm, `${p.name}: points from the made shots`);
    assert.ok(s.fg2m <= s.fg2a && s.fg3m <= s.fg3a && s.ftm <= s.fta, `${p.name}: made never exceeds attempted`);
    assert.equal(p.reb, s.oreb + s.dreb);
  }
  const galos = g.players.find(p => p.code === 'B203034');
  assert.equal(galos.number, '11');
  assert.equal(galos.stat.pts, 15);
  assert.equal(galos.stat.fg3m, 4);
  assert.equal(mmss(galos.seconds), '25:18', "the page's own playing time");
});

test('live feed: played players, best scorer first; efficiency formula', () => {
  const g = parseGame(decodeFeed(raw), 'whun_135563');
  const home = playedPlayers(g, 'home');
  assert.ok(home.length >= 8 && home.every(p => p.side === 'home'));
  assert.ok(home.every((p, i) => i === 0 || home[i - 1].stat.pts >= p.stat.pts), 'sorted by points');
  assert.equal(efficiency({ pts: 10, oreb: 1, dreb: 2, ast: 3, stl: 1, blk: 0, fouled: 2, fg2a: 5, fg2m: 3, fg3a: 2, fg3m: 1, fta: 2, ftm: 2, tov: 2, blkAgainst: 0, pf: 3 }), 10 + 1 + 2 + 3 + 1 + 0 + 2 - (2 + 1 + 0) - 2 /* no deduction for fouls or blocks against: the page's VAL */);
});

test('live feed: game clock from elapsed seconds (4 x 10 min, overtimes 5 min)', () => {
  assert.deepEqual(gameClock(0), { period: 1, elapsed: 0, seconds: 0 });
  assert.deepEqual(gameClock(600), { period: 1, elapsed: 600, seconds: 600 });
  assert.deepEqual(gameClock(601), { period: 2, elapsed: 1, seconds: 601 });
  assert.equal(gameClock(2400).period, 4);
  assert.deepEqual(gameClock(2401), { period: 5, elapsed: 1, seconds: 2401 });
  assert.equal(gameClock(2701).period, 6);
});

test('live graphic: a thin strip on the score bug\'s level, centred in the gap left of it, for both score bug sizes', () => {
  for (const size of ['large', 'small']) {
    const [zx0, zy0, zx1, zy1] = BUG[size].zone;
    for (const id of ['livestat-men', 'livestat-women']) {
      assert.equal(templateById(id).type, 'livestat');
      for (const place of Object.keys(LIVE_CORNERS)) for (const [k, V] of Object.entries(LIVE_VARIANTS)) {
        const t = LIVE_BUILDERS[id](k, place, size), panel = t.elements.find(e => e.id === 'panel');
        const [cx, cy, w, h] = panel.box, x0 = cx - w / 2, y0 = cy - h / 2, x1 = x0 + w, y1 = y0 + h;
        assert.ok(w <= 1040 && h <= 150, `${id}/${k}/${place}/${size}: strip ${w}x${h}`);
        assert.equal(w, liveWidth(k), 'photo | name + figures | club logo');
        if (k === 'basic') assert.ok(w <= 610, `${k}: compact`);
        assert.ok(x1 <= zx0 || y1 <= zy0 || x0 >= zx1 || y0 >= zy1, `${id}/${k}/${place}/${size}: clear of the score bug zone`);
        assert.ok(x0 >= 0 && y0 >= 0 && x1 <= 1920 && y1 <= 1080, 'inside the picture');
        if (place === 'gap') {
          assert.ok(Math.abs(cx - BUG[size].cx) <= 1, `${size}/${k}: centred in the gap between the picture's left edge and the score bug (${cx} vs ${BUG[size].cx})`);
          assert.ok(Math.abs(cy - BUG[size].cy) <= 12, `${size}/${k}: on the score bug's level (centre ${cy})`);
          assert.ok(y1 <= 1060, 'not at the very edge of the picture');
        } else assert.ok(y0 < 100, 'top-left');
        for (const e of t.elements) { // every element lies inside the strip
          if (e.id === 'panel') continue;
          const [bx, by, bw] = e.type === 'image' ? e.box : [e.x, e.y, e.maxWidth || 0];
          const ex0 = e.type === 'image' ? bx - bw / 2 : (e.align === 'left' ? bx : bx - bw / 2), ex1 = e.type === 'image' ? bx + bw / 2 : (e.align === 'left' ? bx + bw : bx + bw / 2);
          assert.ok(ex0 >= x0 - 1 && ex1 <= x1 + 1 && by <= y1 + 1 && by >= y0 - 1, `${id}/${k}/${place}/${size}: ${e.id} inside the strip`);
        }
        assert.equal(t.elements.filter(e => /^c\d+\.value$/.test(e.id)).length, V.keys.length);
        // layout: photo at the left end, club logo at the right end (about as big as the photo), the name centred on the middle of the figures row
        const el = i => t.elements.find(e => e.id === i), ph = el('photo').box, lg = el('logo').box, vals = t.elements.filter(e => /^c\d+\.value$/.test(e.id));
        assert.ok(ph[0] < x0 + 200 && lg[0] > x1 - 200, 'photo left, logo right');
        assert.deepEqual([lg[2], lg[3]], [100, 100], 'the club logo is 100 px');
        assert.ok(Math.abs(lg[1] - (y0 + y1) / 2) <= 1 && lg[0] - 50 >= x1 - 10 - 120 && lg[0] + 50 <= x1 - 10, `logo centred vertically, inside the right column (${lg})`);
        assert.ok(Math.abs(el('name').x - (vals[0].x + vals.at(-1).x) / 2) <= 0.5 && el('name').align === 'center', 'the name is centred on the middle of the figures row');
        assert.equal(el('name').color, LIVE_COLORS.name); assert.ok(vals.every(v => v.color === LIVE_COLORS.value), 'figures in their own colour');
        assert.ok(t.elements.filter(e => /^c\d+\.label$/.test(e.id)).every(l => l.color === LIVE_COLORS.label), 'labels in the name colour');
        assert.ok(t.elements.some(e => e.id === 'photo') && t.elements.some(e => e.id === 'name'));
        assert.ok(!t.elements.some(e => e.id === 'sub') && !t.elements.some(e => /\.sub$/.test(e.id)), 'no status line under the name');
        assert.deepEqual(panel.stroke, id.endsWith('women') ? '#ef4036' : '#0b9444', 'league outline colour');
      }
    }
  }
  assert.equal(LIVE_COLORS.name, LIVE_COLORS.label, 'name and category share a colour');
  assert.notEqual(LIVE_COLORS.value, LIVE_COLORS.name, 'the figures stand out');
  assert.equal(BUG.large.cx, 600); assert.equal(BUG.small.cx, 712);
  assert.equal(liveVariant('nonsense'), 'basic');
  assert.equal(liveCorner('nonsense'), 'gap', 'default = on the score bug level');
  assert.ok(TEMPLATE_TYPES.livestat);
});

test('live graphic: values of the chosen player, roster-style name, official photo only when there is one', async () => {
  const store = await loadStore(), g = parseGame(decodeFeed(raw), 'whun_135563');
  const ids = new Set(['B203034']);
  const ch = liveChoice(store, 'women', g, 'home');
  assert.equal(ch.teamId, 'sercounigyor');
  assert.equal(ch.player.code, 'B203034', 'default: the best scorer');
  const v = bindLiveStat(store, 'women', g, { side: 'home', variant: 'basic', fetchedAt: '22:41:03' }, ids);
  assert.equal(v.name.text, 'GÁLOS Hanna Andrea', 'surname in capitals, Hunbasket roster spelling');
  assert.equal(v['c0.value'].text, '15'); assert.equal(v['c1.value'].text, '5'); assert.equal(v['c2.value'].text, '1');
  assert.equal(v.photo.src, 'photo/B203034');
  assert.equal(v.sub, undefined, 'no status line under the name');
  assert.match(v['c0.value'].source, /22:41:03/, 'freshness is in the source label');
  const sh = bindLiveStat(store, 'women', g, { side: 'home', variant: 'shooting' }, ids);
  assert.deepEqual([sh['c1.value'].text, sh['c1.label'].text], ['4/5 (80%)', '3P'], 'made/attempted, the percentage in ( ) after it');
  assert.deepEqual(sh['c1.value'].runs.map(r => r.text), ['4/5', ' (80%)']);
  const big = liveDims('shooting').val, r = sh['c1.value'].runs[1];
  assert.equal(r.size, Math.round(big * 2 / 3), 'the percentage is 2/3 of the figures');
  assert.ok(Math.abs(r.dy + (big - r.size) * 0.3715) < 1e-9, 'vertically centred on the figures');
  assert.equal(sh['c0.label'].text, '2P'); assert.equal(sh['c0.value'].text, '0/1 (0%)', 'missed everything: 0%');
  const pick = bindLiveStat(store, 'women', g, { side: 'home', stats: ['pts', 'fg', 'min'] }, ids);
  assert.deepEqual([pick['c0.label'].text, pick['c1.label'].text, pick['c2.label'].text], ['PERC', 'PTS', 'FG'], 'ticked stats in canonical order');
  assert.match(pick['c2.value'].text, /^\d+\/\d+ \(\d+%\)$/);
  assert.deepEqual(liveKeys(['nope']), ['pts', 'reb', 'ast'], 'nothing valid ticked: the basic preset');
  assert.ok(liveDims(LIVE_STATS.map(x => x.key)).stats + 276 <= 1040, 'everything ticked still fits');
  const full = bindLiveStat(store, 'women', g, { side: 'home', variant: 'full' }, ids);
  assert.equal(full['c0.value'].text, '25:18'); assert.equal(full['c8.value'].text, '22', 'VAL (the page counts fouls drawn, never subtracts fouls)');
  // another player of the other team (not in the photo list: the grey Hunbasket placeholder, never a made-up photo); a wrong code falls back to the best scorer
  const away = bindLiveStat(store, 'women', g, { side: 'away', player: 'B12490', variant: 'basic' }, ids);
  assert.equal(away.photo.src, 'photo/none'); assert.equal(away['c0.value'].text, '10');
  assert.equal(bindLiveStat(store, 'women', g, { side: 'away', player: 'nope' }, ids)['c0.value'].text, '10');
  // nothing loaded: nothing invented
  const none = bindLiveStat(store, 'women', null, {}, ids);
  assert.equal(none.name.missing, true);
});

test('live feed: the address to open, and what is wrong with a pasted text', () => {
  assert.equal(feedUrl('https://netcasting4.webpont.com/?whun_135563'), 'https://netcasting4.webpont.com/storage/fullwhun_135563.html');
  assert.equal(feedUrl('hun_134947', 'last'), 'https://netcasting4.webpont.com/storage/lasthun_134947.html');
  assert.equal(feedUrl('nothing'), null);
  assert.equal(feedProblem(raw), null, 'a complete feed is fine');
  assert.equal(feedProblem(''), 'empty');
  assert.equal(feedProblem('   '), 'empty');
  assert.equal(feedProblem('<!DOCTYPE html><html><head><title>ETO BASKET</title></head>'), 'html', 'the page itself, not the feed');
  assert.equal(feedProblem('ETO BASKET - VBW CEKK CEGLÉD <script>x</script>'), 'html');
  assert.equal(feedProblem(raw.slice(0, 5000)), 'truncated', 'a feed cut in the middle');
  assert.equal(feedProblem('just some words'), 'unknown');
});

test('live team comparison: quarter points add up to the score, team totals, better value marked, shooting as made/att (pct)', async () => {
  const store = await loadStore(), g = parseGame(decodeFeed(raw), 'whun_135563');
  for (const s of ['home', 'away']) assert.equal(g.quarters[s].reduce((a, b) => a + b, 0), g.score[s], `${s}: quarter points = official score`);
  assert.equal(g.quarters.home.length, 4);
  assert.equal(g.foulsByPeriod.home.reduce((a, b) => a + b, 0), g.teams.home.team.pf, 'team fouls per period add up to the total');
  assert.equal(g.teams.home.team.reb, g.teams.home.team.oreb + g.teams.home.team.dreb);
  assert.equal(liveTimeLabel(g), 'VÉGE'); assert.equal(livePeriodLabel(g), '', 'finished game: no period, just VÉGE');
  const mid = { finished: false, clock: gameClock(1234) }; // 34 s into the 3rd quarter
  assert.deepEqual([livePeriodLabel(mid), liveTimeLabel(mid)], ['3. NEGYED', '9:26'], 'live game: period + time left');
  assert.deepEqual([livePeriodLabel({ finished: false, clock: gameClock(2450) }), liveTimeLabel({ finished: false, clock: gameClock(2450) })], ['HOSSZABBÍTÁS', '4:10']);
  const v = bindLiveTeam(store, 'women', g, { teamStats: ['fg3', 'reb', 'tov'], fetchedAt: '22:41:03', teamLook: 'fill' }); // the legacy filled look is a choice now (the default is the outline look)
  assert.equal(v.scoreH.text, '90'); assert.equal(v.scoreA.text, '48');
  assert.equal(v.logoH.src, 'women/sercounigyor');
  assert.deepEqual([0, 1, 2].map(i => v[`r${i}.label`].text), ['3P', 'REB', 'TOV'], 'ticked stats in canonical order');
  const t = g.teams.home.team, a = g.teams.away.team;
  assert.equal(v['r0.h'].text, `${t.fg3m}/${t.fg3a} (${Math.round(100 * t.fg3m / t.fg3a)}%)`);
  assert.deepEqual(v['r0.h'].runs.map(r => r.text), [`${t.fg3m}/${t.fg3a}`, ` (${Math.round(100 * t.fg3m / t.fg3a)}%)`]);
  assert.equal(v['r0.h'].runs[1].size, Math.round(40 * liveTeamSize(['fg3', 'reb', 'tov']).scale * 2 / 3 * 100) / 100, '2/3 of the (scaled) figures');
  assert.equal(v.time.text, 'VÉGE');
  assert.equal(v['r1.h'].text, String(t.reb)); assert.equal(v['r1.a'].text, String(a.reb));
  const homeBetterReb = t.reb > a.reb;
  assert.equal(v['r1.h.box'].fill, homeBetterReb ? LIVE_TEAM_COLORS.better : LIVE_TEAM_COLORS.worse, 'more rebounds = better = green box, the other side red');
  assert.equal(v['r1.a.box'].fill, homeBetterReb ? LIVE_TEAM_COLORS.worse : LIVE_TEAM_COLORS.better);
  assert.equal(v['r2.h.box'].fill, t.tov < a.tov ? LIVE_TEAM_COLORS.better : LIVE_TEAM_COLORS.worse, 'fewer turnovers = better');
  assert.equal(v['r1.h'].color, '#ffffff', 'white digits on the green / red boxes');
  assert.equal(LIVE_TEAM_COLORS.better, '#0b9444'); assert.equal(LIVE_TEAM_COLORS.worse, '#ec4036');
  assert.match(v['r0.h'].source, /22:41:03/, 'freshness is in the source label');
  assert.deepEqual(liveTeamKeys(['nope']), ['fg', 'fg3', 'ft', 'reb', 'ast', 'tov'], 'nothing valid ticked: the default set');
});

test('live team comparison graphic: about 2x bigger, columns / scores close to the middle, top-left, inside the picture, clear of the score bug zones', () => {
  for (const id of ['liveteam-men', 'liveteam-women']) {
    assert.equal(templateById(id).type, 'liveteam');
    for (const n of [1, 3, 6, LIVE_TEAM_STATS.length]) {
      const keys = LIVE_TEAM_STATS.slice(0, n).map(x => x.key), t = LIVE_TEAM_BUILDERS[id](keys), [cx, cy, w, h] = t.elements.find(e => e.id === 'panel').box, S = liveTeamSize(keys);
      assert.deepEqual([w, h], [S.w, S.h]);
      assert.equal(t.elements.filter(e => /^r\d+\.label$/.test(e.id)).length, n);
      const x0 = cx - w / 2, y0 = cy - h / 2;
      assert.deepEqual([x0, y0], [60, 2], 'same place as Csapatok összevetése (top-left)');
      assert.ok(x0 + w <= 1920 && y0 + h <= 1078, 'inside the picture');
      for (const size of ['large', 'small']) { const [zx0, zy0] = BUG[size].zone; assert.ok(x0 + w <= zx0 || y0 + h <= zy0, `${n} stats: clear of the ${size} score bug zone`); }
      if (n <= 6) assert.ok(S.scale >= 1.9, `${n} stats: about 2x bigger (${S.scale})`);
      assert.ok(S.scale <= 2);
      const el = i => t.elements.find(e => e.id === i), mid = x0 + w / 2;
      assert.ok(Math.abs(el('clock').x - mid) < 1 && Math.abs(el('time').x - mid) < 1, 'period and time in the middle');
      const gap = (el('scoreA.box').box[0] - el('scoreH.box').box[0]) / S.scale; // distance between the two score boxes, in base units: close together
      assert.ok(gap < 300, `scores close together (${gap})`);
      const colGap = (el('r0.a.box').box[0] - el('r0.h.box').box[0]) / S.scale;
      assert.ok(colGap < 400, `value columns close together (${colGap})`);
      for (const e of t.elements.filter(e => e.type === 'text')) assert.ok([undefined, 'italic'].includes(e.font), 'League Gothic only');
    }
  }
  assert.ok(TEMPLATE_TYPES.liveteam);
});

test('live three leaders: the three best VAL of each team are chosen, VAL is only the rule (not shown unless ticked), plain white boxes, no scores', async () => {
  const store = await loadStore(), g = parseGame(decodeFeed(raw), 'whun_135563'), ids = new Set(['B203034']);
  for (const side of ['home', 'away']) {
    const top = topByEff(g, side, 3), all = playedPlayers(g, side);
    assert.equal(top.length, 3);
    assert.deepEqual(top.map(p => p.eff), all.map(p => p.eff).sort((a, b) => b - a).slice(0, 3), `${side}: the three best VAL, best first`);
  }
  const v = bindLiveLeaders(store, 'women', g, { fetchedAt: '22:41:03' }, ids);
  const labels = [0, 1, 2].map(j => v[`h0.c${j}.label`].text);
  assert.deepEqual(labels, ['PTS', 'REB', 'AST'], 'default: points, rebounds, assists – VAL is not shown');
  assert.ok(!Object.values(v).some(x => x && x.text === 'VAL'), 'no VAL on the graphic unless ticked');
  assert.equal(v['h0.name'].text, `${topByEff(g, 'home', 1)[0].name}`.length ? v['h0.name'].text : '', 'names come from the roster binder');
  assert.deepEqual([v.title1.text, v.title2.text], ['TOP', 'TELJESÍTMÉNYEK'], 'fixed two-line title instead of the game time'); assert.equal(v.time, undefined); assert.equal(v.clock, undefined);
  assert.ok(v.logoH.src && v.logoA.src, 'both logos stay');
  assert.ok([0, 1, 2].every(j => v[`h0.c${j}.label`].color === '#ffffff') && v['h0.name'].color === '#ffffff' && v['h0.c0.value'].color === '#ffffff', 'default colours: white');
  const col = bindLiveLeaders(store, 'women', g, { leaderColors: { name: '#ff0000', label: '0f0', value: 'nonsense' } }, ids);
  for (const id of ['h0', 'h2', 'a1']) { assert.equal(col[`${id}.name`].color, '#ff0000', 'names red for every player'); assert.equal(col[`${id}.c0.label`].color, '#00ff00', 'stat categories green (short hex)'); assert.equal(col[`${id}.c1.value`].color, '#ffffff', 'a wrong hex falls back to white'); }
  assert.deepEqual(v['h0.photo'].outline, { size: 3, color: '#ffffff' }, 'photos get a 3 px outline, white by default');
  assert.deepEqual(bindLiveLeaders(store, 'women', g, { leaderColors: { outline: '#ffcc00' } }, ids)['h0.photo'].outline, { size: 3, color: '#ffcc00' }, 'outline colour by hex');
  assert.equal(bindLiveLeaders(store, 'women', g, { leaderOutlineOn: false }, ids)['h0.photo'].outline, null, 'outline can be switched off');
  assert.equal(v['h0.photo'].shadow.blur, 12, 'a soft shadow behind the photos by default');
  assert.deepEqual(bindLiveLeaders(store, 'women', g, { leaderShadowSize: 30 }, ids)['h0.photo'].shadow, { color: 'rgba(0,0,0,0.65)', blur: 30, dx: 8, dy: 10 }, 'adjustable shadow size');
  assert.equal(bindLiveLeaders(store, 'women', g, { leaderShadowSize: 0 }, ids)['h0.photo'].shadow, null, 'size 0 = no shadow'); assert.equal(bindLiveLeaders(store, 'women', g, { leaderShadowSize: 999 }, ids)['h0.photo'].shadow.blur, 40, 'capped at 40'); assert.equal(leaderShadow(12).dy, 4); assert.equal(bindLiveLeaders(store, 'women', g, { leaderShadowOn: false }, ids)['h0.photo'].shadow, null, 'shadow can be switched off');
  assert.equal(v.logoH.outline, undefined, 'the logos keep their own outline logic');
  assert.equal(normHex('FF8800'), '#ff8800'); assert.equal(normHex('#f80'), '#ff8800'); assert.equal(normHex('red'), null); assert.equal(normHex(''), null);
  assert.deepEqual(leaderColors({ name: '#123456' }), { name: '#123456', label: '#ffffff', value: '#ffffff', outline: '#ffffff' });
  for (const id of ['h0', 'h1', 'h2', 'a0', 'a1', 'a2']) for (const j of [0, 1, 2]) assert.equal(v[`${id}.c${j}.box`], undefined, 'plain boxes: no per-value colouring (the white box is the template default)');
  assert.equal(v.scoreH, undefined); assert.equal(v.scoreA, undefined, 'no big scores: the broadcast score bug shows them');
  const sh = bindLiveLeaders(store, 'women', g, { leaderStats: ['fg3', 'eff'] }, ids);
  assert.deepEqual([sh['h0.c0.label'].text, sh['h0.c1.label'].text], ['VAL', '3P'], 'VAL can be ticked: one stat like the others, in the usual order');
  assert.match(sh['h0.c1.value'].text, /^\d+\/\d+ \(\d+%\)$/); assert.equal(sh['h0.c1.value'].runs[1].size, Math.round(32 * liveLeaderSize().scale * 2 / 3 * 100) / 100);
  const none = bindLiveLeaders(store, 'women', null, {}, ids);
  assert.deepEqual(Object.keys(none), ['title1', 'title2'], 'no game: only the fixed title (the studio says so in a notice)');
});

test('live three leaders graphic: top-left, inside the picture, clear of the score bug zones, the same size for every ticked stat count', () => {
  for (const id of ['liveleaders-men', 'liveleaders-women']) {
    assert.equal(templateById(id).type, 'liveleaders');
    for (const keys of [['pts'], ['pts', 'reb', 'ast'], LIVE_STATS.map(x => x.key)]) {
      const t = LIVE_LEADER_BUILDERS[id](keys), [cx, cy, w, h] = t.elements.find(e => e.id === 'panel').box, x0 = cx - w / 2, y0 = cy - h / 2, S = liveLeaderSize();
      assert.deepEqual([w, h], [S.w, S.h]); assert.deepEqual([x0, y0], [60, 2], 'same place as Csapatok összevetése');
      assert.ok(x0 + w <= 1920 && y0 + h <= 1078);
      for (const size of ['large', 'small']) { const [zx0, zy0] = BUG[size].zone; assert.ok(x0 + w <= zx0 || y0 + h <= zy0, `clear of the ${size} score bug zone`); }
      assert.equal(t.elements.filter(e => /^[ha]\d\.c\d+\.value$/.test(e.id)).length, 6 * liveLeaderCells(keys).length);
      const el = i => t.elements.find(e => e.id === i), midX = x0 + w / 2;
      assert.deepEqual([el('logoH').box[2], el('logoH').box[3], el('logoA').box[2], el('logoA').box[3]], [150, 150, 150, 150], 'logos are 150 px');
      const dH = midX - el('logoH').box[0], dA = el('logoA').box[0] - midX;
      assert.ok(Math.abs(dH - dA) < 1 && dH > 150, 'logos mirrored around the middle, at a fixed distance from the title');
      assert.ok(Math.abs(el('title1').x - midX) < 1 && Math.abs(el('title2').x - midX) < 1 && el('title1').y < el('title2').y, 'two centred title lines');
      assert.ok(el('logoH').box[1] + 75 <= el('h0.photo').box[1] - el('h0.photo').box[3] / 2 + 12, 'logos in the header, above the players');
      assert.equal(el('title1').type, 'text');
      for (const e of t.elements) { const [bx, by, bw, bh] = e.type === 'image' || e.type === 'framed' ? e.box : [e.x, e.y, 0, 0]; assert.ok(bx >= x0 - 1 && bx <= x0 + w + 1 && by >= y0 - 1 && by <= y0 + h + 1, `${e.id} inside the panel`); }
    }
  }
  assert.ok(TEMPLATE_TYPES.liveleaders);
});

test('VAL equals the netcasting page (owner 2026-11-25: Forray 35, Mester 18 although she had 1 block against and 4 fouls)', () => {
  // real stat lines of a live game, VAL as shown on the page at that moment
  const line = (pts, fg2m, fg2a, fg3m, fg3a, ftm, fta, oreb, dreb, ast, stl, tov, blk, blkAgainst, pf, fouled) => ({ pts, fg2m, fg2a, fg3m, fg3a, ftm, fta, oreb, dreb, ast, stl, tov, blk, blkAgainst, pf, fouled });
  assert.equal(efficiency(line(6, 2, 4, 0, 0, 2, 2, 2, 3, 3, 1, 1, 0, 1, 4, 6)), 18, 'Mester');
  assert.equal(efficiency(line(11, 2, 3, 2, 2, 1, 2, 2, 3, 3, 2, 4, 0, 0, 4, 3)), 18, 'Halasy');
  assert.equal(efficiency(line(19, 3, 6, 1, 2, 10, 10, 1, 4, 6, 3, 3, 1, 0, 1, 8)), 35, 'Forray');
});

test('names with ő / ű: the feed writes "?", the mkosz.hu names are applied by player number and only when the letters fit', async () => {
  const { applyOfficialNames, needsOfficialNames } = await import('../graphics/js/live.js');
  const { readFile } = await import('node:fs/promises');
  const feed = decodeFeed(await readFile(new URL('./fixtures/live/whunu18_142813.partial.txt', import.meta.url), 'utf8'));
  const g = parseGame(feed, 'whunu18_142813'), by = n => g.players.find(p => p.name.startsWith(n));
  assert.equal(by('Halasy').name, 'Halasy Enik?', 'the feed lost the ő'); assert.ok(needsOfficialNames(g));
  // a wrong number or other letters never rename anybody
  assert.equal(applyOfficialNames(g, { 999: 'Halasy Enikő', 201536: 'Halasy Enikű Mária' }), 0); assert.equal(by('Halasy').name, 'Halasy Enik?');
  assert.equal(applyOfficialNames(g, { 201536: 'Halasy Enikő', 245564: 'Csősz Orsolya', 188120: 'Valaki Más' }), 2);
  assert.equal(by('Halasy').name, 'Halasy Enikő'); assert.equal(by('Cs').name, 'Csősz Orsolya');
  assert.equal(by('Forray').name.includes('?'), false, 'players without "?" are left as they are');
  assert.equal(needsOfficialNames(g), false);
  // the graphic writes the official spelling (roster-less junior player: the feed's / mkosz.hu spelling, surname in capitals)
  const store = await loadStore();
  const v = bindLiveStat(store, 'women', g, { side: 'home', player: by('Halasy').code, stats: ['pts'] }, new Set());
  assert.equal(v.name.text, 'HALASY Enikő');
});

test('team comparison, optional looks (owner 2026-11-26): soft dark backing in both; "outline" = thick green / red outline, "numbers" = green / red / white numbers; the old filled look stays available as an explicit choice, the default is the outline look', async () => {
  const store = await loadStore(), g = parseGame(decodeFeed(raw), 'whun_135563');
  const keys = ['fg', 'reb', 'tov'], BACK = '#121215';
  const fillTpl = LIVE_TEAM_BUILDERS['liveteam-women'](keys, 'fill'), dfltTpl = LIVE_TEAM_BUILDERS['liveteam-women'](keys), outTpl = LIVE_TEAM_BUILDERS['liveteam-women'](keys, 'outline'), numTpl = LIVE_TEAM_BUILDERS['liveteam-women'](keys, 'numbers');
  const box = (t, id) => t.elements.find(e => e.id === id);
  assert.equal(box(fillTpl, 'r0.h.box').fill, '#f4f4f4'); assert.equal(box(fillTpl, 'r0.h.box').sw, 0, 'default look: filled box, no outline');
  assert.equal(box(outTpl, 'r0.h.box').fill, BACK); assert.ok(box(outTpl, 'r0.h.box').sw > 0, 'outline look: dark backing + an outline');
  assert.equal(box(numTpl, 'r0.h.box').fill, BACK); assert.equal(box(numTpl, 'r0.h.box').sw, 0, 'numbers look: dark backing, no outline');
  assert.equal(box(fillTpl, 'r0.label.box'), undefined, 'default look: no box behind the stat name'); assert.equal(box(fillTpl, 'r0.label').color, '#ffffff');
  for (const t of [outTpl, numTpl]) { assert.equal(box(t, 'r0.label.box').fill, BACK, 'the stat name sits on its own dark box'); assert.equal(box(t, 'r0.label.box').opacity, box(fillTpl, 'r0.h.box').opacity, 'as opaque as the usual stat boxes'); assert.ok(box(t, 'r0.label.box').box[2] < box(t, 'r0.h.box').box[2] / 2, 'the label box is small, fitted to the text'); assert.equal(box(t, 'r0.label').color, '#c9cbd1', '…in light grey'); }
  assert.equal(box(fillTpl, 'scoreH.box').fill, '#f4f4f4'); assert.equal(box(fillTpl, 'scoreH').color, '#0b0b0c', 'default look: the white score boxes with dark digits are unchanged');
  for (const t of [outTpl, numTpl]) { for (const id of ['scoreH.box', 'scoreA.box']) { assert.equal(box(t, id).fill, '#17171a'); assert.equal(box(t, id).opacity, 0.965); assert.equal(box(t, id).stroke, '#7d8088'); assert.ok(box(t, id).sw > 0 && box(t, id).sw < 6, 'a very thin grey outline'); } assert.equal(box(t, 'scoreH').color, '#ffc929'); assert.equal(box(t, 'scoreA').color, '#ffc929', 'optional looks: near-black score boxes at 96.5 % with gold digits (the big white blocks looked odd)'); }
  assert.equal(fillTpl.liveTeam.look, 'fill'); assert.equal(outTpl.liveTeam.look, 'outline'); assert.equal(numTpl.liveTeam.look, 'numbers');
  const dflt = bindLiveTeam(store, 'women', g, { teamStats: keys, teamLook: 'fill' }), dfltOut = bindLiveTeam(store, 'women', g, { teamStats: keys }), out = bindLiveTeam(store, 'women', g, { teamStats: keys, teamLook: 'outline' }), num = bindLiveTeam(store, 'women', g, { teamStats: keys, teamLook: 'numbers' });
  assert.equal(dfltTpl.liveTeam.look, 'outline', 'owner 2026-11-27: the outline look is the default'); assert.equal(dfltOut['r1.h.box'].stroke, '#0b9444', 'no look given = outline');
  assert.equal(dflt['r1.h.box'].fill, '#0b9444'); assert.equal(dflt['r1.a.box'].fill, '#ec4036', 'default: filled green / red (REB 42 vs 31)');
  assert.equal(out['r1.h.box'].stroke, '#0b9444'); assert.equal(out['r1.a.box'].stroke, '#ec4036'); assert.equal(out['r1.h.color'], undefined); assert.equal(out['r1.h'].color, '#ffffff', 'outline look: white numbers');
  assert.equal(num['r1.h'].color, '#27d64a'); assert.equal(num['r1.a'].color, '#ff4d42', 'numbers look: better green, worse red');
  assert.equal(num['r1.h.box'].fill, undefined); assert.equal(num['r1.h.box'].stroke, undefined, 'numbers look: the backing comes from the template, no outline');
  // equal values: nobody is marked, white numbers
  const g2 = structuredClone(g); g2.teams.home.team.tov = g2.teams.away.team.tov;
  const tie = bindLiveTeam(store, 'women', g2, { teamStats: keys, teamLook: 'numbers' });
  assert.equal(tie['r2.h'].color, '#ffffff'); assert.equal(tie['r2.a'].color, '#ffffff', 'equal: white numbers');
  assert.equal(bindLiveTeam(store, 'women', g2, { teamStats: keys, teamLook: 'outline' })['r2.h.box'].stroke, 'rgba(255,255,255,0.55)', 'equal: faint white outline');
});
