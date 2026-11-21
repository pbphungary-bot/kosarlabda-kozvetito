// Turns a parsed Excel/CSV workbook into team-stat and player-stat tables for one league.
// Columns are recognised by their header text (Hungarian or English, any case/accents);
// everything not recognised is reported, never guessed. Teams are matched with the
// league-scoped club registry using EXACT names only, so a men's and a women's club can
// never be mixed up ("NKA Universitas Pécs", "Sopron KC" vs "Sopron Basket").
//
// Supported layouts (both seen in the broadcast team's files):
//  • Team table  – one row per team: "boxscore_team_avg" export (Team, Pts, 2Pp, 3Pp, FTP, TRB, ST, TOV, ASS, Val …)
//  • Player sheets – one sheet per team (sheet name = club): a roster block (Mez, Játékos, Poszt, …)
//    next to a stats block whose headers start with "Csapat átlag" / "Női|Férfi NB I. A csoport"
import { clubIdStrict as clubId, club, leagueOfName } from './clubs.js';

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s. _]/g, '');
const STATS_PREFIX = /^(csapatatlag|(noi|ferfi)nbiacsoport)/;
const isStatsCell = c => STATS_PREFIX.test(norm(c));
const headKey = c => norm(c).replace(STATS_PREFIX, '');
const hasLetter = v => typeof v === 'string' && /\p{L}/u.test(v) && !/^[\d\s.,-]+$/.test(v);

// canonical store key → header aliases (normalised: lower case, no accents/spaces/dots)
export const TEAM_COLUMNS = {
  name: ['csapat', 'team', 'klub', 'club', 'csapatnev'],
  ppg: ['pts', 'pts/g', 'ppg', 'pont', 'pont/m', 'p/m', 'atlagpont', 'dobottpont'],
  fg2_pct: ['2pp', '2p%', '2pt%', '2p', 'ketpontos%', '2pontos%'],
  fg3_pct: ['3pp', '3p%', '3pt%', '3p', 'haromponto%', '3pontos%', 'harompontos%'],
  ft_pct: ['ftp', 'ft%', 'bt%', 'ft', 'bt', 'buntetodobas%', 'szabaddobas%'],
  reb: ['trb', 'reb', 'reb/g', 'l/m', 'lepattano', 'lepattano/m', 'lepattanok'],
  ast: ['ass', 'ast', 'ast/g', 'gp', 'gp/m', 'golpassz', 'golpassz/m'],
  stl: ['st', 'stl', 'stl/g', 'szl', 'sz/m', 'szerzettlabda', 'labdaszerzes'],
  tov: ['tov', 'tov/g', 'to', 'el', 'el/m', 'eladottlabda', 'labdaeladas'],
  val: ['val', 'eff', 'efficiency', 'efficienco', 'efficiencyrating', 'val/m', 'ertekeles', 'ertekeles/m', 'hatekonysag'],
};
// the same abbreviation can mean something else in a player table (see the Hungarian conventions of the dashboard)
export const PLAYER_COLUMNS = {
  name: ['jatekos', 'nev', 'player', 'name'],
  '#': ['#', 'mezszam', 'szam', 'no', 'nr'],
  team: ['csapat', 'team', 'klub', 'club'],
  'M.': ['m', 'mecs', 'meccs', 'merkozes', 'games'],
  'P.': ['p/m', 'p', 'pts', 'pts/g', 'pont', 'pont/m'],
  'ÖLP': ['lepattanoo', 'l/m', 'reb', 'reb/g', 'trb', 'lepattano', 'lepattano/m', 'olp', 'olp/m'],
  GP: ['gp/m', 'gp', 'ast', 'ast/g', 'golpassz', 'golpassz/m'],
  SZL: ['labdasz', 'sz/m', 'stl', 'stl/g', 'szl', 'szl/m', 'szerzettlabda'],
  EL: ['labdael', 'el/m', 'tov', 'tov/g', 'el', 'eladottlabda'],
  Blokk: ['blokksa', 'bl/m', 'blk', 'blk/g', 'blokk', 'blokk/m'],
  VAL: ['val/m', 'val', 'eff', 'efficiency', 'efficienco', 'eff/m', 'ertekeles', 'hatekonysag'],
  'Idő': ['ido/m', 'ido', 'min', 'min/g', 'perc', 'perc/m', 'mpg'],
};
// cup / European games list (one row per game, copied by hand from e.g. eredmenyek.com)
export const CUP_COLUMNS = {
  date: ['datum', 'date', 'nap'],
  time: ['ido', 'time', 'kezdes', 'kezdet', 'idopont'],
  home: ['hazai', 'home', 'hazaicsapat'],
  away: ['vendeg', 'away', 'vendegcsapat'],
  comp: ['sorozat', 'verseny', 'bajnoksag', 'competition', 'liga', 'kupa'],
  score: ['eredmeny', 'pontszam', 'score', 'vegeredmeny', 'result'],
  homeScore: ['hazaipont', 'hazaipontszam', 'homescore'],
  awayScore: ['vendegpont', 'vendegpontszam', 'awayscore'],
};

// competition marks that exist in the designs (see graphics/assets/competitions)
export function compKey(league, text) {
  const n = norm(text);
  if (/euroleague/.test(n)) return league === 'women' ? 'comp/euroleague-women' : '';
  if (/eurocup/.test(n)) return league === 'women' ? 'comp/eurocup-women' : '';
  if (/championsleague|bajnokokligaja|bcl|fibabasketballchampions/.test(n)) return league === 'men' ? 'comp/bcl' : '';
  return '';
}

const pad2 = n => String(n).padStart(2, '0');
function hhmm(frac) { const m = Math.round(frac * 1440) % 1440; return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`; }

/** Excel serial number, "2026.11.04.", "2026-11-04", "04.11.2026" (optionally followed by a time) → {date:'YYYY-MM-DD', time} */
export function parseDateCell(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const day = Math.floor(v);
    return { date: new Date(Math.round((day - 25569) * 86400000)).toISOString().slice(0, 10), time: v - day > 0.0001 ? hhmm(v - day) : null };
  }
  const s = String(v ?? '').trim();
  let date = null, rest = s, m;
  const valid = (y, mo, d) => mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100;
  // Hungarian eredmenyek style first: 04.11.2026 (day.month.year)
  if ((m = s.match(/(?<!\d)(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})(?!\d)/)) && valid(+m[3], +m[2], +m[1])) {
    date = `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`; rest = s.replace(m[0], ' ');
  } else if ((m = s.match(/(?<!\d)(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})(?!\d)/)) && valid(+m[1], +m[2], +m[3])) {
    date = `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`; rest = s.replace(m[0], ' ');
  }
  const t = rest.match(/(\d{1,2})[:.](\d{2})(?!\d)/);
  return { date, time: t && +t[1] < 24 && +t[2] < 60 ? `${pad2(t[1])}:${t[2]}` : null };
}

export function parseTimeCell(v) {
  if (typeof v === 'number') return v >= 0 && v < 1 ? hhmm(v) : null;
  const t = String(v ?? '').match(/(\d{1,2})[:.](\d{2})(?!\d)/);
  return t && +t[1] < 24 && +t[2] < 60 ? `${pad2(t[1])}:${t[2]}` : null;
}

const ROSTER_COLUMNS = { number: ['mez', 'mezszam', '#', 'szam'], name: ['jatekos'], pos: ['poszt'], height: ['magassag'], born: ['szuletesiev'] };
const PCT_KEYS = ['fg2_pct', 'fg3_pct', 'ft_pct'];

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace('%', '').replace(',', '.');
  if (s === '' || s === '-' || s === '—') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function mapCells(cells, columns, filter = () => true) {
  const map = {};
  cells.forEach((cell, c) => {
    if (cell === null || cell === undefined || !filter(cell, c)) return;
    const h = headKey(cell);
    if (!h) return;
    for (const [key, aliases] of Object.entries(columns)) if (!(key in map) && aliases.map(norm).includes(h)) { map[key] = c; break; }
  });
  return map;
}

/** Finds what a sheet contains. Searches the whole sheet (tables can start far down). */
export function classifySheet(rows) {
  const limit = Math.min(rows.length, 120);
  // 1) prefixed player-stats block ("Csapat átlag …") – the most specific layout
  for (let r = 0; r < limit; r++) {
    const cells = rows[r] || [];
    const stats = cells.map((c, i) => (c !== null && c !== undefined && isStatsCell(c) ? i : -1)).filter(i => i >= 0);
    if (stats.length < 4) continue;
    const set = new Set(stats);
    const map = mapCells(cells, PLAYER_COLUMNS, (c, i) => set.has(i));
    if (!('name' in map)) continue;
    const roster = mapCells(cells, ROSTER_COLUMNS, (c, i) => !set.has(i));
    return { type: 'players', row: r, map, roster: 'name' in roster ? roster : null, blocks: true };
  }
  // 2) player table (one row per player; a "Játékos" column always wins over a team table) (one row per player, optional team column)
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const map = mapCells(rows[r] || [], PLAYER_COLUMNS);
    if ('name' in map && Object.keys(map).filter(k => !['name', '#', 'team'].includes(k)).length >= 2) return { type: 'players', row: r, map, roster: null, blocks: false };
  }
  // 3) team table (one row per team)
  let best = null;
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const map = mapCells(rows[r] || [], TEAM_COLUMNS);
    const hits = Object.keys(map).length;
    if ('name' in map && hits >= 4 && (!best || hits > best.hits)) best = { type: 'team', row: r, map, hits };
  }
  if (best) return best;
  // 4) cup / European games (Dátum, Hazai, Vendég, …)
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const map = mapCells(rows[r] || [], CUP_COLUMNS);
    if ('home' in map && 'away' in map && 'date' in map) return { type: 'cups', row: r, map };
  }
  // 5) roster only (Mez, Játékos, Poszt …)
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const roster = mapCells(rows[r] || [], ROSTER_COLUMNS);
    if ('name' in roster && Object.keys(roster).length >= 3) return { type: 'roster', row: r, map: {}, roster };
  }
  return null;
}

/** Which league does this workbook belong to? Votes from header text and exact team names. */
export function detectLeague(parsed, hint = null) {
  const votes = { men: 0, women: 0 };
  for (const sheet of parsed.sheets) {
    const rows = sheet.rows;
    for (let r = 0; r < Math.min(rows.length, 120); r++) {
      for (const cell of rows[r] || []) {
        const n = norm(cell);
        if (n.startsWith('ferfinbiacsoport')) { votes.men += 3; break; }
        if (n.startsWith('noinbiacsoport')) { votes.women += 3; break; }
      }
    }
    const cls = classifySheet(rows);
    if (cls?.type === 'team') {
      for (const row of rows.slice(cls.row + 1)) {
        const name = row[cls.map.name];
        if (!name) continue;
        for (const lg of ['men', 'women']) if (clubId(lg, name)) votes[lg] += 1;
      }
    } else if (cls?.type === 'cups') {
      for (const row of rows.slice(cls.row + 1)) {
        for (const col of [cls.map.home, cls.map.away]) {
          const name = row[col];
          if (!name) continue;
          for (const lg of ['men', 'women']) if (clubId(lg, name)) votes[lg] += 1;
        }
        const comp = cls.map.comp !== undefined ? norm(row[cls.map.comp]) : '';
        if (/women|noi/.test(comp)) votes.women += 2;
      }
    } else if (!leagueOfName(sheet.name)) {
      for (const lg of ['men', 'women']) if (clubId(lg, sheet.name)) votes[lg] += 1;
    }
  }
  if (votes.men !== votes.women) return { league: votes.men > votes.women ? 'men' : 'women', votes, certain: true };
  return { league: hint, votes, certain: false };
}

function unmatchedNote(sheet, name, league, who) {
  const other = leagueOfName(name);
  const hint = other && other !== league ? ' – a másik bajnokság csapata' : '';
  return `${sheet}: „${name}”${who ? ` (${who})` : ''}${hint}`;
}

export function importWorkbook(parsed, league) {
  const result = {
    league, team: {}, players: {}, cups: [], compsNoLogo: [], report: [], unmatched: [], ignoredColumns: [], scaled: [], rowsRead: 0,
  };
  for (const sheet of parsed.sheets) {
    const cls = classifySheet(sheet.rows);
    if (!cls) { result.report.push({ sheet: sheet.name, status: 'kihagyva', note: 'Nem ismerhető fel (nincs csapat-/játékosstatisztika fejléc).' }); continue; }
    const rows = sheet.rows;
    const head = rows[cls.row] || [];
    const used = new Set([...Object.values(cls.map), ...(cls.roster ? Object.values(cls.roster) : [])]);
    head.forEach((cell, c) => {
      if (cell !== null && cell !== undefined && cell !== '' && !used.has(c) && !/^column\d+$/i.test(String(cell))) result.ignoredColumns.push(String(cell));
    });
    const body = rows.slice(cls.row + 1);

    if (cls.type === 'team') {
      const byClub = {};
      let n = 0;
      for (const r of body) {
        const name = r[cls.map.name];
        if (name === null || name === undefined || String(name).trim() === '') continue;
        const id = clubId(league, name);
        if (!id) { result.unmatched.push(unmatchedNote(sheet.name, name, league)); continue; }
        const vals = {};
        for (const k of Object.keys(TEAM_COLUMNS)) if (k !== 'name' && k in cls.map) { const x = toNum(r[cls.map[k]]); if (x !== null) vals[k] = x; }
        byClub[id] = vals; n++;
      }
      for (const k of PCT_KEYS) { // percent stored as a fraction (0.502 formatted as %) → ×100
        const all = Object.values(byClub).map(v => v[k]).filter(v => v !== undefined);
        if (all.length && all.every(v => v <= 1.0001)) {
          for (const v of Object.values(byClub)) if (v[k] !== undefined) v[k] = Math.round(v[k] * 1000) / 10;
          result.scaled.push(k);
        }
      }
      for (const [id, v] of Object.entries(byClub)) result.team[id] = { ...(result.team[id] || {}), ...v };
      result.report.push({ sheet: sheet.name, status: 'csapatstatisztika', rows: n, columns: Object.keys(cls.map).filter(k => k !== 'name') });
      continue;
    }

    if (cls.type === 'cups') {
      let n = 0, skipped = 0;
      for (const r of body) {
        const home = String(r[cls.map.home] ?? '').trim(), away = String(r[cls.map.away] ?? '').trim();
        if (!home && !away) continue;
        const dp = parseDateCell(r[cls.map.date]);
        if (!dp.date || !home || !away) { skipped++; continue; }
        const time = cls.map.time !== undefined ? (parseTimeCell(r[cls.map.time]) ?? dp.time) : dp.time;
        const homeId = clubId(league, home), awayId = clubId(league, away);
        if (!homeId && !awayId) { result.unmatched.push(`${sheet.name}: ${home} – ${away} (egyik csapat sem ${league === 'men' ? 'férfi' : 'női'} NB I/A klub)`); continue; }
        let score = null;
        if (cls.map.score !== undefined) {
          const m = String(r[cls.map.score] ?? '').match(/(\d{1,3})\s*[-–:]\s*(\d{1,3})/);
          if (m) score = { home: +m[1], away: +m[2] };
        }
        if (!score && cls.map.homeScore !== undefined && cls.map.awayScore !== undefined) {
          const a = toNum(r[cls.map.homeScore]), b = toNum(r[cls.map.awayScore]);
          if (a !== null && b !== null) score = { home: a, away: b };
        }
        const competition = cls.map.comp !== undefined ? String(r[cls.map.comp] ?? '').trim() : '';
        const key = compKey(league, competition);
        if (competition && !key && !result.compsNoLogo.includes(competition)) result.compsNoLogo.push(competition);
        result.cups.push({ home, away, homeId, awayId, date: dp.date, time, status: score ? 'finished' : 'scheduled', score, competition, compKey: key });
        n++;
      }
      result.report.push({ sheet: sheet.name, status: 'kupa-/európai meccsek', rows: n, columns: Object.keys(cls.map), note: skipped ? `${skipped} sor kihagyva (hiányzó dátum vagy csapat)` : undefined });
      continue;
    }

    // roster by name → jersey number (used to complete blank/dash numbers in the stats block)
    const rosterNo = {};
    let rosterCount = 0;
    if (cls.roster) {
      for (const r of body) {
        const nm = r[cls.roster.name];
        if (!hasLetter(nm)) continue;
        const key = norm(nm);
        if (rosterNo[key] === undefined) { rosterNo[key] = r[cls.roster.number ?? -1]; rosterCount++; }
      }
    }
    const sheetClub = clubId(league, sheet.name);

    if (cls.type === 'roster') {
      result.report.push({ sheet: sheet.name, status: 'csak keret (nincs statisztika)', rows: rosterCount, club: sheetClub, note: sheetClub ? undefined : 'a lapnév nem egyeztethető csapathoz' });
      if (!sheetClub) result.unmatched.push(unmatchedNote(sheet.name, sheet.name, league));
      continue;
    }

    // players
    const byClub = {};
    let n = 0, skipped = 0;
    for (const r of body) {
      const pname = r[cls.map.name];
      if (!hasLetter(pname)) { if (pname !== null && pname !== undefined && String(pname).trim() !== '') skipped++; continue; }
      let id = sheetClub;
      if ('team' in cls.map && r[cls.map.team] !== null && r[cls.map.team] !== undefined && String(r[cls.map.team]).trim() !== '') {
        id = clubId(league, r[cls.map.team]);
        if (!id) { result.unmatched.push(unmatchedNote(sheet.name, r[cls.map.team], league, pname)); continue; }
      }
      if (!id) { result.unmatched.push(unmatchedNote(sheet.name, sheet.name, league)); break; }
      const row = { 'Játékos': String(pname).trim() };
      let no = '#' in cls.map ? r[cls.map['#']] : null;
      if (no === null || no === undefined || no === '' || no === '-') no = rosterNo[norm(pname)];
      row['#'] = no === null || no === undefined ? '' : String(typeof no === 'number' ? Math.round(no) : no).trim();
      for (const k of Object.keys(PLAYER_COLUMNS)) {
        if (['name', '#', 'team'].includes(k) || !(k in cls.map)) continue;
        const x = toNum(r[cls.map[k]]);
        if (x !== null) row[k] = String(x);
      }
      // a name without any statistics (second plain list of names below the table) is not a stats row
      if (Object.keys(row).filter(k => !['Játékos', '#'].includes(k)).length < 2) { skipped++; continue; }
      (byClub[id] ||= []).push(row); n++;
    }
    for (const [id, list] of Object.entries(byClub)) result.players[id] = list;
    result.report.push({
      sheet: sheet.name, status: 'játékosstatisztika', rows: n, club: sheetClub,
      columns: Object.keys(cls.map).filter(k => !['name', 'team'].includes(k)),
      note: skipped ? `${skipped} üres/nulla sor kihagyva` : undefined,
    });
  }
  result.ignoredColumns = [...new Set(result.ignoredColumns)];
  result.teamCount = Object.keys(result.team).length;
  result.playerTeamCount = Object.keys(result.players).length;
  result.playerCount = Object.values(result.players).reduce((a, l) => a + l.length, 0);
  result.cupCount = result.cups.length;
  return result;
}

export const clubLabel = (league, id) => club(league, id)?.official || id;

/**
 * Reads text copied from an eredmenyek.com team page ("Meccsek" tab), e.g.
 *   [EuroCup - női](https://…)        competition heading (applies until the next heading)
 *   MAGYARORSZÁG: / Tabella           ignored
 *   25.11. 18:00                      date (year optional) and time
 *   DVTK NDVTK N                      home team (name repeated, with a trailing " N")
 *   Brod na Savi NBrod na Savi N      away team
 *   --                                separator
 * Played games may be followed by two score lines (or "66-71"); that part is read tolerantly.
 * NB I games are skipped: the dashboard already has them. Returns a workbook-like object for
 * importWorkbook() plus counts for the preview.
 */
export function parseEredmenyekText(text, now = new Date()) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const cleanTeam = l => { const m = l.match(/^(.+?) N\1 N$/); return (m ? m[1] : l.replace(/ N$/, '')).trim(); };
  const pickYear = (d, mo) => {
    let best = null;
    for (const y of [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]) {
      const t = Date.UTC(y, mo - 1, d);
      if (best === null || Math.abs(t - now.getTime()) < Math.abs(best.t - now.getTime())) best = { y, t };
    }
    return best.y;
  };
  const games = [];
  let comp = '', cur = null, unparsed = 0;
  for (const line of lines) {
    let m;
    if (/^-{2,}$/.test(line)) { cur = null; continue; }
    if ((m = line.match(/^\[(.+?)\]\(.*\)$/))) { comp = m[1].trim(); cur = null; continue; }
    if (/^[\p{Lu} .\-/]+:$/u.test(line) || /^tabella$/i.test(line)) continue;
    if ((m = line.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})?(?:\s+(\d{1,2}):(\d{2}))?$/))) {
      const year = m[3] ? +m[3] : pickYear(+m[1], +m[2]);
      cur = { date: `${year}-${pad2(m[2])}-${pad2(m[1])}`, time: m[4] ? `${pad2(m[4])}:${m[5]}` : '', comp, teams: [], scores: [] };
      games.push(cur);
      continue;
    }
    if (cur && cur.teams.length < 2) { cur.teams.push(cleanTeam(line)); continue; }
    if (cur && cur.teams.length === 2) {
      if (/^\d{1,3}$/.test(line)) { cur.scores.push(+line); continue; }
      if ((m = line.match(/^(\d{1,3})\s*[-–:]\s*(\d{1,3})$/))) { cur.scores.push(+m[1], +m[2]); continue; }
    }
    unparsed++;
  }
  const skipped = {};
  const rows = [['Dátum', 'Idő', 'Hazai', 'Vendég', 'Sorozat', 'Eredmény']];
  for (const g of games) {
    if (g.teams.length < 2) { unparsed++; continue; }
    if (/^nb\s*i\b/i.test(g.comp)) { skipped[g.comp] = (skipped[g.comp] || 0) + 1; continue; }
    rows.push([g.date, g.time, g.teams[0], g.teams[1], g.comp, g.scores.length >= 2 ? `${g.scores[0]}-${g.scores[1]}` : '']);
  }
  return {
    workbook: { sheets: [{ name: 'Beillesztett szöveg', rows }], modified: now.toISOString() },
    gamesFound: games.length, imported: rows.length - 1,
    skipped: Object.entries(skipped).map(([name, n]) => ({ name, n })), unparsed,
  };
}
