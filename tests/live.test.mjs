import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ROOT } from './helpers.mjs';
import path from 'node:path';
import { decodeFeed, parseGame, gameCode, gameClock, playedPlayers, efficiency, mmss } from '../graphics/js/live.js';
import { loadStore } from './helpers.mjs';
import { bindLiveStat, liveChoice } from '../graphics/js/binders.js';
import { LIVE_BUILDERS, LIVE_VARIANTS, LIVE_CORNERS, BUG, liveVariant, liveCorner, templateById, TEMPLATE_TYPES } from '../graphics/js/templates.js';

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

test('live graphic: a thin strip on the score bug\'s level, centred in the gap left of it, for both score bug sizes', () => {
  for (const size of ['large', 'small']) {
    const [zx0, zy0, zx1, zy1] = BUG[size].zone;
    for (const id of ['livestat-men', 'livestat-women']) {
      assert.equal(templateById(id).type, 'livestat');
      for (const place of Object.keys(LIVE_CORNERS)) for (const [k, V] of Object.entries(LIVE_VARIANTS)) {
        const t = LIVE_BUILDERS[id](k, place, size), panel = t.elements.find(e => e.id === 'panel');
        const [cx, cy, w, h] = panel.box, x0 = cx - w / 2, y0 = cy - h / 2, x1 = x0 + w, y1 = y0 + h;
        assert.ok(w <= 900 && h <= 150, `${id}/${k}/${place}/${size}: strip ${w}x${h}`);
        if (k !== 'full') assert.ok(w <= 480, `${k}: compact`);
        assert.ok(x1 <= zx0 || y1 <= zy0 || x0 >= zx1 || y0 >= zy1, `${id}/${k}/${place}/${size}: clear of the score bug zone`);
        assert.ok(x0 >= 0 && y0 >= 0 && x1 <= 1920 && y1 <= 1080, 'inside the picture');
        if (place === 'gap') {
          assert.ok(Math.abs(cx - zx0 / 2) <= 1, `${size}/${k}: centred in the gap between the picture's left edge and the score bug (${cx} vs ${zx0 / 2})`);
          assert.ok(Math.abs(cy - BUG[size].cy) <= 12, `${size}/${k}: on the score bug's level (centre ${cy})`);
          assert.ok(y1 <= 1060, 'not at the very edge of the picture');
        } else assert.ok(y0 < 100, 'top-left');
        for (const e of t.elements) { // every element lies inside the strip
          if (e.id === 'panel') continue;
          const [bx, by, bw] = e.type === 'image' ? e.box : [e.x, e.y, e.maxWidth || 0];
          const ex0 = e.type === 'image' ? bx - bw / 2 : (e.align === 'left' ? bx : bx - bw / 2), ex1 = e.type === 'image' ? bx + bw / 2 : (e.align === 'left' ? bx + bw : bx + bw / 2);
          assert.ok(ex0 >= x0 - 1 && ex1 <= x1 + 1 && by <= y1 + 1 && by >= y0 - 1, `${id}/${k}/${place}/${size}: ${e.id} inside the strip`);
        }
        assert.equal(t.elements.filter(e => /^c\d+\.value$/.test(e.id)).length, V.cells.length);
        assert.ok(t.elements.some(e => e.id === 'photo') && t.elements.some(e => e.id === 'name'));
        assert.ok(!t.elements.some(e => e.id === 'sub') && !t.elements.some(e => /\.sub$/.test(e.id)), 'no status line under the name');
        assert.deepEqual(panel.stroke, id.endsWith('women') ? '#ef4036' : '#0b9444', 'league outline colour');
      }
    }
  }
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
  assert.deepEqual([sh['c1.value'].text, sh['c1.label'].text], ['4/5', '3P · 80.0%'], 'made/attempted, percentage on the label line');
  assert.equal(sh['c0.label'].text, '2P · 0.0%');
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
