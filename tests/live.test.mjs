import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ROOT } from './helpers.mjs';
import path from 'node:path';
import { decodeFeed, parseGame, gameCode, gameClock, playedPlayers, efficiency, mmss } from '../graphics/js/live.js';

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
