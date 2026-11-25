// Link maker for the OBS overlays: pick game + graphic (+ ticked statistics), get the link of the browser source and a live preview.
import { gameCode, decodeFeed, parseGame, playedPlayers } from './live.js';
import { LIVE_STATS, LIVE_TEAM_STATS, LIVE_VARIANTS, LIVE_CORNERS, liveKeys } from './templates.js';
import { OVERLAY_GRAPHICS, overlayQuery, gameLeague } from './overlay-params.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = { get: k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } } };
const S = { game: null, players: [], side: 'home', teams: null, player: '', corner: '', stats: null, teamStats: null, leaderStats: null };

$('graphic').innerHTML = Object.entries(OVERLAY_GRAPHICS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
$('graphic').value = ls.get('nbia.live.graphic') || 'liveteam';
$('token').value = ls.get('nbia.live.token');
$('game').value = ls.get('nbia.live.game');

const tick = (cls, list, on) => list.map(x => `<label><input type="checkbox" class="${cls}" value="${x.key}" ${on.includes(x.key) ? 'checked' : ''}> ${x.label}</label>`).join('');
const ticked = cls => [...document.querySelectorAll('.' + cls + ':checked')].map(e => e.value);

function optionsHtml() {
  const g = $('graphic').value;
  if (g === 'liveteam') return `<small class="hint">Pipáld be, mely statisztikák látsszanak (ha nincs kipipálva semmi: az alapcsomag):</small><div class="ticks">${tick('tStat', LIVE_TEAM_STATS, S.teamStats || [])}</div>`;
  if (g === 'liveleaders') return `<small class="hint">Mindkét csapat három legjobb VAL-értékű játékosa (alap: PTS, REB, AST). Pipáld be, mely statisztikák látsszanak:</small><div class="ticks">${tick('lStat', LIVE_STATS, S.leaderStats || [])}</div>`;
  const pl = S.players.filter(p => p.side === S.side);
  return `<div class="grid"><label>Csapat<select id="side"><option value="home" ${S.side === 'home' ? 'selected' : ''}>Hazai${S.teams ? ' – ' + esc(S.teams.home) : ''}</option><option value="away" ${S.side === 'away' ? 'selected' : ''}>Vendég${S.teams ? ' – ' + esc(S.teams.away) : ''}</option></select></label>
    <label>Játékos<select id="player">${pl.length ? pl.map(p => `<option value="${esc(p.code)}" ${p.code === S.player ? 'selected' : ''}>${esc((p.number ? '#' + p.number + ' ' : '') + p.name)}</option>`).join('') : '<option value="">(a meccs betöltése után)</option>'}</select></label>
    <label>Hely a képen<select id="corner">${Object.entries(LIVE_CORNERS).map(([k, v]) => `<option value="${k}" ${S.corner === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
    <label>Kész csomag<select id="variant"><option value="">Saját (pipák)</option>${Object.entries(LIVE_VARIANTS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select></label></div>
    <div class="ticks">${tick('pStat', LIVE_STATS, S.stats || [])}</div>
    <small class="hint">A játékos-betét egy játékost mutat: másik játékosnál másik linket (vagy forrást) használj.</small>`;
}
function readOptions() {
  const g = $('graphic').value;
  if (g === 'liveteam') S.teamStats = ticked('tStat');
  if (g === 'liveleaders') S.leaderStats = ticked('lStat');
  if (g === 'livestat') {
    S.side = $('side')?.value || S.side; S.player = $('player')?.value || S.player; S.corner = $('corner')?.value || S.corner;
    const v = $('variant')?.value; S.stats = v ? liveKeys(v) : ticked('pStat');
  }
}
function link() {
  const game = gameCode($('game').value);
  if (!game) return '';
  const g = $('graphic').value;
  const q = overlayQuery({ game, graphic: g, token: $('token').value.trim(), live: { side: S.side, player: S.player, corner: S.corner, stats: S.stats || [], teamStats: S.teamStats || [], leaderStats: S.leaderStats || [] } });
  return new URL(`overlay.html?${q}`, location.href).href;
}
function refresh() {
  const url = link();
  $('link').value = url || 'Adj meg egy meccs-linket vagy kódot.';
  $('copy').disabled = !url;
  const f = $('prev');
  if (url && f.dataset.url !== url) { f.dataset.url = url; f.style.width = '1920px'; f.style.height = '1080px'; f.src = url; }
  if (!url) f.removeAttribute('src');
  fitPreview();
}
function fitPreview() { const w = $('prevWrap').clientWidth || 960, k = Math.min(1, w / 1920); $('prev').style.transform = `scale(${k})`; $('prevWrap').style.height = `${1080 * k}px`; }
addEventListener('resize', fitPreview);

async function loadGame() {
  const game = gameCode($('game').value); S.players = []; S.teams = null;
  ls.set('nbia.live.game', $('game').value);
  if (!game) { $('gameInfo').textContent = ''; return refreshAll(); }
  $('gameInfo').textContent = 'Betöltés…';
  try {
    const tk = $('token').value.trim();
    const r = await fetch(`../live?game=${game}&kind=full${tk ? '&token=' + encodeURIComponent(tk) : ''}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status === 403 ? 'hibás vagy hiányzó kulcs' : `a kiszolgáló ${r.status}`);
    const g = parseGame(decodeFeed(await r.text()), game);
    if (!g) throw new Error('a hírcsatorna nem értelmezhető');
    S.teams = { home: g.teams.home.short, away: g.teams.away.short };
    S.players = ['home', 'away'].flatMap(side => playedPlayers(g, side).map(p => ({ ...p, side })));
    S.player = S.players.find(p => p.side === S.side)?.code || '';
    $('gameInfo').textContent = `${g.teams.home.short} ${g.score.home}–${g.score.away} ${g.teams.away.short} (${gameLeague(game) === 'women' ? 'női' : 'férfi'}) – a link akkor is jó, ha a meccs még nem kezdődött el.`;
  } catch (e) { $('gameInfo').textContent = `A meccs adatai most nem tölthetők be (${e.message}); a link ettől még elkészül.`; }
  refreshAll();
}
function refreshAll() { $('opts').innerHTML = optionsHtml(); refresh(); }

$('graphic').onchange = () => { ls.set('nbia.live.graphic', $('graphic').value); refreshAll(); };
$('opts').addEventListener('change', e => { if (e.target.id === 'side') { S.side = e.target.value; S.player = S.players.find(p => p.side === S.side)?.code || ''; readOptions(); $('opts').innerHTML = optionsHtml(); } else readOptions(); refresh(); });
$('game').onchange = loadGame;
$('token').onchange = () => { ls.set('nbia.live.token', $('token').value.trim()); loadGame(); };
$('copy').onclick = async () => { try { await navigator.clipboard.writeText($('link').value); $('copied').textContent = 'Kimásolva.'; } catch { $('link').select(); $('copied').textContent = 'Jelöld ki és másold (Ctrl+C).'; } };
loadGame();
