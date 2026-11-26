// The link of one OBS browser source is everything the overlay needs: game, graphic and the ticked statistics. Nothing is kept in the browser
// (a cache-refresh hotkey in OBS just reloads the same page) and nothing is shared between sources (any number of games / graphics at once).
import { gameCode } from './live.js';

export const OVERLAY_GRAPHICS = { livestat: 'Játékos-betét', liveteam: 'Csapatok összevetése', liveleaders: 'Három vezető' };
const list = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

/** League of a game from its netcasting code: whun_… = women, hun_… / hunu18_… = men's competitions (the youth codes keep their old names). */
export const gameLeague = code => (/^whun/i.test(code || '') ? 'women' : 'men');

/** Query string → settings of the overlay (unknown / missing values fall back to the studio defaults). */
export function parseOverlay(search) {
  const q = new URLSearchParams(search);
  const graphic = OVERLAY_GRAPHICS[q.get('g')] ? q.get('g') : 'liveteam';
  const game = gameCode(q.get('game'));
  const live = {
    side: q.get('side') === 'away' ? 'away' : 'home',
    player: q.get('player') || null,
    corner: q.get('corner') || undefined,
    variant: q.get('variant') || undefined,
    stats: list(q.get('stats')).length ? list(q.get('stats')) : undefined,
    teamStats: list(q.get('teamStats')).length ? list(q.get('teamStats')) : undefined,
    leaderStats: list(q.get('leaderStats')).length ? list(q.get('leaderStats')) : undefined,
    teamLook: q.get('teamLook') === 'outline' ? 'outline' : undefined,
  };
  for (const k of Object.keys(live)) if (live[k] === undefined) delete live[k];
  const refresh = Math.min(60, Math.max(2, Number(q.get('refresh')) || 5));
  return { game, graphic, fixed: q.has('g'), league: game ? gameLeague(game) : 'men', templateId: game ? `${graphic}-${gameLeague(game)}` : null, live, refresh, token: q.get('token') || '', debug: q.get('debug') === '1' };
}

/** Settings → query string (the link maker). Only what differs from the defaults is written, so the links stay short. */
export function overlayQuery({ game, graphic, live = {}, token = '', refresh = 5 }) {
  const q = new URLSearchParams();
  q.set('game', gameCode(game) || '');
  q.set('g', OVERLAY_GRAPHICS[graphic] ? graphic : 'liveteam');
  if (graphic === 'livestat') {
    if (live.side === 'away') q.set('side', 'away');
    if (live.player) q.set('player', live.player);
    if (live.corner) q.set('corner', live.corner);
    if (live.stats?.length) q.set('stats', live.stats.join(','));
  }
  if (graphic === 'liveteam' && live.teamStats?.length) q.set('teamStats', live.teamStats.join(','));
  if (graphic === 'liveleaders' && live.leaderStats?.length) q.set('leaderStats', live.leaderStats.join(','));
  if (refresh !== 5) q.set('refresh', String(refresh));
  if (token) q.set('token', token);
  return q.toString();
}

/** The fixed link of a game (what goes into OBS once): the game and the key only. The builder decides what is on air; the overlay follows it (server: /live-state). */
export function fixedLinkQuery({ game, token = '' }) {
  const q = new URLSearchParams();
  q.set('game', gameCode(game) || '');
  if (token) q.set('token', token);
  return q.toString();
}

/** What the builder puts on air, from the server's JSON: { graphic: 'off' | livestat | liveteam | liveleaders, live: { the ticked stats, player, side… } } (unknown / broken values fall back to "off" and the defaults). */
export function normOnAir(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const keys = a => (Array.isArray(a) ? a.map(String).filter(k => /^[a-z0-9]{1,12}$/.test(k)).slice(0, 20) : []);
  const hex = s => (/^#[0-9a-f]{6}$/i.test(String(s ?? '')) ? String(s).toLowerCase() : null);
  const live = { side: r.side === 'away' ? 'away' : 'home' };
  if (typeof r.player === 'string' && /^[A-Za-z0-9_-]{1,20}$/.test(r.player)) live.player = r.player;
  if (r.corner === 'gap' || r.corner === 'tl') live.corner = r.corner;
  if (typeof r.variant === 'string' && /^[a-z0-9]{1,20}$/.test(r.variant)) live.variant = r.variant;
  for (const k of ['stats', 'teamStats', 'leaderStats']) if (keys(r[k]).length) live[k] = keys(r[k]);
  // the look of the three leaders (names, stat names, numbers, photo outline: hex colours; outline / shadow on-off; shadow size 0–40 px) and of the team comparison
  const colors = {}; for (const k of ['name', 'label', 'value', 'outline']) { const c = hex(r.leaderColors?.[k]); if (c) colors[k] = c; }
  if (Object.keys(colors).length) live.leaderColors = colors;
  if (r.leaderOutlineOn === false) live.leaderOutlineOn = false;
  if (r.leaderShadowOn === false) live.leaderShadowOn = false;
  if (r.leaderShadowSize !== undefined && r.leaderShadowSize !== null && r.leaderShadowSize !== '' && Number.isFinite(Number(r.leaderShadowSize))) live.leaderShadowSize = Math.min(40, Math.max(0, Number(r.leaderShadowSize)));
  if (r.teamLook === 'outline') live.teamLook = 'outline';
  return { graphic: OVERLAY_GRAPHICS[r.graphic] ? r.graphic : 'off', live };
}
