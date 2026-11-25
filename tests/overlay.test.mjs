import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOverlay, overlayQuery, gameLeague } from '../graphics/js/overlay-params.js';

test('overlay link: game, graphic and league come from the link', () => {
  const p = parseOverlay('?game=https://netcasting4.webpont.com/?whun_135563&g=liveleaders');
  assert.equal(p.game, 'whun_135563'); assert.equal(p.league, 'women'); assert.equal(p.templateId, 'liveleaders-women');
  const m = parseOverlay('?game=hunu18_142679&g=livestat');
  assert.equal(m.league, 'men'); assert.equal(m.templateId, 'livestat-men'); // youth codes keep the men's competitions
  assert.equal(parseOverlay('?g=liveteam').templateId, null); // no game → nothing to draw
  assert.equal(parseOverlay('?game=whun_1&g=bogus').graphic, 'liveteam'); // unknown graphic → default
  assert.equal(gameLeague('hun_5555'), 'men');
});
test('overlay link: ticked stats round-trip, defaults stay out of the link', () => {
  const q = overlayQuery({ game: 'whun_135563', graphic: 'liveteam', live: { teamStats: ['fg3', 'reb'] }, token: 'abc' });
  const p = parseOverlay('?' + q);
  assert.deepEqual(p.live.teamStats, ['fg3', 'reb']); assert.equal(p.token, 'abc');
  const d = overlayQuery({ game: 'whun_135563', graphic: 'liveteam', live: { teamStats: [] } });
  assert.equal(d, 'game=whun_135563&g=liveteam'); // defaults: no extra parameters
  const s = parseOverlay('?' + overlayQuery({ game: 'hun_1234', graphic: 'livestat', live: { side: 'away', player: '77', stats: ['pts', 'reb'], corner: 'tl' } }));
  assert.equal(s.live.side, 'away'); assert.equal(s.live.player, '77'); assert.deepEqual(s.live.stats, ['pts', 'reb']); assert.equal(s.live.corner, 'tl');
});
test('overlay link: refresh interval is clamped', () => {
  assert.equal(parseOverlay('?game=whun_1234&refresh=0').refresh, 5);
  assert.equal(parseOverlay('?game=whun_1234&refresh=1').refresh, 2);
  assert.equal(parseOverlay('?game=whun_1234&refresh=999').refresh, 60);
});
test('one game code everywhere: netcasting, mkosz.hu and Hunbasket links give the same code', async () => {
  const { gameCode } = await import('../graphics/js/live.js');
  for (const [url, code] of [
    ['https://netcasting4.webpont.com/?hunu18_142733', 'hunu18_142733'],
    ['https://mkosz.hu/merkozes/x2627/hunu18/hunu18_142733', 'hunu18_142733'],
    ['https://hunbasket.hu/merkozesbeharangozo/x2627/whun/whun_135579', 'whun_135579'],
    ['https://hunbasket.hu/merkozes/x2627/whun/whun_135479', 'whun_135479'],
    ['https://netcasting4.webpont.com/?whun_135579', 'whun_135579'],
  ]) assert.equal(gameCode(url), code, url);
});
