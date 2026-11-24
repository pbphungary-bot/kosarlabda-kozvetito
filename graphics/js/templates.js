// Template definitions. Every coordinate, size, colour, tracking and outline
// value below is taken from the source PSD (see graphics/templates/<id>/layers.json
// and tools/psd_extract.py). x/y are the text anchor and baseline in canvas pixels.
// `sample` reproduces the PSD's own content so the render can be diffed against
// Photoshop's composite (tests/visual.mjs).

import { FRAMES } from './frames.js';
import { HSCALE, PANELS, LAYER_OPACITY } from './calibration.js';

const W = 1920, H = 1080;
const GREEN = '#0b9444', RED = '#ec4036';
const WIN = '#1fbf1b';
const WHITE_TXT = '#fefefe';
// Photoshop drop shadow, 100% spread, global angle 0° → dx = -distance
const ol = (size, color, distance = 0) => ({ size, color, dx: -distance, dy: 0 });
// competition marks: EuroCup Women carries a 3 px white outline in the designs, the others none
const COMP_OUTLINE = { 'comp/eurocup-women': ol(3, '#ffffff'), 'comp/euroleague-women': null, 'comp/bcl': null };

// element id → calibration key (see tools/calibrate_text.py)
function hscaleKey(type, id) {
  if (id === 'subtitle' || id === 'title' || id === 'round' || id === 'venue' || id === 'time') return id;
  if (type === 'playerspecial') return id === 'title' ? 'title' : id.endsWith('.label') ? 'label' : /\.c\d$/.test(id) ? 'value' : /^h\d$/.test(id) ? 'header' : id === 'subtitle' ? 'subtitle' : null;
  if (type === 'comparison' || type === 'playercompare') return id.includes('.rank.') ? 'rank' : 'value';
  if (type === 'teamstats') return id === 'team.name' ? 'teamname' : (/\.name$|^hdr\./.test(id) ? 'name' : 'figure');
  if (type === 'intro') return id.endsWith('.rank') ? 'round' : 'name';
  if (type === 'referees') return id.startsWith('controller') ? 'controller' : 'name';
  const m = id.match(/\.(date|match|score)$/);
  return m ? m[1] : null;
}

/** The panel (court + border) of a PSD graphic as a resizable shape; null when the design has none (see tools/psd_frames.py). */
export function panelEl(id) {
  const f = FRAMES[id];
  if (!f) return null;
  const [x0, y0, x1, y1] = f.box;
  return { id: 'panel', type: 'framed', label: 'Panel (háttér + szegély)', group: 'Panel', box: [(x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0], texture: 'assets/court/court.png',
    stroke: f.stroke, sw: f.sw, r: f.r, useBase: true, opacity: f.opacity, fixedFrame: true, lockAspect: false };
}

const base = (id, league, type, psd, label, extra) => {
  const t = {
    id, league, type, psd, label, width: W, height: H,
    background: `templates/${id}/background.png`, reference: `templates/${id}/reference.png`, ...extra,
  };
  t.panel = PANELS[id];
  const fid = extra.frameId || id; // the design whose PSD frame this graphic uses (the photo roster shares the table roster's)
  t.frameId = fid;
  const pe = panelEl(fid);
  if (pe) { t.elements = [pe, ...t.elements]; t.background = `templates/${fid}/statics.png`; t.staticsOnTop = true; } // frame = shape, background = the fixed rest of the PSD
  for (const el of t.elements) {
    // layer opacity of the PSD (98.8 % in most designs, 100 % in the intros)
    if (el.opacity === undefined && LAYER_OPACITY[id] !== undefined && LAYER_OPACITY[id] < 1) el.opacity = LAYER_OPACITY[id];
    if (el.type !== 'text') continue;
    const k = hscaleKey(type, el.id);
    el.hscale = (k && HSCALE[id]?.[k]) || 1;
  }
  return t;
};

export const STAT_ROWS = [
  { key: 'ppg', label: 'PTS', pct: false },
  { key: 'fg2_pct', label: '2P%', pct: true },
  { key: 'fg3_pct', label: '3P%', pct: true },
  { key: 'ft_pct', label: 'FT%', pct: true },
  { key: 'reb', label: 'REB', pct: false },
  { key: 'ast', label: 'AST', pct: false },
  { key: 'stl', label: 'STL', pct: false },
  { key: 'tov', label: 'TOV', pct: false, lowerIsBetter: true },
  { key: 'val', label: 'EFF', pct: false },
];

// ───────────────────────── Csapatok összevetése ─────────────────────────
// Key players: the picture is built from the chosen rows: the panel is exactly as tall as the rows (frame = shape, labels = texts, logo strip below the panel).
const PC_STRIP = { men: [382, 427, 60], women: [428, 409, 60] }; // x, width, height of the logo strip crop (templates/playercompare-<lg>/strip.png); it sits 12 px below the panel
const PC_ROW0 = 253.5, PC_PITCH = 90.6667, PC_TOP = 2, PC_BELOW = 21.2; // first row's y, row pitch, panel top, space under the last row (from the PSD)
export const PC_BUILDERS = {}; // template id → (rowKeys) => template (see app.js tpl())
export function pcRowKeys(keys) { const k = STAT_ROWS.filter(r => (keys || []).includes(r.key)).map(r => r.key); return k.length ? k : STAT_ROWS.map(r => r.key); }

function comparison(id, league, psd, g, type = 'comparison', rowKeys = null) {
  const pc = type === 'playercompare' && g.cx;
  const rowList = pc ? pcRowKeys(rowKeys).map(k => STAT_ROWS.find(r => r.key === k)) : STAT_ROWS;
  const lastY = PC_ROW0 + (rowList.length - 1) * PC_PITCH;
  if (pc) { g = { ...g, hl: [g.hl[0], (193.5 + lastY) / 2 + 3.5], al: [g.al[0], (193.5 + lastY) / 2 + 3.5] }; } // the logos / photos stay in the middle of the rows
  if (type === 'playercompare' && g.cx) { // key players: values / ranks / photos mirrored around the label column, rank rows on the value rows' baseline
    const dv = (g.av - g.hv) / 2, dr = (g.ar - g.hr) / 2, dl = (g.al[0] - g.hl[0]) / 2, ly = (g.hl[1] + g.al[1]) / 2;
    g = { ...g, hv: g.cx - dv, av: g.cx + dv, hr: g.cx - dr, ar: g.cx + dr, hl: [g.cx - dl, ly], al: [g.cx + dl, ly], level: true };
  }
  const els = [
    { id: 'subtitle', type: 'text', label: 'Alcím (adatforrás)', group: 'Fejléc', x: g.subX, y: 163.2, align: 'center',
      font: 'italic', size: 48, tracking: 10, color: '#000000', outline: ol(3, '#ffffff'), runs: true, maxWidth: 1150 },
    { id: 'home.logo', type: 'image', label: 'Hazai logó', group: 'Hazai', box: [g.hl[0], g.hl[1], 471, 400], fit: 'area', area: 152000, opacity: 0.702, logoOutline: true },
    { id: 'away.logo', type: 'image', label: 'Vendég logó', group: 'Vendég', box: [g.al[0], g.al[1], 471, 400], fit: 'area', area: 152000, opacity: 0.702, logoOutline: true },
  ];
  rowList.forEach((s, i) => {
    const y = PC_ROW0 + i * PC_PITCH;
    const yr = g.level ? y : g.rankY + i * 89.6;
    const common = { size: 74.6667, tracking: 25, outline: ol(3, '#ffffff', 1), align: 'center', maxWidth: 170 };
    els.push(
      { id: `home.rank.${s.key}`, type: 'text', label: `Hazai ${s.label} helyezés`, group: 'Hazai', x: g.hr, y: yr, ...common, tracking: g.rankTracking, color: '#383838', maxWidth: 110 },
      { id: `home.${s.key}`, type: 'text', label: `Hazai ${s.label}`, group: 'Hazai', x: g.hv, y, ...common, color: GREEN },
      { id: `away.${s.key}`, type: 'text', label: `Vendég ${s.label}`, group: 'Vendég', x: g.av, y, ...common, color: RED },
      { id: `away.rank.${s.key}`, type: 'text', label: `Vendég ${s.label} helyezés`, group: 'Vendég', x: g.ar, y: yr, ...common, tracking: g.rankTracking, color: '#373737', maxWidth: 110 },
    );
    if (pc) els.push({ id: `label.${s.key}`, type: 'text', label: `${s.label} – sor felirata`, group: 'Sorok', x: g.cx, y, ...common, color: '#000000', outline: ol(3, '#ffffff'), maxWidth: 190 });
  });
  if (type === 'playercompare') els.unshift({ id: 'title', type: 'text', label: 'Cím', group: 'Fejléc', x: g.titleX, y: 103.5, align: 'center',
    size: 96, tracking: 10, color: WHITE_TXT, outline: ol(6, '#000000', 1), maxWidth: 1000, minScale: 0.6 });
  if (!pc) return base(id, league, type, psd, type === 'playercompare' ? PC_LABEL : 'Csapatok összevetése', { elements: els, sample: g.sample });
  const pe = panelEl(`comparison-${league}`), [px0, , px1] = [pe.box[0] - pe.box[2] / 2, 0, pe.box[0] + pe.box[2] / 2], py1 = lastY + PC_BELOW, sw = pe.sw ?? 0;
  pe.box = [pe.box[0], (PC_TOP + py1) / 2, pe.box[2], py1 - PC_TOP];
  const [sx, sw0, sh] = PC_STRIP[league];
  const strip = { id: 'strip', type: 'image', label: 'Logósor (Hunbasket · Tippmix · MKOSZ)', group: 'Panel', box: [sx + sw0 / 2, py1 + 12 + sh / 2, sw0, sh], fit: 'contain', fixedSrc: true, fixedFrame: true };
  for (const e of els) if (e.id.endsWith('.logo')) e.clipInner = true; // the photos stay inside the panel
  const t = base(id, league, type, psd, PC_LABEL, { elements: [pe, strip, ...els], background: null, sample: g.sample });
  t.inner = { box: [px0 + sw, PC_TOP + sw, px1 - sw, py1 - sw], r: Math.max((pe.r ?? 0) - sw, 0) };
  t.panel = { box: [px0, PC_TOP, px1, py1], alpha: pe.opacity ?? 0.9882 };
  t.pcRows = rowList.map(r => r.key);
  return t;
}
const PC_LABEL = 'Kulcsjátékosok összehasonlítása / szemtől szemben';

function comparisonSample(sub, home, away, hr, ar, hc, ac, hlogo, alogo) {
  const v = { subtitle: { runs: [{ text: 'A mérkőző felek idei teljesítménye, statisztikai átlagszámokban - via ' }, { text: sub, color: '#37b3fd' }] } };
  STAT_ROWS.forEach((s, i) => {
    v[`home.${s.key}`] = { text: home[i], color: hc[i] ? GREEN : RED };
    v[`away.${s.key}`] = { text: away[i], color: ac[i] ? GREEN : RED };
    v[`home.rank.${s.key}`] = { text: `(${hr[i]}.)` };
    v[`away.rank.${s.key}`] = { text: `(${ar[i]}.)` };
  });
  v['home.logo'] = { src: hlogo };
  v['away.logo'] = { src: alogo };
  return v;
}

// ───────────────────────── Csapatstat (player table) ─────────────────────────
export const TEAMSTAT_COLS = {
  women: [
    { key: 'M.', label: 'M', hx: 811, x: 810.5 },
    { key: 'P.', label: 'P/M', hx: 921.5, x: 921, best: 'max' },
    { key: 'ÖLP', label: 'L/M', hx: 1042, x: 1042, best: 'max' },
    { key: 'GP', label: 'GP/M', hx: 1173, x: 1168, best: 'max' },
    { key: 'SZL', label: 'SZ/M', hx: 1287.5, x: 1287, best: 'max' },
    { key: 'EL', label: 'EL/M', hx: 1417, x: 1411, worst: 'max' },
    { key: 'VAL', label: 'VAL/M', hx: 1532.5, x: 1528, best: 'max' },
    { key: 'Idő', label: 'IDŐ/M', hx: 1667, x: 1666, best: 'max' },
  ],
  men: [
    { key: 'M.', label: 'M', hx: 771, x: 771.5 },
    { key: 'P.', label: 'P/M', hx: 877.5, x: 880, best: 'max' },
    { key: 'ÖLP', label: 'L/M', hx: 977, x: 974, best: 'max' },
    { key: 'GP', label: 'GP/M', hx: 1071, x: 1067, best: 'max' },
    { key: 'SZL', label: 'SZ/M', hx: 1181, x: 1181.5, best: 'max' },
    { key: 'EL', label: 'EL/M', hx: 1280, x: 1274, worst: 'max' },
    { key: 'Blokk', label: 'BL/M', hx: 1380.5, x: 1380, best: 'max' },
    { key: 'VAL', label: 'VAL/M', hx: 1502, x: 1500, best: 'max' },
    { key: 'Idő', label: 'IDŐ/M', hx: 1607.5, x: 1610, best: 'max' },
  ],
};

function teamstats(id, league, psd, g) {
  const cols = TEAMSTAT_COLS[league];
  const hdr = { type: 'text', group: 'Fejléc', y: g.headerY, size: g.headerSize, tracking: -20, color: '#dba234', caps: true, outline: ol(4, '#000000'), fixed: true };
  const els = [
    { id: 'team.logo', type: 'image', label: 'Csapat logó', group: 'Csapat', box: g.logoBox, fit: 'contain', logoOutline: true, maxOutline: 2 },
    { id: 'team.name', type: 'text', label: 'Csapatnév', group: 'Csapat', x: g.nameX, y: g.nameY, size: 100, tracking: 50, caps: true,
      color: '#ffffff', outline: ol(3, '#ffffff'), maxWidth: g.nameMax, minScale: 0.5 },
    { id: 'hdr.num', label: 'Fejléc #', ...hdr, x: g.numX, align: 'center', defaultText: '#' },
    { id: 'hdr.name', label: 'Fejléc Játékos', ...hdr, x: g.hdrNameX, align: 'left', defaultText: 'Játékos' },
    ...cols.map(c => ({ id: `hdr.${c.key}`, label: `Fejléc ${c.label}`, ...hdr, x: c.hx, align: 'center', defaultText: c.label })),
  ];
  for (let r = 0; r < g.rows; r++) {
    const y = g.rowY + r * g.pitch;
    const cell = { type: 'text', group: `${r + 1}. sor`, y, size: g.rowSize, tracking: 25, color: '#ffffff', caps: true, outline: ol(4, '#000000') };
    els.push(
      { id: `r${r}.num`, label: `${r + 1}. mezszám`, ...cell, x: g.numX, align: 'center', maxWidth: 60 },
      { id: `r${r}.name`, label: `${r + 1}. játékos`, ...cell, x: g.playerX, align: 'left', maxWidth: g.playerMax, minScale: 0.7 },
      ...cols.map(c => ({ id: `r${r}.${c.key}`, label: `${r + 1}. ${c.label}`, ...cell, x: c.x, align: 'center', maxWidth: 95 })),
    );
  }
  return base(id, league, 'teamstats', psd, 'Csapatstatisztika (játékosok)', { elements: els, rows: g.rows, geometry: g, sample: g.sample });
}

// ───────────────────────── Eredmények / Menetrend (row lists) ─────────────────────────
function rowList(id, league, type, psd, label, g) {
  const title = { type: 'text', group: 'Fejléc', x: g.titleX, size: 100, tracking: 10, color: '#000000', caps: true, outline: ol(3, '#ffffff'), align: 'center', maxWidth: g.titleMax, minScale: 0.55 };
  const els = [
    { id: 'team.logo.left', type: 'image', label: 'Logó (bal)', group: 'Fejléc', box: g.crestL, fit: 'contain', logoOutline: true, maxOutline: 2 },
    { id: 'team.logo.right', type: 'image', label: 'Logó (jobb)', group: 'Fejléc', box: g.crestR, fit: 'contain', logoOutline: true, maxOutline: 2 },
    { id: 'title', label: 'Cím (2 sor)', ...title, y: 108.5, lineHeight: 120, wrap: { maxLines: 2 } },
  ];
  for (let r = 0; r < g.rows; r++) {
    const y = g.rowY + r * 125;
    const row = { type: 'text', group: `${r + 1}. sor`, y, size: 75, tracking: 25, color: WHITE_TXT, caps: true, outline: ol(4, '#000000', 1) };
    els.push({ id: `r${r}.date`, label: `${r + 1}. dátum`, ...row, x: g.dateX, align: 'left', maxWidth: g.dateMax });
    if (g.compX) els.push({ id: `r${r}.comp`, type: 'image', label: `${r + 1}. sorozat logó`, group: `${r + 1}. sor`, box: [g.compX, y - 28.5, g.compW, g.compH], fit: 'contain', outlineBySrc: COMP_OUTLINE });
    els.push({ id: `r${r}.match`, label: `${r + 1}. mérkőzés`, ...row, x: g.matchX, align: 'left', maxWidth: g.matchMax, minScale: 0.6 });
    if (g.scoreX) els.push({ id: `r${r}.score`, label: `${r + 1}. eredmény`, ...row, x: g.scoreX, align: 'right', maxWidth: 150 });
  }
  return base(id, league, type, psd, label, { elements: els, rows: g.rows, geometry: g, sample: g.sample });
}

// ───────────────────────── Intro ─────────────────────────
function intro(id, league, psd, g) {
  const name = { type: 'text', adjust: true, y: 809.5, size: 100, tracking: 10, color: WHITE_TXT, caps: true, outline: ol(4, '#000000', 1), align: 'center', maxWidth: 440, lineHeight: 120, wrap: { maxLines: 2, anchor: 'middle' }, minScale: 0.5 };
  const rank = { type: 'text', adjust: true, y: 909.5, size: 58.333, tracking: -20, color: '#ef4036', outline: ol(2, '#ffffff'), align: 'center', maxWidth: 420 }; // shown by default (the PSD has it hidden); the name wraps / shifts around it (compactWith)
  const els = [
    { id: 'round', type: 'text', adjust: true, label: 'Forduló, dátum, időpont', group: 'Mérkőzés', x: g.roundX, y: g.roundY, font: g.roundFont, size: 50, tracking: 10, color: WHITE_TXT, outline: ol(4, '#000000', 1), align: 'center', maxWidth: 900 },
    { id: 'venue', type: 'text', adjust: true, label: 'Helyszín', group: 'Mérkőzés', x: 960.7, y: 244.5, size: g.venueSize, tracking: -20, color: WHITE_TXT, outline: ol(4, '#000000', 1), align: 'center', maxWidth: 560 },
    { id: 'home.logo', type: 'image', label: 'Hazai logó', group: 'Hazai', box: [628, 475, 384, 350], fit: 'contain', logoOutline: true },
    { id: 'away.logo', type: 'image', label: 'Vendég logó', group: 'Vendég', box: [1295, 473.5, 384, 350], fit: 'contain', logoOutline: true },
    { id: 'home.name', label: 'Hazai csapatnév', group: 'Hazai', ...name, x: 625, compactWith: 'home.rank' },
    { id: 'away.name', label: 'Vendég csapatnév', group: 'Vendég', ...name, x: g.awayX, compactWith: 'away.rank' },
    { id: 'home.rank', label: 'Hazai helyezés / mérleg', group: 'Hazai', ...rank, x: 627.8 },
    { id: 'away.rank', label: 'Vendég helyezés / mérleg', group: 'Vendég', ...rank, x: 1294.8 },
  ];
  return base(id, league, 'intro', psd, 'Intro (mérkőzés felvezető)', { elements: els, sample: g.sample });
}

// ───────────────────────── Játékvezetők ─────────────────────────
function referees(id, league, psd, g) {
  const nm = { type: 'text', adjust: true, group: 'Játékvezetők', x: 969, size: 58.333, tracking: 10, color: WHITE_TXT, caps: true, outline: ol(5, '#030303'), align: 'left', maxWidth: 430 };
  const els = [
    { id: 'ref1', label: '1. játékvezető', ...nm, y: 779 },
    { id: 'ref2', label: '2. játékvezető', ...nm, y: 833 },
    { id: 'ref3', label: '3. játékvezető', ...nm, y: 887 },
    { id: 'controller.label', type: 'text', label: 'Ellenőr felirat', group: 'Ellenőr', x: 590, y: 954, size: 45.833, tracking: 25, color: '#fffefe', outline: ol(5, '#030303'), align: 'left', fixed: true, defaultText: 'MKOSZ Ellenőr:' },
    { id: 'controller', type: 'text', adjust: true, label: 'MKOSZ ellenőr', group: 'Ellenőr', x: 967, y: 954, size: 45.833, tracking: 25, color: '#fffefe', outline: ol(5, '#030303'), align: 'left', maxWidth: 430 },
  ];
  return base(id, league, 'referees', psd, 'Játékvezetők', { elements: els, sample: g.sample, fontNote: g.fontNote });
}

// ───────────────────────── Következik (next match corner graphic) ─────────────────────────
// One PSD ("Nex Match graph") for both leagues: title, home logo, kick-off time, away logo in the top-left corner.
// The PSD's hidden layers: the gold frame ("TOP keret", offered as a switch) and the phase line "Az 5-8. helyért"
// (not offered: in the PSD it overlaps the title and the logos).
function nextmatch(id, league) {
  const txt = { type: 'text', adjust: true, group: 'Mérkőzés', color: '#ffffff', outline: ol(5, '#000000'), align: 'left', tracking: 10 };
  const els = [
    { id: 'frame', type: 'image', label: 'Keret (a PSD rejtett „TOP keret” rétege)', group: 'Megjelenés', box: [960, 540, 1920, 1080], fit: 'contain', visible: false, fixedSrc: 'nextmatch/frame' },
    { id: 'title', label: 'Cím', ...txt, x: 90, y: 93.7, size: 83.333, maxWidth: 320 },
    { id: 'home.logo', type: 'image', label: 'Hazai logó', group: 'Hazai', box: [106.5, 165, 100, 100], fit: 'contain', logoOutline: true },
    { id: 'time', label: 'Kezdés időpontja', ...txt, x: 171, y: 186.7, font: 'italic', size: 58.333, maxWidth: 106 },
    { id: 'away.logo', type: 'image', label: 'Vendég logó', group: 'Vendég', box: [330, 165, 100, 100], fit: 'contain', logoOutline: true },
  ];
  return base(id, league, 'nextmatch', 'Nex Match graph.psd', 'Következik', {
    elements: els, background: null, reference: 'templates/nextmatch/reference.png', thumb: 'templates/nextmatch/thumb.jpg',
    sample: {
      title: { text: 'Következik' }, time: { text: '12.30' },
      'home.logo': { src: 'women/vasasakademia' }, 'away.logo': { src: 'men/szedeak' }, // the PSD's own sample (Vasas – Szedeák)
    },
  });
}

// aliases: the star-player designs use the team comparison's calibration (same layers, same geometry)
for (const lg of ['men', 'women']) {
  HSCALE[`playercompare-${lg}`] = HSCALE[`comparison-${lg}`];
  PANELS[`playercompare-${lg}`] = PANELS[`comparison-${lg}`];
  LAYER_OPACITY[`playercompare-${lg}`] = LAYER_OPACITY[`comparison-${lg}`];
}


// ───────────────────────── Játékos-különleges (player special) ─────────────────────────
// Editorial design (PSDs "Uros STAT" and "Kányási"): name, a 1–2 line story, any number of stat columns (each with a 2-line
// header), a photo that can sit behind or in front of any group of text. The operator chooses columns, rows, photo size and layering;
// the panel's outline is untouchable: the photo / logo are clipped to the panel's inner edge and text boxes are checked against it.

/** Stat catalogue: key → label and the columns of the player table (Hunbasket per-game averages). */
export const PS_STATS = {
  pts: { label: 'PTS/G', col: 'P.' },
  reb: { label: 'REB/G', col: 'ÖLP' },
  ast: { label: 'AST/G', col: 'GP' },
  stl: { label: 'STL/G', col: 'SZL' },
  tov: { label: 'TOV/G', col: 'EL' },
  blk: { label: 'BLK/G', col: 'Blokk' },
  min: { label: 'MIN/G', col: 'Idő' },
  val: { label: 'VAL/G', col: 'VAL' },
  gp: { label: 'MECCS', col: 'M.', int: true },
  p2: { label: '2P%', col: '2P %', pct: true },
  p3: { label: '3P%', col: '3P %', pct: true },
  ft: { label: 'FT%', col: 'BT %', pct: true },
  p2ma: { label: '2P', col: '2P %', pct: true, made: '2P S', att: '2P K' },
  p3ma: { label: '3P', col: '3P %', pct: true, made: '3P S', att: '3P K' },
  ftma: { label: 'FT', col: 'BT %', pct: true, made: 'BT S', att: 'BT K' },
  ts: { label: 'TS%', col: 'TS%', pct: true },
  ortg: { label: 'O.RTG', col: 'O.RTG' },
  drtg: { label: 'D.RTG', col: 'D.RTG' },
};
export const PS_MAX_COLS = 4, PS_MAX_ROWS = 8;
export const PS_SMALL = 40; // size of the percentage next to a made/attempted value

const PS_GEOM = {
  men: {
    panel: [0, 0, 1246, 924], inner: { box: [9, 9, 1237, 915], r: 28 }, photoCx: 1069, logoBox: [440, 600, 330, 360], logoOn: false,
    titleX: 431.3, titleY: 102.5, titleMax: 800, subX: 431.8, subY: 154.7, subMax: 900, headerY: 197.6,
    labelX: 544.8, rowY: 331.3, rowSpan: 571, statsLeft: 10, statsRight: 852,
    exact: { cols: 3, labelAfter: 2, xs: [128.7, 348.6, 765.6] },
    palette: [['#ec4036', '#1fbf1b'], ['#0b9444', '#ffffff'], ['#feed01', '#000000'], ['#ffffff', '#000000']],
    cfg: { cols: 3, labelAfter: 2, rows: ['pts', 'p3', 'reb', 'ast', 'val', 'min'], auto: 3 },
  },
  women: {
    panel: [29, 10, 1286, 1003], inner: { box: [37, 18, 1278, 995], r: 37 }, photoCx: 973, logoBox: [454, 649, 368, 400], logoOn: true,
    titleX: 449.5, titleY: 119.5, titleMax: 800, subX: 454, subY: 166.2, subMax: 800, headerY: 263.6,
    labelX: 447, rowY: 390.5, rowSpan: 576, statsLeft: 60, statsRight: 860,
    exact: { cols: 2, labelAfter: 1, xs: [199, 716] },
    palette: [['#a20100', '#ffffff'], ['#296d46', '#ffffff'], ['#1d4e89', '#ffffff'], ['#6b6b6b', '#ffffff']],
    cfg: { cols: 2, labelAfter: 1, rows: ['pts', 'p2ma', 'reb', 'ast', 'stl', 'val'], auto: 2 },
  },
};
export const PS_GROUPS = (cols) => [['title', 'Név és alcím'], ['headers', 'Oszlopfejlécek'], ['labels', 'Sorfeliratok'], ...Array.from({ length: cols }, (_, i) => [`c${i + 1}`, `${i + 1}. oszlop számai`])];

export function psDefaults(league) {
  const c = PS_GEOM[league].cfg;
  return { ...c, rows: [...c.rows], photoH: 0, photoCx: PS_GEOM[league].photoCx, front: {} };
}

/** Normalised config (never trusts stored values). */
export function psNormalize(league, cfg) {
  const d = psDefaults(league), c = { ...d, ...(cfg || {}) };
  c.cols = Math.min(PS_MAX_COLS, Math.max(1, Math.round(c.cols) || d.cols));
  c.labelAfter = Math.min(c.cols, Math.max(0, Math.round(c.labelAfter ?? d.labelAfter)));
  const n = Math.min(PS_MAX_ROWS, Math.max(1, (c.rows || []).length || d.rows.length));
  c.rows = Array.from({ length: n }, (_, i) => (PS_STATS[c.rows?.[i]] ? c.rows[i] : d.rows[i] || 'pts'));
  c.auto = Math.min(c.cols, Math.max(0, Math.round(c.auto ?? d.auto)));
  // data source of every column: manual | season | career | last (last N games); default: the old "auto" column is the season
  c.lastN = Math.min(20, Math.max(1, Math.round(c.lastN) || 5));
  const ok = ['manual', 'season', 'career', 'last'];
  c.colSrc = Array.from({ length: c.cols }, (_, i) => (ok.includes(cfg?.colSrc?.[i]) ? cfg.colSrc[i] : (cfg?.colSrc ? 'manual' : (i + 1 === c.auto ? 'season' : 'manual'))));
  c.photoH = c.photoH > 0 ? c.photoH : 0; // 0 = as tall as the panel allows
  for (const k of ['fsRows', 'fsHeaders', 'fsTitle', 'fsSub']) c[k] = c[k] > 0 ? Math.min(300, c[k]) : 0; // font sizes in px, 0 = the PSD's
  c.front = c.front || {};
  return c;
}

/** The template for one configuration of a player-special design. `base` is the registry entry (background, reference). */
export function psBuild(base, cfgIn) {
  const league = base.league, g = PS_GEOM[league], cfg = psNormalize(league, cfgIn), op = 0.9882;
  const [, iy0, , iy1] = g.inner.box;
  const photoH = cfg.photoH > 0 ? Math.min(cfg.photoH, iy1 - iy0) : iy1 - iy0;
  const n = cfg.cols;
  // x of the columns: the PSD's own positions for its own column count, otherwise even slots (the label takes one slot)
  let xs, labelX;
  if (n === g.exact.cols && cfg.labelAfter === g.exact.labelAfter) { xs = g.exact.xs; labelX = g.labelX; }
  else {
    const slot = (g.statsRight - g.statsLeft) / (n + 1);
    const centres = Array.from({ length: n + 1 }, (_, i) => g.statsLeft + slot * (i + 0.5));
    labelX = centres[cfg.labelAfter];
    xs = centres.filter((_, i) => i !== cfg.labelAfter);
  }
  const colMax = Math.max(150, (g.statsRight - g.statsLeft) / (n + 1) * 1.25);
  const rows = cfg.rows, nr = rows.length;
  const pitch = nr > 1 ? Math.min(g.rowSpan / 5, g.rowSpan / (nr - 1)) : 0;
  const rowSize = cfg.fsRows || Math.min(96, 96 * (pitch || 115) / 115);
  const group = { title: [], headers: [], labels: [] };
  for (let k = 1; k <= n; k++) group[`c${k}`] = [];
  group.title.push(
    { id: 'title', type: 'text', label: 'Név', group: 'Fejléc', x: g.titleX, y: g.titleY, align: 'center', size: cfg.fsTitle || 106.667, tracking: 50, color: '#fefefe', caps: true, outline: ol(4, '#000000', 1), maxWidth: g.titleMax, opacity: op, adjust: true },
    { id: 'subtitle', type: 'text', label: 'Alcím (1–2 sor, kézzel írandó)', group: 'Fejléc', x: g.subX, y: g.subY, align: 'center', font: 'italic', size: cfg.fsSub || 42.667, tracking: 50, color: '#000000',
      outline: ol(3, '#ffffff'), maxWidth: g.subMax, lineHeight: (cfg.fsSub || 42.667) * 1.125, wrap: { maxLines: 2 }, opacity: op },
  );
  xs.forEach((x, i) => group.headers.push({ id: `h${i + 1}`, type: 'text', label: `${i + 1}. oszlop fejléce`, group: `${i + 1}. oszlop`, x, y: g.headerY, align: 'center', size: cfg.fsHeaders || 34.667, tracking: 50, color: '#fefefe',
    outline: ol(4, '#000000', 1), maxWidth: 260, lineHeight: (cfg.fsHeaders || 34.667) * 1.2, wrap: { maxLines: 2 }, opacity: op }));
  rows.forEach((key, i) => {
    const y = g.rowY + i * pitch;
    group.labels.push({ id: `r${i}.label`, type: 'text', label: `${i + 1}. sor felirata`, group: 'Sorok', x: labelX, y, align: 'center', font: 'italic', size: rowSize, tracking: 50, color: '#000000', outline: ol(3, '#ffffff'), maxWidth: 200, opacity: op });
    xs.forEach((x, k) => {
      const [color, outline] = g.palette[k % g.palette.length];
      group[`c${k + 1}`].push({ id: `r${i}.c${k + 1}`, type: 'text', label: `${PS_STATS[key].label} – ${k + 1}. oszlop`, group: `${k + 1}. oszlop`, x, y, align: 'center', size: rowSize, tracking: 25, color, outline: ol(3, outline), maxWidth: PS_STATS[key].made ? colMax * 1.4 : colMax, runs: true, opacity: op });
    });
  });
  const photo = { id: 'photo', type: 'image', label: 'Játékos fotó (feltöltött, áttetsző PNG)', group: 'Fotó', box: [cfg.photoCx, iy1 - photoH / 2, photoH * 3, photoH], fit: 'contain', anchor: 'bottom', clipInner: true, fixedSrc: true };
  const logo = { id: 'logo', type: 'image', label: 'Klublogó (háttér)', group: 'Fotó', box: g.logoBox, fit: 'contain', opacity: 0.6, outline: ol(2, '#ffffff'), visible: g.logoOn, clipInner: true };
  // layering: everything not marked "in front" is drawn behind the photo (default: all text in front of the photo)
  const names = ['title', 'headers', 'labels', ...Array.from({ length: n }, (_, i) => `c${i + 1}`)];
  const isFront = k => cfg.front[k] !== false;
  const els = [...(panelEl(base.frameId || base.id) ? [panelEl(base.frameId || base.id)] : []), logo, ...names.filter(k => !isFront(k)).flatMap(k => group[k]), photo, ...names.filter(isFront).flatMap(k => group[k])];
  for (const e of els) if (e.type === 'text') e.adjust = true; // every text has size / position fields
  const t = base2(base, els);
  t.ps = { cfg, groups: names };
  t.inner = g.inner;
  t.panel = { box: g.panel, alpha: op };
  return t;
}

// a copy of the registry entry with new elements (calibration: see HSCALE below)
function base2(b, elements) {
  const t = { ...b, elements: elements.map(e => ({ ...e })) };
  for (const el of t.elements) {
    if (el.type !== 'text') continue;
    const k = hscaleKey('playerspecial', el.id);
    el.hscale = (k && HSCALE[b.id]?.[k]) || 1;
  }
  return t;
}

function playerspecial(id, league, psd) {
  const b = base(id, league, 'playerspecial', psd, 'Játékos-különleges', { elements: [] });
  return psBuild(b, null);
}
// text-width calibration (PSD ink width / browser width of the same string)
for (const id of ['roster-men', 'roster-women', 'rostergrid-men', 'rostergrid-women']) HSCALE[id] = { hdr: 0.98, name: 0.97, val: 0.97 };
HSCALE['playerspecial-men'] = { title: 0.971, label: 0.96, value: 0.968, header: 0.99, subtitle: 0.968 };
HSCALE['playerspecial-women'] = { title: 0.995, label: 0.96, value: 0.968, header: 0.978, subtitle: 0.976 };


// ───────────────────────── Keret (roster) ─────────────────────────
// Two designs of the same data (Hunbasket roster): "roster" = the table of the FALCO / DVTK keret PSDs, "rostergrid" = cards with photos.
// The panel is fixed; the rows / cards are laid out for the real number of players (built per team, see rosterBuild).
const ROSTER_GEOM = {
  men: { panel: [67, 48, 1672, 907], inner: { box: [75, 56, 1664, 899], r: 14 }, hdr: 110.6, first: 169.7, last: 869, logo: [368, 327, 450, 450], coach: [690, 770, 835], defaultN: 13 },
  women: { panel: [67, 67, 1672, 860], inner: { box: [75, 75, 1664, 852], r: 14 }, hdr: 127, first: 185, last: 826, logo: [370, 365, 430, 430], coach: [690, 772, 835], defaultN: 12 },
};
const ROSTER_COLS = { num: 682, name: 749, nameHdr: 943, flag: 1218, pos: 1300, height: 1433, year: 1592 };

function rosterCommon(g, op) {
  const els = [
    { id: 'logo', type: 'image', label: 'Klublogó', group: 'Bal oldal', box: g.logo, fit: 'contain', opacity: op, logoOutline: true },
    { id: 'coach.label', type: 'text', label: 'Vezetőedző felirat', group: 'Edzők', x: 125, y: g.coach[0], size: 50, tracking: -20, font: 'italic', color: '#000000', outline: ol(3, '#ffffff'), opacity: op, adjust: true },
    { id: 'coach.name', type: 'text', label: 'Vezetőedző', group: 'Edzők', x: 305, y: g.coach[0], size: 75, tracking: -20, font: 'italic', color: '#000000', outline: ol(3, '#ffffff'), maxWidth: 310, opacity: op, adjust: true, caps: true },
    { id: 'assist.label', type: 'text', label: 'Segédedző felirat', group: 'Edzők', x: 125, y: g.coach[1], size: 50, tracking: -20, font: 'italic', color: '#000000', outline: ol(3, '#ffffff'), opacity: op, adjust: true },
    { id: 'assist.name', type: 'text', label: 'Segédedző', group: 'Edzők', x: 305, y: g.coach[1], size: 58.3, tracking: -20, font: 'italic', color: '#000000', outline: ol(3, '#ffffff'), maxWidth: 310, opacity: op, adjust: true, caps: true },
    { id: 'assist2.name', type: 'text', label: '2. segédedző (kézzel)', group: 'Edzők', x: 305, y: g.coach[2], size: 58.3, tracking: -20, font: 'italic', color: '#000000', outline: ol(3, '#ffffff'), maxWidth: 310, opacity: op, adjust: true, caps: true },
  ];
  return els;
}

export function rosterDims(n) {
  return n <= 12 ? { cols: 4, rows: Math.ceil(n / 4) } : n <= 15 ? { cols: 5, rows: Math.ceil(n / 5) } : { cols: 6, rows: Math.ceil(n / 6) };
}

/** base = registry entry (background); n = number of players. */
export function rosterBuild(base, n, mask = '', ns = 1, fs = 1, off = []) {
  const g = ROSTER_GEOM[base.league], op = 0.9882;
  n = Math.max(1, Math.min(24, n || g.defaultN));
  const els = [...(panelEl(base.frameId || base.id) ? [panelEl(base.frameId || base.id)] : []), ...rosterCommon(g, op)];
  if (base.type === 'roster') {
    const pitch = n > 1 ? Math.min(58.4, (g.last - g.first) / (n - 1)) : 0, k = pitch / 58.4;
    const sz = 48.4453 * k, hs = 34.6 * Math.max(k, 0.8);
    const hdr = (id, label, x, align = 'center') => els.push({ id, type: 'text', label, group: 'Fejléc', x, y: g.hdr, align, size: hs, tracking: -20, color: '#ef4036', outline: ol(3, '#000000'), opacity: op, adjust: true });
    hdr('hdr.num', 'Fejléc: #', ROSTER_COLS.num); hdr('hdr.name', 'Fejléc: NÉV', ROSTER_COLS.nameHdr); hdr('hdr.pos', 'Fejléc: POSZT', ROSTER_COLS.pos);
    hdr('hdr.height', 'Fejléc: MAGASSÁG', ROSTER_COLS.height); hdr('hdr.year', 'Fejléc: SZÜL. ÉV', ROSTER_COLS.year);
    for (let i = 0; i < n; i++) {
      const y = g.first + i * pitch, base2 = { type: 'text', group: `${i + 1}. játékos`, y, size: sz, tracking: 25, color: '#ffffff', outline: ol(3, '#000000'), opacity: op, caps: true };
      els.push(
        { ...base2, id: `r${i}.num`, label: `${i + 1}. mezszám`, x: ROSTER_COLS.num, align: 'center', size: sz * ns, maxWidth: 70 * ns },
        { ...base2, id: `r${i}.name`, label: `${i + 1}. név`, x: ROSTER_COLS.name, maxWidth: 420, minScale: 0.5 },
        { id: `r${i}.flag`, type: 'image', label: `${i + 1}. zászló`, group: `${i + 1}. játékos`, box: [ROSTER_COLS.flag, y - 0.3 * sz, 76, 40 * Math.min(1, k + 0.15)], fit: 'contain', opacity: op },
        { ...base2, id: `r${i}.pos`, label: `${i + 1}. poszt`, x: ROSTER_COLS.pos, align: 'center', maxWidth: 110 },
        { ...base2, id: `r${i}.height`, label: `${i + 1}. magasság`, x: ROSTER_COLS.height, align: 'center', maxWidth: 140 },
        { ...base2, id: `r${i}.year`, label: `${i + 1}. születési év`, x: ROSTER_COLS.year, align: 'center', maxWidth: 120 },
      );
    }
  } else { // cards with photos
    const { cols, rows } = rosterDims(n), areaX = 700, areaW = 940, areaY = g.hdr - 20, areaH = g.last - areaY + 8;
    const cw = areaW / cols, ch = Math.min(290, areaH / rows), ph = ch * 0.6, pw = ph * 0.88;
    for (let i = 0; i < n; i++) {
      const c = i % cols, r = Math.floor(i / cols), cx = areaX + cw * (c + 0.5) + (off[r]?.[0] || 0), top = areaY + r * ch + (areaH - ch * rows) / 2 + (off[r]?.[1] || 0); // off[r] = [dx, dy] of the whole row
      const grp = `${i + 1}. játékos`, nm = Math.min(1, cw / 190);
      els.push(
        { id: `r${i}.photo`, type: 'image', label: `${i + 1}. fotó`, group: grp, box: [cx, top + ph / 2, pw, ph], fit: 'contain', anchor: 'bottom', clipInner: true },
        { id: `r${i}.flag`, type: 'image', label: `${i + 1}. zászló`, group: grp, box: [cx + pw / 2 + 2 - 22 * fs, top + (44 - 0.371 * 46 * ns) * nm, 44 * fs, 30 * fs] /* centre on the digits' centre line (digit height 0.743 em) */, fit: 'contain', opacity: op },
        { id: `r${i}.num`, type: 'text', label: `${i + 1}. mezszám`, group: grp, x: cx - pw / 2 + 6, y: top + 44 * nm, size: 46 * nm * ns, tracking: 25, color: '#ffffff', outline: ol(3, '#000000'), opacity: op, maxWidth: 60 * ns },
        // Hungarian players: SURNAME (big) above the given names; foreign players: the given name above the SURNAME (big), as in the table design
        { id: `r${i}.last`, type: 'text', label: `${i + 1}. vezetéknév`, group: grp, x: cx, y: top + ph + (mask[i] === '1' ? 64 : 36) * nm, align: 'center', size: 36 * nm, tracking: 25, color: '#ffffff', outline: ol(3, '#000000'), opacity: op, maxWidth: cw - 8, caps: true, minScale: 0.5 },
        { id: `r${i}.first`, type: 'text', label: `${i + 1}. keresztnév`, group: grp, x: cx, y: top + ph + (mask[i] === '1' ? 28 : 64) * nm, align: 'center', size: 27 * nm, tracking: 25, color: '#ffffff', outline: ol(3, '#000000'), opacity: op, maxWidth: cw - 8, caps: true, minScale: 0.5 },
        { id: `r${i}.info`, type: 'text', label: `${i + 1}. poszt · magasság`, group: grp, x: cx, y: top + ph + 36 * nm + 28 * nm + 26 * nm, align: 'center', size: 24 * nm, tracking: 25, color: '#ef4036', outline: ol(3, '#000000'), opacity: op, maxWidth: cw - 8, caps: true },
      );
    }
  }
  for (const e of els) if (e.type === 'text') { e.adjust = true; e.hscale = HSCALE[base.id]?.[e.id.startsWith('hdr') ? 'hdr' : /\.name$|\.last$|\.first$/.test(e.id) ? 'name' : 'val'] || 0.97; }
  const t = { ...base, elements: els.map(e => ({ ...e })), rosterN: n, rosterMask: mask };
  t.panel = { box: g.panel, alpha: op };
  t.inner = g.inner;
  return t;
}

function rosterEntry(id, league, type, psd, label, bgId) {
  const b = base(id, league, type, psd, label, { elements: [], frameId: bgId, background: `templates/${bgId}/background.png`, reference: `templates/${bgId}/reference.png`, thumb: `templates/${bgId}/thumb.jpg` });
  return rosterBuild(b, ROSTER_GEOM[league].defaultN);
}


// ───────────────────────── Forma (form of the last five games) ─────────────────────────
// A compact corner graphic (at most a quarter of the picture: 960 × 263 for one team, 960 × 478 for two): per game a Gy / V badge,
// the opponent's logo (or its name when there is no logo) and the score; the latest game on the right.
const FORM_PANEL = { x: 40, y: 40, w: 960, row: 215, pad: 24 };
// The panel of the compact graphics (form, head to head) is a shape filled with the court texture, so it can be resized freely.
const BORDER = { men: '#0b9444', women: '#ef4036' }; // the PSDs' outline colours
function panelFrame(league, x, y, w, h) {
  return { id: 'panel', type: 'framed', label: 'Panel (háttér + szegély)', group: 'Panel', box: [x + w / 2, y + h / 2, w, h], texture: 'assets/court/court.png',
    stroke: BORDER[league], sw: 6, r: 28, useBase: true, opacity: 0.965, fixedFrame: true, lockAspect: false };
}
function formTpl(id, league, rows) {
  const { x, y, w, row, pad } = FORM_PANEL, op = 0.9882, h = pad * 2 + row * rows;
  const els = [panelFrame(league, x, y, w, h)];
  for (let r = 0; r < rows; r++) {
    const top = y + pad + r * row, k = `t${r}`;
    els.push({ id: `${k}.logo`, type: 'image', label: rows > 1 ? `${r + 1}. csapat logója` : 'Csapat logója', group: rows > 1 ? `${r + 1}. csapat` : 'Csapat', box: [x + pad + 85, top + 100, 140, 140], fit: 'contain', opacity: op, logoOutline: true });
    for (let i = 0; i < 5; i++) {
      const cx = x + pad + 190 + 146 * i + 73, g = rows > 1 ? `${r + 1}. csapat` : 'Mérkőzések';
      els.push(
        { id: `${k}.g${i}.badge`, type: 'image', label: `${i + 1}. meccs – jelvény`, group: g, box: [cx, top + 52, 92, 92], fit: 'contain', opacity: op, fixedSrc: true },
        { id: `${k}.g${i}.logo`, type: 'image', label: `${i + 1}. meccs – ellenfél logója`, group: g, box: [cx, top + 136, 72, 64], fit: 'contain', opacity: op, logoOutline: true },
        { id: `${k}.g${i}.name`, type: 'text', label: `${i + 1}. meccs – ellenfél neve (ha nincs logó)`, group: g, x: cx, y: top + 148, align: 'center', size: 26, tracking: 25, color: '#ffffff', outline: ol(3, '#000000'), maxWidth: 138, opacity: op, caps: true, minScale: 0.6, adjust: true },
        { id: `${k}.g${i}.score`, type: 'text', label: `${i + 1}. meccs – eredmény`, group: g, x: cx, y: top + 204, align: 'center', size: 36, tracking: 25, color: '#ffffff', outline: ol(3, '#000000'), maxWidth: 140, opacity: op, adjust: true },
      );
    }
  }
  const t = base(id, league, rows > 1 ? 'formpair' : 'form', 'Forma', rows > 1 ? 'Forma (két csapat)' : 'Forma', {
    elements: els, background: null, reference: null, thumb: `templates/${rows > 1 ? 'formpair' : 'form'}-${league}/thumb.jpg`,
  });
  t.panel = { box: [x, y, x + w, y + h], alpha: 0.965 };
  t.inner = { box: [x + 8, y + 8, x + w - 8, y + h - 8], r: 22 };
  return t;
}

// ───────────────────────── Head to head (last five meetings) ─────────────────────────
// One row per meeting, newest on top: date · home badge · score · away badge. Panel 680x478 (top-left, like the form graphic).
export const H2H_PANEL = { x: 40, y: 40, w: 680, row: 86, pad: 24, rows: 6 }; // up to 6 meetings; the panel height follows the real number (bindH2H)
function h2hTpl(id, league) {
  const { x, y, w, row, pad, rows } = H2H_PANEL, op = 0.9882, h = pad * 2 + row * rows, els = [panelFrame(league, x, y, w, h)];
  for (let r = 0; r < rows; r++) {
    const cy = y + pad + row * r + row / 2, g = `${r + 1}. meccs`, base = y + pad + row * r + row / 2;
    const txt = (size, extra) => ({ type: 'text', group: g, size, tracking: 25, color: '#ffffff', outline: ol(3, '#000000'), opacity: op, adjust: true, ...extra });
    els.push(
      { ...txt(34, { id: `h${r}.date`, label: `${r + 1}. meccs – dátum`, x: x + pad + 20, y: base + 0.3715 * 34, align: 'left', maxWidth: 190, minScale: 0.6 }) },
      { id: `h${r}.home`, type: 'image', label: `${r + 1}. meccs – hazai`, group: g, box: [x + 290, cy, 84, 72], fit: 'contain', opacity: op, logoOutline: true },
      { ...txt(54, { id: `h${r}.score`, label: `${r + 1}. meccs – eredmény`, x: x + 440, y: base + 0.3715 * 54, align: 'center', maxWidth: 150, minScale: 0.6 }) },
      { id: `h${r}.away`, type: 'image', label: `${r + 1}. meccs – vendég`, group: g, box: [x + 590, cy, 84, 72], fit: 'contain', opacity: op, logoOutline: true },
    );
  }
  const t = base(id, league, 'h2h', 'Forma-panel (saját)', 'Egymás ellen', { elements: els, background: null, reference: null, thumb: `templates/${id}/thumb.jpg` });
  t.panel = { box: [x, y, x + w, y + h], alpha: 0.965 };
  t.inner = { box: [x + 8, y + 8, x + w - 8, y + h - 8], r: 22 };
  return t;
}

// ───────────────────────── Élő statisztika (live player insert) ─────────────────────────
// A thin pop-up strip for timeouts / quarter breaks: the official roster photo of the chosen player, name and a few statistics from the live boxscore.
// It must not hide the broadcaster's score bug: both versions of it sit in the bottom-right corner (measured on the owner's screenshots of the two feeds:
// x 1211–1886, y 931–1044 and x 1425–1876, y 956–1034). Owner's placement (2026-11-24): on the score bug's level, in the middle of the space between the
// left edge of the picture and the score bug (which one depends on the broadcast: BUG.large / BUG.small).
// Two versions of the broadcaster's score bug exist (owner, 2026-11-24): the LARGE one is used on the broadcasts of ETO Basket (women) and Falco (men) only,
// every other partner uses the SMALL one. Zones = keep-out areas [x0, y0, x1, y1] (incl. a little margin and the credit line below the bug);
// the large zone also contains the small one, so it is the safe choice whenever the host is unknown.
// The size follows the ORIGIN OF THE FEED: ETO Basket and Falco produce with hand cameras (large bug), everyone else has the automated production (small bug).
// cx / cy = the middle of the gap between the picture's left edge and the bug (x) and the bug's vertical middle (y): where the live strip is centred (owner 2026-11-24).
// Measured heights: large bug 931–1045 (115 px) + credit line down to ≈ 1070 (together ≈ 139 px); small bug 958–1034 (77 px) + credit line to ≈ 1051 (together ≈ 94 px).
export const BUG = {
  large: { zone: [1200, 925, 1920, 1080], cx: 600, cy: 988, label: 'Nagy eredményjelző (ETO Basket, Falco): 1213–1887 × 931–1045 px' },
  small: { zone: [1410, 945, 1920, 1080], cx: 712, cy: 995, label: 'Kis eredményjelző (a többi partner): 1425–1874 × 958–1034 px' },
};
export const LARGE_BUG_CLUBS = { women: ['sercounigyor'], men: ['falcokc'] }; // club ids (clubs.js) that broadcast with the large score bug
export const bugSizeOf = (league, homeId) => (LARGE_BUG_CLUBS[league] || []).includes(homeId) ? 'large' : 'small';
export const bugOf = size => BUG[size] || BUG.large;
export const LIVE_CORNERS = { gap: 'Alul, az eredményjelző szintjén (a rés közepén)', tl: 'Bal felül' };
export const liveCorner = c => (LIVE_CORNERS[c] ? c : 'gap');
const LIVE_PAD = 10, LIVE_PHOTO_W = 120, LIVE_LOGO_W = 120, LIVE_GAP = 8, LIVE_LOGO_D = 100; // LIVE_LOGO_D: the club logo is 100 px (owner 2026-11-24, chosen over 75), centred in its column
// colours (owner 2026-11-24): the name and the category labels share one colour (white), the numbers stand out in gold
export const LIVE_COLORS = { name: '#ffffff', label: '#ffffff', value: '#ffc929' };
export const LIVE_VARIANTS = {
  basic: { label: 'Alap (PTS · REB · AST)', stats: 330, h: 150, cols: 3, val: 60, lab: 26, cells: [{ key: 'pts', label: 'PTS' }, { key: 'reb', label: 'REB' }, { key: 'ast', label: 'AST' }] },
  shooting: { label: 'Dobások (2P · 3P · BT)', stats: 330, h: 140, cols: 3, val: 52, lab: 24, cells: [{ key: 'fg2', label: '2P' }, { key: 'fg3', label: '3P' }, { key: 'ft', label: 'BT' }] },
  full: { label: 'Teljes sor', stats: 756, h: 130, cols: 9, val: 40, lab: 22, cells: [{ key: 'min', label: 'PERC' }, { key: 'pts', label: 'PTS' }, { key: 'reb', label: 'REB' }, { key: 'ast', label: 'AST' }, { key: 'stl', label: 'STL' }, { key: 'blk', label: 'BLK' }, { key: 'tov', label: 'TOV' }, { key: 'pf', label: 'FAULT' }, { key: 'eff', label: 'EFF' }] },
};
export const liveWidth = v => LIVE_PAD * 2 + LIVE_PHOTO_W + LIVE_LOGO_W + LIVE_GAP * 2 + LIVE_VARIANTS[liveVariant(v)].stats; // photo | name + figures | club logo
export const liveVariant = v => (LIVE_VARIANTS[v] ? v : 'basic');
export const LIVE_BUILDERS = {}; // template id → (variant, place, bugSize) => template (see app.js tpl())
export const livePlace = (w, h, place, size = 'large') => { // top-left corner of the strip: in the middle of the gap left of the score bug, on its level
  const z = bugOf(size);
  return place === 'tl' ? [40, 40] : [Math.round(z.cx - w / 2), Math.min(Math.round(z.cy - h / 2), 1060 - h)];
};

function liveTpl(id, league, variantIn, placeIn, sizeIn) {
  const variant = liveVariant(variantIn), place = liveCorner(placeIn), size = BUG[sizeIn] ? sizeIn : 'large', V = LIVE_VARIANTS[variant], h = V.h, w = liveWidth(variant), pad = LIVE_PAD, op = 0.9882;
  const [x, y] = livePlace(w, h, place, size);
  const sw = 3, C = LIVE_COLORS;
  const txt = (size2, extra) => ({ type: 'text', size: size2, tracking: 25, color: '#ffffff', outline: ol(2, '#000000'), opacity: op, adjust: true, ...extra });
  const left = x + pad + LIVE_PHOTO_W + LIVE_GAP, right = left + V.stats, photoH = h - 8, logoD = LIVE_LOGO_D;
  const mid = (left + right) / 2; // the middle of the figures row: the name is centred on it
  const els = [
    { ...panelFrame(league, x, y, w, h), sw, r: 14 },
    { id: 'logo', type: 'image', label: 'Klublogó', group: 'Fejléc', box: [x + w - pad - LIVE_LOGO_W / 2, y + h / 2, logoD, logoD], fit: 'contain', opacity: op, logoOutline: true, maxOutline: 2 },
    { id: 'photo', type: 'image', label: 'Játékos fotó (hivatalos)', group: 'Fotó', box: [x + 6 + LIVE_PHOTO_W / 2, y + h - 4 - photoH / 2, LIVE_PHOTO_W, photoH], fit: 'contain', anchor: 'bottom', clipInner: true, opacity: 1 },
    txt(46, { id: 'name', label: 'Név', group: 'Fejléc', x: mid, y: y + pad + 38, align: 'center', runs: true, color: C.name, maxWidth: V.stats - 6, minScale: 0.5, tracking: 30, outline: ol(2.5, '#000000', 1) }),
  ];
  const colW = V.stats / V.cols, top = y + 58;
  V.cells.forEach((c, i) => {
    const cx = left + colW * (i + 0.5), val = top + V.val * 0.743, lab = val + V.lab + 5, g = `${i + 1}. statisztika`;
    els.push(
      txt(V.val, { id: `c${i}.value`, label: `${c.label} – érték`, group: g, x: cx, y: val, align: 'center', color: C.value, maxWidth: colW - 4, minScale: 0.5 }),
      txt(V.lab, { id: `c${i}.label`, label: `${c.label} – felirat`, group: g, x: cx, y: lab, align: 'center', color: C.label, maxWidth: colW - 4, minScale: 0.6 }),
    );
  });
  const t = base(id, league, 'livestat', 'Élő statisztika (saját)', 'Élő statisztika', { elements: els, background: null, reference: null, thumb: `templates/${id}/thumb.jpg` });
  t.panel = { box: [x, y, x + w, y + h], alpha: 0.965 };
  t.inner = { box: [x + sw + 1, y + sw + 1, x + w - sw - 1, y + h - sw - 1], r: 11 };
  t.live = { variant, place, size };
  return t;
}
function liveEntry(id, league) {
  LIVE_BUILDERS[id] = (v, p, z) => liveTpl(id, league, v, p, z);
  return LIVE_BUILDERS[id]('basic', 'gap', 'large');
}

// ───────────────────────── Vezetőedző nyilatkozata (coach interview) ─────────────────────────
// Geometry and type of the owner's prototype "Hegedűs ITW BEAC előtt - 0924.psd" (women); the men's graphic has the same layout with the men's outline colour.
// Left: the coach's cut-out photo (always an upload); right: the quote (small caps like the PSD or plain capitals, shrinks to fit), name, subtitle; club logo
// bottom right; Hunbasket · Tippmix · Play by Play strip under the panel (templates/coach/strip.png, taken from the PSD).
export const COACH_PANEL = { x0: 45, y0: 14, x1: 1455, y1: 944 };
export const COACH_LOOKS = { smallcaps: 'Kiskapitális (mint a PSD-ben)', caps: 'Nagybetű (egyforma méret)' };
export const coachLook = l => (COACH_LOOKS[l] ? l : 'smallcaps');
function coachTpl(id, league) {
  const op = 0.9882, { x0, y0, x1, y1 } = COACH_PANEL, w = x1 - x0, h = y1 - y0, sw = 8;
  const txt = (extra) => ({ type: 'text', align: 'left', color: '#ffffff', opacity: op, adjust: true, ...extra });
  const els = [
    { id: 'panel', type: 'framed', label: 'Panel (háttér + szegély)', group: 'Panel', box: [(x0 + x1) / 2, (y0 + y1) / 2, w, h], texture: 'assets/court/court.png', stroke: BORDER[league], sw, r: 25, useBase: true, opacity: op, fixedFrame: true, lockAspect: false },
    { id: 'photo', type: 'image', label: 'Edző fotója (feltöltött, áttetsző PNG)', group: 'Fotó', box: [328, 488.5, 570, 895], fit: 'contain', anchor: 'bottom', clipInner: true, fixedSrc: true, opacity: op },
    txt({ id: 'quote', label: 'Nyilatkozat', group: 'Szöveg', x: 475.5, y: 60.4, size: 45.83, tracking: 10, lineHeight: 58.3, maxWidth: 963, maxHeight: 735, minScale: 0.45, paragraph: true, outline: ol(4, '#000000', 1) }),
    txt({ id: 'name', label: 'Név', group: 'Szöveg', x: 475.5, y: 873.25, size: 108.33, tracking: -20, color: '#010101', outline: ol(4, '#ffffff'), caps: true, maxWidth: 780, minScale: 0.5 }),
    txt({ id: 'subtitle', label: 'Alcím', group: 'Szöveg', x: 476.5, y: 927, size: 45.83, tracking: -20, outline: ol(3, '#000000'), caps: true, maxWidth: 790, minScale: 0.6 }),
    { id: 'logo', type: 'image', label: 'Klublogó', group: 'Fejléc', box: [1348.5, 838, 124, 124], fit: 'contain', opacity: op, logoOutline: true },
    { id: 'strip', type: 'image', label: 'Logósor (Hunbasket · Tippmix · Play by Play)', group: 'Panel', box: [750.5, 1024, 467, 80], fit: 'contain', fixedSrc: true, fixedFrame: true },
  ];
  const t = base(id, league, 'coach', 'Hegedűs ITW BEAC előtt - 0924.psd', 'Vezetőedző nyilatkozata', { elements: els, background: null, reference: null, thumb: `templates/${id}/thumb.jpg` });
  t.elements.find(e => e.id === 'quote').hscale = 0.8336; // the PSD stretches the quote vertically (x 1.786, y 2.142): size = the taller scale, width squeezed
  t.panel = { box: [x0, y0, x1, y1], alpha: op };
  t.inner = { box: [x0 + sw, y0 + sw, x1 - sw, y1 - sw], r: 17 };
  return t;
}

// ───────────────────────── Extra (MKOSZ) – freely sized frames ─────────────────────────
// "Background for extra graphics + QR code outliner.psd": a tall photo frame and a square QR frame (brown fill, gold border, radius 18).
// Both are drawn as shapes (not as a picture), so they can be moved and resized freely; the uploaded photo / QR code sits inside.
function extraTpl(id, league) {
  const look = { fill: '#2d0909', stroke: '#b58d41', sw: 6, r: 18 };
  return base(id, league, 'extra', 'Background for extra graphics + QR code outliner.psd', 'Extra (MKOSZ)', {
    elements: [
      { id: 'frameA', type: 'framed', label: 'Fotókeret', group: 'Fotókeret', box: [317, 540, 580, 1026], fit: 'cover', pad: 0, ...look },
      { id: 'frameB', type: 'framed', label: 'QR-keret', group: 'QR-keret', box: [849, 540, 316, 320], fit: 'contain', pad: 14, ...look },
    ],
    background: null, reference: null, thumb: 'templates/extra/thumb.jpg',
  });
}

// ───────────────────────── Template registry ─────────────────────────
function pcEntry(id, league, psd, g) {
  PC_BUILDERS[id] = rows => comparison(id, league, psd, g, 'playercompare', rows);
  return PC_BUILDERS[id](null);
}

export const TEMPLATES = [
  comparison('comparison-men', 'men', 'Falco - Alba statösszevetés 1111 előtt.psd', {
    subX: 602.2, hv: 342, av: 852.8, hr: 112, ar: 1086, rankY: 256.5, rankTracking: 25, hl: [348, 590], al: [853.5, 589],
    sample: comparisonSample('FULLFIELD.INFO',
      ['95.1', '59.1%', '38.1%', '78.2%', '42.1', '21.4', '9.0', '10.7', '122.4'],
      ['89.6', '57.1%', '32.7%', '76.0%', '41.0', '19.9', '6.6', '11.0', '107.1'],
      [2, 2, 3, 4, 2, 2, 3, 2, 2], [5, 4, 5, 6, 3, 3, 10, 3, 3],
      [1, 1, 1, 1, 1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0, 0, 0, 0], 'men/falcokc', 'men/albafehervar'),
  }),
  comparison('comparison-women', 'women', 'DVTK - CSATA statösszevetés 1122 előtt.psd', {
    subX: 648.2, hv: 388, av: 914.8, hr: 156, ar: 1122, rankY: 251.5, rankTracking: -20, hl: [391, 589], al: [917, 586],
    sample: comparisonSample('FULLFIELD.INFO',
      ['77.5', '50.2%', '33.6%', '65.8%', '46.3', '22.0', '10.8', '15.3', '102.8'],
      ['74.7', '46.0%', '30.8%', '71.3%', '39.1', '17.2', '10.4', '14.9', '86.1'],
      [3, 3, 2, 9, 1, 1, 6, 3, 2], [4, 7, 5, 4, 6, 6, 8, 2, 4],
      [1, 1, 1, 0, 1, 1, 1, 0, 1], [0, 0, 0, 1, 0, 0, 0, 1, 0], 'women/dvtkhuntherm', 'women/csatattk'),
  }),
  teamstats('teamstats-men', 'men', 'Falco csapatstat 9. ford után 1114.psd', {
    rows: 13, rowY: 228, pitch: 55.95, rowSize: 55.95, headerY: 175, headerSize: 39.96,
    numX: 216.5, playerX: 267, playerMax: 470, hdrNameX: 420,
    logoBox: [263.5, 78.5, 95, 95], nameX: 350, nameY: 113.8, nameMax: 1290, panelCenter: 925.5, logoGap: 39,
  }),
  teamstats('teamstats-women', 'women', 'DVTK csapatstat 7. ford után 1122.psd', {
    rows: 12, rowY: 247, pitch: 58.333, rowSize: 58.333, headerY: 191, headerSize: 41.667,
    numX: 232, playerX: 285, playerMax: 490, hdrNameX: 445,
    logoBox: [657, 82, 92, 100], nameX: 754, nameY: 118.5, nameMax: 1300, panelCenter: 959.5, logoGap: 51,
  }),
  rowList('results-men', 'men', 'results', 'Falco  LAST Games Graph 1111.psd', 'Eredmények', {
    rows: 6, rowY: 325, dateX: 118, dateMax: 260, matchX: 500, matchMax: 740, scoreX: 1421,
    compX: 424, compW: 76, compH: 69, titleX: 774, titleMax: 910,
    crestL: [223, 132, 160, 150], crestR: [1329, 132, 160, 150],
  }),
  rowList('results-women', 'women', 'results', 'DVTK Last Games - 1025.psd', 'Eredmények', {
    rows: 6, rowY: 323, dateX: 85, dateMax: 260, matchX: 424, matchMax: 740, scoreX: 1346,
    compX: 377.5, compW: 70, compH: 75, titleX: 716, titleMax: 780,
    crestL: [237, 132, 160, 150], crestR: [1196, 132, 160, 150],
  }),
  rowList('schedule-men', 'men', 'schedule', 'Falco  Next Games Graph 1111.psd', 'Következő mérkőzések (menetrend)', {
    rows: 6, rowY: 323, dateX: 130, dateMax: 420, matchX: 724, matchMax: 715,
    compX: 619, compW: 76, compH: 69, titleX: 774, titleMax: 910,
    crestL: [223, 132, 160, 150], crestR: [1329, 132, 160, 150],
  }),
  // 6-row panel of the "Női Next Games Graph" PSD, laid out like the men's schedule (the schedule always shows >= 5 games)
  rowList('schedule-women', 'women', 'schedule', 'Női Next Games Graph.psd', 'Következő mérkőzések (menetrend)', {
    rows: 6, rowY: 323, dateX: 130, dateMax: 420, matchX: 724, matchMax: 715,
    compX: 619, compW: 76, compH: 69, titleX: 774, titleMax: 910,
    crestL: [232.5, 129, 160, 150], crestR: [1316.5, 129, 160, 150],
  }),
  rowList('resultrows-men', 'men', 'resultrows', 'Férfi Next Games Graph.psd', 'Eredmények (színes sorok)', {
    rows: 6, rowY: 323, dateX: 160, dateMax: 280, matchX: 457, matchMax: 740, scoreX: 1380, titleX: 774, titleMax: 880,
    crestL: [232.5, 129, 160, 150], crestR: [1316.5, 129, 160, 150],
  }),
  rowList('resultrows-women', 'women', 'resultrows', 'Női Next Games Graph.psd', 'Eredmények (színes sorok)', {
    rows: 6, rowY: 323, dateX: 160, dateMax: 280, matchX: 457, matchMax: 740, scoreX: 1380, titleX: 774, titleMax: 880,
    crestL: [232.5, 129, 160, 150], crestR: [1316.5, 129, 160, 150],
  }),
  intro('intro-men', 'men', 'Férfi Intro Graph 26-27.psd', {
    roundX: 960.7, roundY: 184.5, roundFont: 'italic', venueSize: 50, awayX: 1294,
    sample: {
      round: { text: 'Alapszakasz - 1. forduló - 2026.09.25. - 19.00' }, venue: { text: 'Novomatic Aréna' },
      'home.name': { text: 'SOPRON KC' }, 'away.name': { text: 'DEAC' },
      'home.logo': { src: 'women/sercounigyor' }, 'away.logo': { src: 'women/eltebeacujbuda' },
    },
  }),
  intro('intro-women', 'women', 'Női Intro Graph 26-27.psd', {
    roundX: 961.7, roundY: 182.5, roundFont: 'regular', venueSize: 45.833, awayX: 1296,
    sample: {
      round: { text: 'Alapszakasz - 1. forduló - 2026.09.24. - 18.00' }, venue: { text: 'Olimpiai Sport Park' },
      'home.name': { text: 'ETO BASKET' }, 'away.name': { text: 'ELTE BEAC\nÚJBUDA' },
      'home.logo': { src: 'women/sercounigyor' }, 'away.logo': { src: 'women/eltebeacujbuda' },
    },
  }),
  pcEntry('playercompare-men', 'men', 'Falco - Alba statösszevetés 1111 előtt.psd', {
    subX: 602.2, titleX: 605.5, cx: 605, hv: 342, av: 852.8, hr: 112, ar: 1086, rankY: 256.5, rankTracking: 25, hl: [348, 590], al: [853.5, 589],
  }),
  pcEntry('playercompare-women', 'women', 'DVTK - CSATA statösszevetés 1122 előtt.psd', {
    subX: 648.2, titleX: 651.5, cx: 651, hv: 388, av: 914.8, hr: 156, ar: 1122, rankY: 251.5, rankTracking: -20, hl: [391, 589], al: [917, 586],
  }),
  playerspecial('playerspecial-men', 'men', 'Uros STAT.psd'),
  playerspecial('playerspecial-women', 'women', 'Kányási - 324 vs idei 7 meccs.psd'),
  rosterEntry('roster-men', 'men', 'roster', 'FALCO keret 26-27.psd', 'Keret (tábla)', 'roster-men'),
  rosterEntry('roster-women', 'women', 'roster', 'DVTK keret 26-27.psd', 'Keret (tábla)', 'roster-women'),
  rosterEntry('rostergrid-men', 'men', 'rostergrid', 'FALCO keret 26-27.psd', 'Keret (fotókkal)', 'roster-men'),
  rosterEntry('rostergrid-women', 'women', 'rostergrid', 'DVTK keret 26-27.psd', 'Keret (fotókkal)', 'roster-women'),
  formTpl('form-men', 'men', 1),
  formTpl('form-women', 'women', 1),
  formTpl('formpair-men', 'men', 2),
  formTpl('formpair-women', 'women', 2),
  h2hTpl('h2h-men', 'men'),
  h2hTpl('h2h-women', 'women'),
  coachTpl('coach-men', 'men'),
  coachTpl('coach-women', 'women'),
  liveEntry('livestat-men', 'men'),
  liveEntry('livestat-women', 'women'),
  extraTpl('extra-men', 'men'),
  extraTpl('extra-women', 'women'),
  nextmatch('nextmatch-men', 'men'),
  nextmatch('nextmatch-women', 'women'),
  referees('referees-men', 'men', 'Sporik ffi alap.psd', {
    fontNote: 'A PSD Satoshi betűtípust használ; a stúdió kérésre League Gothic-kal rendereli (a női változat tipográfiájával).',
    sample: { ref1: { text: 'Goda László' }, ref2: { text: 'Major Ádám' }, ref3: { text: 'Söjtöry Tamás Ferenc' }, controller: { text: 'Forrai Sámuel' } },
  }),
  referees('referees-women', 'women', 'Sporik női alap.psd', {
    sample: { ref1: { text: 'Györfy Rúben' }, ref2: { text: 'Major Ádám' }, ref3: { text: 'Gombos Márk Bálint' }, controller: { text: 'Szabó Anita' } },
  }),
];

export const TEMPLATE_TYPES = {
  nextmatch: 'Következik',
  intro: 'Intro',
  comparison: 'Csapatok összevetése',
  playercompare: PC_LABEL,
  playerspecial: 'Játékos-különleges',
  form: 'Forma',
  formpair: 'Forma (két csapat)',
  roster: 'Keret (tábla)',
  rostergrid: 'Keret (fotókkal)',
  teamstats: 'Csapatstatisztika',
  results: 'Eredmények',
  resultrows: 'Eredmények (színes sorok)',
  schedule: 'Menetrend',
  referees: 'Játékvezetők',
  h2h: 'Egymás ellen',
  extra: 'Extra (MKOSZ)',
  livestat: 'Élő statisztika (játékos)',
  coach: 'Vezetőedző nyilatkozata',
};

export function templateById(id) { return TEMPLATES.find(t => t.id === id); }

// samples that need geometry from TEMPLATES (row lists, team stats) are built lazily
export { GREEN, RED, WIN, WHITE_TXT };
