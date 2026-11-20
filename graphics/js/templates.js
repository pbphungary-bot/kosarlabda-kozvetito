// Template definitions. Every coordinate, size, colour, tracking and outline
// value below is taken from the source PSD (see graphics/templates/<id>/layers.json
// and tools/psd_extract.py). x/y are the text anchor and baseline in canvas pixels.
// `sample` reproduces the PSD's own content so the render can be diffed against
// Photoshop's composite (tests/visual.mjs).

import { HSCALE } from './calibration.js';

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
  if (id === 'subtitle' || id === 'title' || id === 'round' || id === 'venue') return id;
  if (type === 'comparison') return id.includes('.rank.') ? 'rank' : 'value';
  if (type === 'teamstats') return id === 'team.name' ? 'teamname' : (/\.name$|^hdr\./.test(id) ? 'name' : 'figure');
  if (type === 'intro') return id.endsWith('.rank') ? 'round' : 'name';
  if (type === 'referees') return id.startsWith('controller') ? 'controller' : 'name';
  const m = id.match(/\.(date|match|score)$/);
  return m ? m[1] : null;
}

const base = (id, league, type, psd, label, extra) => {
  const t = {
    id, league, type, psd, label, width: W, height: H,
    background: `templates/${id}/background.png`, reference: `templates/${id}/reference.png`, ...extra,
  };
  for (const el of t.elements) {
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
function comparison(id, league, psd, g) {
  const els = [
    { id: 'subtitle', type: 'text', label: 'Alcím (adatforrás)', group: 'Fejléc', x: g.subX, y: 163.2, align: 'center',
      font: 'italic', size: 48, tracking: 10, color: '#000000', outline: ol(3, '#ffffff'), runs: true, maxWidth: 1150 },
    { id: 'home.logo', type: 'image', label: 'Hazai logó', group: 'Hazai', box: [g.hl[0], g.hl[1], 471, 400], fit: 'area', area: 152000, opacity: 0.702, logoOutline: true },
    { id: 'away.logo', type: 'image', label: 'Vendég logó', group: 'Vendég', box: [g.al[0], g.al[1], 471, 400], fit: 'area', area: 152000, opacity: 0.702, logoOutline: true },
  ];
  STAT_ROWS.forEach((s, i) => {
    const y = 253.5 + i * 90.6667;
    const yr = g.rankY + i * 89.6;
    const common = { size: 74.6667, tracking: 25, outline: ol(3, '#ffffff', 1), align: 'center', maxWidth: 170 };
    els.push(
      { id: `home.rank.${s.key}`, type: 'text', label: `Hazai ${s.label} helyezés`, group: 'Hazai', x: g.hr, y: yr, ...common, tracking: g.rankTracking, color: '#383838', maxWidth: 110 },
      { id: `home.${s.key}`, type: 'text', label: `Hazai ${s.label}`, group: 'Hazai', x: g.hv, y, ...common, color: GREEN },
      { id: `away.${s.key}`, type: 'text', label: `Vendég ${s.label}`, group: 'Vendég', x: g.av, y, ...common, color: RED },
      { id: `away.rank.${s.key}`, type: 'text', label: `Vendég ${s.label} helyezés`, group: 'Vendég', x: g.ar, y: yr, ...common, tracking: g.rankTracking, color: '#373737', maxWidth: 110 },
    );
  });
  return base(id, league, 'comparison', psd, 'Csapatok összevetése', { elements: els, sample: g.sample });
}

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
  const name = { type: 'text', y: 809.5, size: 100, tracking: 10, color: WHITE_TXT, caps: true, outline: ol(4, '#000000', 1), align: 'center', maxWidth: 400, lineHeight: 120, wrap: { maxLines: 2, anchor: 'middle' }, minScale: 0.6 };
  const rank = { type: 'text', y: 909.5, size: 58.333, tracking: -20, color: '#ef4036', outline: ol(2, '#ffffff'), align: 'center', maxWidth: 420, visible: false };
  const els = [
    { id: 'round', type: 'text', label: 'Forduló, dátum, időpont', group: 'Mérkőzés', x: g.roundX, y: g.roundY, font: g.roundFont, size: 50, tracking: 10, color: WHITE_TXT, outline: ol(4, '#000000', 1), align: 'center', maxWidth: 900 },
    { id: 'venue', type: 'text', label: 'Helyszín', group: 'Mérkőzés', x: 960.7, y: 244.5, size: g.venueSize, tracking: -20, color: WHITE_TXT, outline: ol(4, '#000000', 1), align: 'center', maxWidth: 560 },
    { id: 'home.logo', type: 'image', label: 'Hazai logó', group: 'Hazai', box: [628, 475, 384, 350], fit: 'contain', logoOutline: true },
    { id: 'away.logo', type: 'image', label: 'Vendég logó', group: 'Vendég', box: [1295, 473.5, 384, 350], fit: 'contain', logoOutline: true },
    { id: 'home.name', label: 'Hazai csapatnév', group: 'Hazai', ...name, x: 625 },
    { id: 'away.name', label: 'Vendég csapatnév', group: 'Vendég', ...name, x: g.awayX },
    { id: 'home.rank', label: 'Hazai helyezés / mérleg', group: 'Hazai', ...rank, x: 627.8 },
    { id: 'away.rank', label: 'Vendég helyezés / mérleg', group: 'Vendég', ...rank, x: 1294.8 },
  ];
  return base(id, league, 'intro', psd, 'Intro (mérkőzés felvezető)', { elements: els, sample: g.sample });
}

// ───────────────────────── Játékvezetők ─────────────────────────
function referees(id, league, psd, g) {
  const nm = { type: 'text', group: 'Játékvezetők', x: 969, size: 58.333, tracking: 10, color: WHITE_TXT, caps: true, outline: ol(5, '#030303'), align: 'left', maxWidth: 430 };
  const els = [
    { id: 'ref1', label: '1. játékvezető', ...nm, y: 779 },
    { id: 'ref2', label: '2. játékvezető', ...nm, y: 833 },
    { id: 'ref3', label: '3. játékvezető', ...nm, y: 887 },
    { id: 'controller.label', type: 'text', label: 'Ellenőr felirat', group: 'Ellenőr', x: 590, y: 954, size: 45.833, tracking: 25, color: '#fffefe', outline: ol(5, '#030303'), align: 'left', fixed: true, defaultText: 'MKOSZ Ellenőr:' },
    { id: 'controller', type: 'text', label: 'MKOSZ ellenőr', group: 'Ellenőr', x: 967, y: 954, size: 45.833, tracking: 25, color: '#fffefe', outline: ol(5, '#030303'), align: 'left', maxWidth: 430 },
  ];
  return base(id, league, 'referees', psd, 'Játékvezetők', { elements: els, sample: g.sample, fontNote: g.fontNote });
}

// ───────────────────────── Template registry ─────────────────────────
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
  rowList('schedule-women', 'women', 'schedule', 'DVTK Next Games - 1025.psd', 'Következő mérkőzések (menetrend)', {
    rows: 4, rowY: 369, dateX: 152, dateMax: 420, matchX: 661, matchMax: 740,
    compX: 609, compW: 70, compH: 75, titleX: 774, titleMax: 780,
    crestL: [295, 132, 160, 150], crestR: [1254, 132, 160, 150],
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
  referees('referees-men', 'men', 'Sporik ffi alap.psd', {
    fontNote: 'A PSD Satoshi betűtípust használ; a stúdió kérésre League Gothic-kal rendereli (a női változat tipográfiájával).',
    sample: { ref1: { text: 'Goda László' }, ref2: { text: 'Major Ádám' }, ref3: { text: 'Söjtöry Tamás Ferenc' }, controller: { text: 'Forrai Sámuel' } },
  }),
  referees('referees-women', 'women', 'Sporik női alap.psd', {
    sample: { ref1: { text: 'Györfy Rúben' }, ref2: { text: 'Major Ádám' }, ref3: { text: 'Gombos Márk Bálint' }, controller: { text: 'Szabó Anita' } },
  }),
];

export const TEMPLATE_TYPES = {
  intro: 'Intro',
  comparison: 'Csapatok összevetése',
  teamstats: 'Csapatstatisztika',
  results: 'Eredmények',
  resultrows: 'Eredmények (színes sorok)',
  schedule: 'Menetrend',
  referees: 'Játékvezetők',
};

export function templateById(id) { return TEMPLATES.find(t => t.id === id); }

// samples that need geometry from TEMPLATES (row lists, team stats) are built lazily
export { GREEN, RED, WIN, WHITE_TXT };
