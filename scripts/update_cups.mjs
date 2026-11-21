// Collects the European / cup games of the NB I/A clubs from the official FIBA and Champions League
// game-list pages (the game data is embedded in the pages' Next.js payload) and writes
// data/cups_men.json and data/cups_women.json. Only games with at least one NB I/A club are kept;
// clubs are matched with the studio's exact-name registry, so a club of the other league never mixes in.
// Politeness: one request per page, identifying User-Agent, run a few times a day only.
import { readFile, writeFile } from 'node:fs/promises';
import { clubIdStrict } from '../graphics/js/clubs.js';

const UA = 'kosarlabda-kozvetito-collector/1.0 (+https://github.com/pbphungary-bot/kosarlabda-kozvetito; low-frequency, public schedule data)';

// season slug is the only thing to change each year
export const SEASON = '26-27';
export const PAGES = [
  { url: `https://www.fiba.basketball/en/events/eurocup-women-${SEASON}/games`, competition: 'EuroCup Women', compKey: 'comp/eurocup-women' },
  { url: `https://www.fiba.basketball/en/events/euroleague-women-${SEASON}/games`, competition: 'EuroLeague Women', compKey: 'comp/euroleague-women' },
  { url: 'https://www.championsleague.basketball/en/games', competition: 'Basketball Champions League', compKey: 'comp/bcl' },
  { url: `https://www.fiba.basketball/en/events/fiba-europe-cup-${SEASON}/games`, competition: 'FIBA Europe Cup', compKey: '' },
];

/** Concatenated string chunks of the Next.js flight payload (self.__next_f.push([1,"..."])). */
export function flightText(html) {
  const out = [];
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    try { out.push(JSON.parse('"' + m[1] + '"')); } catch { /* skip a broken chunk */ }
  }
  return out.join('');
}

function balanced(text, i) {
  let depth = 0, instr = false, esc = false;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (instr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') instr = false; }
    else if (c === '"') instr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return text.slice(i, j + 1); }
  }
  return null;
}

/** All game objects ({"gameId":…}) of a page. */
export function extractGames(html) {
  const fl = flightText(html), seen = new Map();
  for (const m of fl.matchAll(/\{"gameId":\d+/g)) {
    const raw = balanced(fl, m.index);
    if (!raw) continue;
    try { const g = JSON.parse(raw); if (g.teamA && g.teamB && !seen.has(g.gameId)) seen.set(g.gameId, g); } catch { /* not a game */ }
  }
  return [...seen.values()];
}

const teamNames = t => [t.officialName, t.shortName, t.name].filter(Boolean);
function resolve(league, t) {
  for (const n of teamNames(t)) { const id = clubIdStrict(league, n); if (id) return { id, name: n }; }
  return null;
}

/** Game objects → studio fixtures for one league (only games with an NB I/A club). */
export function toFixtures(games, page, league) {
  const out = [];
  for (const g of games) {
    const gender = g.competition?.gender;
    if (gender && gender !== (league === 'women' ? 'Women' : 'Men')) continue;
    const a = resolve(league, g.teamA), b = resolve(league, g.teamB);
    if (!a && !b) continue;
    const dt = String(g.gameDateTime || '');
    const date = dt.slice(0, 10), time = dt.slice(11, 16) || null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || g.isPostponed) continue;
    const sa = Number.isInteger(g.teamAScore) ? g.teamAScore : null, sb = Number.isInteger(g.teamBScore) ? g.teamBScore : null;
    const played = sa !== null && sb !== null && (sa + sb) > 0;
    const shortOf = t => t.shortName || t.officialName || t.name;
    out.push({
      key: `fiba:${g.gameId}`, date, time, competition: page.competition, compKey: page.compKey,
      home: a ? (a.name) : shortOf(g.teamA), away: b ? b.name : shortOf(g.teamB),
      homeId: a?.id || null, awayId: b?.id || null,
      status: played ? 'finished' : 'scheduled', score: played ? { home: sa, away: sb } : null,
      venue: g.venueName || null, round: g.round?.roundName ? `${g.round.roundName}${g.round.roundNumber ? ' ' + g.round.roundNumber : ''}` : null,
    });
  }
  return out;
}

async function fetchPage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(40000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function readOld(file) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } }

async function main() {
  const result = { men: [], women: [] }, report = [];
  for (const page of PAGES) {
    try {
      const games = extractGames(await fetchPage(page.url));
      for (const lg of ['men', 'women']) result[lg].push(...toFixtures(games, page, lg));
      report.push(`${page.competition}: ${games.length} games on the page`);
    } catch (e) { report.push(`${page.competition}: ${e.message}`); }
  }
  console.log(report.join('\n'));
  const now = new Date().toISOString();
  for (const lg of ['men', 'women']) {
    const file = new URL(`../data/cups_${lg}.json`, import.meta.url);
    const old = await readOld(file);
    const games = result[lg].sort((x, y) => x.date.localeCompare(y.date) || (x.time || '').localeCompare(y.time || ''));
    // all pages failed → keep the old file untouched (never replace data by nothing)
    if (!games.length && old?.games?.length) { console.log(`${lg}: nothing found, keeping old file`); continue; }
    if (old && JSON.stringify(old.games) === JSON.stringify(games)) continue; // unchanged → no commit noise
    await writeFile(file, JSON.stringify({ updated_at: now, source: 'FIBA / Basketball Champions League (hivatalos játéklista)', games }, null, 1) + '\n');
    console.log(`${lg}: ${games.length} games written`);
  }
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
