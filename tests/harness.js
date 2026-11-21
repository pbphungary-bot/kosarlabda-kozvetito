// Browser-side test harness: renders a template with the PSD's own sample content
// (rebuilt from graphics/templates/<id>/layers.json) and diffs it against
// Photoshop's flattened composite (reference.png).
import { render, loadFonts, logoOutlines } from '../graphics/js/engine.js';
import { TEMPLATES, templateById, TEAMSTAT_COLS } from '../graphics/js/templates.js';

const G = '../graphics/';
const img = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(src)); i.src = src; });

const COMP_ROWS = {
  'results-women': { 0: 'comp/euroleague-women', 3: 'comp/eurocup-women', 5: 'comp/eurocup-women' },
  'schedule-women': { 0: 'comp/eurocup-women', 2: 'comp/eurocup-women' },
  'results-men': { 1: 'comp/bcl', 4: 'comp/bcl' },
  'schedule-men': { 1: 'comp/bcl', 5: 'comp/bcl' },
};
const CREST = { 'results-women': 'women/dvtkhuntherm', 'schedule-women': 'women/dvtkhuntherm', 'results-men': 'men/falcokc', 'schedule-men': 'men/falcokc', 'resultrows-men': 'women/csatattk', 'resultrows-women': 'women/csatattk', 'teamstats-men': 'men/falcokc', 'teamstats-women': 'women/dvtkhuntherm' };

function runsToLines(runs) {
  // → [[{text,color}...] per line]
  const lines = [[]];
  for (const r of runs) {
    const parts = r.text.split('\r');
    parts.forEach((p, i) => { if (i > 0) lines.push([]); if (p) lines[lines.length - 1].push({ text: p, color: r.color }); });
  }
  return lines;
}

function cellsOf(line) {
  // split a line into tab-separated cells, keeping the colour of each cell
  const cells = [];
  let cur = null;
  for (const seg of line) {
    const pieces = seg.text.split('\t');
    pieces.forEach((p, i) => {
      if (i > 0) cur = null;
      const t = p.trim();
      if (!t) return;
      if (!cur) { cur = { text: t, color: seg.color }; cells.push(cur); } else cur.text += (p.startsWith(' ') ? ' ' : '') + t;
    });
    if (seg.text.endsWith(' ') && cur) cur.text += ' ';
  }
  cells.forEach(c => { c.text = c.text.trim(); });
  return cells;
}

async function sampleValues(t) {
  if (t.sample && (t.type === 'comparison' || t.type === 'intro' || t.type === 'referees' || t.type === 'nextmatch')) {
    const v = structuredClone(t.sample);
    if (t.type === 'referees') v['controller.label'] = { text: 'MKOSZ Ellenőr:' };
    return v;
  }
  const L = await (await fetch(`${G}templates/${t.id}/layers.json`)).json();
  const texts = L.layers.filter(l => l.kind === 'type' && l.visible && l.typography?.text.trim());
  const v = {};
  if (t.type === 'teamstats') {
    const table = texts.find(l => l.typography.text.includes('Játékos'));
    const title = texts.find(l => l !== table);
    v['team.name'] = { text: title.typography.text, color: title.typography.runs[0].color, outline: { size: 3, color: title.effects[0].color, dx: 0, dy: 0 } };
    v['team.name'].geom = { x: t.geometry.nameX, size: 100 * (t.league === 'men' ? 0.9591 : 1) };
    v['team.logo'] = { src: CREST[t.id] };
    const lines = runsToLines(table.typography.runs).filter(l => l.length).slice(1);
    const cols = TEAMSTAT_COLS[t.league];
    lines.forEach((line, r) => {
      const cells = cellsOf(line);
      if (cells.length < 3) return;
      v[`r${r}.num`] = { text: cells[0].text };
      v[`r${r}.name`] = { text: cells[1].text };
      cols.forEach((c, k) => { const cell = cells[2 + k]; if (cell) v[`r${r}.${c.key}`] = { text: cell.text.replace('©', '').trim(), color: cell.color }; });
    });
    for (const e of t.elements) if (e.defaultText) v[e.id] = { text: e.defaultText };
    return v;
  }
  // row lists
  const rowsLayer = texts.find(l => /\d{4}\.\d\d\.\d\d/.test(l.typography.text));
  const titleLayer = texts.find(l => l !== rowsLayer);
  v.title = { text: titleLayer.typography.text.replace(/\r$/, '').replace('\r', '\n').trim() };
  v['team.logo.left'] = { src: CREST[t.id] };
  v['team.logo.right'] = { src: CREST[t.id] };
  const lines = runsToLines(rowsLayer.typography.runs).filter(l => l.length && l.some(s => s.text.trim()));
  lines.forEach((line, r) => {
    const cells = cellsOf(line);
    // schedule rows: "date - time", match ; results: date, match (may be split by a tab), score
    const date = cells[0];
    const scoreCell = /^\d+-\d+$/.test(cells.at(-1).text) ? cells.at(-1) : null;
    const mid = cells.slice(1, scoreCell ? -1 : undefined);
    v[`r${r}.date`] = { text: date.text, color: date.color };
    v[`r${r}.match`] = { text: mid.map(c => c.text).join(' ').replace(/\s+/g, ' '), color: mid[0]?.color };
    if (scoreCell) v[`r${r}.score`] = { text: scoreCell.text, color: scoreCell.color };
    v[`r${r}.comp`] = { src: COMP_ROWS[t.id]?.[r] || '' };
  });
  return v;
}

let assetsCache = null;
async function assets() {
  if (assetsCache) return assetsCache;
  const keys = new Set();
  for (const t of TEMPLATES) {
    const v = await sampleValues(t);
    Object.values(v).forEach(x => x?.src && keys.add(x.src));
  }
  const images = {};
  for (const k of keys) images[k] = await img(k.startsWith('comp/') ? `${G}assets/competitions/${k.slice(5)}.png` : `${G}logos/${k}.png`);
  return (assetsCache = images);
}

window.harness = {
  ids: TEMPLATES.filter(t => t.sample).map(t => t.id),
  async init() { return loadFonts(G + 'fonts/'); },
  async renderSample(id) {
    const t = templateById(id);
    const values = await sampleValues(t);
    const images = await assets();
    const bg = t.background ? await img(G + t.background) : null;
    const canvas = document.createElement('canvas');
    const outlines = logoOutlines(await (await fetch(G + 'logos/logos.json')).json());
    const report = render(canvas, t, values, { background: bg, images, outlines });
    const ref = await img(G + t.reference);
    const rc = document.createElement('canvas'); rc.width = t.width; rc.height = t.height;
    const rg = rc.getContext('2d'); rg.drawImage(ref, 0, 0);
    const a = canvas.getContext('2d').getImageData(0, 0, t.width, t.height).data;
    const b = rg.getImageData(0, 0, t.width, t.height).data;
    const diff = new ImageData(t.width, t.height);
    let bad = 0, sum = 0, n = 0;
    for (let i = 0; i < a.length; i += 4) {
      // compare over a neutral backdrop so alpha differences count
      const aa = a[i + 3] / 255, ba = b[i + 3] / 255;
      if (aa === 0 && ba === 0) continue;
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a[i + c] * aa + 40 * (1 - aa) - (b[i + c] * ba + 40 * (1 - ba))));
      n++; sum += d;
      if (d > 48) { bad++; diff.data[i] = 255; diff.data[i + 1] = 40; diff.data[i + 2] = 40; diff.data[i + 3] = 255; }
      else { diff.data[i] = diff.data[i + 1] = diff.data[i + 2] = 255; diff.data[i + 3] = 40; }
    }
    // shift-tolerant metric: a pixel is wrong only if no reference pixel within 1 px matches it
    const W = t.width, Hh = t.height;
    const comp = (d, i) => { const al = d[i + 3] / 255; return [0, 1, 2].map(c => d[i + c] * al + 40 * (1 - al)); };
    let tbad = 0;
    for (let y = 1; y < Hh - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = (y * W + x) * 4;
      if (diff.data[i] !== 255 || diff.data[i + 1] !== 40) continue; // only pixels already flagged
      const pa = comp(a, i);
      let ok = false;
      for (let dy = -1; dy <= 1 && !ok; dy++) for (let dx = -1; dx <= 1 && !ok; dx++) {
        const pb = comp(b, ((y + dy) * W + x + dx) * 4);
        if (Math.max(...pa.map((v, c) => Math.abs(v - pb[c]))) <= 48) ok = true;
      }
      if (!ok) tbad++;
    }
    const dc = document.createElement('canvas'); dc.width = t.width; dc.height = t.height;
    dc.getContext('2d').putImageData(diff, 0, 0);
    return {
      id, report, width: canvas.width, height: canvas.height,
      badPct: +(100 * bad / n).toFixed(3), tolerantBadPct: +(100 * tbad / n).toFixed(3), meanDiff: +(sum / n).toFixed(2),
      render: canvas.toDataURL('image/png'), diff: dc.toDataURL('image/png'),
    };
  },
};
