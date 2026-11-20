import { loadDashboard, LEAGUES, SOURCES } from './data.js';
import { readFile } from './xlsx.js';
import { importWorkbook, detectLeague, clubLabel } from './importer.js';
import { club, CLUBS } from './clubs.js';
import { TEMPLATES, TEMPLATE_TYPES, templateById } from './templates.js';
import { render, loadFonts, measure, logoOutlines } from './engine.js';
import {
  bindComparison, bindTeamstats, bindRowList, bindIntro, bindReferees, COMPETITIONS, MISSING, fmtDate, teamstatPlayers,
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
}, lsGet(LS.state, {}));
let store = null;
let fontsOk = false;
const images = {};
const measureCanvas = document.createElement('canvas').getContext('2d');
let lastReport = null;
let outlines = {};

const saveState = () => lsSet(LS.state, { league: state.league, template: state.template, sel: state.sel, overrides: state.overrides, zoom: state.zoom });
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
  ]);
}

const tpl = () => templateById(state.template[state.league]);
const sel = () => state.sel[state.league];
const ovKey = () => tpl().id;
const overrides = () => (state.overrides[ovKey()] ||= {});

// ───────────────────────── freshness ─────────────────────────
function renderFreshness() {
  const lg = state.league;
  const f = store.freshness(lg);
  const names = { fixtures: 'Menetrend', standings: 'Tabella', teamStats: 'Csapatstat', players: 'Játékosstat' };
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
    <img src="templates/${t.id}/thumb.jpg" alt="" loading="lazy"><span>${esc(TEMPLATE_TYPES[t.type])}</span></button>`).join('');
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
  if (t.type === 'intro' || t.type === 'comparison') {
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
    $('selectTitle').textContent = '2. Mérkőzés (fájlnévhez)';
    const games = store.upcoming(lg);
    box.innerHTML = `<label>Mérkőzés<select id="matchSel">${games.map(m => `<option value="${esc(matchKey(m))}" ${matchKey(m) === s.matchKey ? 'selected' : ''}>${esc(matchLabel(m))}</option>`).join('')}</select></label>`;
    $('matchSel').onchange = e => { s.matchKey = e.target.value; s.custom = null; update(true); };
  } else {
    $('selectTitle').textContent = '2. Csapat';
    box.innerHTML = `<label>Csapat<select id="teamSel">${teamOptions(s.teamId)}</select></label>${extra.players || ''}`;
    $('teamSel').onchange = e => { s.teamId = e.target.value; s.players = null; resetMatchOverrides(); update(true); };
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
  if (t.type === 'comparison' || t.type === 'intro') {
    const m = currentMatch();
    if (!m) { info.notices.push({ bad: true, text: 'Nincs kiválasztható mérkőzés ebben a bajnokságban.' }); return { v, info }; }
    if (t.type === 'comparison') v = bindComparison(store, lg, m.homeId, m.awayId);
    else v = bindIntro(store, lg, m, lsGet(LS.venues, {}));
    if (m.custom && t.type === 'intro') info.notices.push({ text: 'Egyéni párosítás: a forduló és az időpont nem az adatokból jön – írd be kézzel.' });
  } else if (t.type === 'teamstats') {
    const r = bindTeamstats(store, lg, s.teamId, t, measureFn, s.players);
    v = r.values;
    info.players = r.players; info.shown = r.shown;
    if (r.hidden > 0) info.notices.push({ text: `${r.players.length} játékos van az adatokban, a sablonon ${t.rows} sor fér el. ${r.hidden} játékos nem látszik (alapból a legkevesebb percet játszók) – a listában módosíthatod.` });
  } else if (t.type === 'results' || t.type === 'schedule' || t.type === 'resultrows') {
    const r = bindRowList(store, lg, s.teamId, t);
    v = r.values;
    if (r.missingResults.length) info.notices.push({ bad: true, text: `Az adatokból hiányzik ${r.missingResults.length} lejátszott mérkőzés eredménye (${r.missingResults.join(', ')}). Ellenőrizd a menetrend frissességét, és szükség esetén írd be kézzel.` });
    if (r.games.length < t.rows) info.notices.push({ text: `Csak ${r.games.length} NB I/A mérkőzés van az adatokban – a további sorok üresek (kézzel kitölthetők, pl. európai kupameccsek).` });
    info.notices.push({ text: 'Az adatbázis csak NB I/A mérkőzéseket tartalmaz. Európai kupa- és kupameccseket kézzel kell beírni; a sorozat logója soronként választható.' });
  } else if (t.type === 'referees') {
    v = bindReferees();
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
    if (el.type === 'image') {
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
  if (t.type === 'intro' || t.type === 'comparison' || t.type === 'referees') {
    const m = currentMatch();
    who = m ? `${club(lg, m.homeId)?.short}-${club(lg, m.awayId)?.short}` : 'meccs';
  } else who = club(lg, s.teamId)?.short || 'csapat';
  const date = new Date().toISOString().slice(0, 10);
  const ascii = x => x.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '_').replace(/_+/g, '_');
  return ascii(`${LEAGUES[lg].short}_${TEMPLATE_TYPES[t.type]}_${who}_${date}`) + '.png';
}

async function update(full) {
  const t = tpl();
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
    renderSelection({ players: playersHtml });
    renderFields(values, auto);
    $('fileName').value = fileName(values);
  }
  $('notices').innerHTML = info.notices.map(n => `<div class="notice ${n.bad ? 'bad' : ''}">${esc(n.text)}</div>`).join('');
  const bg = await loadImage('bg/' + t.id, t.background);
  const canvas = $('canvas');
  lastReport = render(canvas, t, values, { background: bg, images, outlines });
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
  $('importState').textContent = xi ? `– ${xi.teams} csapat, ${xi.playerTeams} csapat játékosai (${xi.files.length} fájl)` : '';
  $('excelOn').checked = xi ? xi.enabled : true;
  $('excelOn').disabled = !xi;
  $('excelClear').disabled = !xi;
}

function previewImports() {
  const html = pendingImports.map(({ file, league, imp, certain }) => {
    const rows = imp.report.map(r => `<tr><td>${esc(r.sheet)}</td><td>${esc(r.status)}${r.club ? ' → ' + esc(clubLabel(league, r.club)) : ''}</td><td>${r.rows ?? ''}</td><td>${esc(r.note || (r.columns || []).join(', '))}</td></tr>`).join('');
    const useful = imp.teamCount + imp.playerTeamCount;
    return `<div><b>${esc(file.name)}</b> → <b>${esc(LEAGUES[league]?.label || '?')}</b>${certain ? '' : ' <span class="warn">(a bajnokság nem volt egyértelmű – a most kiválasztottat használom)</span>'}</div>
      <table><tr><th>Munkalap</th><th>Felismerve</th><th>Sor</th><th>Oszlopok / megjegyzés</th></tr>${rows}</table>
      ${imp.teamCount ? `<div class="ok">Csapatstatisztika: ${imp.teamCount} csapat</div>` : ''}
      ${imp.playerCount ? `<div class="ok">Játékosok: ${imp.playerCount} játékos, ${imp.playerTeamCount} csapat</div>` : ''}
      ${imp.scaled.length ? `<div class="warn">Törtként tárolt százalék szorozva 100-zal: ${esc(imp.scaled.join(', '))}</div>` : ''}
      ${imp.unmatched.length ? `<div class="warn">Nem egyeztethető (kihagyva, nem találgatok):<ul>${imp.unmatched.slice(0, 8).map(u => `<li>${esc(u)}</li>`).join('')}</ul></div>` : ''}
      ${imp.ignoredColumns.length ? `<div class="hint">Nem használt oszlopok: ${imp.ignoredColumns.length} db (${esc(imp.ignoredColumns.slice(0, 6).join(', '))}…)</div>` : ''}
      ${useful === 0 ? '<div class="warn">Nem találtam használható adatot ebben a fájlban.</div>' : ''}`;
  }).join('<hr>');
  const any = pendingImports.some(p => p.imp.teamCount + p.imp.playerTeamCount > 0);
  $('importPreview').innerHTML = html + (any ? '<div class="import-row"><button id="applyImport" class="primary">Alkalmazás</button><button id="cancelImport" class="ghost">Mégse</button></div>' : '<div class="import-row"><button id="cancelImport" class="ghost">Bezárás</button></div>');
  const ap = $('applyImport');
  if (ap) ap.onclick = async () => {
    for (const { file, league, imp } of pendingImports) if (imp.teamCount + imp.playerTeamCount > 0) store.mergeExcel(league, imp, file);
    const first = pendingImports.find(p => p.imp.teamCount + p.imp.playerTeamCount > 0);
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
        pendingImports.push({ file: { name: f.name }, league: state.league, certain: false, imp: { report: [{ sheet: f.name, status: 'hiba', note: err.message }], teamCount: 0, playerTeamCount: 0, playerCount: 0, scaled: [], unmatched: [], ignoredColumns: [] } });
      }
    }
    if (files.length) previewImports();
    e.target.value = '';
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
