import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ROOT } from './helpers.mjs';
import path from 'node:path';
import { decodeFeed, parseGame, gameCode, gameClock, playedPlayers, efficiency, mmss } from '../graphics/js/live.js';
import { loadStore } from './helpers.mjs';
import { bindLiveStat, liveChoice } from '../graphics/js/binders.js';
import { LIVE_BUILDERS, LIVE_VARIANTS, liveVariant, templateById, TEMPLATE_TYPES } from '../graphics/js/templates.js';

// A finished game (ETO Basket – VBW CEKK Cegléd, women, 2026-11-22, final 90–48) saved from the public netcasting feed.
const raw = await readFile(path.join(ROOT, 'tests/fixtures/live/whun_135563.full.txt'), 'utf8');

test('live feed: game code from a netcasting link / plain code', () => {
  assert.equal(gameCode('https://netcasting4.webpont.com/?whun_135563'), 'whun_135563');
  assert.equal(gameCode('  WHUN_135563 '), 'whun_135563');
  assert.equal(gameCode('hun_134947'), 'hun_134947');
  assert.equal(gameCode('nothing'), null);
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
  assert.equal(efficiency({ pts: 10, oreb: 1, dreb: 2, ast: 3, stl: 1, blk: 0, fouled: 2, fg2a: 5, fg2m: 3, fg3a: 2, fg3m: 1, fta: 2, ftm: 2, tov: 2, blkAgainst: 0, pf: 3 }), 10 + 1 + 2 + 3 + 1 + 0 + 2 - (2 + 1 + 0) - 2 - 0 - 3);
});

test('live feed: game clock from elapsed seconds (4 x 10 min, overtimes 5 min)', () => {
  assert.deepEqual(gameClock(0), { period: 1, elapsed: 0, seconds: 0 });
  assert.deepEqual(gameClock(600), { period: 1, elapsed: 600, seconds: 600 });
  assert.deepEqual(gameClock(601), { period: 2, elapsed: 1, seconds: 601 });
  assert.equal(gameClock(2400).period, 4);
  assert.deepEqual(gameClock(2401), { period: 5, elapsed: 1, seconds: 2401 });
  assert.equal(gameClock(2701).period, 6);
});

test('live graphic: every variant is a compact panel (at most a quarter of the picture), cells = elements', () => {
  for (const id of ['livestat-men', 'livestat-women']) {
    assert.equal(templateById(id).type, 'livestat');
    for (const [k, V] of Object.entries(LIVE_VARIANTS)) {
      const t = LIVE_BUILDERS[id](k), panel = t.elements.find(e => e.id === 'panel');
      assert.ok(panel.box[2] <= 960 && panel.box[3] <= 540, `${id}/${k}: panel ${panel.box[2]}x${panel.box[3]} fits a quarter of 1920x1080`);
      assert.equal(t.elements.filter(e => /^c\d+\.value$/.test(e.id)).length, V.cells.length);
      assert.ok(t.elements.some(e => e.id === 'photo') && t.elements.some(e => e.id === 'name'));
      assert.deepEqual(panel.stroke, id.endsWith('men') && !id.endsWith('women') ? '#0b9444' : '#ef4036', 'league outline colour');
    }
  }
  assert.equal(liveVariant('nonsense'), 'basic');
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
  assert.match(v.sub.text, /^#11 · ETO Basket 90–48 VBW CEKK Cegléd · végeredmény$/);
  assert.match(v['c0.value'].source, /22:41:03/, 'freshness is in the source label');
  const sh = bindLiveStat(store, 'women', g, { side: 'home', variant: 'shooting' }, ids);
  assert.deepEqual([sh['c1.value'].text, sh['c1.sub'].text], ['4/5', '80.0%']);
  assert.equal(sh['c0.sub'].text, '0.0%');
  const full = bindLiveStat(store, 'women', g, { side: 'home', variant: 'full' }, ids);
  assert.equal(full['c0.value'].text, '25:18'); assert.equal(full['c8.value'].text, '20', 'EFF');
  // another player of the other team (not in the photo list: no photo, never a made-up one); a wrong code falls back to the best scorer
  const away = bindLiveStat(store, 'women', g, { side: 'away', player: 'B12490', variant: 'basic' }, ids);
  assert.equal(away.photo.src, ''); assert.equal(away['c0.value'].text, '10');
  assert.equal(bindLiveStat(store, 'women', g, { side: 'away', player: 'nope' }, ids)['c0.value'].text, '10');
  // nothing loaded: nothing invented
  const none = bindLiveStat(store, 'women', null, {}, ids);
  assert.equal(none.name.missing, true);
});
