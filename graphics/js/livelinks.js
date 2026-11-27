// The live builder (adásvezérlő): pick the game, click which graphic is on air and tick its statistics. The choice is stored on the server per game (/live-state);
// the ONE fixed link of the game in OBS follows it, so nothing has to be changed in OBS. The preview below is that very link (what the server sends).
import { gameCode, decodeFeed, parseGame, playedPlayers, applyOfficialNames, needsOfficialNames } from './live.js';
import { LIVE_STATS, LIVE_TEAM_STATS, LIVE_VARIANTS, LIVE_CORNERS, liveKeys, liveTeamKeys } from './templates.js';
import { OVERLAY_GRAPHICS, fixedLinkQuery, categoryLinkQuery, normOnAir, gameLeague } from './overlay-params.js';
import { LEADER_COLOR_DEFAULTS, LEADER_SHADOW_DEFAULT } from './binders.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = { get: k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } } };
const GRAPHICS = { ...OVERLAY_GRAPHICS, off: 'Nincs adásban' };
// the choice of this game; every graphic keeps its own ticks while the commentator switches between them
const S = { game: null, graphic: 'off', players: [], teams: null, side: 'home', player: '', corner: '', variant: '', stats: [], teamStats: [], leaderStats: [], leaderColors: {}, leaderOutlineOn: true, leaderShadowOn: true, leaderShadowSize: LEADER_SHADOW_DEFAULT, teamLook: 'outline' };
let pushTimer = null, loadSeq = 0, touchSeq = 0, lastGame = null, firstPick = false; // touchSeq rises with every click of the user: a slower reload of the saved state must never overwrite it

{ const qt = new URLSearchParams(location.search).get('token'); if (qt) ls.set('nbia.live.token', qt); } // the launcher prints a link that already carries the key
$('token').value = ls.get('nbia.live.token');
$('game').value = ls.get('nbia.live.game');

const tokenQ = () => { const t = $('token').value.trim(); return t ? `&token=${encodeURIComponent(t)}` : ''; };
const tick = (cls, list, on) => list.map(x => `<label><input type="checkbox" class="${cls}" value="${x.key}" ${on.includes(x.key) ? 'checked' : ''}> ${x.label}</label>`).join('');
const ticked = cls => [...document.querySelectorAll('.' + cls + ':checked')].map(e => e.value);

function onAirHtml() {
  $('onair').innerHTML = Object.entries(GRAPHICS).map(([k, v]) => `<button type="button" class="onairBtn ${S.graphic === k ? 'primary' : ''}" data-g="${k}" ${gameCode($('game').value) ? '' : 'disabled'}>${esc(v)}</button>`).join('');
}
function optionsHtml() {
  const g = S.graphic;
  if (g === 'liveteam') return `<small class="hint">Pipáld be, mely statisztikák látsszanak (a kipipáltak jelennek meg; alapból egy kész csomag van kipipálva):</small><div class="ticks">${tick('tStat', LIVE_TEAM_STATS, liveTeamKeys(S.teamStats))}</div>
    <label>A jobb / rosszabb érték jelölése<select id="teamLook"><option value="outline" ${S.teamLook === 'outline' ? 'selected' : ''}>Sötét háttér, vastag zöld / piros körvonal (alap)</option><option value="fill" ${S.teamLook === 'fill' ? 'selected' : ''}>Zöld / piros kitöltött doboz (régi)</option><option value="numbers" ${S.teamLook === 'numbers' ? 'selected' : ''}>Sötét háttér, zöld / piros számok (kipróbálás)</option></select></label>`;
  if (g === 'liveleaders') return `<small class="hint">Mindkét csapat három legjobb VAL-értékű játékosa (alap: PTS, REB, AST). Pipáld be, mely statisztikák látsszanak:</small><div class="ticks">${tick('lStat', LIVE_STATS, liveKeys(S.leaderStats))}</div>
    <small class="hint">Megjelenés (mindenhol egyformán, nem játékosonként):</small>
    <div class="grid">${[['name', 'Nevek'], ['label', 'Statisztika-nevek (PTS, REB…)'], ['value', 'Számok'], ['outline', 'Fotók körvonala']].map(([k, lab]) => `<label>${lab}<input type="color" class="lColor" data-k="${k}" value="${S.leaderColors[k] || LEADER_COLOR_DEFAULTS[k]}" style="width:60px;padding:0"></label>`).join('')}</div>
    <div class="ticks"><label><input type="checkbox" id="lOutlineOn" ${S.leaderOutlineOn !== false ? 'checked' : ''}> Körvonal a fotók körül</label> <label><input type="checkbox" id="lShadowOn" ${S.leaderShadowOn !== false ? 'checked' : ''}> Árnyék</label>
      <label>Árnyék mérete <input type="range" id="lShadowSize" min="0" max="40" step="1" value="${S.leaderShadowSize}" style="width:140px"> <output id="lShadowOut">${S.leaderShadowSize}</output> px</label>
      <button type="button" id="lReset" class="ghost">Színek visszaállítása (fehér)</button></div>`;
  if (g === 'livestat') {
    const pl = S.players.filter(p => p.side === S.side);
    return `<div class="grid"><label>Csapat<select id="side"><option value="home" ${S.side === 'home' ? 'selected' : ''}>Hazai${S.teams ? ' – ' + esc(S.teams.home) : ''}</option><option value="away" ${S.side === 'away' ? 'selected' : ''}>Vendég${S.teams ? ' – ' + esc(S.teams.away) : ''}</option></select></label>
      <label>Játékos<select id="player">${pl.length ? pl.map(p => `<option value="${esc(p.code)}" ${p.code === S.player ? 'selected' : ''}>${esc((p.number ? '#' + p.number + ' ' : '') + p.name)}</option>`).join('') : '<option value="">(a meccs betöltése után)</option>'}</select></label>
      <label>Hely a képen<select id="corner">${Object.entries(LIVE_CORNERS).map(([k, v]) => `<option value="${k}" ${(S.corner || 'gap') === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      <label>Kész csomag<select id="variant"><option value="">Saját (pipák)</option>${Object.entries(LIVE_VARIANTS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select></label></div>
      <div class="ticks">${tick('pStat', LIVE_STATS, liveKeys(S.stats.length ? S.stats : undefined))}</div>`;
  }
  return '<small class="hint">Most semmi nincs adásban: az OBS-forrás átlátszó marad. Kattints a fenti gombok egyikére.</small>';
}
function readOptions() {
  if (S.graphic === 'liveteam') { S.teamStats = ticked('tStat'); S.teamLook = ['outline', 'fill', 'numbers'].includes($('teamLook')?.value) ? $('teamLook').value : 'outline'; }
  if (S.graphic === 'liveleaders') {
    S.leaderStats = ticked('lStat');
    const c = {}; for (const e of document.querySelectorAll('.lColor')) if (e.value && e.value.toLowerCase() !== LEADER_COLOR_DEFAULTS[e.dataset.k]) c[e.dataset.k] = e.value.toLowerCase();
    S.leaderColors = { ...S.leaderColors, ...c }; for (const e of document.querySelectorAll('.lColor')) if (e.value.toLowerCase() === LEADER_COLOR_DEFAULTS[e.dataset.k]) delete S.leaderColors[e.dataset.k];
    S.leaderOutlineOn = !!$('lOutlineOn')?.checked; S.leaderShadowOn = !!$('lShadowOn')?.checked; S.leaderShadowSize = Number($('lShadowSize')?.value ?? S.leaderShadowSize);
  }
  if (S.graphic === 'livestat') {
    S.side = $('side')?.value || S.side; S.player = $('player')?.value || S.player; S.corner = $('corner')?.value || S.corner;
    const v = $('variant')?.value; S.stats = v ? liveKeys(v) : ticked('pStat');
  }
}
const payload = () => ({ graphic: S.graphic, side: S.side, player: S.player || undefined, corner: S.corner || undefined, stats: S.stats, teamStats: S.teamStats, leaderStats: S.leaderStats, leaderColors: S.leaderColors, leaderOutlineOn: S.leaderOutlineOn, leaderShadowOn: S.leaderShadowOn, leaderShadowSize: S.leaderShadowSize, teamLook: S.teamLook });

/** The choice goes to the server (a moment after the last click); the OBS overlay and the preview below pick it up by themselves. */
function pushSoon() { clearTimeout(pushTimer); pushTimer = setTimeout(push, 250); }
async function push() {
  const game = gameCode($('game').value);
  if (!game) return;
  try {
    const r = await fetch(`../live-state?game=${game}${tokenQ()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: payload() }) });
    if (!r.ok) throw new Error(r.status === 403 ? 'hibás vagy hiányzó kulcs' : `a kiszolgáló ${r.status}`);
    $('pushInfo').textContent = `Elküldve (${GRAPHICS[S.graphic]}) – az OBS-ben egy-két másodpercen belül megjelenik.`;
  } catch (e) { $('pushInfo').innerHTML = `<span style="color:var(--warn)">Nem sikerült elküldeni: ${esc(e.message)}. Az OBS-ben a régi grafika marad.</span>`; }
}

function fixedLink() {
  const game = gameCode($('game').value);
  return game ? new URL(`overlay.html?${fixedLinkQuery({ game, token: $('token').value.trim() })}`, location.href).href : '';
}
/** The three links of the categories under the main link (each with its own copy button). */
function categoryLinksHtml() {
  const game = gameCode($('game').value), token = $('token').value.trim();
  $('catLinks').innerHTML = Object.entries(OVERLAY_GRAPHICS).map(([g, label]) => {
    const url = game ? new URL(`overlay.html?${categoryLinkQuery({ game, graphic: g, token })}`, location.href).href : '';
    return `<label>${esc(label)}<input class="catLink" data-g="${g}" readonly value="${esc(url || 'Adj meg egy meccs-linket vagy kódot.')}"></label>
      <div class="import-row"><button type="button" class="catCopy" data-g="${g}" ${url ? '' : 'disabled'}>Link másolása</button></div>`;
  }).join('');
}
$('catLinks').addEventListener('click', async e => {
  const b = e.target.closest('.catCopy'); if (!b) return;
  const inp = $('catLinks').querySelector(`.catLink[data-g="${b.dataset.g}"]`);
  try { await navigator.clipboard.writeText(inp.value); b.textContent = 'Kimásolva.'; } catch { inp.select(); b.textContent = 'Jelöld ki és másold (Ctrl+C).'; }
  setTimeout(() => { b.textContent = 'Link másolása'; }, 2500);
});

function refreshView() {
  onAirHtml(); categoryLinksHtml(); $('opts').innerHTML = optionsHtml();
  const url = fixedLink(); $('link').value = url || 'Adj meg egy meccs-linket vagy kódot.'; $('copy').disabled = !url;
  const f = $('prev');
  if (url && f.dataset.url !== url) { f.dataset.url = url; f.style.width = '1920px'; f.style.height = '1080px'; f.src = url; } // the link never changes: the preview follows the server
  if (!url) { f.removeAttribute('src'); delete f.dataset.url; }
  fitPreview();
}
function fitPreview() { const w = $('prevWrap').clientWidth || 960, k = Math.min(1, w / 1920); $('prev').style.transform = `scale(${k})`; $('prevWrap').style.height = `${1080 * k}px`; }
addEventListener('resize', fitPreview);

/** What is already on air for this game (another laptop, an earlier visit): the controls start from it, unless the user has already clicked something in the meantime. */
async function loadState(game) {
  const t0 = touchSeq;
  try {
    const r = await fetch(`../live-state?game=${game}${tokenQ()}`, { cache: 'no-store' });
    if (!r.ok || t0 !== touchSeq) return;
    const j = await r.json(), n = normOnAir(j.state);
    if (t0 !== touchSeq) return;
    if (!(j.rev > 0)) { S.graphic = 'liveteam'; firstPick = true; return; } // nothing was ever put on air for this game: the team comparison is the default (owner 2026-11-27)
    S.graphic = n.graphic; S.side = n.live.side; S.player = n.live.player || ''; S.corner = n.live.corner || '';
    S.stats = n.live.stats || []; S.teamStats = n.live.teamStats || []; S.leaderStats = n.live.leaderStats || [];
    S.leaderColors = n.live.leaderColors || {}; S.leaderOutlineOn = n.live.leaderOutlineOn !== false; S.leaderShadowOn = n.live.leaderShadowOn !== false; S.leaderShadowSize = n.live.leaderShadowSize ?? LEADER_SHADOW_DEFAULT; S.teamLook = n.live.teamLook || 'outline';
  } catch { /* offline: start from nothing */ }
}
async function loadGame() {
  const game = gameCode($('game').value), seq = ++loadSeq;
  S.players = []; S.teams = null; S.game = game; if (S.game !== lastGame) { S.graphic = 'off'; S.side = 'home'; S.player = ''; S.corner = ''; S.stats = []; S.teamStats = []; S.leaderStats = []; S.leaderColors = {}; S.leaderOutlineOn = true; S.leaderShadowOn = true; S.leaderShadowSize = LEADER_SHADOW_DEFAULT; S.teamLook = 'outline'; lastGame = game; }
  ls.set('nbia.live.game', $('game').value); ls.set('nbia.live.token', $('token').value.trim());
  if (!game) { $('gameInfo').textContent = ''; S.graphic = 'off'; return refreshView(); }
  $('gameInfo').textContent = 'Betöltés…';
  firstPick = false;
  await loadState(game);
  if (seq !== loadSeq) return;
  refreshView();
  if (firstPick) { firstPick = false; push(); } // the default (team comparison) goes on air right away; a saved choice, also "Nincs adásban", is never replaced
  try {
    const r = await fetch(`../live?game=${game}&kind=full${tokenQ()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status === 403 ? 'hibás vagy hiányzó kulcs' : `a kiszolgáló ${r.status}`);
    const g = parseGame(decodeFeed(await r.text()), game);
    if (!g) throw new Error('a hírcsatorna nem értelmezhető');
    if (needsOfficialNames(g)) { try { const n = await fetch(`../mkosz?game=${game}${tokenQ()}`, { cache: 'no-store' }); if (n.ok) applyOfficialNames(g, (await n.json()).names); } catch { /* the feed's spelling stays */ } }
    if (seq !== loadSeq) return;
    S.teams = { home: g.teams.home.short, away: g.teams.away.short };
    S.players = ['home', 'away'].flatMap(side => playedPlayers(g, side).map(p => ({ ...p, side })));
    if (!S.players.some(p => p.code === S.player)) S.player = S.players.find(p => p.side === S.side)?.code || '';
    $('gameInfo').textContent = `${g.teams.home.short} ${g.score.home}–${g.score.away} ${g.teams.away.short} (${gameLeague(game) === 'women' ? 'női' : 'férfi'}) – a link akkor is jó, ha a meccs még nem kezdődött el.`;
  } catch (e) { $('gameInfo').textContent = `A meccs adatai most nem tölthetők be (${e.message}); a link ettől még elkészül.`; }
  refreshView();
}

$('onair').addEventListener('click', e => {
  const b = e.target.closest('.onairBtn'); if (!b) return;
  touchSeq++; S.graphic = b.dataset.g; refreshView(); pushSoon();
});
$('opts').addEventListener('change', e => {
  touchSeq++;
  if (e.target.id === 'side') { S.side = e.target.value; S.player = S.players.find(p => p.side === S.side)?.code || ''; $('opts').innerHTML = optionsHtml(); }
  readOptions(); pushSoon();
});
$('opts').addEventListener('input', e => { // the slider and the colour pickers act while they are moved (pushes are debounced)
  if (e.target.id === 'lShadowSize') $('lShadowOut').textContent = e.target.value;
  if (e.target.id === 'lShadowSize' || e.target.classList.contains('lColor')) { touchSeq++; readOptions(); pushSoon(); }
});
$('opts').addEventListener('click', e => { if (e.target.id === 'lReset') { touchSeq++; S.leaderColors = {}; $('opts').innerHTML = optionsHtml(); pushSoon(); } });
$('game').onchange = loadGame;
$('token').onchange = loadGame;
$('copy').onclick = async () => { try { await navigator.clipboard.writeText($('link').value); $('copied').textContent = 'Kimásolva.'; } catch { $('link').select(); $('copied').textContent = 'Jelöld ki és másold (Ctrl+C).'; } };

// Today's and the coming games of the two NB I/A leagues: the Hunbasket match address ends in the very code the netcasting feed uses (…/whun/whun_135579 → ?whun_135579)
async function loadSchedule() {
  const pick = $('gamePick'), rows = [], now = new Date(), from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1), to = new Date(+from + 9 * 864e5);
  for (const [lg, label] of [['men', 'Férfi'], ['women', 'Női']]) {
    try {
      const j = await (await fetch(`../data/${lg}.json`, { cache: 'no-store' })).json();
      for (const m of j.matches || []) {
        const d = String(m.date || '').match(/(\d{4})\.\s*(\d{2})\.\s*(\d{2})/), code = gameCode(m.url);
        if (!d || !code) continue;
        const dt = new Date(+d[1], +d[2] - 1, +d[3]);
        if (dt >= from && dt <= to) rows.push({ dt, code, text: `${label} · ${d[2]}.${d[3]}. ${m.time || ''} · ${m.home} – ${m.away}${m.status === 'finished' ? ' (vége)' : ''}` });
      }
    } catch { /* offline: the code can still be pasted */ }
  }
  rows.sort((a, b) => a.dt - b.dt || a.text.localeCompare(b.text, 'hu'));
  pick.innerHTML = `<option value="">${rows.length ? '– válassz meccset –' : '(nincs közelgő meccs az adatokban)'}</option>` + rows.map(r => `<option value="${r.code}">${esc(r.text)}</option>`).join('');
}
$('gamePick').onchange = e => { if (e.target.value) { $('game').value = e.target.value; loadGame(); } };
window.__builder = { state: () => ({ ...S }), link: () => $('link').value };
loadSchedule();
loadGame();
