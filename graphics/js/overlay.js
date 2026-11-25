// OBS browser source: renders ONE live graphic of ONE game on a transparent 1920x1080 canvas and keeps it up to date by itself.
// Everything comes from the link (see overlay-params.js); a reload (OBS "refresh cache of current page") simply starts over with the same link.
// Nothing is ever drawn when there is no data yet or the feed fails: the last good picture stays (never an error text on air). &debug=1 shows a status line.
import { loadDashboard } from './data.js';
import { loadFonts, render, logoOutlines } from './engine.js';
import { CLUBS, clubIdStrict } from './clubs.js';
import { parseGame, decodeFeed, feedProblem, applyOfficialNames, needsOfficialNames } from './live.js';
import { templateById, LIVE_BUILDERS, LIVE_TEAM_BUILDERS, LIVE_LEADER_BUILDERS, liveKeys, liveTeamKeys, liveCorner, bugSizeOf } from './templates.js';
import { bindLiveStat, bindLiveTeam, bindLiveLeaders } from './binders.js';
import { parseOverlay, normOnAir } from './overlay-params.js';
import { imageUrl } from './image-urls.js';

const P = parseOverlay(location.search);
const canvas = document.getElementById('c'), dbg = document.getElementById('dbg');
const images = {};
let store = null, outlines = {}, photoIds = new Set(), lastText = null, dirty = false, status = 'indul…', officialNames = null, namesTried = 0;
// What is on air: a link with &g=… shows that one graphic (old direct links); the fixed link of a game (no &g) follows what the builder put on air on the server (/live-state).
let onAir = P.fixed ? { graphic: P.graphic, live: P.live } : { graphic: 'off', live: {} }, stateRev = -1;
const say = s => { status = s; if (P.debug) { dbg.style.display = 'block'; dbg.textContent = `${P.game || '—'} · ${onAir.graphic} · ${s}`; } };

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
  const t = templateById(`${onAir.graphic}-${P.league}`), L = onAir.live;
  if (onAir.graphic === 'liveleaders') return LIVE_LEADER_BUILDERS[t.id](liveKeys(L.leaderStats));
  if (onAir.graphic === 'liveteam') return LIVE_TEAM_BUILDERS[t.id](liveTeamKeys(L.teamStats));
  const h = game.teams.home, homeId = clubIdStrict(P.league, h.short) || clubIdStrict(P.league, h.name); // which score bug the broadcast carries (the host club decides)
  return LIVE_BUILDERS[t.id](liveKeys(Array.isArray(L.stats) && L.stats.length ? L.stats : L.variant), liveCorner(L.corner), homeId ? bugSizeOf(P.league, homeId) : 'large');
}
function bind(game) {
  const sel = { ...onAir.live, fetchedAt: '' }, lg = P.league;
  return onAir.graphic === 'liveleaders' ? bindLiveLeaders(store, lg, game, sel, photoIds) : onAir.graphic === 'liveteam' ? bindLiveTeam(store, lg, game, sel) : bindLiveStat(store, lg, game, sel, photoIds);
}

function clearCanvas() { const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); }
async function draw(text) {
  if (onAir.graphic === 'off') { clearCanvas(); return say('nincs adásban (az átlátszó kép marad)'); }
  const feed = decodeFeed(text);
  if (feedProblem(text) || !feed) throw new Error('a hírcsatorna válasza nem értelmezhető');
  const game = parseGame(feed, P.game);
  if (!game) throw new Error('a meccs nincs a hírcsatornában');
  applyOfficialNames(game, officialNames); // ő / ű that the feed lost: the official spelling from mkosz.hu (by player number)
  if (!officialNames && needsOfficialNames(game)) loadOfficialNames();
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

/** The official spelling of the names (mkosz.hu match page, relayed by the server); asked only when the feed has a "?" in a name, at most once a minute until it works. */
async function loadOfficialNames() {
  if (officialNames || Date.now() - namesTried < 60000) return;
  namesTried = Date.now();
  try {
    const r = await fetch(new URL(`../mkosz?game=${P.game}${P.token ? '&token=' + encodeURIComponent(P.token) : ''}`, location.href), { cache: 'no-store' });
    if (!r.ok) throw new Error(`a kiszolgáló ${r.status}`);
    officialNames = (await r.json()).names || {};
    dirty = true; // draw again with the right letters
  } catch (e) { console.warn('official names', e); }
}

/** The builder's choice of this game from the server: when it changed, the overlay switches by itself (no change in OBS needed). */
async function pollState() {
  const r = await fetch(new URL(`../live-state?game=${P.game}${P.token ? '&token=' + encodeURIComponent(P.token) : ''}`, location.href), { cache: 'no-store' });
  if (!r.ok) throw new Error(r.status === 403 ? 'hibás vagy hiányzó kulcs a linkben' : `a kiszolgáló ${r.status}`);
  const j = await r.json();
  if (j.rev !== stateRev) { stateRev = j.rev; onAir = normOnAir(j.state); dirty = true; if (onAir.graphic === 'off') { clearCanvas(); say('nincs adásban (az átlátszó kép marad)'); } else await pollFeed(); }
}
async function pollFeed() {
  if (onAir.graphic === 'off') return; // nothing on air: the feed is not even asked
  const url = new URL(`../live?game=${P.game}&kind=full${P.token ? '&token=' + encodeURIComponent(P.token) : ''}`, location.href);
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(r.status === 403 ? 'hibás vagy hiányzó token a linkben' : `a kiszolgáló ${r.status}`);
  const text = await r.text();
  if (text !== lastText || dirty) { dirty = false; lastText = text; await draw(text); } // unchanged feed and choice → nothing to redraw
}
// two independent timers (no clock arithmetic): the feed every `refresh` seconds, the builder's choice every 1.5 s (fixed link only); an error keeps the last good picture
const guarded = fn => { let busy = false; return async () => { if (busy) return; busy = true; try { await fn(); } catch (e) { say(`hiba: ${e.message} (az utolsó jó kép marad)`); console.warn('overlay', e); } finally { busy = false; } }; };
const tickFeed = guarded(pollFeed), tickState = guarded(pollState);

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
  if (!P.fixed) await tickState();
  await tickFeed();
  if (!P.fixed) setInterval(tickState, 1500);
  setInterval(tickFeed, P.refresh * 1000);
}
main();
window.__overlay = { params: P, status: () => status, onAir: () => onAir, names: () => ({ Halasy: officialNames?.['201536'] }) }; // names(): test hook
