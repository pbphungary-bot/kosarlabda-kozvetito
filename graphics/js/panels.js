// Side panels of the studio that are self-contained: player-special settings (columns, rows, move columns as units),
// background removal of uploaded photos (AI) and the Extra (MKOSZ) frames. Created once by app.js with the shared context.
import { psNormalize, PS_STATS, PS_MAX_COLS, PS_MAX_ROWS, PS_GROUPS } from './templates.js';
import { segment, compose } from './bgremove.js';

export function createPanels(ctx) {
  const { state, images, esc, tpl, update, renderSelection, renderInspector, renderLayoutState, renderOverlay, saveState, ovFor, effOf, elById, toast } = ctx;
  const $ = id => document.getElementById(id);
  // ───────────────────────── player special: settings ─────────────────────────
  function psConfig(s) { return psNormalize(state.league, s.psCfg); }
  function psSet(s, patch) {
    s.psCfg = { ...psConfig(s), ...patch };
    renderSelection(); update(true);
  }

  // ── move whole columns as units: tick the parts, then nudge them together (stored as the usual per-element moves, so "save as base" keeps them)
  function psUnits() {
    const out = [];
    for (const el of tpl().elements) if (el.type === 'text' && !out.some(u => u.name === el.group)) out.push({ name: el.group });
    for (const u of out) u.ids = tpl().elements.filter(e => e.type === 'text' && e.group === u.name).map(e => e.id);
    return out;
  }
  function psMoveHtml() {
    const on = state.psMove ||= new Set(), step = state.psStep || 10;
    const units = psUnits().map(u => `<label class="chk"><input type="checkbox" class="psUnit" data-g="${esc(u.name)}" ${on.has(u.name) ? 'checked' : ''}> ${esc(u.name === 'Sorok' ? 'Sorfeliratok' : u.name)}</label>`).join('');
    return `<label>Együtt mozgatás: jelöld ki, mit mozgass egyben (oszlop = fejléc + az összes száma), majd használd a nyilakat</label>
      <div class="psgroups">${units}</div>
      <div class="import-row psnudge"><button type="button" class="ghost" id="psAllUnits">Mind</button><button type="button" class="ghost" id="psNoUnits">Egyik sem</button>
        <label>Lépés (px) <input type="number" id="psStep" min="1" max="200" value="${step}"></label>
        <button type="button" data-d="-1,0" title="Balra">←</button><button type="button" data-d="0,-1" title="Fel">↑</button><button type="button" data-d="0,1" title="Le">↓</button><button type="button" data-d="1,0" title="Jobbra">→</button>
        <button type="button" class="ghost" id="psUnitReset" title="A kijelöltek vissza a PSD helyére">Kijelöltek helye: alap</button></div>`;
  }
  function wirePsMove() {
    const on = state.psMove ||= new Set();
    document.querySelectorAll('.psUnit').forEach(el => el.onchange = () => { el.checked ? on.add(el.dataset.g) : on.delete(el.dataset.g); });
    const units = () => psUnits().filter(u => on.has(u.name));
    $('psAllUnits').onclick = () => { psUnits().forEach(u => on.add(u.name)); document.querySelectorAll('.psUnit').forEach(c => { c.checked = true; }); };
    $('psNoUnits').onclick = () => { on.clear(); document.querySelectorAll('.psUnit').forEach(c => { c.checked = false; }); };
    $('psStep').onchange = e => { state.psStep = Math.max(1, Math.min(200, +e.target.value || 10)); };
    document.querySelectorAll('.psnudge [data-d]').forEach(b => b.onclick = () => {
      const us = units();
      if (!us.length) return toast('Jelölj ki legalább egy oszlopot / csoportot.');
      const [dx, dy] = b.dataset.d.split(',').map(Number), k = state.psStep || 10;
      for (const u of us) for (const id of u.ids) { const o = ovFor(id), e = effOf(id); o.dx = (e.dx || 0) + dx * k; o.dy = (e.dy || 0) + dy * k; }
      update(false); saveState(); renderInspector(); renderLayoutState();
    });
    $('psUnitReset').onclick = () => {
      for (const u of units()) for (const id of u.ids) Object.assign(ovFor(id), { dx: 0, dy: 0 });
      update(false); saveState(); renderInspector(); renderLayoutState();
    };
  }

  function psConfigHtml(s) {
    const c = psConfig(s), lg = state.league;
    const num = (id, v, min, max, step = 1) => `<input type="number" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}">`;
    const rowSel = c.rows.map((k, i) => `<label>${i + 1}. sor <select class="psRow" data-i="${i}">${Object.entries(PS_STATS).map(([key, d]) => `<option value="${key}" ${key === k ? 'selected' : ''}>${esc(d.label)}${d.made ? ' (bedobott/dobott + %)' : ''}</option>`).join('')}</select></label>`).join('');
    const groups = PS_GROUPS(c.cols).map(([k, label]) => `<label class="chk"><input type="checkbox" class="psFront" data-k="${k}" ${c.front[k] === false ? '' : 'checked'}> ${esc(label)}</label>`).join('');
    return `<details class="psbox" ${s.psOpen ? 'open' : ''} id="psBox"><summary>Grafika felépítése (oszlopok, sorok, fotó, rétegek)</summary>
      <div class="row2"><label>Oszlopok száma (1–${PS_MAX_COLS}) ${num('psCols', c.cols, 1, PS_MAX_COLS)}</label>
        <label>Sorok száma (1–${PS_MAX_ROWS}) ${num('psRows', c.rows.length, 1, PS_MAX_ROWS)}</label></div>
      <div class="row2"><label>Oszlopok a felirat előtt (bal oldalon) ${num('psLabelAfter', c.labelAfter, 0, c.cols)}</label>
        <label>Utolsó N meccs átlaga (ha van ilyen oszlop) ${num('psLastN', c.lastN, 1, 20)}</label></div>
      <label>Oszlopok adatforrása (a Hunbasket játékosoldalából; a „kézi” oszlopot te írod)</label>
      <div class="row2">${c.colSrc.map((k, i) => `<label>${i + 1}. oszlop <select class="psSrc" data-i="${i}">${[['manual', 'Kézi'], ['season', 'Idei átlag'], ['career', 'Karrier'], ['last', 'Utolsó N meccs']].map(([v, l]) => `<option value="${v}" ${v === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`).join('')}</div>
      <div class="row2">${rowSel}</div>
      <div class="row2"><label>Fotó magassága (px; 0 = a lehető legnagyobb) ${num('psPhotoH', c.photoH, 0, 1000)}</label>
        <label>Fotó közepének X helye (px) ${num('psPhotoCx', Math.round(c.photoCx), 0, 1400)}</label></div>
      <div class="row2"><label>Számok és feliratok betűmérete (px; 0 = automatikus) ${num('psFsRows', c.fsRows, 0, 300)}</label>
        <label>Fejlécek betűmérete (px; 0 = PSD) ${num('psFsHeaders', c.fsHeaders, 0, 300)}</label></div>
      <div class="row2"><label>Név betűmérete (px; 0 = PSD) ${num('psFsTitle', c.fsTitle, 0, 300)}</label>
        <label>Alcím betűmérete (px; 0 = PSD) ${num('psFsSub', c.fsSub, 0, 300)}</label></div>
      <small class="hint">Egyes elemek mérete külön is állítható a Mezők listában (Betűméret / Balra-jobbra / Fel-le).</small>
      <label>Réteg: a kipipált csoportok a <b>fotó előtt</b> jelennek meg, a többi a fotó mögött</label>
      <div class="psgroups">${groups}</div>
      ${psMoveHtml()}
      <div class="import-row"><button id="psReset" class="ghost">Alaphelyzet (${lg === 'men' ? 'férfi' : 'női'} design)</button></div>
    </details>`;
  }

  function wirePsConfig(s) {
    wirePsMove();
    $('psBox').ontoggle = e => { s.psOpen = e.target.open; };
    const n = (id, lo, hi) => Math.min(hi, Math.max(lo, Math.round(+$(id).value || 0)));
    $('psCols').onchange = () => { const cols = n('psCols', 1, PS_MAX_COLS), c = psConfig(s); psSet(s, { cols, labelAfter: Math.min(cols, c.labelAfter), colSrc: Array.from({ length: cols }, (_, i) => c.colSrc[i] || 'manual') }); };
    $('psRows').onchange = () => { const k = n('psRows', 1, PS_MAX_ROWS), c = psConfig(s); psSet(s, { rows: Array.from({ length: k }, (_, i) => c.rows[i] || 'pts') }); };
    $('psLabelAfter').onchange = () => psSet(s, { labelAfter: n('psLabelAfter', 0, psConfig(s).cols) });
    $('psLastN').onchange = () => psSet(s, { lastN: n('psLastN', 1, 20) });
    document.querySelectorAll('.psSrc').forEach(el => el.onchange = () => { const colSrc = [...psConfig(s).colSrc]; colSrc[+el.dataset.i] = el.value; psSet(s, { colSrc }); });
    for (const [id, key] of [['psFsRows', 'fsRows'], ['psFsHeaders', 'fsHeaders'], ['psFsTitle', 'fsTitle'], ['psFsSub', 'fsSub']]) $(id).onchange = () => psSet(s, { [key]: n(id, 0, 300) });
    $('psPhotoH').onchange = () => psSet(s, { photoH: n('psPhotoH', 0, 1000) });
    $('psPhotoCx').onchange = () => psSet(s, { photoCx: n('psPhotoCx', 0, 1400) });
    document.querySelectorAll('.psRow').forEach(el => el.onchange = () => { const rows = [...psConfig(s).rows]; rows[+el.dataset.i] = el.value; psSet(s, { rows }); });
    document.querySelectorAll('.psFront').forEach(el => el.onchange = () => psSet(s, { front: { ...psConfig(s).front, [el.dataset.k]: el.checked } }));
    $('psReset').onclick = () => { s.psCfg = null; renderSelection(); update(true); };
  }

  // ───────────────────────── background removal of uploaded photos (AI, in the browser) ─────────────────────────
  const bgState = {}; // key ('photo' | 'extraA') -> { orig, seg, cut }
  function bgHtml(key) {
    const st = bgState[key], has = !!images['upload/' + key];
    return `<div class="bgrow" data-k="${key}"><button type="button" class="bgGo" ${has ? '' : 'disabled'}>Háttér eltávolítása (AI)</button>
      <button type="button" class="bgUndo ghost" ${st?.seg ? '' : 'disabled'}>Eredeti kép vissza</button>
      <label>Vágás erőssége <input type="range" class="bgCut" min="0" max="100" value="${st?.cut ?? 50}" ${st?.seg ? '' : 'disabled'}></label>
      <small class="hint bgMsg">Az első használatkor egyszeri ~44 MB-os modellt tölt le, utána gyors; a kép nem hagyja el a böngészőt.</small></div>`;
  }
  function wireBg(key) {
    const row = document.querySelector(`.bgrow[data-k="${key}"]`);
    if (!row) return;
    const msg = t => { row.querySelector('.bgMsg').textContent = t; };
    const apply = () => { const st = bgState[key]; images['upload/' + key] = compose(st.seg, st.cut); update(false); };
    row.querySelector('.bgGo').onclick = async () => {
      const btn = row.querySelector('.bgGo'); btn.disabled = true;
      try {
        const orig = bgState[key]?.orig || images['upload/' + key];
        const seg = await segment(orig, { onStatus: msg });
        bgState[key] = { orig, seg, cut: bgState[key]?.cut ?? 50 };
        apply();
        renderSelection(); // buttons / slider enabled
        document.querySelector(`.bgrow[data-k="${key}"] .bgMsg`).textContent = 'Kész – a „Vágás erőssége” csúszkával finomíthatod a szélét.';
      } catch (e) { msg('Nem sikerült: ' + (e.message || e)); btn.disabled = false; }
    };
    row.querySelector('.bgUndo').onclick = () => { const st = bgState[key]; if (!st) return; images['upload/' + key] = st.orig; delete bgState[key]; renderSelection(); update(true); };
    row.querySelector('.bgCut').oninput = e => { bgState[key].cut = +e.target.value; apply(); };
  }

  // ───────────────────────── Extra (MKOSZ): photo frame + QR frame ─────────────────────────
  const EXTRA_FILLS = [['', 'Alap (barna)'], ['#ffffff', 'Fehér'], ['#000000', 'Fekete'], ['transparent', 'Átlátszó']];
  function extraPanelHtml(s) {
    const one = (k, id, title, hint, dflt) => {
      const c = s.extra?.[k] || {}, has = !!images['upload/extra' + k], fit = c.fit || dflt.fit;
      const b = ctx.lastReport()?.boxes?.[id], w = b ? Math.round(b[2]) : '', h = b ? Math.round(b[3]) : '';
      return `<fieldset class="xbox" data-k="${k}"><legend>${title}</legend>
        <label>${hint}<span class="import-row"><input type="file" class="xFile" accept="image/png,image/webp,image/jpeg"> <button type="button" class="xClear ghost" ${has ? '' : 'disabled'}>Kép törlése</button></span></label>
        ${k === 'A' ? bgHtml('extraA') : ''}
        <div class="row2"><label>Illesztés<select class="xFit"><option value="cover" ${fit === 'cover' ? 'selected' : ''}>Kitölti a keretet (levágva)</option><option value="contain" ${fit === 'contain' ? 'selected' : ''}>Egészben belefér</option></select></label>
          <label>Keret háttere<select class="xFill">${EXTRA_FILLS.map(([v, n]) => `<option value="${v}" ${(c.fill ?? '') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
        <div class="row2"><label>Kép nagyítása (%)<input type="number" class="xZoom" min="10" max="500" step="5" value="${c.zoom || 100}"></label>
          <label>Belső margó (px)<input type="number" class="xPad" min="0" max="200" step="2" value="${c.pad ?? dflt.pad}"></label></div>
        <div class="row2"><label>Kép balra / jobbra (px)<input type="number" class="xPx" step="2" value="${c.px || 0}"></label>
          <label>Kép fel / le (px)<input type="number" class="xPy" step="2" value="${c.py || 0}"></label></div>
        <div class="row2"><label>Keret szélessége (px)<input type="number" class="xW" min="40" max="1920" step="2" value="${w}"></label>
          <label>Keret magassága (px)<input type="number" class="xH" min="40" max="1080" step="2" value="${h}"></label></div></fieldset>`;
    };
    return `${one('A', 'frameA', 'Fotókeret', 'Fotó feltöltése (a kereten belül marad)', { fit: 'cover', pad: 0 })}
      ${one('B', 'frameB', 'QR-keret', 'QR-kód feltöltése', { fit: 'contain', pad: 14 })}
      <label class="inline"><input type="checkbox" id="xLock" ${state.lockAspect !== false ? 'checked' : ''}> Arány rögzítve (méretezéskor a keret ugyanúgy nő / fogy; kikapcsolva szabadon húzható)</label>
      <small class="hint">Mozgatás és húzással átméretezés: kapcsold be a szerkesztést (Elrendezés fül), kattints a keretre – a sarkain a fogantyúkkal méretezhetsz.</small>`;
  }
  function wireExtraPanel(s) {
    const box = $('selection');
    s.extra ||= { A: {}, B: {} };
    $('xLock').onchange = e => { state.lockAspect = e.target.checked; renderOverlay(); };
    wireBg('extraA');
    box.querySelectorAll('.xbox').forEach(fs => {
      const k = fs.dataset.k, id = k === 'A' ? 'frameA' : 'frameB', c = (s.extra[k] ||= {});
      const set = (key, val) => { c[key] = val; update(false); };
      fs.querySelector('.xFile').onchange = e => {
        const f = e.target.files[0]; if (!f) return;
        const img = new Image();
        img.onload = () => { images['upload/extra' + k] = img; delete bgState['extra' + k]; c.name = f.name; renderSelection(); update(true); };
        img.src = URL.createObjectURL(f);
      };
      fs.querySelector('.xClear').onclick = () => { delete images['upload/extra' + k]; delete bgState['extra' + k]; renderSelection(); update(true); };
      fs.querySelector('.xFit').onchange = e => set('fit', e.target.value);
      fs.querySelector('.xFill').onchange = e => set('fill', e.target.value);
      fs.querySelector('.xZoom').onchange = e => set('zoom', Math.max(10, Math.min(500, +e.target.value || 100)));
      fs.querySelector('.xPad').onchange = e => set('pad', Math.max(0, +e.target.value || 0));
      fs.querySelector('.xPx').onchange = e => set('px', +e.target.value || 0);
      fs.querySelector('.xPy').onchange = e => set('py', +e.target.value || 0);
      const size = which => {
        const o = ovFor(id), b = ctx.lastReport().boxes[id], kk = effOf(id).scale > 0 ? effOf(id).scale : 1;
        let w = Math.max(40, +fs.querySelector('.xW').value || b[2]), h = Math.max(40, +fs.querySelector('.xH').value || b[3]);
        if (state.lockAspect !== false) { if (which === 'w') h = w * b[3] / b[2]; else w = h * b[2] / b[3]; }
        const cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2, base = elById(id).box; // keep the centre where it is
        o.w = Math.round(w / kk); o.h = Math.round(h / kk); o.dx = Math.round(cx - base[0]); o.dy = Math.round(cy - base[1]);
        saveState(); update(true);
      };
      fs.querySelector('.xW').onchange = () => size('w');
      fs.querySelector('.xH').onchange = () => size('h');
    });
  }

  function refreshExtraSizes() {
    if (tpl().type !== 'extra' || !ctx.lastReport()) return;
    document.querySelectorAll('.xbox').forEach(fs => {
      const b = ctx.lastReport().boxes[fs.dataset.k === 'A' ? 'frameA' : 'frameB'];
      if (!b) return;
      const w = fs.querySelector('.xW'), h = fs.querySelector('.xH');
      if (document.activeElement !== w) w.value = Math.round(b[2]);
      if (document.activeElement !== h) h.value = Math.round(b[3]);
    });
  }

  return { psConfig, psConfigHtml, wirePsConfig, bgState, bgHtml, wireBg, extraPanelHtml, wireExtraPanel, refreshExtraSizes };
}
