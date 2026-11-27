import { loadDashboard, LEAGUES, SOURCES, gameKey } from './data.js';
import { readFile } from './xlsx.js';
import * as LAY from './layout.js';
import { importWorkbook, detectLeague, clubLabel, parseEredmenyekText, compKey } from './importer.js';
import { club, CLUBS, clubIdStrict } from './clubs.js';
import { TEMPLATES, TEMPLATE_TYPES, templateById, rosterBuild, psBuild, psNormalize, rosterDims, STAT_ROWS, PC_BUILDERS, pcRowKeys, LIVE_BUILDERS, TEAMSTATS_BUILDERS, TEAMSTATS_MAX, LIVE_TEAM_BUILDERS, LIVE_LEADER_BUILDERS, LIVE_TEAM_STATS, liveTeamKeys, LIVE_VARIANTS, LIVE_STATS, liveKeys, liveVariant, LIVE_CORNERS, liveCorner, BUG, bugSizeOf, COACH_LOOKS, coachLook } from './templates.js';
import { render, loadFonts, measure, logoOutlines } from './engine.js';
import { createPanels } from './panels.js';
import { PACKAGE_ITEMS, fileNameFor, zipName, readmeText, buildZip } from './package.js';
import {
  bindComparison, bindPlayerCompare, bindPlayerSpecial, bindRoster, rosterPlayers, isForeign, bindForm, bindH2H, SRC_COLOR, playerOptions, pickPlayer, bindTeamstats, bindRowList, bindIntro, bindNextMatch, bindReferees, COMPETITIONS, MISSING, fmtDate, bindLiveStat, bindLiveTeam, bindLiveLeaders, normHex, leaderColors, LEADER_SHADOW_DEFAULT, liveChoice, bindCoach, coachOpponent
} from './binders.js';
import { decodeFeed, parseGame, gameCode, feedUrl, feedProblem, applyOfficialNames, needsOfficialNames } from './live.js';
import { imageUrl } from './image-urls.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = { state: 'nbia.studio.state.v1', presets: 'nbia.studio.presets.v1', venues: 'nbia.studio.venues.v1', excel: 'nbia.studio.excel.v1', layouts: 'nbia.studio.layouts.v1' };
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

const COLORS = [
  ['', 'Automatikus'], ['#fefefe', 'Fehér'], ['#1fbf1b', 'Zöld (győzelem)'], ['#0b9444', 'Zöld (jobb mutató)'],
  ['#ec4036', 'Piros'], ['#000000', 'Fekete'], ['#dba234', 'Arany'], ['#383838', 'Sötétszürke'],
];

const state = Object.assign({
  league: 'men',
  template: { men: 'intro-men', women: 'intro-women' },
  sel: { men: {}, women: {} },
  overrides: {},
  zoom: 'fit',
  baseOpacity: 0.965, // court/panel opacity of the export; null = the PSD's own value
}, lsGet(LS.state, {}));
let store = null;
// saved layouts per template: { [templateId]: { benchmark: {items} | null, saved: { [name]: {items} } } }
state.layouts = lsGet(LS.layouts, {});
const persistLayouts = () => lsSet(LS.layouts, state.layouts);
const layoutsOf = tid => (state.layouts[tid] ||= { benchmark: null, saved: {} });
const bench = () => layoutsOf(tpl().id).benchmark;
let selectedId = null; // element selected in the layout editor
let fontsOk = false;
const images = {};
const measureCanvas = document.createElement('canvas').getContext('2d');
let lastReport = null;
let outlines = {};

// The settings of the live graphics are remembered and shared by the men's and the women's tab (what you pick once stays: stats, colours, outline, shadow, preset, corner); the game itself (code, team, player, auto refresh) stays per tab.
const LIVE_SHARED = ['stats', 'variant', 'corner', 'teamStats', 'leaderStats', 'leaderColors', 'leaderOutlineOn', 'leaderShadowOn', 'leaderShadowSize'];
function syncLiveSettings() {
  const from = state.sel[state.league]?.live;
  if (!from) return;
  for (const lg of ['men', 'women']) {
    if (lg === state.league) continue;
    const to = ((state.sel[lg] ||= {}).live ||= {});
    for (const k of LIVE_SHARED) if (from[k] !== undefined) to[k] = JSON.parse(JSON.stringify(from[k]));
  }
}
const saveState = () => { syncLiveSettings(); lsSet(LS.state, { league: state.league, template: state.template, sel: state.sel, overrides: state.overrides, zoom: state.zoom, baseOpacity: state.baseOpacity }); };
const toast = msg => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); };

let photoIds = new Set(); // ids of the downloaded player photos (players/index.json); a missing photo shows the placeholder
/** Loads the flags / photos a set of values refers to (the renderer draws only what is already loaded). */
async function ensureImages(values) {
  const jobs = [];
  for (const v of Object.values(values)) {
    const k = v?.src;
    if (typeof k === 'string' && !images[k]) { const u = imageUrl(k); if (u) jobs.push(loadImage(k, u)); }
  }
  await Promise.all(jobs);
}

/** Court textures of resizable panels (element.texture = path; stored under 'tex/<path>'). */
async function ensureTextures(t) {
  for (const el of t.elements) if (el.texture && !images['tex/' + el.texture]) { try { await loadImage('tex/' + el.texture, el.texture); } catch { /* the panel falls back to its plain fill */ } }
}

function loadImage(key, url) {
  if (images[key]) return Promise.resolve(images[key]);
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => { images[key] = img; resolve(img); };
    img.onerror = () => { console.warn('image failed', url); resolve(null); };
    img.src = url;
  });
}

async function loadLeagueImages(lg) {
  await Promise.all([
    ...Object.keys(CLUBS[lg]).map(id => loadImage(`${lg}/${id}`, `logos/${lg}/${id}.png`)),
    ...Object.keys(COMPETITIONS).filter(Boolean).map(k => loadImage(k, `assets/competitions/${k.split('/')[1]}.png`)),
    loadImage('nextmatch/frame', 'templates/nextmatch/frame.png'),
  ]);
}

const psCache = new Map();
const tpl = () => {
  const t = templateById(state.template[state.league]);
  if (t.type === 'roster' || t.type === 'rostergrid') { // rows / cards for the real number of players of the chosen team
    const pl = rosterPlayers(store, t.league, state.sel[t.league]?.teamId);
    const n = pl.length || t.rosterN, mask = pl.map(p => (isForeign(p) ? '1' : '0')).join(''); // foreign players: given name above the surname
    const ns = Math.max(0.5, Math.min(2.5, (state.sel[t.league]?.numScale || 100) / 100)); // jersey-number size, all players at once
    const fs = Math.max(0.5, Math.min(2.5, (state.sel[t.league]?.flagScale || 100) / 100)); // flag size, all players at once
    const off = state.sel[t.league]?.rowOff || [];
    const key = `${t.id}|${n}|${mask}|${ns}|${fs}|${JSON.stringify(off)}`;
    if (!psCache.has(key)) { if (psCache.size > 40) psCache.clear(); psCache.set(key, rosterBuild(t, n, mask, ns, fs, off)); }
    return psCache.get(key);
  }
  if (t.type === 'playercompare') { // key players: only the chosen rows, the panel is as tall as they are
    const rows = pcRowKeys(state.sel[t.league]?.pc?.rows), key = t.id + '|' + rows.join();
    if (!psCache.has(key)) { if (psCache.size > 40) psCache.clear(); psCache.set(key, PC_BUILDERS[t.id](rows)); }
    return psCache.get(key);
  }
  if (t.type === 'teamstats') { // player table: as many rows as players are shown (up to TEAMSTATS_MAX); more than the PSD's rows make the rows tighter
    const sl = state.sel[t.league], n = sl?.players ? sl.players.length : (store?.players(t.league, sl?.teamId)?.players.length || 0), key = `${t.id}|${n}`;
    if (!psCache.has(key)) { if (psCache.size > 40) psCache.clear(); psCache.set(key, TEAMSTATS_BUILDERS[t.id](n)); }
    return psCache.get(key);
  }
  if (t.type === 'liveleaders') { // live three leaders: the ticked statistics
    const keys = liveKeys(state.sel[t.league]?.live?.leaderStats), key = `${t.id}|${keys.join()}`;
    if (!psCache.has(key)) { if (psCache.size > 40) psCache.clear(); psCache.set(key, LIVE_LEADER_BUILDERS[t.id](keys)); }
    return psCache.get(key);
  }
  if (t.type === 'liveteam') { // live team comparison: the ticked statistics
    const keys = liveTeamKeys(state.sel[t.league]?.live?.teamStats), key = `${t.id}|${keys.join()}`;
    if (!psCache.has(key)) { if (psCache.size > 40) psCache.clear(); psCache.set(key, LIVE_TEAM_BUILDERS[t.id](keys)); }
    return psCache.get(key);
  }
  if (t.type === 'livestat') { // live player insert: the statistics shown = the chosen variant
    const keys = liveKeys(liveSpec(state.sel[t.league]?.live)), corner = liveCorner(state.sel[t.league]?.live?.corner), size = bugSizeNow() || 'large', key = `${t.id}|${keys.join()}|${corner}|${size}`;
    if (!psCache.has(key)) { if (psCache.size > 40) psCache.clear(); psCache.set(key, LIVE_BUILDERS[t.id](keys, corner, size)); }
    return psCache.get(key);
  }
  if (t.type !== 'playerspecial') return t;
  // the player-special graphic is built from the operator's settings (columns, rows, photo, layering)
  const cfg = psNormalize(t.league, state.sel[t.league]?.psCfg);
  const key = t.id + JSON.stringify(cfg);
  if (!psCache.has(key)) { if (psCache.size > 30) psCache.clear(); psCache.set(key, psBuild(t, cfg)); }
  return psCache.get(key);
};
const s0 = () => state.sel[state.league];
const sel = () => state.sel[state.league];
const ovKey = () => tpl().id;
const overrides = () => (state.overrides[ovKey()] ||= {});

// ───────────────────────── freshness ─────────────────────────
function renderFreshness() {
  const lg = state.league;
  const f = store.freshness(lg);
  const names = { fixtures: 'Menetrend', referees: 'Játékvezetők', standings: 'Tabella', teamStats: 'Csapatstat', players: 'Játékosstat', cups: 'Európai meccsek' };
  const fmt = iso => { const d = new Date(iso); return d.toLocaleString('hu-HU', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); };
  const parts = Object.keys(SOURCES).map(k => {
    const x = f[k];
    if (!x && SOURCES[k].optional) return '';
    if (!x) return `<span class="err" title="Nem tölthető be">${names[k]}: hiányzik</span>`;
    const age = x.hours === null ? '?' : x.hours < 1 ? '<1 ó' : x.hours < 48 ? `${Math.round(x.hours)} ó` : `${Math.round(x.hours / 24)} nap`;
    return `<span class="${x.stale ? 'stale' : ''}" title="Frissítve: ${esc(x.updated_at)}">${names[k]}: ${fmt(x.updated_at)} (${age})</span>`;
  });
  const xi = store.excelInfo(lg);
  if (xi) { const off = excelOffParts(xi); parts.push(`<span class="${off.length ? 'stale' : ''}" title="${esc(xi.file)} – módosítva: ${esc(xi.modified || '?')}">Excel: ${esc(xi.file)} (${xi.modified ? fmt(xi.modified) : 'ismeretlen dátum'})${off.length ? ' – kikapcsolva: ' + off.join(', ') : ''}</span>`); }
  for (const e of store.errors.filter(e => e.league === lg)) parts.push(`<span class="err">${esc(e.file)}: ${esc(e.error)}</span>`);
  $('freshness').innerHTML = parts.join('');
}

// ───────────────────────── template list ─────────────────────────
function renderTemplateList() {
  const list = TEMPLATES.filter(t => t.league === state.league);
  $('templateList').innerHTML = list.map(t => `<button data-id="${t.id}" class="${t.id === tpl().id ? 'on' : ''}">
    <img src="${t.thumb || `templates/${t.id}/thumb.jpg`}" alt="" loading="lazy"><span>${esc(TEMPLATE_TYPES[t.type])}</span></button>`).join('');
}

// ───────────────────────── selection ─────────────────────────
const matchLabel = m => `${fmtDate(m.date)} ${m.time || ''} · ${m.roundNo ? m.roundNo + '. ford.' : ''} · ${club(state.league, m.homeId)?.short || m.home} – ${club(state.league, m.awayId)?.short || m.away}${m.status === 'finished' && m.score ? ` (${m.score.home}-${m.score.away})` : ''}`;
const matchKey = m => m.url || `${m.date}|${m.home}|${m.away}`;

function teamOptions(selected) {
  return store.clubs(state.league).map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.official)}${c.rank ? ` (${c.rank}.)` : ''}</option>`).join('');
}

function ensureSelection() {
  const s = sel(), lg = state.league;
  const up = store.upcoming(lg);
  if (!s.matchKey || !store.league(lg).fixtures.some(m => matchKey(m) === s.matchKey)) s.matchKey = up[0] ? matchKey(up[0]) : null;
  const m = currentMatch();
  if (!s.teamId || !CLUBS[lg][s.teamId]) s.teamId = m?.homeId || Object.keys(CLUBS[lg])[0];
}

function currentMatch() {
  const s = sel();
  if (s.custom) return s.custom.homeId && s.custom.awayId ? { custom: true, homeId: s.custom.homeId, awayId: s.custom.awayId, home: club(state.league, s.custom.homeId).official, away: club(state.league, s.custom.awayId).official, roundNo: null, date: null, time: null } : null;
  return store.league(state.league).fixtures.find(m => matchKey(m) === s.matchKey) || null;
}

// Which score bug the broadcast carries (large: the broadcasts of ETO Basket and Falco, small: all other partners): by the host club of the chosen match / live game,
// or set by hand. Unknown host → the large zone (it contains the small one). Graphics are kept out of that zone (engine: assets.safeZone).
const BUG_KEY = 'nbia.studio.bug.v1';
let bugMode = lsGet(BUG_KEY, 'auto');
function bugSizeNow() {
  if (bugMode === 'large' || bugMode === 'small') return bugMode;
  if (bugMode === 'off') return null;
  const lg = state.league, tt = templateById(state.template[lg]);
  let homeId = null;
  if (isLiveType(tt?.type)) { const h = live.game?.teams.home; homeId = h ? (clubIdStrict(lg, h.short) || clubIdStrict(lg, h.name)) : null; }
  else homeId = currentMatch()?.homeId || null;
  return homeId ? bugSizeOf(lg, homeId) : 'large';
}
const bugZoneNow = () => { const z = bugSizeNow(); return z ? BUG[z].zone : null; };
/** Preview-only hatched marking of the zone (never part of the exported PNG). */
function applyZoneGuide() {
  const size = bugSizeNow(), zg = $('zoneGuide');
  if (!size || !$('zoneToggle').checked) { zg.classList.remove('on'); return; }
  const zb = BUG[size].zone;
  Object.assign(zg.style, { left: `${zb[0] / 19.2}%`, top: `${zb[1] / 10.8}%`, width: `${(zb[2] - zb[0]) / 19.2}%`, height: `${(zb[3] - zb[1]) / 10.8}%` });
  zg.title = BUG[size].label; zg.dataset.size = size; zg.classList.add('on');
}

/** Options of the comparison graphics: colour of the data-source name; key players: photos instead of logos. */
function cmpOptionsHtml(s, t) {
  const col = s.srcColor || SRC_COLOR;
  const photo = t.type === 'playercompare' ? `<div class="row2"><label>Középen: <select id="pcMode"><option value="auto" ${s.pc?.mode !== 'logo' ? 'selected' : ''}>a játékosok fotója (ha van)</option><option value="logo" ${s.pc?.mode === 'logo' ? 'selected' : ''}>a klubok logója</option></select></label>
      <label>Fotó átlátszatlansága (%)<input type="number" id="pcOpacity" min="10" max="100" step="5" value="${Math.round((s.pc?.photoOpacity ?? 0.6) * 100)}"></label></div>
    <fieldset class="xbox"><legend>Statisztikai kategóriák (a háttér a sorok számához igazodik)</legend><div class="pcRows">${STAT_ROWS.map(r => `<label class="chk"><input type="checkbox" class="pcRow" data-k="${r.key}" ${pcRowKeys(s.pc?.rows).includes(r.key) ? 'checked' : ''}> ${r.label}</label>`).join(' ')}</div></fieldset>` : '';
  return `<div class="row2"><label>Forrás-felirat színe (FULLFIELD.INFO / HUNBASKET.HU)<span class="import-row"><input type="color" id="srcColor" value="${col}"> <button type="button" id="srcColorReset" class="ghost">Alap</button></span></label></div>${photo}`;
}
function wireCmpOptions(s) {
  $('srcColor').oninput = e => { s.srcColor = e.target.value; update(false); };
  $('srcColorReset').onclick = () => { s.srcColor = null; renderSelection(); update(true); };
  if ($('pcMode')) {
    $('pcMode').onchange = e => { (s.pc ||= {}).mode = e.target.value; update(true); };
    document.querySelectorAll('.pcRow').forEach(cb => cb.onchange = () => {
      const on = [...document.querySelectorAll('.pcRow')].filter(x => x.checked).map(x => x.dataset.k);
      if (!on.length) { cb.checked = true; return toast('Legalább egy kategóriának maradnia kell.'); }
      (s.pc ||= {}).rows = on; update(true);
    });
    $('pcOpacity').onchange = e => { (s.pc ||= {}).photoOpacity = Math.max(0.1, Math.min(1, (+e.target.value || 60) / 100)); update(true); };
  }
}

function playerSelects() {
  const m = currentMatch(), s = sel(), lg = state.league;
  if (!m) return '';
  const one = (side, id, label) => {
    const opts = playerOptions(store, lg, id);
    const cur = pickPlayer(store, lg, id, s.pc?.[side]);
    return `<label>${label}<select id="pc_${side}">${opts.map(o => `<option value="${esc(o.key)}" ${o.key === cur?.key ? 'selected' : ''}>${esc(o.name)} (${esc(o.p['P.'] ?? '?')} pont/meccs · ${esc(o.p['M.'] ?? '?')} meccs)</option>`).join('') || '<option>nincs játékosstatisztika</option>'}</select></label>`;
  };
  const up = (side, label) => `<fieldset class="xbox"><legend>${label} – saját fotó</legend><span class="import-row"><input type="file" class="pcUp" data-side="${side}" accept="image/png,image/webp,image/jpeg"> <button type="button" class="pcUpClear ghost" data-side="${side}" ${images['upload/pc' + (side === 'home' ? 'Home' : 'Away')] ? '' : 'disabled'}>Fotó törlése</button></span>${bgHtml('pc' + (side === 'home' ? 'Home' : 'Away'))}</fieldset>`;
  return `<div class="row2">${one('home', m.homeId, 'Hazai játékos')}${one('away', m.awayId, 'Vendég játékos')}</div><div class="row2">${up('home', 'Hazai')}${up('away', 'Vendég')}</div><small class="hint">A feltöltött fotó mindig előnyt élvez a Hunbasket-fotóval és a logóval szemben (átlátszó PNG a legjobb, vagy használd a háttéreltávolítót). Alapból a legjobb pontszerző; a helyezés a liga játékosai között értendő.</small>`;
}


// player-special settings, background removal and the Extra frames live in panels.js (created in main())
function rowOffHtml(s, rows) {
  const names = ['Felső sor', 'Középső sor', 'Alsó sor', '4. sor', '5. sor'];
  return Array.from({ length: rows }, (_, r) => `<span class="rowoff"><b>${names[r] || (r + 1) + '. sor'}</b> <label>↔ <input type="number" class="rowOff" data-r="${r}" data-a="0" min="-300" max="300" step="2" value="${s.rowOff?.[r]?.[0] || 0}"></label><label>↕ <input type="number" class="rowOff" data-r="${r}" data-a="1" min="-300" max="300" step="2" value="${s.rowOff?.[r]?.[1] || 0}"></label></span>`).join('') + '<button type="button" id="rowOffReset" class="ghost">Sorok alaphelyzet</button>';
}

// ───────────────────────── live statistics (Élő statisztika) ─────────────────────────
// The feed of the MKOSZ netcasting page cannot be read by a browser directly (no CORS header, cloud networks are refused): tools/serve.py relays it at /live.
// Without the relay the operator pastes the feed text (open …/storage/full<code>.html, Ctrl+A, Ctrl+C).
function isLiveType(t) { return t === 'livestat' || t === 'liveteam' || t === 'liveleaders'; }
const live = { game: null, fetchedAt: '', error: '', busy: false, timer: null, players: 0, names: null, namesFor: '', namesTried: 0 };
const liveToken = () => { try { return localStorage.getItem('nbia.live.token') || ''; } catch { return ''; } };
const liveRelay = (code, kind = 'full') => new URL(`../live?game=${code}&kind=${kind}${liveToken() ? '&token=' + encodeURIComponent(liveToken()) : ''}`, location.href).href;
function liveApply(text, code) {
  const feed = decodeFeed(text);
  if (!feed) return false;
  live.game = parseGame(feed, code);
  if (live.namesFor === code) applyOfficialNames(live.game, live.names); // ő / ű the feed lost, from the mkosz.hu page
  live.fetchedAt = new Date().toLocaleTimeString('hu-HU');
  live.error = '';
  return true;
}
/** The official spelling of the names (the feed writes ő / ű as "?"): asked from the server only when a name needs it, once a minute at most. */
async function liveNames(code) {
  if (live.namesFor === code || Date.now() - live.namesTried < 60000 || !needsOfficialNames(live.game)) return;
  live.namesTried = Date.now();
  try {
    const r = await fetch(new URL(`../mkosz?game=${code}${liveToken() ? '&token=' + encodeURIComponent(liveToken()) : ''}`, location.href), { cache: 'no-store' });
    if (!r.ok) return;
    live.names = (await r.json()).names || {}; live.namesFor = code;
    applyOfficialNames(live.game, live.names);
  } catch { /* the feed's own spelling stays */ }
}
async function liveFetchNow() {
  const code = gameCode(sel().live?.code);
  if (!code) { live.error = 'Adj meg egy meccs-linket vagy kódot (pl. whun_135563, junior: hunu18_142679).'; return false; }
  if (live.busy) return false;
  live.busy = true;
  try {
    const r = await fetch(liveRelay(code), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    if (!liveApply(await r.text(), code)) throw new Error('a hírcsatorna válasza nem értelmezhető (csonka vagy más formátum)');
    await liveNames(code);
    return true;
  } catch (e) {
    live.error = `Az élő hírcsatorna innen nem érhető el (${e.message}). Indítsd a stúdiót a helyi szerverrel (python3 tools/serve.py), vagy illeszd be a hírcsatorna szövegét lent.`;
    return false;
  } finally { live.busy = false; }
}
function liveTimer() {
  clearInterval(live.timer); live.timer = null;
  if (!isLiveType(tpl().type) || !sel().live?.auto || !live.game) return;
  live.timer = setInterval(async () => {
    if (!isLiveType(tpl().type)) return liveTimer();
    if (await liveFetchNow()) { const n = live.game.players.length; if (n !== live.players) { live.players = n; renderSelection(); } update(false); }
    else $('liveInfo') && ($('liveInfo').innerHTML = liveInfoHtml());
  }, 5000);
}
function liveInfoHtml() {
  if (live.error) return `<span style="color:var(--warn)">${esc(live.error)}</span>`;
  const g = live.game;
  if (!g) return 'Még nincs élő meccs betöltve.';
  const c = g.clock, state = g.finished ? 'végeredmény' : c.period <= 4 ? `${c.period}. negyed` : `${c.period - 4}. hosszabbítás`;
  return `${esc(g.teams.home.short)} ${g.score.home}–${g.score.away} ${esc(g.teams.away.short)} · ${state} · frissítve: ${esc(live.fetchedAt)}`;
}
/** The ticked stats of the live player insert: the saved list, else the chosen preset. */
const liveSpec = L => (Array.isArray(L?.stats) && L.stats.length ? L.stats : L?.variant);
function livePanelHtml(s) {
  const L = s.live || {}, mode = tpl().type, teamMode = mode === 'liveteam' || mode === 'liveleaders', g = live.game, side = L.side === 'away' ? 'away' : 'home';
  const ch = g ? liveChoice(store, state.league, g, side, L.player) : null;
  const ticked = liveKeys(liveSpec(L)), variants = `<option value="">Saját választás</option>` + Object.entries(LIVE_VARIANTS).map(([k, v]) => `<option value="${k}" ${liveKeys(k).join() === ticked.join() ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
  const tickHtml = LIVE_STATS.map(x => `<label style="flex-direction:row;display:inline-flex;gap:4px;align-items:center;margin-right:10px"><input type="checkbox" class="liveStat" value="${x.key}" ${ticked.includes(x.key) ? 'checked' : ''}> ${x.label}</label>`).join('');
  const playerRows = `    <div class="row2"><label>Csapat<select id="liveSide"><option value="home" ${side === 'home' ? 'selected' : ''}>Hazai${g ? ' – ' + esc(g.teams.home.short) : ''}</option><option value="away" ${side === 'away' ? 'selected' : ''}>Vendég${g ? ' – ' + esc(g.teams.away.short) : ''}</option></select></label>
      <label>Játékos<select id="livePlayer">${ch ? ch.players.map(p => `<option value="${esc(p.code)}" ${ch.player && p.code === ch.player.code ? 'selected' : ''}>${esc((p.number ? '#' + p.number + ' ' : '') + p.name)} – ${p.stat.pts} p</option>`).join('') : '<option>nincs betöltött meccs</option>'}</select></label></div>
    <div class="row2"><label>Statisztikák (kész csomag)<select id="liveVariant">${variants}</select></label>
      <label>Hely a képen<select id="liveCorner">${Object.entries(LIVE_CORNERS).map(([k, v]) => `<option value="${k}" ${liveCorner(L.corner) === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
    <div id="liveStats"><small class="hint">Pipáld be, mi látsszon (a dobásoknál: betalált/kísérlet és (százalék)):</small><br>${tickHtml}</div>`;
  const tt = liveTeamKeys(L.teamStats), teamTicks = `<div id="liveTeamStats"><small class="hint">Pipáld be, mely statisztikák látsszanak (a dobásoknál: betalált/kísérlet és (százalék)):</small><br>${LIVE_TEAM_STATS.map(x => `<label style="flex-direction:row;display:inline-flex;gap:4px;align-items:center;margin-right:10px"><input type="checkbox" class="liveTeamStat" value="${x.key}" ${tt.includes(x.key) ? 'checked' : ''}> ${x.label}</label>`).join('')}</div>`;
  const lk = liveKeys(L.leaderStats), lc = leaderColors(L.leaderColors), leaderTicks = `<div id="liveLeaderStats"><small class="hint">Mindkét csapat három legjobb VAL-értékű játékosa jelenik meg (a VAL csak a kiválasztás szabálya). Pipáld be, mely statisztikák látsszanak:</small><br>${LIVE_STATS.map(x => `<label style="flex-direction:row;display:inline-flex;gap:4px;align-items:center;margin-right:10px"><input type="checkbox" class="liveLeaderStat" value="${x.key}" ${lk.includes(x.key) ? 'checked' : ''}> ${x.label}</label>`).join('')}<br><label style="flex-direction:row;display:inline-flex;gap:4px;align-items:center"><input type="checkbox" id="liveLeaderOutlineOn" ${L.leaderOutlineOn === false ? '' : 'checked'}> Körvonal a játékosfotók mögött (3 px)</label> <label style="flex-direction:row;display:inline-flex;gap:4px;align-items:center;margin-left:10px"><input type="checkbox" id="liveLeaderShadowOn" ${L.leaderShadowOn === false ? '' : 'checked'}> Árnyék</label> <label style="flex-direction:row;display:inline-flex;gap:6px;align-items:center;margin-left:10px">Árnyék mérete <input type="range" id="liveLeaderShadowSize" min="0" max="40" step="1" value="${L.leaderShadowSize ?? LEADER_SHADOW_DEFAULT}" style="width:110px"><output id="liveLeaderShadowSizeOut">${L.leaderShadowSize ?? LEADER_SHADOW_DEFAULT}</output> px</label><br><small class="hint">Színek (hex-kód, pl. #ff8800; mindenhol egyformán, nem játékosonként):</small><div class="row2" style="flex-wrap:wrap">${[['name', 'Nevek'], ['label', 'Statisztika-nevek (PTS, REB…)'], ['value', 'Számok'], ['outline', 'Fotók körvonala (3 px)']].map(([k, lab]) => `<label>${lab}<span class="import-row"><input type="color" class="liveLeaderPick" data-k="${k}" value="${lc[k]}" style="width:38px;padding:0"> <input type="text" class="liveLeaderHex" data-k="${k}" value="${lc[k]}" maxlength="7" placeholder="#ffffff" style="flex:1;min-width:0"></span></label>`).join('')}</div><button type="button" id="liveLeaderColorReset" class="ghost">Színek visszaállítása (fehér)</button></div>`;
  return `<label>Élő meccs (netcasting link vagy kód)<span class="import-row"><input type="text" id="liveCode" style="flex:1;min-width:0" placeholder="https://netcasting4.webpont.com/?whun_135563" value="${esc(L.code || '')}"> <button type="button" id="liveLoad">Betöltés</button></span></label>
    <label style="flex-direction:row;display:flex;gap:6px;align-items:center"><input type="checkbox" id="liveAuto" ${L.auto ? 'checked' : ''}> Automatikus frissítés 5 másodpercenként</label>
    <small id="liveInfo" class="hint">${liveInfoHtml()}</small>
    ${mode === 'liveleaders' ? leaderTicks : teamMode ? teamTicks : playerRows}
    <details ${live.error || !live.game ? 'open' : ''}><summary>Beillesztés (ha az élő lekérés nem működik)</summary>
      <small class="hint" id="liveOpenRow">${liveOpenHtml(L.code)}</small>
      <textarea id="livePaste" rows="3" style="width:100%" placeholder="A böngészőben nyisd meg: https://netcasting4.webpont.com/storage/full<kód>.html – Ctrl+A, Ctrl+C, majd illeszd be ide."></textarea>
      <button type="button" id="livePasteGo" class="ghost">Beillesztett adat használata</button></details>
    <small class="hint">A fotó a keretgrafikáéval azonos hivatalos Hunbasket-fotó, a név a Hunbasket-keret írásmódja szerint. A statisztikát a stúdió az élő boxscore eseménylistájából számolja (a pontok egyeznek a hivatalos állással).</small>`;
}
/** Step 1 of the paste way: a ready-made link to the feed of the game (typing that address by hand is easy to get wrong). */
function liveOpenHtml(code) {
  const u = feedUrl(code);
  return u ? `1. <a href="${esc(u)}" target="_blank" rel="noopener">A hírcsatorna megnyitása új lapon ↗</a> (${esc(gameCode(code))}) &nbsp;2. a megnyílt lapon Ctrl+A, Ctrl+C &nbsp;3. illeszd be ide`
    : 'Előbb írd be fent a meccs linkjét vagy kódját (pl. whun_135563, junior: hunu18_142679): ide kerül a hírcsatorna megnyitásának hivatkozása.';
}
const LIVE_PROBLEM = {
  empty: 'A beillesztő mező üres.',
  html: 'Ez egy weboldal (HTML) szövege, nem a hírcsatorna. Használd a fenti hivatkozást („A hírcsatorna megnyitása”): azon a lapon egyetlen hosszú szöveg látszik, ABBÓL másold ki az egészet (Ctrl+A, Ctrl+C).',
  truncated: 'A beillesztett szöveg csonka (félbeszakadt): másold ki újra az egészet (Ctrl+A, Ctrl+C a hírcsatorna lapján).',
  unknown: 'A beillesztett szöveg nem hírcsatorna. A fenti hivatkozás megnyitja a helyes címet; onnan másold ki az egészet.',
};
function wireLivePanel(s) {
  const L = () => (s.live ||= {});
  $('liveCode').oninput = e => { $('liveOpenRow').innerHTML = liveOpenHtml(e.target.value); };
  $('liveCode').onchange = e => { L().code = e.target.value.trim(); };
  $('liveLoad').onclick = async () => {
    L().code = $('liveCode').value.trim();
    $('liveInfo').textContent = 'Betöltés…';
    const prev = live.game?.id;
    await liveFetchNow();
    live.players = live.game?.players.length || 0;
    if (live.game && live.game.id !== prev) { L().player = null; L().side = 'home'; resetMatchOverrides(); } // a refresh keeps the chosen player, another game starts over
    renderSelection(); update(true); liveTimer();
  };
  $('liveAuto').onchange = e => { L().auto = e.target.checked; saveState(); liveTimer(); };
  $('livePasteGo').onclick = () => {
    const code = gameCode(L().code), prev = live.game?.id;
    const txt = $('livePaste').value.trim();
    if (!liveApply(txt, code)) { const why = feedProblem(txt); live.error = `A beillesztett szöveg nem értelmezhető hírcsatorna. ${LIVE_PROBLEM[why] || LIVE_PROBLEM.unknown}`; }
    live.players = live.game?.players.length || 0;
    if (live.game && live.game.id !== prev) { L().player = null; L().side = 'home'; resetMatchOverrides(); }
    renderSelection(); update(true);
  };
  if (!$('liveSide')) { // team comparison / three leaders: only the ticked statistics
    const setColor = (k, hex) => { L().leaderColors = { ...(L().leaderColors || {}), [k]: hex }; update(true); };
    document.querySelectorAll('.liveLeaderPick').forEach(el => { el.oninput = () => { const h = normHex(el.value); if (!h) return; const tx = document.querySelector(`.liveLeaderHex[data-k="${el.dataset.k}"]`); if (tx) tx.value = h; setColor(el.dataset.k, h); }; });
    document.querySelectorAll('.liveLeaderHex').forEach(el => {
      el.oninput = () => { const h = normHex(el.value); el.style.outline = h || !el.value ? '' : '2px solid #c00'; if (h) { const pk = document.querySelector(`.liveLeaderPick[data-k="${el.dataset.k}"]`); if (pk) pk.value = h; setColor(el.dataset.k, h); } };
      el.onchange = () => { const h = normHex(el.value); el.value = h || leaderColors(L().leaderColors)[el.dataset.k]; el.style.outline = ''; };
    });
    const ol = $('liveLeaderOutlineOn'); if (ol) ol.onchange = () => { L().leaderOutlineOn = ol.checked; update(true); };
    const sd = $('liveLeaderShadowOn'); if (sd) sd.onchange = () => { L().leaderShadowOn = sd.checked; update(true); };
    const ss = $('liveLeaderShadowSize'); if (ss) ss.oninput = () => { L().leaderShadowSize = Number(ss.value); $('liveLeaderShadowSizeOut').textContent = ss.value; update(true); };
    const rs = $('liveLeaderColorReset'); if (rs) rs.onclick = () => { L().leaderColors = {}; renderSelection(); update(true); };
    document.querySelectorAll('.liveLeaderStat').forEach(cb => { cb.onchange = () => { L().leaderStats = [...document.querySelectorAll('.liveLeaderStat:checked')].map(x => x.value); if (!L().leaderStats.length) L().leaderStats = liveKeys('basic'); resetMatchOverrides(); renderSelection(); update(true); }; });
    document.querySelectorAll('.liveTeamStat').forEach(cb => { cb.onchange = () => { L().teamStats = [...document.querySelectorAll('.liveTeamStat:checked')].map(x => x.value); if (!L().teamStats.length) L().teamStats = liveTeamKeys(null); resetMatchOverrides(); renderSelection(); update(true); }; });
    return;
  }
  $('liveSide').onchange = e => { L().side = e.target.value; L().player = null; resetMatchOverrides(); renderSelection(); update(true); };
  $('livePlayer').onchange = e => { L().player = e.target.value; resetMatchOverrides(); update(true); };
  $('liveVariant').onchange = e => { if (e.target.value) { L().variant = e.target.value; L().stats = liveKeys(e.target.value); } resetMatchOverrides(); renderSelection(); update(true); };
  document.querySelectorAll('.liveStat').forEach(cb => { cb.onchange = () => { L().stats = [...document.querySelectorAll('.liveStat:checked')].map(x => x.value); if (!L().stats.length) L().stats = liveKeys('basic'); resetMatchOverrides(); renderSelection(); update(true); }; });
  $('liveCorner').onchange = e => { L().corner = e.target.value; resetMatchOverrides(); update(true); };
}

/** The collected BB1 pre-match statements of the chosen team: one click puts the text into the quote box and the speaker's name on the graphic. */
async function renderCoachStatements(C) {
  const draw = () => {
    const el = $('coachStmts');
    if (!el) return; // the panel changed meanwhile
    const list = store.previewStatements(state.league, sel().teamId).slice(0, 8);
    el.innerHTML = list.length
      ? '<span class="stmts">' + list.map((x, i) => `<button type="button" class="ghost stmt" data-i="${i}" title="${esc(x.text.slice(0, 400))}"><b>${esc(x.speaker)}</b> · ${esc(fmtDate(String(x.published_at).slice(0, 10)))} · ${esc(x.title)}<br><small>${esc(x.text.slice(0, 120))}…</small></button>`).join('') + '</span>'
      : 'Ehhez a csapathoz nincs gyűjtött előzetes-nyilatkozat (a hub a BB1 „A – B” előzetes-cikkeit gyűjti, 15 percenként). A szöveg kézzel is beilleszthető.';
    el.querySelectorAll('.stmt').forEach(b => b.onclick = () => {
      const x = list[+b.dataset.i];
      C.quote = x.text; C.name = x.speaker; C.srcTitle = x.title; C.srcUrl = x.url;
      renderSelection(); update(true);
    });
  };
  draw();
  await store.loadLazy(state.league, 'previews', fetchData);
  draw();
}

/** The match and team pickers: two fixed lines at the very top of the page, the same for every graphic (owner 2026-11-27).
 *  The one the current graphic does not use is dimmed, but still works (match and team are shared by all graphics of a league). */
const MATCH_TYPES = ['intro', 'comparison', 'playercompare', 'nextmatch', 'formpair', 'h2h', 'referees'];
function renderPickBar() {
  const t = tpl(), s = sel(), lg = state.league, bar = $('pickBar');
  if (!bar) return;
  const isRef = t.type === 'referees', usesMatch = MATCH_TYPES.includes(t.type), usesTeam = !usesMatch && !isLiveType(t.type) && t.type !== 'extra';
  const showPast = !!s.showPast;
  const hasRefs = m => !!store.matchStaff(lg, m)?.referees?.length;
  let games = showPast ? store.league(lg).fixtures : store.upcoming(lg);
  if (isRef && !s.showOpen) games = games.filter(hasRefs); // by default only games whose referees are already published
  if (isRef && (!s.matchKey || !games.some(m => matchKey(m) === s.matchKey)) && games[0]) s.matchKey = matchKey(games[0]); // never wipe the choice: other templates share it
  const custom = !isRef && s.custom;
  const opts = games.map(m => `<option value="${esc(matchKey(m))}" ${matchKey(m) === s.matchKey && !custom ? 'selected' : ''}>${esc(matchLabel(m))}${isRef ? (hasRefs(m) ? '' : ' – nincs kiírva') : (m.resultMissing ? ' – eredmény hiányzik az adatokból' : '')}</option>`).join('');
  bar.innerHTML = `
    <div class="pick-row ${usesMatch || isLiveType(t.type) || t.type === 'extra' ? '' : 'idle'}" title="${usesMatch ? '' : 'Ennél a grafikánál nem számít a mérkőzés, de átállítható.'}">
      <b>Mérkőzés</b>
      <select id="matchSel" class="pick-main" aria-label="Mérkőzés">${opts || '<option value="">Nincs ilyen mérkőzés</option>'}${isRef ? '' : `<option value="__custom" ${custom ? 'selected' : ''}>Egyéni párosítás…</option>`}</select>
      <label><input type="checkbox" id="showPast" ${showPast ? 'checked' : ''}> Lejátszott is</label>
      ${custom ? `<label>Hazai <select id="customHome">${teamOptions(s.custom.homeId)}</select></label><label>Vendég <select id="customAway">${teamOptions(s.custom.awayId)}</select></label>` : ''}
    </div>
    <div class="pick-row ${usesTeam || t.type === 'extra' ? '' : 'idle'}" title="${usesTeam ? '' : 'Ennél a grafikánál nem számít a csapat, de átállítható.'}">
      <b>Csapat</b>
      <select id="teamSel" class="pick-main" aria-label="Csapat">${teamOptions(s.teamId)}</select>
    </div>`;
  $('matchSel').onchange = e => {
    if (e.target.value === '__custom') { const m = currentMatch(); s.custom = { homeId: m?.homeId || Object.keys(CLUBS[lg])[0], awayId: m?.awayId || Object.keys(CLUBS[lg])[1] }; }
    else { s.custom = null; s.matchKey = e.target.value; }
    resetMatchOverrides(); update(true);
  };
  $('showPast').onchange = e => { s.showPast = e.target.checked; renderSelection(); update(true); };
  if (custom) {
    $('customHome').onchange = e => { s.custom.homeId = e.target.value; resetMatchOverrides(); update(true); };
    $('customAway').onchange = e => { s.custom.awayId = e.target.value; resetMatchOverrides(); update(true); };
  }
  $('teamSel').onchange = e => { // a new team starts from a clean slate in every graphic that depends on it
    s.teamId = e.target.value; s.ps = null; s.players = null; s.games = null; s.customRows = null; s.gameFilter = null;
    if (s.coach) { s.coach.oppId = undefined; if (s.coach.srcTitle) { s.coach.quote = ''; s.coach.name = null; s.coach.srcTitle = null; s.coach.srcUrl = null; } }
    if (usesTeam) resetTemplateOverrides(); else resetMatchOverrides();
    update(true);
  };
  const stack = $('topStack');
  if (stack) document.documentElement.style.setProperty('--top-h', stack.offsetHeight + 'px');
}

window.addEventListener('resize', () => { const st = $('topStack'); if (st) document.documentElement.style.setProperty('--top-h', st.offsetHeight + 'px'); });

function renderSelection(extra = {}) {
  renderPickBar();
  const t = tpl(), s = sel(), lg = state.league;
  const box = $('selection');
  $('sizeBar').hidden = true; // only the roster templates show it (set below)
  if (t.type === 'intro' || t.type === 'comparison' || t.type === 'playercompare' || t.type === 'nextmatch' || t.type === 'formpair' || t.type === 'h2h') {
    $('selectTitle').textContent = '2. Mérkőzés';
    box.innerHTML = `${t.type === 'playercompare' ? playerSelects() : ''}${t.type === 'comparison' || t.type === 'playercompare' ? cmpOptionsHtml(s, t) : ''}`;
    if (t.type === 'comparison' || t.type === 'playercompare') wireCmpOptions(s);
    if (t.type === 'playercompare') {
      document.querySelectorAll('.pcUp').forEach(inp => inp.onchange = e => {
        const f = e.target.files[0], k = 'pc' + (inp.dataset.side === 'home' ? 'Home' : 'Away');
        if (!f) return;
        const img = new Image();
        img.onload = () => { images['upload/' + k] = img; delete bgState[k]; renderSelection(); update(true); };
        img.onerror = () => toast('A képet nem sikerült beolvasni.');
        img.src = URL.createObjectURL(f);
      });
      document.querySelectorAll('.pcUpClear').forEach(btn => btn.onclick = () => { const k = 'pc' + (btn.dataset.side === 'home' ? 'Home' : 'Away'); delete images['upload/' + k]; delete bgState[k]; renderSelection(); update(true); });
      wireBg('pcHome'); wireBg('pcAway');
    }
    if (t.type === 'playercompare') {
      for (const side of ['home', 'away']) $('pc_' + side).onchange = e => { (s.pc ||= {})[side] = e.target.value; resetMatchOverrides(); update(true); };
    }
  } else if (isLiveType(t.type)) {
    $('selectTitle').textContent = t.type === 'livestat' ? '2. Élő meccs és játékos' : '2. Élő meccs és statisztikák';
    box.innerHTML = livePanelHtml(s);
    wireLivePanel(s);
    liveTimer();
  } else if (t.type === 'extra') {
    $('selectTitle').textContent = '2. Képek és keretek';
    box.innerHTML = extraPanelHtml(s);
    wireExtraPanel(s);
  } else if (t.type === 'coach') {
    $('selectTitle').textContent = '2. Edző, nyilatkozat és fotó';
    const C = s.coach ||= {}, oppDefault = coachOpponent(store, lg, s.teamId);
    box.innerHTML = `<div class="row2"><label>Ellenfél (az alcím javaslatához)<select id="coachOpp"><option value="">– nincs –</option>${teamOptions(C.oppId === undefined ? oppDefault : C.oppId)}</select></label></div>
      <div class="stmtbox"><b>Gyűjtött előzetes-nyilatkozatok (BB1.hu)</b> <span id="coachStmts" class="hint">betöltés…</span></div>
      ${C.name ? `<small class="hint">A név a kiválasztott nyilatkozat mondójától jön: <b>${esc(C.name)}</b> <button type="button" id="coachNameReset" class="ghost">Vissza a Hunbasket-névre</button></small>` : ''}
      <label>Nyilatkozat (a gyűjtöttek közül választva vagy kézzel beillesztve; új bekezdés = új sor)
        <textarea id="coachQuote" rows="8" style="width:100%" placeholder="Illeszd be az edző nyilatkozatát…">${esc(C.quote || '')}</textarea></label>
      <div class="row2"><label>A szöveg stílusa<select id="coachLook">${Object.entries(COACH_LOOKS).map(([k, v]) => `<option value="${k}" ${coachLook(C.look) === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <span class="import-row" style="align-items:end"><button type="button" id="coachQuoteClear" class="ghost">Szöveg törlése</button></span></div>
      <label>Az edző fotója (áttetsző PNG kivágás; csak a böngészőben marad)
        <span class="import-row"><input type="file" id="coachPhoto" accept="image/png,image/webp,image/jpeg"> <button id="coachPhotoClear" type="button" class="ghost" ${images['upload/coachPhoto'] ? '' : 'disabled'}>Fotó törlése</button></span></label>
      ${bgHtml('coachPhoto')}
      <small class="hint">A név és a klublogó az adatokból jön (Hunbasket vezetőedző), az alcím javaslat: átírható a Mezők között. A szöveg hosszától függően a betűméret automatikusan csökken, hogy elférjen; a fotó mozgatása / nagyítása az Elrendezés dobozban.</small>`;
    if ($('coachNameReset')) $('coachNameReset').onclick = () => { C.name = null; renderSelection(); update(true); };
    renderCoachStatements(C);
    $('coachOpp').onchange = e => { C.oppId = e.target.value; update(true); };
    let quoteTimer = null;
    $('coachQuote').oninput = e => { C.quote = e.target.value; clearTimeout(quoteTimer); quoteTimer = setTimeout(() => update(false), 200); };
    $('coachQuote').onchange = e => { C.quote = e.target.value; update(true); };
    $('coachLook').onchange = e => { C.look = e.target.value; update(true); };
    $('coachQuoteClear').onclick = () => { C.quote = ''; C.srcTitle = null; C.srcUrl = null; renderSelection(); update(true); };
    $('coachPhoto').onchange = e => {
      const f = e.target.files[0];
      if (!f) return;
      const img = new Image();
      img.onload = () => { images['upload/coachPhoto'] = img; delete bgState.coachPhoto; renderSelection(); update(true); };
      img.onerror = () => toast('A képet nem sikerült beolvasni.');
      img.src = URL.createObjectURL(f);
    };
    $('coachPhotoClear').onclick = () => { delete images['upload/coachPhoto']; delete bgState.coachPhoto; renderSelection(); update(true); };
    wireBg('coachPhoto');
  } else if (t.type === 'playerspecial') {
    $('selectTitle').textContent = '2. Csapat és játékos';
    const opts = playerOptions(store, lg, s.teamId);
    const cur = pickPlayer(store, lg, s.teamId, s.ps?.player);
    box.innerHTML = `<div class="row2"><label>Játékos<select id="psPlayer">${opts.map(o => `<option value="${esc(o.key)}" ${o === cur ? 'selected' : ''}>${esc(o.name)}</option>`).join('') || '<option>nincs játékosstatisztika</option>'}</select></label></div>
      <label>Fotó (áttetsző PNG kivágás; csak a böngészőben marad)
        <span class="import-row"><input type="file" id="psPhoto" accept="image/png,image/webp,image/jpeg"> <button id="psPhotoClear" class="ghost" ${images['upload/photo'] ? '' : 'disabled'}>Fotó törlése</button></span></label>
      ${bgHtml('photo')}
      ${psConfigHtml(s)}
      <small class="hint">A név és az idei átlagok (az utolsó oszlop) az adatokból jönnek; a sztori, a többi oszlop és a fotó a tiéd. A fotó mozgatása/nagyítása: Elrendezés doboz.</small>`;
    $('psPlayer').onchange = e => { (s.ps ||= {}).player = e.target.value; resetMatchOverrides(); update(true); };
    $('psPhoto').onchange = e => {
      const f = e.target.files[0];
      if (!f) return;
      const url = URL.createObjectURL(f), img = new Image();
      img.onload = () => { images['upload/photo'] = img; delete bgState.photo; state.photoName = f.name; renderSelection(); update(true); };
      img.onerror = () => toast('A képet nem sikerült beolvasni.');
      img.src = url;
    };
    $('psPhotoClear').onclick = () => { delete images['upload/photo']; delete bgState.photo; renderSelection(); update(true); };
    wireBg('photo');
    wirePsConfig(s);
  } else if (t.type === 'referees') {
    $('selectTitle').textContent = '2. Mérkőzés';
    const showOpen = !!s.showOpen;
    const hasRefs = m => !!store.matchStaff(lg, m)?.referees?.length;
    const last = store.upcoming(lg).filter(hasRefs).at(-1);
    const info = last ? `A játékvezetők ${fmtDate(last.date)}-ig vannak kiírva (${store.upcoming(lg).filter(hasRefs).length} következő meccsnél). A többi meccsé a Hunbaskeren még nem jelent meg; félóránként frissül.` : 'Egyik következő meccshez sincs még kiírva játékvezető a Hunbaskeren.';
    box.innerHTML = `<div class="hint">${esc(info)}</div>
      <label style="flex-direction:row;display:flex;gap:6px;align-items:center"><input type="checkbox" id="showOpen" ${showOpen ? 'checked' : ''}> Kiírás nélküli meccsek is (kézi beírással)</label>`;
    $('showOpen').onchange = e => { s.showOpen = e.target.checked; renderSelection(); update(true); };
  } else {
    $('selectTitle').textContent = '2. Beállítások';
    box.innerHTML = `${extra.players || ''}${extra.games || ''}`;
    const bar = $('sizeBar'), isRoster = t.type === 'roster' || t.type === 'rostergrid';
    bar.hidden = !isRoster;
    bar.innerHTML = !isRoster ? '' : `<b>Méretek – az összes játékosra egyszerre:</b> <label>Mezszámok (%) <input type="number" id="numScale" min="50" max="250" step="5" value="${s.numScale || 100}"></label>${t.type === 'rostergrid' ? `<label>Zászlók (%) <input type="number" id="flagScale" min="50" max="250" step="5" value="${s.flagScale || 100}"></label>` : ''}${t.type === 'rostergrid' ? rowOffHtml(s, rosterDims(rosterPlayers(store, lg, s.teamId).length || t.rosterN).rows) : ''}`;
    if ($('rowOffReset')) $('rowOffReset').onclick = () => { s.rowOff = []; renderSelection(); update(true); };
    document.querySelectorAll('.rowOff').forEach(el => el.onchange = () => { const o = [...(s.rowOff || [])]; const i = +el.dataset.r; o[i] = [...(o[i] || [0, 0])]; o[i][+el.dataset.a] = Math.max(-300, Math.min(300, +el.value || 0)); s.rowOff = o; update(true); });
    if ($('numScale')) $('numScale').onchange = e => { s.numScale = Math.max(50, Math.min(250, +e.target.value || 100)); update(true); };
    if ($('flagScale')) $('flagScale').onchange = e => { s.flagScale = Math.max(50, Math.min(250, +e.target.value || 100)); update(true); };
    if (extra.games) {
      const group = t.type === 'schedule' ? 'schedule' : 'results';
      $('gameFilter').onchange = e => { s.gameFilter = e.target.value; update(true); };
      $('addGame').ontoggle = e => { s.addOpen = e.target.open; };
      box.querySelectorAll('.delcup').forEach(b => b.onclick = ev => {
        ev.preventDefault(); ev.stopPropagation();
        if (!confirm('Törlöd ezt a meccset?')) return;
        store.removeCup(state.league, b.dataset.del); persistExcel(); renderImportState(); renderFreshness(); update(true);
      });
      $('agSave').onclick = () => {
        const lg = state.league, id = s.teamId, me = club(lg, id);
        const date = $('agDate').value, time = $('agTime').value, oppText = $('agOpp').value.trim();
        const msg = t => { $('agMsg').textContent = t; };
        if (!date) return msg('Add meg a dátumot.');
        if (!oppText) return msg('Add meg az ellenfelet.');
        const oppId = clubIdStrict(lg, oppText);
        if (oppId === id) return msg('Az ellenfél nem lehet ugyanaz a csapat.');
        const opp = oppId ? club(lg, oppId).official : oppText;
        const home = $('agSide').value === 'home';
        let score = null;
        if ($('agScore').value.trim()) {
          const m = $('agScore').value.match(/(\d{1,3})\s*[-–:]\s*(\d{1,3})/);
          if (!m) return msg('Az eredmény így kell: 66-71 (hazai–vendég).');
          score = { home: +m[1], away: +m[2] };
        }
        const competition = $('agComp').value;
        store.addCup(lg, {
          home: home ? me.official : opp, away: home ? opp : me.official,
          homeId: home ? id : oppId, awayId: home ? oppId : id,
          date, time: time || null, status: score ? 'finished' : 'scheduled', score, competition, compKey: compKey(lg, competition),
        });
        persistExcel(); s.addOpen = true;
        renderImportState(); renderFreshness(); update(true);
        toast(`Meccs hozzáadva: ${fmtDate(date)} ${home ? me.short + ' – ' + opp : opp + ' – ' + me.short}`);
      };
      $('gamesAuto').onclick = () => { (s.games ||= {})[group] = null; (s.customRows ||= {})[group] = null; update(true); };
      const keysNow = () => [...box.querySelectorAll('#rowEdit li[data-key]')].map(li => li.dataset.key);
      const apply = keys => { (s.games ||= {})[group] = keys; update(true); };
      const dateOf = key => (lastCandidates.find(m => gameKey(m) === key) || {}).date || null;
      // insert a game at its place by date among the rows (rows without a date, e.g. typed ones, keep their position)
      const insertByDate = (keys, key) => {
        const d = dateOf(key), out = [...keys];
        const at = d ? out.findIndex(k => dateOf(k) && dateOf(k) > d) : -1;
        out.splice(at < 0 ? out.length : at, 0, key);
        return out;
      };
      box.querySelectorAll('#rowEdit li[data-key]').forEach(li => {
        const k = li.dataset.key;
        li.querySelector('.rowdel').onclick = () => apply(keysNow().filter(x => x !== k));
        const move = d => { const a = keysNow(), i = a.indexOf(k); [a[i], a[i + d]] = [a[i + d], a[i]]; apply(a); };
        li.querySelector('.rowup').onclick = () => move(-1);
        li.querySelector('.rowdown').onclick = () => move(1);
      });
      $('rowAdd').onclick = () => { const k = $('rowAddSel').value; if (k) apply(insertByDate(keysNow(), k)); };
      $('rowAddSel').onchange = () => { if ($('rowAddSel').value && keysNow().length < t.rows) $('rowAdd').click(); };
      $('customRowBox').ontoggle = e => { s.customOpen = e.target.open; };
      $('crAdd').onclick = () => {
        const dateText = $('crDate').value.trim(), matchText = $('crMatch').value.trim(), scoreText = group === 'results' ? $('crScore').value.trim() : '';
        if (!matchText) return toast('Írd be a párosítást.');
        const id = `custom:${Date.now().toString(36)}`;
        ((s.customRows ||= {})[group] ||= []).push({ key: id, dateText, matchText, scoreText });
        apply([...keysNow(), id]);
      };
      box.querySelectorAll('.gamelist input').forEach(cb => cb.onchange = () => {
        const keys = keysNow();
        if (cb.checked) {
          if (keys.length >= t.rows) { cb.checked = false; toast(`Legfeljebb ${t.rows} mérkőzés fér el a sablonon.`); return; }
          apply(insertByDate(keys, cb.value));
        } else apply(keys.filter(x => x !== cb.value));
      });
    }
    if (extra.players) {
      box.querySelectorAll('.players input').forEach(cb => cb.onchange = () => {
        const keys = [...box.querySelectorAll('.players input:checked')].map(x => x.value);
        if (keys.length > TEAMSTATS_MAX) { cb.checked = false; toast(`Legfeljebb ${TEAMSTATS_MAX} játékos fér el a táblán.`); return; }
        s.players = keys; update(false);
      });
    }
  }
}

/** A new team starts from a clean slate: the data-bound choices of the previous team (typed rows, hidden rows, sizes) never carry over. */
function resetTemplateOverrides() {
  const o = overrides();
  for (const k of Object.keys(o)) delete o[k];
}

function resetMatchOverrides() {
  // data-bound overrides belong to one matchup/team; keep only visibility choices
  const o = overrides();
  for (const k of Object.keys(o)) { const { visible } = o[k]; if (visible === undefined) delete o[k]; else o[k] = { visible }; }
}

// ───────────────────────── values ─────────────────────────
const measureFn = (el, text) => measure(measureCanvas, el, text);

function autoValues() {
  const t = tpl(), lg = state.league, s = sel();
  const info = { notices: [] };
  if (t.elements.some(e => e.id === 'panel' && e.type === 'framed')) info.notices.push({ text: 'A panel mérete szabadon állítható: Elrendezés fül → „Szerkesztés” bekapcsolva → kattints a panel szélére, és húzd a sarkait – alapból szabadon; Shift lenyomva tartva arányosan.' });
  let v = {};
  if (t.type === 'comparison' || t.type === 'playercompare' || t.type === 'intro' || t.type === 'nextmatch' || t.type === 'formpair' || t.type === 'h2h') {
    const m = currentMatch();
    if (!m) { info.notices.push({ bad: true, text: 'Nincs kiválasztható mérkőzés ebben a bajnokságban.' }); return { v, info }; }
    if (t.type === 'formpair') v = bindForm(store, lg, [m.homeId, m.awayId]);
    else if (t.type === 'h2h') { v = bindH2H(store, lg, m.homeId, m.awayId); if (!store.h2hGames(lg, m.homeId, m.awayId).length) info.notices.push({ text: 'Ennek a két csapatnak nincs korábbi egymás elleni meccse az adatokban (Hunbasket 2020/21-től).' }); }
    else if (t.type === 'nextmatch') v = bindNextMatch(store, lg, m);
    else if (t.type === 'comparison') v = bindComparison(store, lg, m.homeId, m.awayId, s.srcColor);
    else if (t.type === 'playercompare') v = bindPlayerCompare(store, lg, m.homeId, m.awayId, { ...(s.pc || {}), photoIds, srcColor: s.srcColor, uploads: { home: !!images['upload/pcHome'], away: !!images['upload/pcAway'] } });
    else v = bindIntro(store, lg, m, lsGet(LS.venues, {}));
    if (m.custom && t.type === 'intro') info.notices.push({ text: 'Egyéni párosítás: a forduló és az időpont nem az adatokból jön – írd be kézzel.' });
  } else if (t.type === 'form') {
    v = bindForm(store, lg, [s.teamId]);
    if (store.playedGames(lg, s.teamId).length < 5) info.notices.push({ text: 'Ennek a csapatnak 5-nél kevesebb lejátszott meccse van: az üres oszlopok nem jelennek meg.' });
  } else if (t.type === 'roster' || t.type === 'rostergrid') {
    const r = bindRoster(store, lg, s.teamId, t, photoIds);
    v = r.values;
    if (r.missing) info.notices.push({ bad: true, text: 'Ehhez a csapathoz nincs Hunbasket keret-adat (data/team_pages_*.json). Töltsd ki kézzel.' });
    else {
      info.notices.push({ text: 'A keret a Hunbasket csapatoldaláról jön (mezszám szerint rendezve). A kapitány-jelölés (©) az adatokban nincs: kézzel írd a név mögé, ha kell. A nevek hosszú, több keresztnevesek lerövidülnek (3 szó).' });
      if (t.type === 'rostergrid') info.notices.push({ text: 'A fotók a Hunbasketről valók (az MKOSZ engedélyével, letöltve a repóba). Ahol nincs fotó, helyőrző jelenik meg.' });
    }
  } else if (t.type === 'liveleaders') {
    const g = live.game;
    if (!g) info.notices.push({ bad: true, text: 'Még nincs élő meccs betöltve: add meg a netcasting linket / kódot a Meccs mezőben, vagy illeszd be a hírcsatorna szövegét.' });
    else {
      const gl = /^w/.test(g.id || '') ? 'women' : 'men';
      if (g.id && gl !== lg) info.notices.push({ bad: true, text: `Ez a meccs a ${gl === 'women' ? 'női' : 'férfi'} bajnokságé (${g.id}): válts át a ${gl === 'women' ? 'Női' : 'Férfi'} NB I/A fülre, különben a klubok / logók nem egyeznek.` });
      v = bindLiveLeaders(store, lg, g, { ...(s.live || {}), fetchedAt: live.fetchedAt }, photoIds);
      info.notices.push({ text: `Élő adat – ${g.teams.home.short} ${g.score.home}–${g.score.away} ${g.teams.away.short}, frissítve: ${live.fetchedAt}. Csapatonként a három legjobb VAL-értékű játékos; a hat játékos közül a legjobb érték zöld, a legrosszabb piros.` });
      if (Object.entries(v).some(([k, x]) => /\.photo$/.test(k) && x && x.src === 'photo/none')) info.notices.push({ text: 'Egyes játékosokhoz nincs letöltött hivatalos fotó: a grafika náluk a Hunbasket szürke helyőrzője jelenik meg.' });
    }
  } else if (t.type === 'liveteam') {
    const g = live.game;
    if (!g) info.notices.push({ bad: true, text: 'Még nincs élő meccs betöltve: add meg a netcasting linket / kódot a Meccs mezőben, vagy illeszd be a hírcsatorna szövegét.' });
    else {
      const gl = /^w/.test(g.id || '') ? 'women' : 'men';
      if (g.id && gl !== lg) info.notices.push({ bad: true, text: `Ez a meccs a ${gl === 'women' ? 'női' : 'férfi'} bajnokságé (${g.id}): válts át a ${gl === 'women' ? 'Női' : 'Férfi'} NB I/A fülre, különben a klubok / logók nem egyeznek.` });
      v = bindLiveTeam(store, lg, g, { ...(s.live || {}), fetchedAt: live.fetchedAt });
      info.notices.push({ text: `Élő adat – ${g.teams.home.short} ${g.score.home}–${g.score.away} ${g.teams.away.short}, frissítve: ${live.fetchedAt}. A piros doboz a jobb értéket jelöli (egyenlőnél nincs jelölés).` });
    }
  } else if (t.type === 'livestat') {
    const g = live.game;
    if (!g) info.notices.push({ bad: true, text: 'Még nincs élő meccs betöltve: add meg a netcasting linket / kódot a Meccs mezőben, vagy illeszd be a hírcsatorna szövegét.' });
    else {
      const gl = /^w/.test(g.id || '') ? 'women' : 'men';
      if (g.id && gl !== lg) info.notices.push({ bad: true, text: `Ez a meccs a ${gl === 'women' ? 'női' : 'férfi'} bajnokságé (${g.id}): válts át a ${gl === 'women' ? 'Női' : 'Férfi'} NB I/A fülre, különben a klub / fotó nem egyezik.` });
      v = bindLiveStat(store, lg, g, { ...(s.live || {}), fetchedAt: live.fetchedAt }, photoIds);
      info.notices.push({ text: `Élő adat – ${g.teams.home.short} ${g.score.home}–${g.score.away} ${g.teams.away.short}, frissítve: ${live.fetchedAt}. A hírcsatorna kb. 5 másodpercenként frissül; a „Betöltés” gomb vagy az automatikus frissítés hozza az újat.` });
      if (v.photo && v.photo.src === 'photo/none') info.notices.push({ text: 'Ehhez a játékoshoz nincs letöltött hivatalos fotó: a Hunbasket szürke helyőrzője jelenik meg.' });
    }
  } else if (t.type === 'extra') {
    v = {};
    for (const [id, k] of [['frameA', 'A'], ['frameB', 'B']]) {
      const c = s.extra?.[k] || {}, has = !!images['upload/extra' + k];
      v[id] = { src: has ? 'upload/extra' + k : '', source: has ? (c.name || 'Feltöltött kép') : 'Nincs kép feltöltve (üres keret)', fit: c.fit, zoom: (c.zoom || 100) / 100, px: c.px || 0, py: c.py || 0, pad: c.pad, fill: c.fill };
    }
  } else if (t.type === 'coach') {
    v = bindCoach(store, lg, s.teamId, s.coach || {}, !!images['upload/coachPhoto'] && (!pkgCtx || pkgCtx.photoTeam === s.teamId));
    if (!store.teamPage(lg, s.teamId)) info.notices.push({ bad: true, text: 'Ehhez a csapathoz nincs Hunbasket csapatoldal-adat (vezetőedző): a nevet kézzel írd be.' });
    if (!s.coach?.quote?.trim()) info.notices.push({ text: 'Még nincs nyilatkozat: illeszd be a szöveget a „Nyilatkozat” mezőbe (a Hunbasket-előzetesből vagy a BB1-cikkből).' });
    if (!images['upload/coachPhoto']) info.notices.push({ text: 'Nincs fotó feltöltve: tölts fel egy áttetsző PNG kivágást az edzőről (a háttéreltávolító segít).' });
  } else if (t.type === 'playerspecial') {
    v = bindPlayerSpecial(store, lg, s.teamId, s.ps?.player, t);
    v.photo = { src: images['upload/photo'] ? 'upload/photo' : '', source: images['upload/photo'] ? 'Feltöltött fotó' : 'Nincs fotó feltöltve' };
    if (!images['upload/photo']) info.notices.push({ text: 'Nincs fotó feltöltve – a grafika fotó nélkül jelenik meg. Tölts fel egy áttetsző PNG kivágást a Fotó mezővel.' });
    info.notices.push({ text: 'Az alcím és az első oszlop(ok) (pl. karrier, utolsó meccsek) kézzel töltendők: az adatbázisban csak az idei átlag van meg. Az üres mezők nem jelennek meg a képen.' });
  } else if (t.type === 'teamstats') {
    const r = bindTeamstats(store, lg, s.teamId, t, measureFn, s.players);
    v = r.values;
    info.players = r.players; info.shown = r.shown;
    if (r.hidden > 0) info.notices.push({ text: `${r.players.length} játékos van az adatokban, a táblán legfeljebb ${TEAMSTATS_MAX} sor fér el. ${r.hidden} játékos nem látszik (alapból a legkevesebb percet játszók) – a listában módosíthatod.` });
  } else if (t.type === 'results' || t.type === 'schedule' || t.type === 'resultrows') {
    const grp = t.type === 'schedule' ? 'schedule' : 'results';
    const r = bindRowList(store, lg, s.teamId, t, s.games?.[grp] || null, s.customRows?.[grp] || []);
    v = r.values;
    info.games = r.games; info.candidates = r.candidates;
    if (r.missingResults.length) info.notices.push({ bad: true, text: `Az adatokból hiányzik ${r.missingResults.length} lejátszott mérkőzés eredménye (${r.missingResults.join(', ')}). Ellenőrizd a menetrend frissességét, és szükség esetén írd be kézzel.` });
    if (t.type === 'schedule' && !s.games?.schedule && r.candidates.length - 1 >= 5) info.notices.push({ text: `Alapból a soron következő meccs utáni ${Math.min(t.rows, r.candidates.length - 1)} meccs jelenik meg (a következő meccs a grafika „tárgya”). A következő meccs a listában kipipálható.` });
    if (r.games.length < t.rows) info.notices.push({ bad: t.type === 'schedule' && r.games.length < 5, text: `Csak ${r.games.length} mérkőzés jelenik meg (${r.candidates.length} van a listában: NB I/A + feltöltött kupameccsek)${t.type === 'schedule' && r.games.length < 5 ? ' – a menetrendnek legalább 5 sor kellene' : ''}. A további sorok üresek, kézzel kitölthetők.` });
    if (!store.cupFixtures(lg, s.teamId).length) info.notices.push({ text: 'Az adatbázis csak NB I/A mérkőzéseket tartalmaz. Kupa- és európai meccseket tölts fel a „Kupameccsek” lapról (Adatok feltöltése), vagy írd be kézzel; a sorozat logója soronként választható.' });
  } else if (t.type === 'referees') {
    const m = currentMatch();
    v = bindReferees(store, lg, m);
    const staff = m && !m.custom ? store.matchStaff(lg, m) : null;
    if (!staff?.referees?.length) info.notices.push({ bad: true, text: 'Ehhez a meccshez még nincsenek kiírva a játékvezetők (és az MKOSZ ellenőr) a Hunbasket menetrendjén – a mezők kézzel kitölthetők.' });
    if (t.fontNote) info.notices.push({ text: t.fontNote });
  }
  const f = store.freshness(lg);
  const stale = Object.entries(f).filter(([, x]) => x.stale).map(([k]) => ({ fixtures: 'menetrend', standings: 'tabella', teamStats: 'csapatstatisztika', players: 'játékosstatisztika' }[k]));
  if (stale.length && t.type !== 'referees' && !isLiveType(t.type)) info.notices.push({ text: `Régi adat (48 óránál régebbi): ${stale.join(', ')}. Adás előtt ellenőrizd az értékeket.` });
  return { v, info };
}

function mergedValues(auto) {
  const o = overrides(), out = {};
  for (const el of tpl().elements) {
    const a = auto[el.id] || (el.defaultText ? { text: el.defaultText } : {});
    const x = { ...a };
    const ov = o[el.id] || {};
    if (ov.text !== undefined) {
      if (el.runs && a.runs && tpl().type === 'playerspecial') x.runs = [{ text: ov.text }]; // the typed text replaces the whole line
      else if (el.runs && a.runs) x.runs = [...a.runs.slice(0, -1), { ...a.runs[a.runs.length - 1], text: ov.text }];
      x.text = ov.text; x.missing = false; x.overridden = true;
    }
    if (ov.color) { x.color = ov.color; x.overridden = true; }
    if (ov.src !== undefined) { x.src = ov.src; x.overridden = true; }
    if (ov.visible !== undefined) x.visible = ov.visible;
    const lay = LAY.effective(bench(), o, el.id);
    if (lay.size > 0) x.size = lay.size;
    if (lay.dx) x.dx = lay.dx;
    if (lay.dy) x.dy = lay.dy;
    if (lay.scale > 0 && lay.scale !== 1) x.scale = lay.scale;
    if (lay.w > 0) x.w = lay.w;
    if (lay.h > 0) x.h = lay.h;
    if (el.runs && !x.runs && x.text !== undefined) x.runs = [{ text: x.text }];
    out[el.id] = x;
  }
  out[LAY.GLOBAL] = LAY.effective(bench(), o, LAY.GLOBAL);
  out[LAY.CONTENT] = { ...LAY.effective(bench(), o, LAY.CONTENT), photo: state.contentPhoto !== false };
  return out;
}

// ───────────────────────── fields ─────────────────────────
function renderFields(values, auto) {
  const t = tpl(), o = overrides();
  const only = $('onlyMissing').checked;
  let html = '', group = null;
  for (const el of t.elements) {
    const v = values[el.id], a = auto[el.id] || {};
    const ov = o[el.id] || {};
    const isOv = ov.text !== undefined || ov.color || ov.src !== undefined || ov.visible !== undefined || LAY.KEYS.some(k => ov[k] !== undefined);
    const missing = v.missing && !isOv;
    if (only && !missing && !isOv) continue;
    if (el.group !== group) { group = el.group; html += `<div class="group-title">${esc(group)}</div>`; }
    const visible = v.visible ?? el.visible ?? true;
    const autoTxt = el.type === 'image' ? (a.src ? (a.src.startsWith('comp/') ? COMPETITIONS[a.src] : club(state.league, a.src.split('/')[1])?.official || a.src) : 'nincs') : (el.runs && a.runs ? a.runs.at(-1).text : a.text ?? '');
    html += `<div class="field ${missing ? 'missing' : ''} ${isOv ? 'overridden' : ''}" data-id="${esc(el.id)}">
      <input type="checkbox" class="vis" title="Látható" ${visible ? 'checked' : ''}>
      <div class="lbl"><span>${esc(el.label || el.id)}</span><em title="${esc(a.source || '')}">${esc(a.source || '')}</em></div>`;
    if ((el.type === 'image' && el.fixedSrc) || el.type === 'framed') {
      html += '';
    } else if (el.type === 'image') {
      const opts = [['', 'Nincs'], ...store.clubs(state.league).map(c => [`${state.league}/${c.id}`, c.official]), ...Object.entries(COMPETITIONS).filter(([k]) => k)];
      const cur = v.src ?? '';
      html += `<div class="inputs"><select class="src">${opts.map(([k, l]) => `<option value="${esc(k)}" ${k === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        ${isOv ? '<button class="reset" title="Vissza az automatikusra">↺</button>' : ''}</div>`;
    } else if (!el.fixed || true) {
      const multi = !!el.wrap;
      const val = ov.text !== undefined ? ov.text : '';
      const ph = esc(autoTxt === MISSING ? 'HIÁNYZÓ ADAT – írd be' : autoTxt).replace(/\n/g, ' ⏎ ');
      html += `<div class="inputs">${multi
        ? `<textarea class="txt" rows="2" placeholder="${ph}">${esc(val)}</textarea>`
        : `<input class="txt" value="${esc(val)}" placeholder="${ph}">`}
        <select class="color" title="Szín">${COLORS.map(([c, n]) => `<option value="${c}" ${c === (ov.color || '') ? 'selected' : ''} style="${c ? `background:${c};color:${c === '#000000' || c === '#383838' ? '#fff' : '#000'}` : ''}">${c ? '■ ' + n : 'Auto'}</option>`).join('')}</select>
        ${isOv ? '<button class="reset" title="Vissza az automatikusra">↺</button>' : ''}</div>`;
      if (el.adjust) {
        html += `<div class="adj"><label>Betűméret (px) <input type="number" class="sz" min="10" max="300" step="1" placeholder="${Math.round(lastReport?.sizes?.[el.id] ?? el.size)}" value="${ov.size || ''}"></label>
          <label>Balra / jobbra (px) <input type="number" class="dx" step="1" placeholder="${bench()?.items?.[el.id]?.dx || 0}" value="${ov.dx ?? ''}"></label>
          <label>Fel / le (px) <input type="number" class="dy" step="1" placeholder="${bench()?.items?.[el.id]?.dy || 0}" value="${ov.dy ?? ''}"></label></div>`;
      }
    }
    if (missing) html += `<div class="flag">Hiányzó adat – az adásban „${MISSING}” jelenne meg.</div>`;
    if (a.note) html += `<div class="note">${esc(a.note)}</div>`;
    html += '</div>';
  }
  if (t.type === 'intro') {
    html = `<div class="eqrow"><button id="eqNames" class="ghost" title="Mindkét csapatnév a kisebb (jelenleg érvényes) méretre áll">Csapatnevek egyforma méretre</button>
      <button id="eqRanks" class="ghost" title="Mindkét helyezés/mérleg sor egyforma méretre áll">Helyezés/mérleg egyforma méretre</button></div>` + html;
  }
  $('fields').innerHTML = html || '<p class="note">Nincs megjeleníthető mező.</p>';
}

function onFieldEvent(e) {
  const f = e.target.closest('.field');
  if (!f) return;
  const id = f.dataset.id, o = overrides();
  const cur = (o[id] ||= {});
  if (e.target.classList.contains('vis')) cur.visible = e.target.checked;
  else if (e.target.classList.contains('txt')) { if (e.target.value === '') delete cur.text; else cur.text = e.target.value; }
  else if (e.target.classList.contains('color')) { if (e.target.value) cur.color = e.target.value; else delete cur.color; }
  else if (e.target.classList.contains('src')) cur.src = e.target.value;
  else if (e.target.classList.contains('sz')) { const n = parseFloat(e.target.value); if (n > 0) cur.size = n; else delete cur.size; }
  else if (e.target.classList.contains('dx')) { const n = parseFloat(e.target.value); if (e.target.value !== '' && Number.isFinite(n)) cur.dx = n; else delete cur.dx; }
  else if (e.target.classList.contains('dy')) { const n = parseFloat(e.target.value); if (e.target.value !== '' && Number.isFinite(n)) cur.dy = n; else delete cur.dy; }
  else if (e.target.classList.contains('reset')) { delete o[id]; update(true); return; }
  else return;
  if (!Object.keys(cur).length) delete o[id];
  // live state of the field row while typing
  const v = current.auto?.[id] || {};
  f.classList.toggle('overridden', !!o[id] && (o[id].text !== undefined || !!o[id].color || o[id].src !== undefined || o[id].visible !== undefined || LAY.KEYS.some(k => o[id][k] !== undefined)));
  f.classList.toggle('missing', !!v.missing && !(o[id] && o[id].text !== undefined));
  const flag = f.querySelector('.flag');
  if (flag) flag.hidden = !f.classList.contains('missing');
  // remember venues per home team
  if (id === 'venue' && tpl().type === 'intro' && e.type === 'change') {
    const m = currentMatch();
    if (m && cur.text) { const vs = lsGet(LS.venues, {}); vs[`${state.league}/${m.homeId}`] = cur.text; lsSet(LS.venues, vs); }
  }
  // typing boxes only redraw the graphic: re-building the field list would steal the focus from the box the user clicks next
  update(e.type === 'change' && !['txt', 'sz', 'dx', 'dy'].some(c => e.target.classList.contains(c)));
}

// ───────────────────────── render ─────────────────────────
let current = { values: null };

function fileName(values) {
  const t = tpl(), lg = state.league, s = sel();
  let who;
  if (t.type === 'intro' || t.type === 'comparison' || t.type === 'playercompare' || t.type === 'referees' || t.type === 'nextmatch' || t.type === 'formpair' || t.type === 'h2h') {
    const m = currentMatch();
    who = m ? `${club(lg, m.homeId)?.short}-${club(lg, m.awayId)?.short}` : 'meccs';
  } else if (t.type === 'liveteam' || t.type === 'liveleaders') {
    who = live.game ? `${live.game.teams.home.short}-${live.game.teams.away.short}` : 'meccs';
  } else if (t.type === 'livestat') {
    const ch = live.game ? liveChoice(store, lg, live.game, s.live?.side === 'away' ? 'away' : 'home', s.live?.player) : null;
    who = ch?.player ? `${ch.player.name}-${live.game.teams[s.live?.side === 'away' ? 'away' : 'home'].short}` : 'jatekos';
  } else who = club(lg, s.teamId)?.short || 'csapat';
  const date = new Date().toISOString().slice(0, 10);
  const ascii = x => x.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '_').replace(/_+/g, '_');
  return ascii(`${LEAGUES[lg].short}_${TEMPLATE_TYPES[t.type]}_${who}_${date}`) + '.png';
}

let lastCandidates = []; // candidate games of the current row-list graphic (for inserting rows by date)
let updateSeq = 0; // only the newest redraw may draw: a slower, older one must not overwrite it with stale values
const fetchData = async f => {
  const r = await fetch(`../data/${f}?v=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
};
async function update(full) {
  const seq = ++updateSeq;
  if (tpl().type === 'h2h') await store.loadLazy(state.league, 'h2h', fetchData);
  if (tpl().type === 'playerspecial') { // the big player-page files are only needed here
    const had = store.lazyLoaded?.[state.league + 'playerPages'];
    await store.loadLazy(state.league, 'playerPages', fetchData);
    if (!had && seq !== updateSeq) return;
  }
  const t = tpl();
  renderBaseOpacity();
  document.body.classList.toggle('women', state.league === 'women');
  const { v: auto, info } = autoValues();
  const values = mergedValues(auto);
  current = { values, auto };
  if (info.candidates) lastCandidates = info.candidates;
  if (full) {
    let playersHtml = '';
    if (t.type === 'teamstats' && info.players?.length) {
      const shownKeys = new Set(info.shown.map(x => x.key));
      playersHtml = `<label>Megjelenő játékosok (max. ${TEAMSTATS_MAX}; 12 fölött a sorok összébb húzódnak)</label><div class="players">${info.players.map(x => `<label><input type="checkbox" value="${esc(x.key)}" ${shownKeys.has(x.key) ? 'checked' : ''}> #${esc(x.p['#'])} ${esc(x.p['Játékos'])} <small>(${esc(x.p['M.'])} m., ${esc(x.p['Idő'])} perc)</small></label>`).join('')}</div>`;
    }
    let gamesHtml = '';
    if (info.candidates) {
      const sch = t.type === 'schedule';
      const filter = s0().gameFilter || 'all';
      const group = sch ? 'schedule' : 'results';
      const manual = !!s0().games?.[group];
      const shownKeys = new Set(info.games.map(gameKey));
      const list = info.candidates.filter(m => filter === 'all' || (filter === 'cup' ? m.cup : !m.cup));
      const ordered = sch ? list : [...list].reverse(); // newest first for results
      const nameOf = m => `${club(state.league, m.homeId)?.short || m.home} – ${club(state.league, m.awayId)?.short || m.away}`;
      const comps = state.league === 'women'
        ? [['EuroLeague Women', 'EuroLeague Women'], ['EuroCup Women', 'EuroCup Women']]
        : [['Basketball Champions League', 'Bajnokok Ligája (BCL)']];
      const opp = store.clubs(state.league).filter(c => c.id !== s0().teamId);
      const addForm = `<details class="addgame" id="addGame" ${s0().addOpen ? 'open' : ''}><summary>+ Kupa-/európai meccs hozzáadása</summary>
        <div class="addgrid">
          <label>Dátum<input type="date" id="agDate"></label>
          <label>Idő<input type="time" id="agTime" value="18:00"></label>
          <label>Pálya<select id="agSide"><option value="home">Hazai</option><option value="away">Idegenben</option></select></label>
          <label>Sorozat<select id="agComp">${comps.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}<option value="Magyar Kupa">Magyar Kupa (nincs logó)</option><option value="">Egyéb (nincs logó)</option></select></label>
          <label class="wide">Ellenfél<input id="agOpp" list="agOppList" placeholder="pl. Brod na Savi" autocomplete="off"><datalist id="agOppList">${opp.map(c => `<option value="${esc(c.official)}">`).join('')}</datalist></label>
          <label>Eredmény (hazai–vendég, ha már lejátszották)<input id="agScore" placeholder="pl. 66-71"></label>
        </div>
        <div class="import-row"><button id="agSave" class="primary">Meccs hozzáadása</button><span id="agMsg" class="hint"></span></div></details>`;
      const noCups = !info.candidates.some(m => m.cup);
      const rowName = m => m.custom ? `${esc(m.dateText || '')} ${esc(m.matchText || '')}${m.scoreText ? ' <small>(' + esc(m.scoreText) + ')</small>' : ''} <small>· kézzel beírt</small>`
        : `${esc(fmtDate(m.date))} ${esc(nameOf(m))}${m.score ? ' <small>(' + m.score.home + '-' + m.score.away + ')</small>' : ''}${m.cup ? ' <small>· ' + esc(m.competition || 'kupa/európai') + '</small>' : ''}`;
      const addable = ordered.filter(m => !shownKeys.has(gameKey(m)));
      const rowsHtml = `<label>Sorok a grafikán (${info.games.length}/${t.rows}) – törlés, hozzáadás, sorrend azonnal érvényes</label>
        <ol class="rowedit" id="rowEdit">${info.games.map((m, i) => `<li data-key="${esc(gameKey(m))}"><span>${rowName(m)}</span>
          <button type="button" class="rowup" ${i ? '' : 'disabled'} title="Feljebb">↑</button><button type="button" class="rowdown" ${i < info.games.length - 1 ? '' : 'disabled'} title="Lejjebb">↓</button><button type="button" class="rowdel" title="Sor törlése">✕</button></li>`).join('') || '<li class="empty">A grafika üres – adj hozzá meccset.</li>'}</ol>
        <div class="row2"><select id="rowAddSel"><option value="">+ Meccs hozzáadása a sorokhoz…</option>${addable.slice(0, 80).map(m => `<option value="${esc(gameKey(m))}">${rowName(m).replace(/<[^>]+>/g, '')}</option>`).join('')}</select>
          <button type="button" id="rowAdd" ${info.games.length >= t.rows ? 'disabled' : ''}>Hozzáadás</button></div>
        <details class="addgame" id="customRowBox" ${s0().customOpen ? "open" : ""}><summary>+ Egyéni sor (szabad szöveg)</summary>
          <div class="addgrid"><label>Dátum szövege<input id="crDate" placeholder="${sch ? '2026.12.05. - 18:00' : '2026.11.21.'}"></label>
            <label>Párosítás<input id="crMatch" placeholder="Falco-Vulcano KC - Alba"></label>
            ${sch ? '' : '<label>Eredmény<input id="crScore" placeholder="85-72"></label>'}</div>
          <div class="import-row"><button type="button" id="crAdd" ${info.games.length >= t.rows ? 'disabled' : ''}>Sor hozzáadása</button></div></details>`;
      gamesHtml = `${noCups ? '<div class="notice">Ennél a csapatnál még nincs kupa-/európai meccs. Add hozzá lent, vagy tölts fel lapot / illessz be szöveget az eredmenyek.com oldalról („Adatok feltöltése” a bal felső sarokban).</div>' : ''}${rowsHtml}${addForm}
        <label>Megjelenő mérkőzések (max. ${t.rows}) ${manual ? '<b>– kézi választás</b>' : '– automatikus'}</label>
        <div class="row2"><select id="gameFilter"><option value="all" ${filter === 'all' ? 'selected' : ''}>Mind</option><option value="nbia" ${filter === 'nbia' ? 'selected' : ''}>Csak NB I/A</option><option value="cup" ${filter === 'cup' ? 'selected' : ''}>Csak kupa-/európai</option></select>
        <button id="gamesAuto" class="ghost" ${manual ? '' : 'disabled'}>Automatikus (${sch ? 'következő' : 'legutóbbi'} ${t.rows})</button></div>
        <div class="players gamelist">${ordered.slice(0, 60).map(m => `<label><input type="checkbox" value="${esc(gameKey(m))}" ${shownKeys.has(gameKey(m)) ? 'checked' : ''}> ${esc(fmtDate(m.date))} ${esc(nameOf(m))}${m.score ? ' <small>(' + m.score.home + '-' + m.score.away + ')</small>' : ''}${m.cup ? ` <small>· ${esc(m.competition || 'kupa/európai')}${m.auto ? ' · automatikus' : ''}</small> ${m.auto ? '' : `<button type="button" class="delcup" data-del="${esc(m.cupKey)}" title="Meccs törlése">✕</button>`}` : ''}</label>`).join('') || '<small>Nincs ilyen mérkőzés az adatokban.</small>'}</div>`;
    }
    renderSelection({ players: playersHtml, games: gamesHtml });
    renderFields(values, auto);
    renderLayoutPanel();
    $('fileName').value = fileName(values);
  }
  $('notices').innerHTML = info.notices.map(n => `<div class="notice ${n.bad ? 'bad' : ''}">${esc(n.text)}</div>`).join('');
  const bg = t.background ? await loadImage('bg/' + t.id, t.background) : null;
  await ensureTextures(t);
  await ensureImages(values);
  if (seq !== updateSeq) return;
  const canvas = $('canvas');
  lastReport = render(canvas, t, values, { background: bg, images, outlines, baseOpacity: state.baseOpacity, safeZone: bugZoneNow() });
  applyZoneGuide();
  refreshExtraSizes();
  renderOverlay();
  renderLayoutState();
  document.querySelectorAll('#fields .field input.sz').forEach(inp => {
    const sz = lastReport.sizes[inp.closest('.field').dataset.id];
    if (sz) inp.placeholder = Math.round(sz);
  });
  if ($('showRef').checked && t.reference) {
    const ref = await loadImage('ref/' + t.id, t.reference);
    if (seq !== updateSeq) return;
    const ctx = canvas.getContext('2d');
    ctx.save(); ctx.globalAlpha = 0.5; ctx.drawImage(ref, 0, 0); ctx.restore();
  }
  const missing = t.elements.filter(el => values[el.id]?.missing && (values[el.id].visible ?? el.visible ?? true));
  const msgs = [];
  if (missing.length) msgs.push(`${missing.length} hiányzó adat`);
  if (t.inner) { // the panel's outline is untouchable: text must stay inside it
    const [x0, y0, x1, y1] = t.inner.box;
    const out = t.elements.filter(el => el.type === 'text' && lastReport.boxes[el.id] && (values[el.id]?.visible ?? el.visible ?? true)).filter(el => {
      const Cn = lastReport.content, moved = Cn && (Cn.dx || Cn.dy || Cn.scale !== 1);
      const [bx, by, bw, bh] = moved ? LAY.toCanvas(lastReport.boxes[el.id], null, 1920, 1080, Cn) : lastReport.boxes[el.id]; // the content move counts
      return bx < x0 || by < y0 || bx + bw > x1 || by + bh > y1;
    });
    if (out.length) msgs.push(`A keret vonalát átlépi: ${out.map(el => el.label).slice(0, 6).join(', ')}${out.length > 6 ? ' …' : ''} – told beljebb vagy csökkentsd`);
  }
  if (lastReport.overflow.length) msgs.push(`Túl hosszú szöveg, kilóg a keretből (csökkentsd a betűméretet): ${lastReport.overflow.map(id => t.elements.find(e => e.id === id)?.label || id).join(', ')}`);
  if (lastReport.fit) { const f = lastReport.fit; msgs.push(`Az adásbeli eredményjelző miatt ${f.kind === 'up' ? Math.round(-f.dy) + ' px-szel feljebb tolva' : f.kind === 'left' ? Math.round(-f.dx) + ' px-szel balra tolva' : (100 * (1 - f.s)).toFixed(1) + '%-kal kicsinyítve'} (eredményjelző: ${bugSizeNow() === 'small' ? 'kicsi' : 'nagy'})`); }
  if (lastReport.scaled.length) msgs.push(`Automatikusan kicsinyítve: ${lastReport.scaled.map(id => t.elements.find(e => e.id === id)?.label || id).join(', ')}`);
  $('renderReport').textContent = msgs.join(' · ');
  $('dims').textContent = `${canvas.width} × ${canvas.height} px · PNG, átlátszó háttér · forrás: ${t.psd}`;
  $('exportBtn').disabled = !fontsOk || $('showRef').checked;
  $('exportBtn').title = $('showRef').checked ? 'Kapcsold ki a PSD minta összevetést az exportáláshoz' : '';
  saveState();
}

/** Asks about missing data; true = go on. */
function confirmMissing() {
  const t = tpl();
  const missing = t.elements.filter(el => current.values[el.id]?.missing && (current.values[el.id].visible ?? el.visible ?? true));
  return !missing.length || confirm(`${missing.length} mező hiányzó adatot tartalmaz („${MISSING}”):\n${missing.slice(0, 12).map(e => '• ' + e.label).join('\n')}${missing.length > 12 ? '\n…' : ''}\n\nExportálod így is?`);
}

function exportPng() {
  const t = tpl();
  if (!confirmMissing()) return;
  $('canvas').toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = $('fileName').value || 'grafika.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`Exportálva: ${a.download} (${t.width}×${t.height})`);
  }, 'image/png');
}

/** Phone: the share sheet (Save to Photos, messengers, AirDrop …) instead of a plain download. */
function sharePng() {
  if (!confirmMissing()) return;
  $('canvas').toBlob(async blob => {
    const file = new File([blob], $('fileName').value || 'grafika.png', { type: 'image/png' });
    try { await navigator.share({ files: [file], title: file.name }); }
    catch (e) { if (e?.name !== 'AbortError') toast('A megosztás nem sikerült – használd a „PNG exportálása” gombot.'); }
  }, 'image/png');
}


// ───────────────────────── full graphic package of a match (ZIP) ─────────────────────────
function packageItemsHtml() {
  const on = lsGet('nbia.studio.packageItems.v2', null); // v2: Intro, Kulcsjátékosok, Játékos-különleges and the coach graphics are unticked by default (a new item missing from the saved list is unticked)
  return PACKAGE_ITEMS.map(it => `<label class="chk"><input type="checkbox" class="pkgItem" value="${it.id}" ${on ? (on.includes(it.id) ? 'checked' : '') : (it.defaultOn === false ? '' : 'checked')}> ${esc(it.label.replace(/_/g, ' '))}${it.who === 'home' ? ' – hazai csapat' : it.who === 'away' ? ' – vendég csapat' : ''}</label>`).join('');
}

/** Renders one template with the automatic data (+ saved layout) without touching what is on screen. */
let pkgCtx = null; // set while a package item is rendered (the coach photo upload belongs to one team only)
async function renderForPackage(item, m) {
  const lg = state.league, t0 = templateById(`${item.type}-${lg}`);
  const saved = { tpl: state.template[lg], sel: JSON.parse(JSON.stringify(state.sel[lg])), ov: state.overrides[t0.id] };
  const s = state.sel[lg];
  try {
    state.template[lg] = t0.id;
    state.overrides[t0.id] = {}; // no typed overrides: the package is the pure automatic result
    if (item.who !== 'match') { s.teamId = item.who === 'home' ? m.homeId : m.awayId; s.games = null; s.customRows = null; s.players = null; }
    if (t0.type === 'h2h') await store.loadLazy(lg, 'h2h', fetchData);
    if (t0.type === 'coach') { // the team's latest collected pre-match statement (text + speaker); the photo upload only for the team it was made for
      await store.loadLazy(lg, 'previews', fetchData);
      const st = store.previewStatements(lg, s.teamId)[0], look = saved.sel.coach?.look;
      s.coach = st ? { quote: st.text, name: st.speaker, srcTitle: st.title, srcUrl: st.url, look } : { look };
      pkgCtx = { photoTeam: saved.sel.teamId };
    }
    const t = tpl();
    const { v: auto, info } = autoValues();
    const values = mergedValues(auto);
    const bg = t.background ? await loadImage('bg/' + t.id, t.background) : null;
  await ensureTextures(t);
    await ensureImages(values);
    const canvas = document.createElement('canvas');
    const rep = render(canvas, t, values, { background: bg, images, outlines, baseOpacity: state.baseOpacity, safeZone: bugZoneNow() });
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    const missing = t.elements.filter(el => values[el.id]?.missing && (values[el.id].visible ?? el.visible ?? true)).map(el => el.label);
    const warns = [
      ...info.notices.filter(n => n.bad).map(n => n.text),
      ...(missing.length ? [`${missing.length} hiányzó adat („${MISSING}”): ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ' …' : ''}`] : []),
      ...(rep.overflow.length ? [`kilógó szöveg: ${rep.overflow.join(', ')}`] : []),
      ...(t0.type === 'coach' ? [...(values.quote?.text ? [] : ['nincs nyilatkozat (nincs gyűjtött előzetes ehhez a csapathoz): a szöveg üres']), ...(values.photo?.src ? [] : ['nincs fotó: töltsd fel a Vezetőedző nyilatkozata sablonban'])] : []),
    ];
    return { blob, warns, what: TEMPLATE_TYPES[t.type] };
  } finally {
    pkgCtx = null;
    state.template[lg] = saved.tpl; state.sel[lg] = saved.sel;
    if (saved.ov === undefined) delete state.overrides[t0.id]; else state.overrides[t0.id] = saved.ov;
  }
}

async function exportPackage() {
  const lg = state.league, m = currentMatch();
  const btn = $('pkgBtn');
  if (!m) return toast('Válassz előbb mérkőzést (Adatok fül).');
  const chosen = [...document.querySelectorAll('.pkgItem:checked')].map(x => x.value);
  lsSet('nbia.studio.packageItems.v2', chosen);
  const items = PACKAGE_ITEMS.filter(it => chosen.includes(it.id));
  if (!items.length) return toast('Jelölj ki legalább egy grafikát.');
  btn.disabled = true;
  const date = (m.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const hs = club(lg, m.homeId)?.short || m.home, as = club(lg, m.awayId)?.short || m.away;
  const files = [], rendered = [], skipped = [], warnings = [];
  let n = 0;
  for (const [i, it] of items.entries()) {
    btn.textContent = `Készül… ${i + 1}/${items.length}`;
    if (it.type === 'referees' && !(m.custom ? null : store.matchStaff(lg, m))?.referees?.length) { skipped.push('Játékvezetők: még nincs kiírva (a Hunbasket menetrendjén nem szerepel)'); continue; }
    try {
      const r = await renderForPackage(it, m);
      const subject = it.who === 'match' ? `${hs}-${as}` : `${it.who === 'home' ? hs : as}`;
      const file = fileNameFor(++n, it, subject, date);
      files.push({ name: file, bytes: new Uint8Array(await r.blob.arrayBuffer()) });
      rendered.push({ file, what: `${r.what}${it.who === 'match' ? '' : ' – ' + (it.who === 'home' ? hs : as)}` });
      for (const w of r.warns) warnings.push(`${file}: ${w}`);
    } catch (e) { skipped.push(`${it.label}: nem sikerült (${e.message})`); }
  }
  const f = store.freshness(lg);
  const names = { fixtures: 'Menetrend', standings: 'Tabella', teamStats: 'Csapatstat', players: 'Játékosstat', referees: 'Játékvezetők', cups: 'Európai meccsek' };
  const freshness = Object.entries(f).map(([k, x]) => `${names[k] || k}: ${x.updated_at ? new Date(x.updated_at).toLocaleString('hu-HU') : 'ismeretlen'}${x.stale ? '  (RÉGI, 48 óránál régebbi!)' : ''}`);
  const xi = store.excelInfo(lg);
  if (xi) { const off = excelOffParts(xi); freshness.push(`Feltöltött Excel: ${xi.file}${off.length ? ` (kikapcsolva: ${off.join(', ')})` : ''}`); }
  const readme = readmeText({ title: `${hs} – ${as} (${LEAGUES[lg].label})`, date, made: new Date().toLocaleString('hu-HU'), rendered, skipped, warnings, freshness });
  const zip = buildZip(files, readme);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
  a.download = zipName(LEAGUES[lg].short, `${hs}-${as}`, date);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  btn.disabled = false; btn.textContent = 'Teljes csomag letöltése (ZIP)';
  toast(`${a.download}: ${files.length} kép${warnings.length ? `, ${warnings.length} figyelmeztetés (_OLVASSEL.txt)` : ''}`);
  update(true);
}

// ───────────────────────── presets ─────────────────────────
function renderPresets() {
  const list = lsGet(LS.presets, []);
  $('presetList').innerHTML = list.length ? list.map((p, i) => `<li><span>${esc(p.name)} <small>· ${esc(LEAGUES[p.league]?.short)} · ${esc(TEMPLATE_TYPES[templateById(p.template)?.type] || p.template)} · ${new Date(p.savedAt).toLocaleString('hu-HU')}</small></span>
    <button data-load="${i}">Betöltés</button><button data-del="${i}" class="ghost">Törlés</button></li>`).join('') : '<li><small>Még nincs mentett beállítás.</small></li>';
}

function savePreset() {
  const name = $('presetName').value.trim() || `${TEMPLATE_TYPES[tpl().type]} ${new Date().toLocaleString('hu-HU')}`;
  const list = lsGet(LS.presets, []);
  const p = { name, savedAt: Date.now(), league: state.league, template: tpl().id, sel: JSON.parse(JSON.stringify(sel())), overrides: JSON.parse(JSON.stringify(overrides())) };
  const i = list.findIndex(x => x.name === name);
  if (i >= 0) list[i] = p; else list.unshift(p);
  lsSet(LS.presets, list);
  $('presetName').value = '';
  renderPresets(); toast('Beállítás mentve: ' + name);
}

function loadPreset(p) {
  if (!templateById(p.template)) return toast('Ismeretlen sablon a mentésben.');
  state.league = p.league;
  state.template[p.league] = p.template;
  state.sel[p.league] = JSON.parse(JSON.stringify(p.sel || {}));
  state.overrides[p.template] = JSON.parse(JSON.stringify(p.overrides || {}));
  switchLeague(p.league, true);
  toast('Betöltve: ' + p.name);
}

// ───────────────────────── Excel / CSV import ─────────────────────────
let pendingImports = [];

function restoreExcel() {
  const saved = lsGet(LS.excel, {});
  for (const lg of Object.keys(LEAGUES)) if (saved[lg]) store.setExcel(lg, saved[lg]);
}

function persistExcel() {
  const out = {};
  for (const lg of Object.keys(LEAGUES)) if (store.excel[lg]) out[lg] = store.excel[lg];
  lsSet(LS.excel, out);
}

/** Which kinds of the uploaded Excel data are switched off (only those that were uploaded): ['csapatstatisztika', 'játékosstatisztika', 'kupameccsek']. */
function excelOffParts(xi) {
  return [[!xi.enabledTeam && xi.teams, 'csapatstatisztika'], [!xi.enabledPlayers && xi.playerTeams, 'játékosstatisztika'], [!xi.enabledCups && xi.cups, 'kupameccsek']].filter(([c]) => c).map(([, n]) => n);
}

function renderImportState() {
  const xi = store.excelInfo(state.league);
  $('importState').textContent = xi ? `– ${xi.teams} csapat, ${xi.playerTeams} csapat játékosai${xi.cups ? `, ${xi.cups} kupameccs` : ''} (${xi.files.length} fájl)` : '';
  for (const [id, part, count] of [['excelOnTeam', 'Team', xi?.teams], ['excelOnPlayers', 'Players', xi?.playerTeams], ['excelOnCups', 'Cups', xi?.cups]]) { // three independent switches (team stats / player stats / cup games)
    $(id).checked = xi ? xi['enabled' + part] : true;
    $(id).disabled = !xi || !count; // nothing of that kind uploaded: nothing to switch
  }
  $('excelClear').disabled = !xi;
}

function previewImports() {
  const html = pendingImports.map(({ file, league, imp, certain }) => {
    const rows = imp.report.map(r => `<tr><td>${esc(r.sheet)}</td><td>${esc(r.status)}${r.club ? ' → ' + esc(clubLabel(league, r.club)) : ''}</td><td>${r.rows ?? ''}</td><td>${esc(r.note || (r.columns || []).join(', '))}</td></tr>`).join('');
    const useful = imp.teamCount + imp.playerTeamCount + (imp.cupCount || 0);
    return `<div><b>${esc(file.name)}</b> → <b>${esc(LEAGUES[league]?.label || '?')}</b>${certain ? '' : ' <span class="warn">(a bajnokság nem volt egyértelmű – a most kiválasztottat használom)</span>'}</div>
      <table><tr><th>Munkalap</th><th>Felismerve</th><th>Sor</th><th>Oszlopok / megjegyzés</th></tr>${rows}</table>
      ${imp.teamCount ? `<div class="ok">Csapatstatisztika: ${imp.teamCount} csapat</div>` : ''}
      ${imp.playerCount ? `<div class="ok">Játékosok: ${imp.playerCount} játékos, ${imp.playerTeamCount} csapat</div>` : ''}
      ${imp.cupCount ? `<div class="ok">Kupa-/európai meccsek: ${imp.cupCount} (${imp.cups.filter(g => g.status === 'finished').length} lejátszott, ${imp.cups.filter(g => g.status !== 'finished').length} következő)</div>` : ''}
      ${imp.compsNoLogo?.length ? `<div class="warn">Nincs logó a PSD-kben ehhez a sorozathoz (a sor logó nélkül jelenik meg): ${esc(imp.compsNoLogo.join(', '))}</div>` : ''}
      ${(imp.notes || []).map(n => `<div class="hint">${esc(n)}</div>`).join('')}
      ${imp.scaled.length ? `<div class="warn">Törtként tárolt százalék szorozva 100-zal: ${esc(imp.scaled.join(', '))}</div>` : ''}
      ${imp.unmatched.length ? `<div class="warn bad"><b>Nem ismertem fel ezeket a csapatneveket – kihagytam őket, nem találgatok:</b><ul>${imp.unmatched.map(u => `<li>${esc(u)}</li>`).join('')}</ul></div>` : ''}
      ${imp.teamCount ? (() => { const have = new Set(Object.keys(imp.team || {})); const miss = store.clubs(league).filter(c => !have.has(c.id)).map(c => c.official); return miss.length ? `<div class="warn bad"><b>Ezek a ${esc(LEAGUES[league].short.toLowerCase())} NB I/A csapatok nem szerepelnek a fájlban</b> (az ő adataik a dashboardról jönnek): ${esc(miss.join(', '))}</div>` : ''; })() : ''}
      ${imp.ignoredColumns.length ? `<div class="hint">Nem használt oszlopok: ${imp.ignoredColumns.length} db (${esc(imp.ignoredColumns.slice(0, 6).join(', '))}…)</div>` : ''}
      ${useful === 0 ? '<div class="warn">Nem találtam használható adatot ebben a fájlban.</div>' : ''}`;
  }).join('<hr>');
  const any = pendingImports.some(p => p.imp.teamCount + p.imp.playerTeamCount + (p.imp.cupCount || 0) > 0);
  $('importPreview').innerHTML = html + (any ? '<div class="import-row"><button id="applyImport" class="primary">Alkalmazás</button><button id="cancelImport" class="ghost">Mégse</button></div>' : '<div class="import-row"><button id="cancelImport" class="ghost">Bezárás</button></div>');
  const ap = $('applyImport');
  if (ap) ap.onclick = async () => {
    for (const { file, league, imp } of pendingImports) if (imp.teamCount + imp.playerTeamCount + (imp.cupCount || 0) > 0) store.mergeExcel(league, imp, file);
    const first = pendingImports.find(p => p.imp.teamCount + p.imp.playerTeamCount + (p.imp.cupCount || 0) > 0);
    persistExcel(); pendingImports = []; $('importPreview').innerHTML = '';
    toast('Excel adatok betöltve');
    if (first && first.league !== state.league) await switchLeague(first.league); else { renderImportState(); renderFreshness(); update(true); }
  };
  const ca = $('cancelImport');
  if (ca) ca.onclick = () => { pendingImports = []; $('importPreview').innerHTML = ''; };
}

// ───────────────────────── layout editor (move elements, benchmark) ─────────────────────────
state.snap = true; state.groupMove = false; state.editMode = false; state.contentPhoto = true;
const elById = id => tpl().elements.find(e => e.id === id);
const ovFor = id => (overrides()[id] ||= {});
const effOf = id => LAY.effective(bench(), overrides(), id);

const { psConfigHtml, wirePsConfig, bgState, bgHtml, wireBg, extraPanelHtml, wireExtraPanel, refreshExtraSizes } = createPanels({
  state, images, esc, tpl, update, renderSelection, renderInspector, renderLayoutState, renderOverlay, saveState, ovFor, effOf, elById, toast,
  lastReport: () => lastReport,
});

function renderLayoutPanel() {
  const L = layoutsOf(tpl().id), names = Object.keys(L.saved);
  const g = overrides()[LAY.GLOBAL] || {}, gb = bench()?.items?.[LAY.GLOBAL] || {};
  const c = overrides()[LAY.CONTENT] || {}, cb = bench()?.items?.[LAY.CONTENT] || {};
  const hasPhoto = tpl().elements.some(e => e.id === 'photo');
  $('layoutPanel').innerHTML = `
    <label class="chk"><input type="checkbox" id="editMode" ${state.editMode ? 'checked' : ''}> Szerkesztés: elemek húzása az előnézeten (kijelölt elem: nyilak 1 px, Shift+nyíl 10 px, Esc)</label>
    <div class="lay-row">
      <label class="chk"><input type="checkbox" id="snapOn" ${state.snap ? 'checked' : ''}> Rögzítés a PSD / az alap helyéhez (Alt húzás közben: ki)</label>
      <label class="chk"><input type="checkbox" id="groupMove" ${state.groupMove ? 'checked' : ''}> Csoport együtt mozog (egy sor; hazai / vendég) – Shift húzás közben: fordítva</label>
    </div>
    <div class="lay-row"><b>Teljes grafika:</b> Balra/jobbra <input type="number" id="gX" step="1" placeholder="${gb.dx || 0}" value="${g.dx ?? ''}">
      Fel/le <input type="number" id="gY" step="1" placeholder="${gb.dy || 0}" value="${g.dy ?? ''}">
      Méret (%) <input type="number" id="gS" step="1" min="10" max="300" placeholder="${Math.round((gb.scale || 1) * 100)}" value="${g.scale ? Math.round(g.scale * 100) : ''}"></div>
    <div class="lay-row"><b>Tartalom a kereten belül:</b> Balra/jobbra <input type="number" id="cX" step="1" placeholder="${cb.dx || 0}" value="${c.dx ?? ''}">
      Fel/le <input type="number" id="cY" step="1" placeholder="${cb.dy || 0}" value="${c.dy ?? ''}">
      Méret (%) <input type="number" id="cS" step="1" min="10" max="300" placeholder="${Math.round((cb.scale || 1) * 100)}" value="${c.scale ? Math.round(c.scale * 100) : ''}">
      ${hasPhoto ? `<label class="chk"><input type="checkbox" id="cPhoto" ${state.contentPhoto ? 'checked' : ''}> a fotó is mozogjon</label>` : ''}
      <small class="hint">A keret és a háttér nem mozdul; a keretbe lógó szöveget jelzem.</small></div>
    <div id="inspector" class="insp empty"></div>
    <div class="lay-row"><b>Alap (benchmark):</b> <span id="benchState"></span>
      <button id="benchSave" title="A jelenlegi elrendezés lesz az alap: minden új meccs ebből indul">Mentés alapként</button>
      <button id="layDiscard" class="ghost">Nem mentett módosítások eldobása</button>
      <button id="benchClear" class="ghost" title="Visszaáll a PSD eredeti elrendezése">Alap törlése (PSD)</button></div>
    <div class="lay-row"><b>Mentett elrendezések:</b>
      <select id="layList">${names.map(n => `<option>${esc(n)}</option>`).join('') || '<option value="">– nincs –</option>'}</select>
      <button id="layLoad" ${names.length ? '' : 'disabled'}>Betöltés</button><button id="layDel" class="ghost" ${names.length ? '' : 'disabled'}>Törlés</button>
      <input id="layName" placeholder="Név (pl. Hosszú nevek)"><button id="laySave">Mentés névvel</button></div>
    <p class="hint">Az „alap” sablononként érvényes és böngészőben tárolódik; az Exportálás (JSON) gomb a mentett beállításokkal együtt az elrendezéseket is menti.</p>`;
  renderInspector();
  renderLayoutState();
}

function renderLayoutState() {
  const n = LAY.unsavedCount(overrides());
  const b = bench(), saved = b ? Object.keys(b.items).length : 0;
  if ($('benchState')) $('benchState').textContent = saved ? `mentve (${saved} elem módosítva a PSD-hez képest)` : 'a PSD eredeti elrendezése';
  if ($('layoutState')) $('layoutState').textContent = n ? `· ${n} nem mentett módosítás` : (saved ? '· alap érvényben' : '');
}

function renderInspector() {
  const box = $('inspector');
  if (!box) return;
  const el = selectedId && elById(selectedId);
  if (!el) { box.className = 'insp empty'; box.textContent = 'Nincs kijelölt elem – kapcsold be a szerkesztést, és kattints egy elemre az előnézeten.'; return; }
  const eff = effOf(selectedId);
  box.className = 'insp';
  const sizeBox = el.type === 'text'
    ? `Betűméret (px) <input type="number" id="iS" min="10" max="300" step="1" value="${eff.size > 0 ? eff.size : ''}" placeholder="${Math.round(lastReport?.sizes?.[el.id] ?? el.size)}">`
    : `Méret (%) <input type="number" id="iS" min="10" max="400" step="1" value="${Math.round((eff.scale > 0 ? eff.scale : 1) * 100)}">`
      + (el.type === 'framed' ? ` Szélesség (px) <input type="number" id="iW" min="40" step="2" value="${Math.round(lastReport?.boxes?.[el.id]?.[2] ?? el.box[2])}"> Magasság (px) <input type="number" id="iH" min="40" step="2" value="${Math.round(lastReport?.boxes?.[el.id]?.[3] ?? el.box[3])}">` : '');
  box.innerHTML = `<div class="lay-row"><b>${esc(el.label || el.id)}</b><small>${esc(el.group || '')}</small>
    Balra/jobbra (px) <input type="number" id="iX" step="1" value="${eff.dx || 0}"> Fel/le (px) <input type="number" id="iY" step="1" value="${eff.dy || 0}"> ${sizeBox}
    <button id="iReset">Elem a PSD helyére</button></div>`;
}

function selectElement(id) {
  selectedId = id;
  document.querySelectorAll('#fields .field').forEach(f => f.classList.toggle('sel', f.dataset.id === id));
  if (id) document.querySelector(`#fields .field[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  renderOverlay();
  renderInspector();
}

function renderOverlay() {
  const ov = $('overlay');
  if (!ov) return;
  const on = !!state.editMode || tpl().type === 'extra'; // the frames of the extra graphic are always directly editable
  ov.classList.toggle('on', on);
  if (!on) return;
  const boxes = lastReport?.boxes || {}, g = lastReport?.global, C = lastReport?.content;
  const cFor = id => (C && (C.dx || C.dy || C.scale !== 1) && (id !== 'photo' || C.photo) ? C : null);
  const ids = Object.keys(boxes).sort((a, b) => boxes[b][2] * boxes[b][3] - boxes[a][2] * boxes[a][3]); // big first: small elements stay on top
  const present = new Set(ids);
  ov.querySelectorAll('.hit').forEach(d => { if (!present.has(d.dataset.id)) d.remove(); });
  ids.forEach((id, i) => {
    let d = ov.querySelector(`.hit[data-id="${CSS.escape(id)}"]`);
    if (!d) { d = document.createElement('div'); d.className = 'hit'; d.dataset.id = id; ov.appendChild(d); }
    const [x, y, w, h] = LAY.toCanvas(boxes[id], g, 1920, 1080, cFor(id));
    Object.assign(d.style, { left: `${(x / 1920) * 100}%`, top: `${(y / 1080) * 100}%`, width: `${(w / 1920) * 100}%`, height: `${(h / 1080) * 100}%`, zIndex: i + 1 });
    d.title = `${elById(id)?.label || id} – húzd, vagy jelöld ki`;
    d.classList.toggle('sel', id === selectedId);
    const bigPic = id === selectedId && elById(id)?.type === 'image' && w * h > 300000; // a large picture (e.g. a 900 px tall photo) lies under many texts
    d.classList.toggle('sel-img', bigPic);
    if (bigPic) d.style.zIndex = 9999; // its handles stay above those texts
    const handles = ['framed', 'image'].includes(elById(id)?.type) && id === selectedId; // framed shapes and pictures can be resized by their corners (pictures: proportional scale)
    if (!handles) d.querySelectorAll('.rh').forEach(h => h.remove());
    else if (!d.querySelector('.rh')) for (const c of ['nw', 'ne', 'sw', 'se']) { const h = document.createElement('i'); h.className = 'rh'; h.dataset.c = c; d.appendChild(h); }
  });
  // ghost: where the selected element sits in the PSD
  let ghost = ov.querySelector('.ghost');
  const eff = selectedId ? effOf(selectedId) : null;
  if (eff && (eff.dx || eff.dy) && boxes[selectedId]) {
    const [bx, by, bw, bh] = boxes[selectedId];
    const [x, y, w, h] = LAY.toCanvas([bx - (eff.dx || 0), by - (eff.dy || 0), bw, bh], g, 1920, 1080, cFor(selectedId));
    if (!ghost) { ghost = document.createElement('div'); ghost.className = 'ghost'; ov.appendChild(ghost); }
    Object.assign(ghost.style, { left: `${(x / 1920) * 100}%`, top: `${(y / 1080) * 100}%`, width: `${(w / 1920) * 100}%`, height: `${(h / 1080) * 100}%` });
  } else ghost?.remove();
}

let drag = null, redrawQueued = false;
function scheduleRedraw() {
  if (redrawQueued) return;
  redrawQueued = true;
  requestAnimationFrame(() => { redrawQueued = false; update(false); });
}

/** Draggable splitter between the controls sidebar and the preview (desktop): width remembered, double click / Home resets. */
function initSplitter() {
  const sp = $('splitter'), layout = document.querySelector('.layout');
  if (!sp || !layout) return;
  const DEF = 480, key = 'nbia.studio.sideW';
  const clamp = w => Math.max(320, Math.min(Math.round(w), Math.max(360, window.innerWidth - 480), 1000));
  const set = (w, save) => { w = clamp(w); layout.style.setProperty('--side-w', w + 'px'); if (save) lsSet(key, w); return w; };
  set(lsGet(key, DEF), false);
  let startX = 0, startW = 0;
  const cur = () => parseInt(getComputedStyle(layout).getPropertyValue('--side-w'), 10) || DEF;
  sp.addEventListener('pointerdown', e => { e.preventDefault(); sp.setPointerCapture(e.pointerId); startX = e.clientX; startW = cur(); sp.classList.add('drag'); });
  sp.addEventListener('pointermove', e => { if (sp.classList.contains('drag')) set(startW + e.clientX - startX, false); });
  const end = () => { if (!sp.classList.contains('drag')) return; sp.classList.remove('drag'); set(cur(), true); renderOverlay(); };
  sp.addEventListener('pointerup', end); sp.addEventListener('pointercancel', end);
  sp.addEventListener('dblclick', () => { set(DEF, true); renderOverlay(); });
  sp.addEventListener('keydown', e => {
    const d = { ArrowLeft: -24, ArrowRight: 24 }[e.key];
    if (d) { e.preventDefault(); set(cur() + d, true); renderOverlay(); } else if (e.key === 'Home') { set(DEF, true); renderOverlay(); }
  });
  window.addEventListener('resize', () => set(cur(), false));
}

function wireLayoutEditor() {
  const ov = $('overlay');
  let resize = null;
  ov.addEventListener('pointerdown', e => {
    const rh = e.target.closest('.rh');
    if (rh) {
      e.preventDefault(); rh.setPointerCapture(e.pointerId);
      const id = rh.parentElement.dataset.id;
      resize = { id, c: rh.dataset.c, x0: e.clientX, y0: e.clientY, b: [...lastReport.boxes[id]], k0: effOf(id).scale > 0 ? effOf(id).scale : 1, moved: false };
      return;
    }
    const hit = e.target.closest('.hit');
    if (!hit) return;
    e.preventDefault();
    document.activeElement?.blur?.(); // a focused dropdown / box would swallow the arrow keys
    hit.setPointerCapture(e.pointerId);
    const id = hit.dataset.id;
    selectElement(id);
    const grp = elById(id)?.group;
    const together = grp && (state.groupMove !== !!e.shiftKey);
    const ids = together ? tpl().elements.filter(x => x.group === grp && lastReport.boxes[x.id]).map(x => x.id) : [id];
    drag = { id, ids, x0: e.clientX, y0: e.clientY, moved: false, start: Object.fromEntries(ids.map(i => [i, { dx: effOf(i).dx || 0, dy: effOf(i).dy || 0 }])) };
  });
  ov.addEventListener('pointermove', e => {
    if (resize) {
      const r = resize, rect = $('canvas').getBoundingClientRect(), k = 1920 / rect.width / (lastReport?.global?.scale || 1);
      const sx = r.c.includes('e') ? 1 : -1, sy = r.c.includes('s') ? 1 : -1;
      const elr = elById(r.id);
      if (elr.type === 'image') { // pictures: proportional scale (about the centre; pictures that stand on the panel's bottom edge grow upwards and keep their feet)
        const m = elr.stand > 0 ? 1 : 2, w = r.b[2] + sx * (e.clientX - r.x0) * k * m, h = r.b[3] + sy * (e.clientY - r.y0) * k * m;
        const f = Math.max(0.1, Math.max(w / r.b[2], h / r.b[3]));
        ovFor(r.id).scale = Math.round(Math.min(4, r.k0 * f) * 1000) / 1000;
        r.moved = true; scheduleRedraw();
        return;
      }
      let w = Math.max(40, r.b[2] + sx * (e.clientX - r.x0) * k), h = Math.max(40, r.b[3] + sy * (e.clientY - r.y0) * k);
      const lock = (elById(r.id).lockAspect ?? state.lockAspect !== false) !== (e.altKey || e.shiftKey); // Shift / Alt flips the lock for this drag
      if (lock) { const f = Math.max(w / r.b[2], h / r.b[3]); w = r.b[2] * f; h = r.b[3] * f; } // the same growth in both directions (Alt = free)
      const left = sx === 1 ? r.b[0] : r.b[0] + r.b[2] - w, top = sy === 1 ? r.b[1] : r.b[1] + r.b[3] - h; // the opposite corner stays
      const base = elById(r.id).box, o = ovFor(r.id);
      o.w = Math.round(w / r.k0); o.h = Math.round(h / r.k0); o.dx = Math.round(left + w / 2 - base[0]); o.dy = Math.round(top + h / 2 - base[1]);
      r.moved = true; scheduleRedraw();
      return;
    }
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 3) return;
    drag.moved = true;
    const rect = $('canvas').getBoundingClientRect();
    const C = lastReport?.content, cs = C && (drag.id !== 'photo' || C.photo) ? C.scale || 1 : 1;
    const k = 1920 / rect.width / ((lastReport?.global?.scale || 1) * cs); // screen px → template px
    const s0 = drag.start[drag.id], b = bench()?.items?.[drag.id] || {};
    let ndx = s0.dx + (e.clientX - drag.x0) * k, ndy = s0.dy + (e.clientY - drag.y0) * k;
    if (state.snap && !e.altKey) { ndx = LAY.snap(ndx, [0, b.dx || 0]); ndy = LAY.snap(ndy, [0, b.dy || 0]); }
    const ddx = Math.round(ndx) - s0.dx, ddy = Math.round(ndy) - s0.dy;
    for (const i of drag.ids) { const o = ovFor(i); o.dx = drag.start[i].dx + ddx; o.dy = drag.start[i].dy + ddy; }
    scheduleRedraw();
  });
  const end = () => { if (resize) { const m = resize.moved; resize = null; if (m) { saveState(); renderInspector(); renderLayoutState(); refreshExtraSizes(); } return; } if (!drag) return; const d = drag; drag = null; if (d.moved) { saveState(); renderInspector(); renderLayoutState(); } };
  ov.addEventListener('pointerup', end);
  ov.addEventListener('pointercancel', end);

  document.addEventListener('keydown', e => {
    if (!state.editMode || !selectedId) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    if (e.key === 'Escape') { selectElement(null); return; }
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    const eff = effOf(selectedId), o = ovFor(selectedId);
    o.dx = (eff.dx || 0) + d[0]; o.dy = (eff.dy || 0) + d[1];
    update(false); saveState(); renderInspector();
  });

  const panel = $('layoutPanel');
  panel.addEventListener('change', e => {
    if (e.target.id === 'editMode') { state.editMode = e.target.checked; renderOverlay(); }
    if (e.target.id === 'snapOn') state.snap = e.target.checked;
    if (e.target.id === 'groupMove') state.groupMove = e.target.checked;
    if (e.target.id === 'cPhoto') { state.contentPhoto = e.target.checked; update(false); }
  });
  panel.addEventListener('input', e => {
    const id = e.target.id, v = e.target.value, n = parseFloat(v), has = v !== '' && Number.isFinite(n);
    const setKey = (o, key, val) => { if (val === undefined) delete o[key]; else o[key] = val; };
    if (['cX', 'cY', 'cS'].includes(id)) {
      const o = ovFor(LAY.CONTENT);
      setKey(o, { cX: 'dx', cY: 'dy', cS: 'scale' }[id], has ? (id === 'cS' ? n / 100 : n) : undefined);
      if (!Object.keys(o).length) delete overrides()[LAY.CONTENT];
    } else if (['gX', 'gY', 'gS'].includes(id)) {
      const o = ovFor(LAY.GLOBAL);
      setKey(o, { gX: 'dx', gY: 'dy', gS: 'scale' }[id], has ? (id === 'gS' ? n / 100 : n) : undefined);
      if (!Object.keys(o).length) delete overrides()[LAY.GLOBAL];
    } else if (['iW', 'iH'].includes(id) && selectedId) {
      const b = lastReport.boxes[selectedId], o = ovFor(selectedId), base = elById(selectedId).box, kk = effOf(selectedId).scale > 0 ? effOf(selectedId).scale : 1;
      let w = id === 'iW' ? n : b[2], h = id === 'iH' ? n : b[3];
      if (elById(selectedId).lockAspect ?? state.lockAspect !== false) { if (id === 'iW') h = w * b[3] / b[2]; else w = h * b[2] / b[3]; }
      o.w = Math.round(w / kk); o.h = Math.round(h / kk);
      o.dx = Math.round(b[0] + b[2] / 2 - base[0]); o.dy = Math.round(b[1] + b[3] / 2 - base[1]);
      renderInspector(); refreshExtraSizes();
    } else if (['iX', 'iY', 'iS'].includes(id) && selectedId) {
      const o = ovFor(selectedId), el = elById(selectedId);
      if (id === 'iX') setKey(o, 'dx', has ? n : undefined);
      else if (id === 'iY') setKey(o, 'dy', has ? n : undefined);
      else if (el.type === 'text') setKey(o, 'size', has ? n : undefined);
      else setKey(o, 'scale', has ? n / 100 : undefined);
    } else return;
    update(false); saveState();
  });
  panel.addEventListener('click', e => {
    const id = e.target.id, L = layoutsOf(tpl().id);
    if (id === 'benchSave') {
      const lay = LAY.extract(tpl(), bench(), overrides());
      L.benchmark = Object.keys(lay.items).length ? lay : null;
      LAY.dropLayoutKeys(overrides()); persistLayouts(); saveState(); update(true);
      toast(L.benchmark ? 'Elrendezés mentve alapként – minden új meccs ebből indul' : 'Nincs módosítás: az alap a PSD eredeti elrendezése');
    } else if (id === 'layDiscard') { LAY.dropLayoutKeys(overrides()); saveState(); update(true); }
    else if (id === 'benchClear') { L.benchmark = null; LAY.dropLayoutKeys(overrides()); persistLayouts(); saveState(); update(true); toast('Alap törölve: PSD eredeti elrendezés'); }
    else if (id === 'laySave') {
      const name = $('layName').value.trim() || `Elrendezés ${Object.keys(L.saved).length + 1}`;
      L.saved[name] = LAY.extract(tpl(), bench(), overrides()); persistLayouts(); renderLayoutPanel(); toast('Elrendezés mentve: ' + name);
    } else if (id === 'layLoad' && L.saved[$('layList').value]) {
      LAY.dropLayoutKeys(overrides()); LAY.applyToOverrides(overrides(), L.saved[$('layList').value], bench()); saveState(); update(true);
      toast('Betöltve: ' + $('layList').value + ' (nem mentett módosításként; „Mentés alapként” rögzíti)');
    } else if (id === 'layDel' && L.saved[$('layList').value]) {
      if (confirm('Törlöd a mentett elrendezést?')) { delete L.saved[$('layList').value]; persistLayouts(); renderLayoutPanel(); }
    } else if (id === 'iReset' && selectedId) {
      Object.assign(ovFor(selectedId), { dx: 0, dy: 0, size: 0, scale: 1, w: 0, h: 0 }); update(true); saveState();
    }
  });
}

// ───────────────────────── wiring ─────────────────────────
async function switchLeague(lg, keep) {
  state.league = lg;
  document.querySelectorAll('.league-toggle button').forEach(b => b.classList.toggle('on', b.dataset.league === lg));
  await loadLeagueImages(lg);
  if (!keep) ensureSelection(); else ensureSelection();
  renderFreshness();
  renderImportState();
  renderTemplateList();
  await update(true);
}

function renderBaseOpacity() {
  const t = tpl();
  const v = state.baseOpacity === null ? t.panel.alpha : state.baseOpacity;
  $('baseOpacity').value = Math.round(v * 1000) / 10;
  $('baseOpacityVal').textContent = (Math.round(v * 1000) / 10).toFixed(1).replace('.', ',') + '%'
    + (state.baseOpacity === null ? ' (PSD)' : '');
}


// ───────────────────────── mobile: tabs, pinch zoom, share ─────────────────────────
const smallMQ = window.matchMedia('(max-width: 900px)');
/** View switch: 'auto' follows the screen width, 'mobile' / 'desktop' force a layout (kept in this browser). */
const viewMode = () => { try { const v = localStorage.getItem('nbia.view'); return v === 'mobile' || v === 'desktop' ? v : 'auto'; } catch { return 'auto'; } };
const mobileMQ = { get matches() { const v = viewMode(); return v === 'mobile' || (v === 'auto' && smallMQ.matches); } };
const VIEW_LABEL = { auto: 'Nézet: auto', mobile: 'Nézet: mobil', desktop: 'Nézet: asztali' };
function applyView(mode, reload = false) {
  try { if (mode === 'auto') localStorage.removeItem('nbia.view'); else localStorage.setItem('nbia.view', mode); } catch { /* storage unavailable */ }
  document.documentElement.dataset.view = mode;
  $('mobileCss').media = mode === 'mobile' ? 'all' : mode === 'desktop' ? 'not all' : '(max-width: 900px)';
  const vp = document.querySelector('meta[name=viewport]');
  vp.content = mode === 'desktop' ? 'width=1280' : 'width=device-width, initial-scale=1, viewport-fit=cover';
  $('viewSwitch').textContent = VIEW_LABEL[mode];
  if (reload) toast(`${VIEW_LABEL[mode]}${mode === 'desktop' ? ' – telefonon a teljes asztali elrendezés kicsinyítve jelenik meg' : ''}`);
}

const TABS = ['template', 'data', 'fields', 'layout', 'export'];
function setTab(name, scroll = true) {
  if (!TABS.includes(name)) name = 'template';
  state.tab = name;
  document.body.dataset.tab = name;
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  if (name === 'layout' && $('layoutBox')) $('layoutBox').open = true;
  try { sessionStorage.setItem('nbia.studio.tab', name); } catch { /* ignore */ }
  if (scroll && mobileMQ.matches) window.scrollTo({ top: 0 });
}

function setStageZoom(z) {
  const st = $('stage');
  state.stageZoom = Math.min(4, Math.max(1, z));
  st.style.setProperty('--z', state.stageZoom);
  st.classList.toggle('zoomed', state.stageZoom > 1.01);
}

function initMobile() {
  $('viewSwitch').textContent = VIEW_LABEL[viewMode()];
  $('viewSwitch').onclick = () => applyView({ auto: 'mobile', mobile: 'desktop', desktop: 'auto' }[viewMode()], true);
  let tab = 'template';
  try { tab = sessionStorage.getItem('nbia.studio.tab') || tab; } catch { /* ignore */ }
  setTab(tab, false);
  $('tabbar').onclick = e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); };
  // the sticky warning line sits right under the preview, whatever its height
  const st = $('stage');
  const sync = () => document.documentElement.style.setProperty('--stage-h', `${st.getBoundingClientRect().height}px`);
  if (window.ResizeObserver) new ResizeObserver(sync).observe(st); else sync();
  // pinch to zoom the preview, double tap toggles; one finger pans the zoomed preview (native scrolling)
  let pinch = null, lastTap = 0;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid = t => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];
  st.addEventListener('touchstart', e => {
    if (e.touches.length === 2) { pinch = { d: dist(e.touches), z: state.stageZoom || 1 }; }
    else if (e.touches.length === 1 && !state.editMode) {
      const now = performance.now(); // monotonic: not affected by clock changes
      if (now - lastTap < 300) { setStageZoom((state.stageZoom || 1) > 1.2 ? 1 : 2.5); e.preventDefault(); }
      lastTap = now;
    }
  }, { passive: false });
  st.addEventListener('touchmove', e => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const [cx, cy] = mid(e.touches), r = st.getBoundingClientRect();
    const fx = (st.scrollLeft + cx - r.left) / st.scrollWidth, fy = (st.scrollTop + cy - r.top) / st.scrollHeight;
    setStageZoom(pinch.z * dist(e.touches) / pinch.d);
    st.scrollLeft = fx * st.scrollWidth - (cx - r.left);
    st.scrollTop = fy * st.scrollHeight - (cy - r.top);
  }, { passive: false });
  st.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; });
  // share sheet (phones / tablets that can share files)
  try {
    const probe = new File([new Blob(['x'])], 'a.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [probe] }) && window.matchMedia('(pointer: coarse)').matches) $('shareBtn').hidden = false;
  } catch { /* no file sharing */ }
  $('shareBtn').onclick = sharePng;
}

function applyZoom() {
  document.querySelectorAll('[data-zoom]').forEach(b => b.classList.toggle('on', b.dataset.zoom === state.zoom));
  $('stage').classList.toggle('actual', state.zoom === '1');
}

async function main() {
  document.querySelectorAll('.league-toggle button').forEach(b => b.onclick = () => switchLeague(b.dataset.league));
  $('templateList').onclick = e => { const b = e.target.closest('button'); if (!b) return; state.template[state.league] = b.dataset.id; ensureSelection(); renderTemplateList(); update(true); if (mobileMQ.matches) setTab('data'); };
  $('fields').addEventListener('input', onFieldEvent);
  $('fields').addEventListener('change', onFieldEvent);
  $('fields').addEventListener('click', e => { if (e.target.classList.contains('reset')) onFieldEvent(e); });
  $('onlyMissing').onchange = () => update(true);
  $('resetAll').onclick = () => { if (confirm('Törlöd ennek a sablonnak minden kézi felülírását?')) { state.overrides[ovKey()] = {}; update(true); } };
  $('exportBtn').onclick = exportPng;
  $('pkgItems').innerHTML = packageItemsHtml();
  $('pkgBtn').onclick = exportPackage;
  initMobile();
  try { const r = await fetch('players/index.json', { cache: 'no-store' }); if (r.ok) photoIds = new Set((await r.json()).ids); } catch { /* no photos downloaded */ }
  $('checker').onchange = e => $('stage').classList.toggle('checker', e.target.checked);
  // the broadcast's score bug: which one (setting) and the preview-only guide of its zone
  $('bugMode').value = ['auto', 'large', 'small', 'off'].includes(bugMode) ? bugMode : 'auto';
  $('bugMode').onchange = e => { bugMode = e.target.value; lsSet(BUG_KEY, bugMode); update(true); };
  $('zoneToggle').checked = lsGet('nbia.studio.zoneGuide.v1', true) !== false;
  $('zoneToggle').onchange = e => { lsSet('nbia.studio.zoneGuide.v1', e.target.checked); applyZoneGuide(); };
  $('fields').addEventListener('click', e => {
    const id = e.target.id;
    if (id !== 'eqNames' && id !== 'eqRanks') return;
    const ids = id === 'eqNames' ? ['home.name', 'away.name'] : ['home.rank', 'away.rank'];
    const els = tpl().elements.filter(x => ids.includes(x.id));
    const sizes = els.map(x => lastReport?.sizes?.[x.id] ?? x.size);
    const target = Math.round(Math.min(...sizes) * 10) / 10;
    for (const x of els) (overrides()[x.id] ||= {}).size = target;
    update(true);
    toast(`Egyforma méret: ${target} px`);
  });
  $('showRef').onchange = () => update(false);
  $('baseOpacity').oninput = e => { state.baseOpacity = +e.target.value / 100; renderBaseOpacity(); update(false); };
  $('baseOpacityPsd').onclick = () => { state.baseOpacity = null; renderBaseOpacity(); update(false); };
  document.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => { state.zoom = b.dataset.zoom; applyZoom(); saveState(); });
  $('savePreset').onclick = savePreset;
  $('presetList').onclick = e => {
    const list = lsGet(LS.presets, []);
    if (e.target.dataset.load) loadPreset(list[+e.target.dataset.load]);
    if (e.target.dataset.del && confirm('Törlöd a mentett beállítást?')) { list.splice(+e.target.dataset.del, 1); lsSet(LS.presets, list); renderPresets(); }
  };
  $('exportPresets').onclick = () => {
    const blob = new Blob([JSON.stringify({ presets: lsGet(LS.presets, []), venues: lsGet(LS.venues, {}), layouts: state.layouts }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'grafika-studio-beallitasok.json'; a.click();
  };
  $('importPresets').onchange = async e => {
    try {
      const j = JSON.parse(await e.target.files[0].text());
      const list = lsGet(LS.presets, []);
      for (const p of j.presets || []) { const i = list.findIndex(x => x.name === p.name); if (i >= 0) list[i] = p; else list.push(p); }
      lsSet(LS.presets, list);
      lsSet(LS.venues, { ...lsGet(LS.venues, {}), ...(j.venues || {}) });
      if (j.layouts) { state.layouts = { ...state.layouts, ...j.layouts }; persistLayouts(); }
      renderPresets(); toast(`${(j.presets || []).length} beállítás importálva`);
    } catch (err) { toast('Hibás fájl: ' + err.message); }
    e.target.value = '';
  };
  $('excelFile').onchange = async e => {
    const files = [...e.target.files];
    pendingImports = [];
    for (const f of files) {
      try {
        const parsed = await readFile(f);
        const d = detectLeague(parsed, state.league);
        pendingImports.push({ file: { name: f.name, modified: parsed.modified }, league: d.league, certain: d.certain, imp: importWorkbook(parsed, d.league) });
      } catch (err) {
        pendingImports.push({ file: { name: f.name }, league: state.league, certain: false, imp: { report: [{ sheet: f.name, status: 'hiba', note: err.message }], teamCount: 0, playerTeamCount: 0, playerCount: 0, cupCount: 0, cups: [], scaled: [], unmatched: [], ignoredColumns: [] } });
      }
    }
    if (files.length) previewImports();
    e.target.value = '';
  };
  $('pasteRead').onclick = () => {
    const text = $('pasteBox').value;
    if (!text.trim()) { toast('Előbb illessz be szöveget.'); return; }
    const now = new Date();
    const p = parseEredmenyekText(text, now);
    const d = detectLeague(p.workbook, state.league);
    const imp = importWorkbook(p.workbook, d.league);
    imp.notes = [];
    for (const k of p.skipped) imp.notes.push(`${k.n} „${k.name}” mérkőzés kihagyva: az NB I/A meccsek már a dashboard adataiban vannak.`);
    if (p.unparsed) imp.notes.push(`${p.unparsed} sort nem tudtam értelmezni (kihagyva).`);
    if (!p.gamesFound) imp.notes.push('Nem találtam mérkőzést a szövegben. A „Meccsek” fülről másolt szöveg kell, dátum + két csapatnév soronként.');
    pendingImports = [{ file: { name: 'Beillesztett szöveg (eredmenyek.com)', modified: now.toISOString() }, league: d.league, certain: d.certain, imp }];
    previewImports();
  };
  wireLayoutEditor();
  initSplitter();
  const lb = $('layoutBox'); // remember whether the layout box was open
  lb.open = !!lsGet('nbia.studio.layoutOpen', false);
  lb.addEventListener('toggle', () => lsSet('nbia.studio.layoutOpen', lb.open));
  $('quickCup').onclick = async () => {
    const lg = state.league;
    if (!['results', 'schedule', 'resultrows'].includes(tpl().type)) state.template[lg] = `schedule-${lg}`;
    sel().addOpen = true;
    renderTemplateList();
    await update(true);
    const box = $('addGame');
    if (box) { box.open = true; box.scrollIntoView({ block: 'center' }); $('agOpp')?.focus(); }
  };
  for (const [id, part] of [['excelOnTeam', 'Team'], ['excelOnPlayers', 'Players'], ['excelOnCups', 'Cups']]) {
    $(id).onchange = e => { store.setExcelPart(state.league, part, e.target.checked); persistExcel(); renderImportState(); renderFreshness(); update(true); };
  }
  $('excelClear').onclick = () => { if (confirm('Törlöd a feltöltött Excel adatokat ennél a bajnokságnál?')) { store.setExcel(state.league, null); persistExcel(); renderImportState(); renderFreshness(); update(true); } };
  $('stage').classList.add('checker');
  applyZoom();
  renderPresets();

  try { fontsOk = await loadFonts('fonts/'); } catch (err) { fontsOk = false; }
  try { outlines = logoOutlines(await (await fetch('logos/logos.json')).json()); } catch { outlines = {}; }
  if (!fontsOk) toast('A League Gothic betűtípus nem tölthető be – az exportálás le van tiltva.');
  store = await loadDashboard(async f => {
    const r = await fetch(`../data/${f}?v=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
  if (store.unresolved.length) console.warn('Unresolved team names', store.unresolved);
  restoreExcel();
  window.__studio = { state, store, images, selectElement, renderPackageItems: () => { $('pkgItems').innerHTML = packageItemsHtml(); }, setTab, setStageZoom, applyView, viewMode, render: () => update(true), current: () => current, report: () => lastReport, fontsOk: () => fontsOk };
  await switchLeague(state.league, true);
  document.body.dataset.ready = '1';
}

main();
