import { loadDashboard, LEAGUES, SOURCES, gameKey } from './data.js';
import { readFile } from './xlsx.js';
import { importWorkbook, detectLeague, clubLabel, parseEredmenyekText, compKey } from './importer.js';
import { club, CLUBS, clubIdStrict } from './clubs.js';
import { TEMPLATES, TEMPLATE_TYPES, templateById } from './templates.js';
import { render, loadFonts, measure, logoOutlines } from './engine.js';
import {
  bindComparison, bindTeamstats, bindRowList, bindIntro, bindNextMatch, bindReferees, COMPETITIONS, MISSING, fmtDate, teamstatPlayers,
} from './binders.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = { state: 'nbia.studio.state.v1', presets: 'nbia.studio.presets.v1', venues: 'nbia.studio.venues.v1', excel: 'nbia.studio.excel.v1' };
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
let fontsOk = false;
const images = {};
const measureCanvas = document.createElement('canvas').getContext('2d');
let lastReport = null;
let outlines = {};

const saveState = () => lsSet(LS.state, { league: state.league, template: state.template, sel: state.sel, overrides: state.overrides, zoom: state.zoom, baseOpacity: state.baseOpacity });
const toast = msg => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); };

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

const tpl = () => templateById(state.template[state.league]);
const s0 = () => state.sel[state.league];
const sel = () => state.sel[state.league];
const ovKey = () => tpl().id;
const overrides = () => (state.overrides[ovKey()] ||= {});

// ───────────────────────── freshness ─────────────────────────
function renderFreshness() {
  const lg = state.league;
  const f = store.freshness(lg);
  const names = { fixtures: 'Menetrend', referees: 'Játékvezetők', standings: 'Tabella', teamStats: 'Csapatstat', players: 'Játékosstat' };
  const fmt = iso => { const d = new Date(iso); return d.toLocaleString('hu-HU', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); };
  const parts = Object.keys(SOURCES).map(k => {
    const x = f[k];
    if (!x) return `<span class="err" title="Nem tölthető be">${names[k]}: hiányzik</span>`;
    const age = x.hours === null ? '?' : x.hours < 1 ? '<1 ó' : x.hours < 48 ? `${Math.round(x.hours)} ó` : `${Math.round(x.hours / 24)} nap`;
    return `<span class="${x.stale ? 'stale' : ''}" title="Frissítve: ${esc(x.updated_at)}">${names[k]}: ${fmt(x.updated_at)} (${age})</span>`;
  });
  const xi = store.excelInfo(lg);
  if (xi) parts.push(`<span class="${xi.enabled ? '' : 'stale'}" title="${esc(xi.file)} – módosítva: ${esc(xi.modified || '?')}">Excel: ${esc(xi.file)} (${xi.modified ? fmt(xi.modified) : 'ismeretlen dátum'})${xi.enabled ? '' : ' – kikapcsolva'}</span>`);
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

function renderSelection(extra = {}) {
  const t = tpl(), s = sel(), lg = state.league;
  const box = $('selection');
  if (t.type === 'intro' || t.type === 'comparison' || t.type === 'nextmatch') {
    $('selectTitle').textContent = '2. Mérkőzés';
    const showPast = !!s.showPast;
    const games = showPast ? store.league(lg).fixtures : store.upcoming(lg);
    box.innerHTML = `
      <label>Mérkőzés (${showPast ? 'teljes menetrend' : 'következő mérkőzések'})
        <select id="matchSel">${games.map(m => `<option value="${esc(matchKey(m))}" ${matchKey(m) === s.matchKey && !s.custom ? 'selected' : ''}>${esc(matchLabel(m))}${m.resultMissing ? ' – eredmény hiányzik az adatokból' : ''}</option>`).join('')}
        <option value="__custom" ${s.custom ? 'selected' : ''}>Egyéni párosítás…</option></select></label>
      <label style="flex-direction:row;display:flex;gap:6px;align-items:center"><input type="checkbox" id="showPast" ${showPast ? 'checked' : ''}> Lejátszott mérkőzések is</label>
      ${s.custom ? `<div class="row2"><label>Hazai<select id="customHome">${teamOptions(s.custom.homeId)}</select></label><label>Vendég<select id="customAway">${teamOptions(s.custom.awayId)}</select></label></div>` : ''}`;
    $('matchSel').onchange = e => {
      if (e.target.value === '__custom') { const m = currentMatch(); s.custom = { homeId: m?.homeId || Object.keys(CLUBS[lg])[0], awayId: m?.awayId || Object.keys(CLUBS[lg])[1] }; }
      else { s.custom = null; s.matchKey = e.target.value; }
      resetMatchOverrides(); update(true);
    };
    $('showPast').onchange = e => { s.showPast = e.target.checked; renderSelection(); };
    if (s.custom) {
      $('customHome').onchange = e => { s.custom.homeId = e.target.value; resetMatchOverrides(); update(true); };
      $('customAway').onchange = e => { s.custom.awayId = e.target.value; resetMatchOverrides(); update(true); };
    }
  } else if (t.type === 'referees') {
    $('selectTitle').textContent = '2. Mérkőzés';
    const showPast = !!s.showPast, showOpen = !!s.showOpen;
    const hasRefs = m => !!store.matchStaff(lg, m)?.referees?.length;
    let games = showPast ? store.league(lg).fixtures : store.upcoming(lg);
    const withRefs = games.filter(hasRefs);
    // by default only games whose referees are already published: nothing to type, the names come from Hunbasket
    if (!showOpen) games = withRefs;
    if (!s.matchKey || !games.some(m => matchKey(m) === s.matchKey)) s.matchKey = games[0] ? matchKey(games[0]) : null;
    const last = store.upcoming(lg).filter(hasRefs).at(-1);
    const info = last ? `A játékvezetők ${fmtDate(last.date)}-ig vannak kiírva (${store.upcoming(lg).filter(hasRefs).length} következő meccsnél). A többi meccsé a Hunbaskeren még nem jelent meg; félóránként frissül.` : 'Egyik következő meccshez sincs még kiírva játékvezető a Hunbaskeren.';
    box.innerHTML = `<label>Mérkőzés – csak ahol már ki vannak írva a játékvezetők${showOpen ? ' (a ✓ nélküliek kézi beírást igényelnek)' : ''}<select id="matchSel">${games.map(m => `<option value="${esc(matchKey(m))}" ${matchKey(m) === s.matchKey ? 'selected' : ''}>${esc(matchLabel(m))}${hasRefs(m) ? '' : ' – nincs kiírva'}</option>`).join('') || '<option value="">Nincs ilyen mérkőzés</option>'}</select></label>
      <div class="hint">${esc(info)}</div>
      <label style="flex-direction:row;display:flex;gap:6px;align-items:center"><input type="checkbox" id="showPast" ${showPast ? 'checked' : ''}> Lejátszott mérkőzések is</label>
      <label style="flex-direction:row;display:flex;gap:6px;align-items:center"><input type="checkbox" id="showOpen" ${showOpen ? 'checked' : ''}> Kiírás nélküli meccsek is (kézi beírással)</label>`;
    $('matchSel').onchange = e => { s.matchKey = e.target.value; s.custom = null; resetMatchOverrides(); update(true); };
    $('showPast').onchange = e => { s.showPast = e.target.checked; renderSelection(); update(true); };
    $('showOpen').onchange = e => { s.showOpen = e.target.checked; renderSelection(); update(true); };
  } else {
    $('selectTitle').textContent = '2. Csapat';
    box.innerHTML = `<label>Csapat<select id="teamSel">${teamOptions(s.teamId)}</select></label>${extra.players || ''}${extra.games || ''}`;
    $('teamSel').onchange = e => { s.teamId = e.target.value; s.players = null; s.games = null; resetMatchOverrides(); update(true); };
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
      $('gamesAuto').onclick = () => { (s.games ||= {})[group] = null; update(true); };
      box.querySelectorAll('.gamelist input').forEach(cb => cb.onchange = () => {
        const keys = [...box.querySelectorAll('.gamelist input:checked')].map(x => x.value);
        if (keys.length > t.rows) { cb.checked = false; toast(`Legfeljebb ${t.rows} mérkőzés fér el a sablonon.`); return; }
        (s.games ||= {})[group] = keys; update(true);
      });
    }
    if (extra.players) {
      box.querySelectorAll('.players input').forEach(cb => cb.onchange = () => {
        const keys = [...box.querySelectorAll('.players input:checked')].map(x => x.value);
        if (keys.length > t.rows) { cb.checked = false; toast(`Legfeljebb ${t.rows} játékos fér el a sablonon.`); return; }
        s.players = keys; update(false);
      });
    }
  }
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
  let v = {};
  if (t.type === 'comparison' || t.type === 'intro' || t.type === 'nextmatch') {
    const m = currentMatch();
    if (!m) { info.notices.push({ bad: true, text: 'Nincs kiválasztható mérkőzés ebben a bajnokságban.' }); return { v, info }; }
    if (t.type === 'nextmatch') v = bindNextMatch(store, lg, m);
    else if (t.type === 'comparison') v = bindComparison(store, lg, m.homeId, m.awayId);
    else v = bindIntro(store, lg, m, lsGet(LS.venues, {}));
    if (m.custom && t.type === 'intro') info.notices.push({ text: 'Egyéni párosítás: a forduló és az időpont nem az adatokból jön – írd be kézzel.' });
  } else if (t.type === 'teamstats') {
    const r = bindTeamstats(store, lg, s.teamId, t, measureFn, s.players);
    v = r.values;
    info.players = r.players; info.shown = r.shown;
    if (r.hidden > 0) info.notices.push({ text: `${r.players.length} játékos van az adatokban, a sablonon ${t.rows} sor fér el. ${r.hidden} játékos nem látszik (alapból a legkevesebb percet játszók) – a listában módosíthatod.` });
  } else if (t.type === 'results' || t.type === 'schedule' || t.type === 'resultrows') {
    const r = bindRowList(store, lg, s.teamId, t, s.games?.[t.type === 'schedule' ? 'schedule' : 'results'] || null);
    v = r.values;
    info.games = r.games; info.candidates = r.candidates;
    if (r.missingResults.length) info.notices.push({ bad: true, text: `Az adatokból hiányzik ${r.missingResults.length} lejátszott mérkőzés eredménye (${r.missingResults.join(', ')}). Ellenőrizd a menetrend frissességét, és szükség esetén írd be kézzel.` });
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
  if (stale.length && t.type !== 'referees') info.notices.push({ text: `Régi adat (48 óránál régebbi): ${stale.join(', ')}. Adás előtt ellenőrizd az értékeket.` });
  return { v, info };
}

function mergedValues(auto) {
  const o = overrides(), out = {};
  for (const el of tpl().elements) {
    const a = auto[el.id] || (el.defaultText ? { text: el.defaultText } : {});
    const x = { ...a };
    const ov = o[el.id] || {};
    if (ov.text !== undefined) {
      if (el.runs && a.runs) x.runs = [...a.runs.slice(0, -1), { ...a.runs[a.runs.length - 1], text: ov.text }];
      x.text = ov.text; x.missing = false; x.overridden = true;
    }
    if (ov.color) { x.color = ov.color; x.overridden = true; }
    if (ov.src !== undefined) { x.src = ov.src; x.overridden = true; }
    if (ov.visible !== undefined) x.visible = ov.visible;
    if (el.runs && !x.runs && x.text !== undefined) x.runs = [{ text: x.text }];
    out[el.id] = x;
  }
  return out;
}

// ───────────────────────── fields ─────────────────────────
function editableText(el, v) {
  if (el.runs && v.runs) return v.runs[v.runs.length - 1].text;
  return v.text === MISSING ? '' : v.text ?? '';
}

function renderFields(values, auto) {
  const t = tpl(), o = overrides();
  const only = $('onlyMissing').checked;
  let html = '', group = null;
  for (const el of t.elements) {
    const v = values[el.id], a = auto[el.id] || {};
    const ov = o[el.id] || {};
    const isOv = ov.text !== undefined || ov.color || ov.src !== undefined || ov.visible !== undefined;
    const missing = v.missing && !isOv;
    if (only && !missing && !isOv) continue;
    if (el.group !== group) { group = el.group; html += `<div class="group-title">${esc(group)}</div>`; }
    const visible = v.visible ?? el.visible ?? true;
    const autoTxt = el.type === 'image' ? (a.src ? (a.src.startsWith('comp/') ? COMPETITIONS[a.src] : club(state.league, a.src.split('/')[1])?.official || a.src) : 'nincs') : (el.runs && a.runs ? a.runs.at(-1).text : a.text ?? '');
    html += `<div class="field ${missing ? 'missing' : ''} ${isOv ? 'overridden' : ''}" data-id="${esc(el.id)}">
      <input type="checkbox" class="vis" title="Látható" ${visible ? 'checked' : ''}>
      <div class="lbl"><span>${esc(el.label || el.id)}</span><em title="${esc(a.source || '')}">${esc(a.source || '')}</em></div>`;
    if (el.type === 'image' && el.fixedSrc) {
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
    }
    if (missing) html += `<div class="flag">Hiányzó adat – az adásban „${MISSING}” jelenne meg.</div>`;
    if (a.note) html += `<div class="note">${esc(a.note)}</div>`;
    html += '</div>';
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
  else if (e.target.classList.contains('reset')) { delete o[id]; update(true); return; }
  else return;
  if (!Object.keys(cur).length) delete o[id];
  // live state of the field row while typing
  const v = current.auto?.[id] || {};
  f.classList.toggle('overridden', !!o[id] && (o[id].text !== undefined || !!o[id].color || o[id].src !== undefined || o[id].visible !== undefined));
  f.classList.toggle('missing', !!v.missing && !(o[id] && o[id].text !== undefined));
  const flag = f.querySelector('.flag');
  if (flag) flag.hidden = !f.classList.contains('missing');
  // remember venues per home team
  if (id === 'venue' && tpl().type === 'intro' && e.type === 'change') {
    const m = currentMatch();
    if (m && cur.text) { const vs = lsGet(LS.venues, {}); vs[`${state.league}/${m.homeId}`] = cur.text; lsSet(LS.venues, vs); }
  }
  update(e.type === 'change' && !e.target.classList.contains('txt'));
}

// ───────────────────────── render ─────────────────────────
let current = { values: null };

function fileName(values) {
  const t = tpl(), lg = state.league, s = sel();
  let who;
  if (t.type === 'intro' || t.type === 'comparison' || t.type === 'referees' || t.type === 'nextmatch') {
    const m = currentMatch();
    who = m ? `${club(lg, m.homeId)?.short}-${club(lg, m.awayId)?.short}` : 'meccs';
  } else who = club(lg, s.teamId)?.short || 'csapat';
  const date = new Date().toISOString().slice(0, 10);
  const ascii = x => x.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '_').replace(/_+/g, '_');
  return ascii(`${LEAGUES[lg].short}_${TEMPLATE_TYPES[t.type]}_${who}_${date}`) + '.png';
}

async function update(full) {
  const t = tpl();
  renderBaseOpacity();
  document.body.classList.toggle('women', state.league === 'women');
  const { v: auto, info } = autoValues();
  const values = mergedValues(auto);
  current = { values, auto };
  if (full) {
    let playersHtml = '';
    if (t.type === 'teamstats' && info.players?.length) {
      const shownKeys = new Set(info.shown.map(x => x.key));
      playersHtml = `<label>Megjelenő játékosok (max. ${t.rows})</label><div class="players">${info.players.map(x => `<label><input type="checkbox" value="${esc(x.key)}" ${shownKeys.has(x.key) ? 'checked' : ''}> #${esc(x.p['#'])} ${esc(x.p['Játékos'])} <small>(${esc(x.p['M.'])} m., ${esc(x.p['Idő'])} perc)</small></label>`).join('')}</div>`;
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
      gamesHtml = `${noCups ? '<div class="notice">Ennél a csapatnál még nincs kupa-/európai meccs. Add hozzá lent, vagy tölts fel lapot / illessz be szöveget az eredmenyek.com oldalról („Adatok feltöltése” a bal felső sarokban).</div>' : ''}${addForm}
        <label>Megjelenő mérkőzések (max. ${t.rows}) ${manual ? '<b>– kézi választás</b>' : '– automatikus'}</label>
        <div class="row2"><select id="gameFilter"><option value="all" ${filter === 'all' ? 'selected' : ''}>Mind</option><option value="nbia" ${filter === 'nbia' ? 'selected' : ''}>Csak NB I/A</option><option value="cup" ${filter === 'cup' ? 'selected' : ''}>Csak kupa-/európai</option></select>
        <button id="gamesAuto" class="ghost" ${manual ? '' : 'disabled'}>Automatikus (${sch ? 'következő' : 'legutóbbi'} ${t.rows})</button></div>
        <div class="players gamelist">${ordered.slice(0, 60).map(m => `<label><input type="checkbox" value="${esc(gameKey(m))}" ${shownKeys.has(gameKey(m)) ? 'checked' : ''}> ${esc(fmtDate(m.date))} ${esc(nameOf(m))}${m.score ? ' <small>(' + m.score.home + '-' + m.score.away + ')</small>' : ''}${m.cup ? ` <small>· ${esc(m.competition || 'kupa/európai')}</small> <button type="button" class="delcup" data-del="${esc(m.cupKey)}" title="Meccs törlése">✕</button>` : ''}</label>`).join('') || '<small>Nincs ilyen mérkőzés az adatokban.</small>'}</div>`;
    }
    renderSelection({ players: playersHtml, games: gamesHtml });
    renderFields(values, auto);
    $('fileName').value = fileName(values);
  }
  $('notices').innerHTML = info.notices.map(n => `<div class="notice ${n.bad ? 'bad' : ''}">${esc(n.text)}</div>`).join('');
  const bg = t.background ? await loadImage('bg/' + t.id, t.background) : null;
  const canvas = $('canvas');
  lastReport = render(canvas, t, values, { background: bg, images, outlines, baseOpacity: state.baseOpacity });
  if ($('showRef').checked) {
    const ref = await loadImage('ref/' + t.id, t.reference);
    const ctx = canvas.getContext('2d');
    ctx.save(); ctx.globalAlpha = 0.5; ctx.drawImage(ref, 0, 0); ctx.restore();
  }
  const missing = t.elements.filter(el => values[el.id]?.missing && (values[el.id].visible ?? el.visible ?? true));
  const msgs = [];
  if (missing.length) msgs.push(`${missing.length} hiányzó adat`);
  if (lastReport.overflow.length) msgs.push(`Túl hosszú szöveg (a minimális méreten sem fér el): ${lastReport.overflow.map(id => t.elements.find(e => e.id === id)?.label || id).join(', ')}`);
  if (lastReport.scaled.length) msgs.push(`Automatikusan kicsinyítve: ${lastReport.scaled.map(id => t.elements.find(e => e.id === id)?.label || id).join(', ')}`);
  $('renderReport').textContent = msgs.join(' · ');
  $('dims').textContent = `${canvas.width} × ${canvas.height} px · PNG, átlátszó háttér · forrás: ${t.psd}`;
  $('exportBtn').disabled = !fontsOk || $('showRef').checked;
  $('exportBtn').title = $('showRef').checked ? 'Kapcsold ki a PSD minta összevetést az exportáláshoz' : '';
  saveState();
}

function exportPng() {
  const t = tpl();
  const missing = t.elements.filter(el => current.values[el.id]?.missing && (current.values[el.id].visible ?? el.visible ?? true));
  if (missing.length && !confirm(`${missing.length} mező hiányzó adatot tartalmaz („${MISSING}”):\n${missing.slice(0, 12).map(e => '• ' + e.label).join('\n')}${missing.length > 12 ? '\n…' : ''}\n\nExportálod így is?`)) return;
  $('canvas').toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = $('fileName').value || 'grafika.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`Exportálva: ${a.download} (${t.width}×${t.height})`);
  }, 'image/png');
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

function renderImportState() {
  const xi = store.excelInfo(state.league);
  $('importState').textContent = xi ? `– ${xi.teams} csapat, ${xi.playerTeams} csapat játékosai${xi.cups ? `, ${xi.cups} kupameccs` : ''} (${xi.files.length} fájl)` : '';
  $('excelOn').checked = xi ? xi.enabled : true;
  $('excelOn').disabled = !xi;
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
      ${imp.unmatched.length ? `<div class="warn">Nem egyeztethető (kihagyva, nem találgatok):<ul>${imp.unmatched.slice(0, 8).map(u => `<li>${esc(u)}</li>`).join('')}</ul></div>` : ''}
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

function applyZoom() {
  document.querySelectorAll('[data-zoom]').forEach(b => b.classList.toggle('on', b.dataset.zoom === state.zoom));
  $('stage').classList.toggle('actual', state.zoom === '1');
}

async function main() {
  document.querySelectorAll('.league-toggle button').forEach(b => b.onclick = () => switchLeague(b.dataset.league));
  $('templateList').onclick = e => { const b = e.target.closest('button'); if (!b) return; state.template[state.league] = b.dataset.id; renderTemplateList(); update(true); };
  $('fields').addEventListener('input', onFieldEvent);
  $('fields').addEventListener('change', onFieldEvent);
  $('fields').addEventListener('click', e => { if (e.target.classList.contains('reset')) onFieldEvent(e); });
  $('onlyMissing').onchange = () => update(true);
  $('resetAll').onclick = () => { if (confirm('Törlöd ennek a sablonnak minden kézi felülírását?')) { state.overrides[ovKey()] = {}; update(true); } };
  $('exportBtn').onclick = exportPng;
  $('checker').onchange = e => $('stage').classList.toggle('checker', e.target.checked);
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
    const blob = new Blob([JSON.stringify({ presets: lsGet(LS.presets, []), venues: lsGet(LS.venues, {}) }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'grafika-studio-beallitasok.json'; a.click();
  };
  $('importPresets').onchange = async e => {
    try {
      const j = JSON.parse(await e.target.files[0].text());
      const list = lsGet(LS.presets, []);
      for (const p of j.presets || []) { const i = list.findIndex(x => x.name === p.name); if (i >= 0) list[i] = p; else list.push(p); }
      lsSet(LS.presets, list);
      lsSet(LS.venues, { ...lsGet(LS.venues, {}), ...(j.venues || {}) });
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
  $('quickCup').onclick = async () => {
    const lg = state.league;
    if (!['results', 'schedule', 'resultrows'].includes(tpl().type)) state.template[lg] = `schedule-${lg}`;
    sel().addOpen = true;
    renderTemplateList();
    await update(true);
    const box = $('addGame');
    if (box) { box.open = true; box.scrollIntoView({ block: 'center' }); $('agOpp')?.focus(); }
  };
  $('excelOn').onchange = e => { const x = store.excel[state.league]; if (x) { x.enabled = e.target.checked; persistExcel(); renderImportState(); renderFreshness(); update(true); } };
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
  window.__studio = { state, store, render: () => update(true), current: () => current, report: () => lastReport, fontsOk: () => fontsOk };
  await switchLeague(state.league, true);
  document.body.dataset.ready = '1';
}

main();
