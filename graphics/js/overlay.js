// OBS browser source: renders ONE live graphic of ONE game on a transparent 1920x1080 canvas and keeps it up to date by itself.
// Everything comes from the link (see overlay-params.js); a reload (OBS "refresh cache of current page") simply starts over with the same link.
// Nothing is ever drawn when there is no data yet or the feed fails: the last good picture stays (never an error text on air). &debug=1 shows a status line.
import { loadDashboard } from './data.js';
import { loadFonts, render, logoOutlines } from './engine.js';
import { CLUBS, clubIdStrict } from './clubs.js';
import { parseGame, decodeFeed, feedProblem } from './live.js';
import { templateById, LIVE_BUILDERS, LIVE_TEAM_BUILDERS, LIVE_LEADER_BUILDERS, liveKeys, liveTeamKeys, liveCorner, bugSizeOf } from './templates.js';
import { bindLiveStat, bindLiveTeam, bindLiveLeaders } from './binders.js';
import { parseOverlay } from './overlay-params.js';
import { imageUrl } from './image-urls.js';

const P = parseOverlay(location.search);
const canvas = document.getElementById('c'), dbg = document.getElementById('dbg');
const images = {};
let store = null, outlines = {}, photoIds = new Set(), lastText = null, status = 'indul…';
const say = s => { status = s; if (P.debug) { dbg.style.display = 'block'; dbg.textContent = `${P.game || '—'} · ${P.graphic} · ${s}`; } };

function loadImage(key, url) {
  if (images[key]) return Promise.resolve(images[key]);
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => { images[key] = img; resolve(img); };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
async function ensureImages(t, values) {
  const jobs = [];
  for (const el of t.elements) if (el.texture && !images['tex/' + el.texture]) jobs.push(loadImage('tex/' + el.texture, el.texture));
  for (const v of Object.values(values)) {
    const k = v?.src;
    if (typeof k === 'string' && !images[k]) { const u = imageUrl(k); if (u) jobs.push(loadImage(k, u)); }
  }
  await Promise.all(jobs);
}

/** The template for this link: the ticked statistics decide its geometry, as in the studio. */
function buildTemplate(game) {
  const t = templateById(P.templateId), L = P.live;
  if (P.graphic === 'liveleaders') return LIVE_LEADER_BUILDERS[t.id](liveKeys(L.leaderStats));
  if (P.graphic === 'liveteam') return LIVE_TEAM_BUILDERS[t.id](liveTeamKeys(L.teamStats));
  const h = game.teams.home, homeId = clubIdStrict(P.league, h.short) || clubIdStrict(P.league, h.name); // which score bug the broadcast carries (the host club decides)
  return LIVE_BUILDERS[t.id](liveKeys(Array.isArray(L.stats) && L.stats.length ? L.stats : L.variant), liveCorner(L.corner), homeId ? bugSizeOf(P.league, homeId) : 'large');
}
function bind(game) {
  const sel = { ...P.live, fetchedAt: '' }, lg = P.league;
  return P.graphic === 'liveleaders' ? bindLiveLeaders(store, lg, game, sel, photoIds) : P.graphic === 'liveteam' ? bindLiveTeam(store, lg, game, sel) : bindLiveStat(store, lg, game, sel, photoIds);
}

async function draw(text) {
  const feed = decodeFeed(text);
  if (feedProblem(text) || !feed) throw new Error('a hírcsatorna válasza nem értelmezhető');
  const game = parseGame(feed, P.game);
  if (!game) throw new Error('a meccs nincs a hírcsatornában');
  const t = buildTemplate(game), auto = bind(game), values = {};
  for (const el of t.elements) {
    const x = { ...(auto[el.id] || (el.defaultText ? { text: el.defaultText } : {})) };
    if (el.runs && !x.runs && x.text !== undefined) x.runs = [{ text: x.text }];
    values[el.id] = x;
  }
  await ensureImages(t, values);
  render(canvas, t, values, { background: null, images, outlines, baseOpacity: null, safeZone: null });
  say(`${game.teams.home.short} ${game.score.home}–${game.score.away} ${game.teams.away.short}`);
}

async function tick() {
  try {
    const url = new URL(`../live?game=${P.game}&kind=full${P.token ? '&token=' + encodeURIComponent(P.token) : ''}`, location.href);
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status === 403 ? 'hibás vagy hiányzó token a linkben' : `a kiszolgáló ${r.status}`);
    const text = await r.text();
    if (text !== lastText) { await draw(text); lastText = text; } // unchanged feed → nothing to redraw
  } catch (e) { say(`hiba: ${e.message} (az utolsó jó kép marad)`); console.warn('overlay', e); }
}

async function main() {
  if (!P.game) return say('hiányzik a meccs a linkből (?game=whun_135563)');
  try {
    await loadFonts('fonts/');
    store = await loadDashboard(async f => { const r = await fetch(`../data/${f}?v=${Math.floor(Date.now() / 600000)}`, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    try { outlines = logoOutlines(await (await fetch('logos/logos.json')).json()); } catch { outlines = {}; }
    try { const r = await fetch('players/index.json', { cache: 'no-store' }); if (r.ok) photoIds = new Set((await r.json()).ids); } catch { /* no photos */ }
    await Promise.all(Object.keys(CLUBS[P.league]).map(id => loadImage(`${P.league}/${id}`, `logos/${P.league}/${id}.png`)));
  } catch (e) { say(`indítási hiba: ${e.message}`); }
  document.body.dataset.ready = '1';
  await tick();
  setInterval(tick, P.refresh * 1000);
}
main();
window.__overlay = { params: P, status: () => status };
