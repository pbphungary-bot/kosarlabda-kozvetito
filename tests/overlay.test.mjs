import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOverlay, overlayQuery, gameLeague, fixedLinkQuery, normOnAir } from '../graphics/js/overlay-params.js';

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

test('fixed link: game and key only; without &g the overlay follows the builder', () => {
  assert.equal(fixedLinkQuery({ game: 'https://mkosz.hu/merkozes/x2627/hunu18/hunu18_142733' }), 'game=hunu18_142733');
  assert.equal(fixedLinkQuery({ game: 'whun_135579', token: 'k y' }), 'game=whun_135579&token=k+y');
  assert.equal(parseOverlay('?game=whun_135579').fixed, false, 'the fixed link has no graphic of its own');
  assert.equal(parseOverlay('?game=whun_135579&g=liveteam').fixed, true, 'an old direct link keeps its graphic');
});
test('on-air state from the server: unknown or broken values are safe', () => {
  assert.equal(normOnAir(undefined).graphic, 'off'); assert.equal(normOnAir({}).graphic, 'off'); assert.equal(normOnAir({ graphic: 'rm -rf' }).graphic, 'off');
  const n = normOnAir({ graphic: 'liveleaders', side: 'away', player: 'B203034', corner: 'tl', teamStats: ['fg3', '<script>', 'reb'], leaderStats: 'pts', stats: [] });
  assert.equal(n.graphic, 'liveleaders'); assert.equal(n.live.side, 'away'); assert.equal(n.live.player, 'B203034'); assert.equal(n.live.corner, 'tl');
  assert.deepEqual(n.live.teamStats, ['fg3', 'reb'], 'only plain stat keys pass'); assert.equal(n.live.leaderStats, undefined); assert.equal(n.live.stats, undefined);
  assert.equal(normOnAir({ graphic: 'livestat', player: '<img onerror>' }).live.player, undefined);
});

test('on-air look options: hex colours, outline / shadow switches and the shadow size are whitelisted', () => {
  const n = normOnAir({ graphic: 'liveleaders', leaderColors: { name: '#FF8800', label: 'red', value: '#12345', outline: '#00ff00', evil: '#000000' }, leaderOutlineOn: false, leaderShadowOn: false, leaderShadowSize: 99, teamLook: 'outline' });
  assert.deepEqual(n.live.leaderColors, { name: '#ff8800', outline: '#00ff00' }, 'only valid #rrggbb, only the four known keys');
  assert.equal(n.live.leaderOutlineOn, false); assert.equal(n.live.leaderShadowOn, false); assert.equal(n.live.leaderShadowSize, 40, 'clamped to 0–40');
  assert.equal(n.live.teamLook, 'outline'); assert.equal(normOnAir({ graphic: 'liveteam', teamLook: 'numbers' }).live.teamLook, 'numbers');
  const d = normOnAir({ graphic: 'liveleaders', leaderOutlineOn: true, leaderShadowSize: -5, teamLook: 'weird', leaderColors: {} });
  assert.equal(d.live.leaderOutlineOn, undefined, 'defaults stay out'); assert.equal(d.live.leaderShadowSize, 0); assert.equal(d.live.teamLook, undefined); assert.equal(d.live.leaderColors, undefined);
  assert.equal(normOnAir({ graphic: 'liveleaders', leaderShadowSize: 'abc' }).live.leaderShadowSize, undefined);
});
