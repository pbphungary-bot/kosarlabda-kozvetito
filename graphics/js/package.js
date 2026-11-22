// The full graphic package of one match: every graphic that belongs to it, rendered with the automatic data and the saved
// layouts ("alap"), packed into one ZIP (RAR is a proprietary format that cannot be created in a browser; ZIP opens everywhere).
import { zipSync, strToU8 } from '../vendor/fflate.js';

/** [template type, whose data, label of the file] – the order of the numbers in the file names. */
export const PACKAGE_ITEMS = [
  { id: 'intro', type: 'intro', who: 'match', label: 'Intro' },
  { id: 'nextmatch', type: 'nextmatch', who: 'match', label: 'Kovetkezik' },
  { id: 'comparison', type: 'comparison', who: 'match', label: 'Csapatok_osszevetese' },
  { id: 'playercompare', type: 'playercompare', who: 'match', label: 'Csillagjatekosok' },
  { id: 'referees', type: 'referees', who: 'match', label: 'Jatekvezetok' },
  { id: 'formpair', type: 'formpair', who: 'match', label: 'Forma' },
  { id: 'schedule-home', type: 'schedule', who: 'home', label: 'Menetrend' },
  { id: 'schedule-away', type: 'schedule', who: 'away', label: 'Menetrend' },
  { id: 'results-home', type: 'results', who: 'home', label: 'Eredmenyek' },
  { id: 'results-away', type: 'results', who: 'away', label: 'Eredmenyek' },
  { id: 'roster-home', type: 'roster', who: 'home', label: 'Keret' },
  { id: 'roster-away', type: 'roster', who: 'away', label: 'Keret' },
  { id: 'teamstats-home', type: 'teamstats', who: 'home', label: 'Csapatstat' },
  { id: 'teamstats-away', type: 'teamstats', who: 'away', label: 'Csapatstat' },
];

export const ascii = x => String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');

/** "03_Csapatok_osszevetese_Falco-Alba_2026-11-22.png" */
export function fileNameFor(n, item, subject, date) {
  return `${String(n).padStart(2, '0')}_${item.label}_${ascii(subject)}_${date}.png`;
}

export function zipName(leagueShort, who, date) {
  return `${ascii(leagueShort)}_Csomag_${ascii(who)}_${date}.zip`;
}

/** The _OLVASSEL.txt of the package: what is inside, what was skipped, the freshness of the data, the warnings. */
export function readmeText({ title, date, made, rendered, skipped, warnings, freshness }) {
  const L = [];
  L.push(`GRAFIKAI CSOMAG – ${title}`, `Meccs napja: ${date || '?'}`, `Készült: ${made}`, '');
  L.push(`Képek (${rendered.length} db, 1920×1080, átlátszó PNG):`, ...rendered.map(r => `  ${r.file}  –  ${r.what}`), '');
  if (skipped.length) L.push('Kihagyva:', ...skipped.map(s => `  ${s}`), '');
  L.push('Adatok frissessége:', ...freshness.map(f => `  ${f}`), '');
  L.push(warnings.length ? 'Figyelmeztetések (adás előtt nézd át őket!):' : 'Nincs figyelmeztetés.', ...warnings.map(w => `  • ${w}`), '');
  L.push('A csomag az automatikus adatokból és a mentett „alap” elrendezésekből készült; a kézi felülírásokat nem tartalmazza.');
  return L.join('\n');
}

/** files: [{name, bytes}] → ZIP bytes (PNGs are already compressed: stored without recompression). */
export function buildZip(files, readme) {
  const o = {};
  for (const f of files) o[f.name] = [f.bytes, { level: 0 }];
  o['_OLVASSEL.txt'] = [strToU8(readme), { level: 6 }];
  return zipSync(o);
}
