// Loads the NB I/A Közvetítőhub data files (../data/*.json) – the same files the
// dashboard reads – and indexes them per league by club id. Nothing is invented:
// a value that is not in the data stays null and is reported as missing.
import { clubId, club, CLUBS } from './clubs.js';

export const LEAGUES = {
  men: { label: 'Férfi NB I/A', short: 'Férfi' },
  women: { label: 'Női NB I/A', short: 'Női' },
};

export const SOURCES = {
  fixtures: { men: 'men.json', women: 'women.json', label: 'Menetrend és eredmények (Hunbasket)' },
  standings: { men: 'standings_men.json', women: 'standings_women.json', label: 'Tabella (Hunbasket)' },
  referees: { men: 'referees_men.json', women: 'referees_women.json', label: 'Játékvezetők, ellenőr, helyszín (Hunbasket)' },
  cups: { men: 'cups_men.json', women: 'cups_women.json', label: 'Európai / kupameccsek (FIBA)', optional: true },
  playerPages: { men: 'player_pages_men.json', women: 'player_pages_women.json', label: 'Játékosoldalak (Hunbasket)', optional: true, lazy: true },
  teamPages: { men: 'team_pages_men.json', women: 'team_pages_women.json', label: 'Keretek (Hunbasket)', optional: true },
  teamStats: { men: 'team_stats_men.json', women: 'team_stats_women.json', label: 'Csapatstatisztika' },
  players: { men: 'player_stats_men.json', women: 'player_stats_women.json', label: 'Játékosstatisztika (Hunbasket)' },
};

export const STALE_HOURS = 48;

/** Stable identity of a game (used to remember which games the operator picked). */
export const gameKey = m => m.url || `${m.date}|${m.home}|${m.away}`;

/** "2026. 09. 25." → "2026-09-25" */
export function parseHuDate(s) {
  const m = String(s || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

export function parseScore(result) {
  const m = String(result || '').match(/^\s*(\d{1,3})\s*[-–—:]\s*(\d{1,3})\s*$/);
  return m ? { home: +m[1], away: +m[2] } : null;
}

function num(v) {
  if (v === null || v === undefined || v === '' || v === '-' || v === '—') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export class Store {
  constructor(raw, now = new Date()) {
    this.now = now;
    this.errors = raw.errors || [];
    this.unresolved = [];
    this.excel = { men: null, women: null }; // imported Excel/CSV data, see importer.js
    this.leagues = {};
    for (const lg of Object.keys(LEAGUES)) this.leagues[lg] = this.#index(lg, raw[lg] || {});
  }

  #resolve(lg, name, where) {
    const id = clubId(lg, name);
    if (!id) this.unresolved.push({ league: lg, name, where });
    return id;
  }

  #index(lg, r) {
    const L = { updated: {}, fixtures: [], standings: {}, teamStats: {}, players: {}, referees: {}, cups: [], checked: {}, teamPages: {}, playerPages: {}, statSource: null };
    if (r.fixtures) {
      L.updated.fixtures = r.fixtures.updated_at || null;
      const today = this.now.toISOString().slice(0, 10);
      L.fixtures = (r.fixtures.matches || []).map((m, i) => {
        const date = parseHuDate(m.date);
        const score = m.status === 'finished' ? parseScore(m.result) : null;
        return {
          idx: i, round: m.round, roundNo: parseInt(m.round, 10) || null,
          home: m.home, away: m.away,
          homeId: this.#resolve(lg, m.home, 'fixtures'), awayId: this.#resolve(lg, m.away, 'fixtures'),
          date, time: m.time || null, status: m.status, score, url: m.url,
          // past date but no final result in the data: never shown as a result
          resultMissing: m.status !== 'finished' && !!date && date < today,
          finishedWithoutScore: m.status === 'finished' && !score,
        };
      }).sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || '') || a.idx - b.idx);
    }
    if (r.referees) {
      L.updated.referees = r.referees.updated_at || null;
      L.referees = r.referees.matches || {};
    }
    if (r.playerPages) {
      L.updated.playerPages = r.playerPages.updated_at || null;
      L.playerPages = r.playerPages.players || {};
    }
    if (r.teamPages) {
      L.updated.teamPages = r.teamPages.updated_at || null;
      for (const t of r.teamPages.teams || []) { const id = this.#resolve(lg, t.name, 'teamPages'); if (id) L.teamPages[id] = t; }
    }
    if (r.cups) {
      L.updated.cups = r.cups.updated_at || null;
      L.cups = (r.cups.games || []).filter(g => g.date && (g.homeId || g.awayId));
    }
    if (r.standings) {
      L.updated.standings = r.standings.updated_at || null;
      L.checked.standings = r.standings.checked_at || null; // last time the collector looked (the data may simply not have changed)
      for (const s of r.standings.standings || []) {
        const id = this.#resolve(lg, s.name, 'standings');
        if (id) L.standings[id] = { ...s };
      }
    }
    if (r.teamStats) {
      L.updated.teamStats = r.teamStats.updated_at || null;
      L.statSource = r.teamStats.source || null;
      L.statSourceUrl = r.teamStats.source_url || null;
      for (const t of r.teamStats.teams || []) {
        const id = this.#resolve(lg, t.name, 'teamStats');
        if (id) L.teamStats[id] = { name: t.name, season: t.periods?.season || {} };
      }
    }
    if (r.players) {
      L.updated.players = r.players.updated_at || null;
      for (const t of r.players.teams || []) {
        const id = this.#resolve(lg, t.name, 'players');
        if (!id) continue;
        L.players[id] = {
          name: t.name, sourceUrl: t.source_url,
          players: (t.players || []).map(row => Object.fromEntries(t.columns.map((c, i) => [c, row[i]]))),
        };
      }
    }
    return L;
  }

  league(lg) { return this.leagues[lg]; }

  clubs(lg) {
    const L = this.leagues[lg];
    return Object.keys(CLUBS[lg]).map(id => club(lg, id))
      .map(c => ({ ...c, rank: L.standings[c.id]?.rank ?? null }))
      .sort((a, b) => a.official.localeCompare(b.official, 'hu'));
  }

  /** Matches not yet played (status scheduled and date today or later). */
  upcoming(lg) {
    const today = this.now.toISOString().slice(0, 10);
    return this.leagues[lg].fixtures.filter(m => m.status !== 'finished' && m.date && m.date >= today);
  }

  /** NB I/A games from the dashboard data plus uploaded cup / European games of the team, by date. */
  teamFixtures(lg, id) {
    const base = this.leagues[lg].fixtures.filter(m => m.homeId === id || m.awayId === id);
    const cups = this.cupFixtures(lg, id);
    if (!cups.length) return base;
    return [...base, ...cups].sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || ''));
  }

  /** Uploaded cup / European games (sheet import), in the same shape as dashboard fixtures. */
  cupFixtures(lg, id) {
    const today = this.now.toISOString().slice(0, 10);
    const k = g => `${g.date}|${g.homeId || g.home}|${g.awayId || g.away}`;
    const all = {};
    for (const g of this.leagues[lg].cups) all[k(g)] = { ...g, auto: true }; // automatic (FIBA) …
    const x = this.#excelOn(lg);
    if (x?.cups) for (const [key, g] of Object.entries(x.cups)) all[key] = g; // … the operator's own entry wins
    return Object.entries(all).filter(([, g]) => g.homeId === id || g.awayId === id).map(([cupKey, g]) => ({
      cupKey, idx: -1, round: null, roundNo: null, home: g.home, away: g.away, homeId: g.homeId, awayId: g.awayId,
      date: g.date, time: g.time, status: g.status, score: g.score, url: null, venue: g.venue || null,
      cup: true, auto: !!g.auto, competition: g.competition, compKey: g.compKey,
      resultMissing: g.status !== 'finished' && g.date < today, finishedWithoutScore: false,
    }));
  }

  /** Adds one game by hand (the "+ Kupa-/európai meccs" form). Stored with the other Excel data. */
  addCup(lg, g) {
    const x = this.excel[lg] || { team: {}, players: {}, cups: {}, enabled: true, meta: { files: [] } };
    x.cups = x.cups || {};
    x.cups[`${g.date}|${g.homeId || g.home}|${g.awayId || g.away}`] = g;
    x.enabled = true;
    x.meta = x.meta || { files: [] };
    const name = 'Kézzel hozzáadott meccsek';
    x.meta.files = [...(x.meta.files || []).filter(f => f.name !== name), { name, modified: new Date().toISOString(), importedAt: new Date().toISOString() }];
    this.excel[lg] = x;
  }

  removeCup(lg, cupKey) {
    const x = this.excel[lg];
    if (x?.cups) delete x.cups[cupKey];
  }

  /** All played games of the team with a score (NB I/A + uploaded cup/European games), oldest first. */
  playedGames(lg, id) {
    return this.teamFixtures(lg, id).filter(m => m.status === 'finished' && m.score);
  }

  /** All games still to play (today or later), soonest first. */
  upcomingGames(lg, id) {
    const today = this.now.toISOString().slice(0, 10);
    return this.teamFixtures(lg, id).filter(m => m.status !== 'finished' && m.date && m.date >= today);
  }

  /** Most recent finished games with a valid score, oldest first. */
  lastResults(lg, id, n) {
    const done = this.teamFixtures(lg, id).filter(m => m.status === 'finished' && m.score);
    return done.slice(-n);
  }

  nextGames(lg, id, n) {
    const today = this.now.toISOString().slice(0, 10);
    return this.teamFixtures(lg, id).filter(m => m.status !== 'finished' && m.date && m.date >= today).slice(0, n);
  }

  /** Played matches in the window that have no result in the data (stale feed). */
  missingResults(lg, id) {
    return this.teamFixtures(lg, id).filter(m => m.resultMissing);
  }

  /** Arena, referees and MKOSZ controller of a dashboard fixture (by match URL), or null. */
  matchStaff(lg, m) {
    return (m && m.url && this.leagues[lg].referees[m.url]) || null;
  }

  standing(lg, id) { return this.leagues[lg].standings[id] || null; }

  /** Attach an Excel import: { team: {id: {key: value}}, players: {id: [row]}, meta: {file, modified, importedAt}, enabled } */
  setExcel(lg, data) { this.excel[lg] = data; }

  /** Merge one imported file into the league's Excel data (team stats per field, players per team). */
  mergeExcel(lg, imp, file) {
    const x = this.excel[lg] || { team: {}, players: {}, cups: {}, enabled: true, meta: { files: [] } };
    for (const [id, v] of Object.entries(imp.team || {})) x.team[id] = { ...(x.team[id] || {}), ...v };
    Object.assign(x.players, imp.players || {});
    x.cups = x.cups || {};
    for (const g of imp.cups || []) x.cups[`${g.date}|${g.homeId || g.home}|${g.awayId || g.away}`] = g;
    x.meta = x.meta || { files: [] };
    x.meta.files = [...(x.meta.files || []).filter(f => f.name !== file.name), { name: file.name, modified: file.modified || null, importedAt: new Date().toISOString() }];
    x.enabled = true;
    this.excel[lg] = x;
  }

  #excelOn(lg) { const x = this.excel[lg]; return x && x.enabled !== false ? x : null; }

  stat(lg, id, key) {
    const x = this.#excelOn(lg)?.team?.[id]?.[key];
    if (x !== undefined && x !== null) return num(x);
    return num(this.leagues[lg].teamStats[id]?.season?.[key]);
  }

  /** 'excel' when the value comes from the imported file, 'dashboard' otherwise. */
  statSource(lg, id, key) {
    const x = this.#excelOn(lg)?.team?.[id]?.[key];
    return x !== undefined && x !== null ? 'excel' : 'dashboard';
  }

  /** Competition rank (1 = best) of a team within its league for one stat. */
  statRank(lg, id, key, lowerIsBetter = false) {
    const mine = this.stat(lg, id, key);
    if (mine === null) return null;
    const all = Object.keys(this.leagues[lg].teamStats).map(t => this.stat(lg, t, key)).filter(v => v !== null);
    return 1 + all.filter(v => (lowerIsBetter ? v < mine : v > mine)).length;
  }

  players(lg, id) {
    const x = this.#excelOn(lg)?.players?.[id];
    if (x && x.length) return { name: club(lg, id)?.official, sourceUrl: null, source: 'excel', players: x };
    const d = this.leagues[lg].players[id];
    return d ? { ...d, source: 'dashboard' } : null;
  }

  /** Is the uploaded Excel switched on and does it hold team statistics (any team) / this team? */
  excelTeams(lg) { const x = this.#excelOn(lg); return x?.team ? Object.keys(x.team).filter(id => Object.keys(x.team[id] || {}).length) : []; }
  excelHasTeam(lg, id) { return this.excelTeams(lg).includes(id); }

  /** Loads the lazy sources (player pages) of a league into the store; fetchJson(file) as for loadDashboard. */
  async loadLazy(lg, key, fetchJson) {
    const def = SOURCES[key];
    if (!def || this.lazyLoaded?.[lg + key]) return;
    (this.lazyLoaded ||= {})[lg + key] = true;
    try {
      const j = await fetchJson(def[lg]);
      if (key === 'playerPages') { this.leagues[lg].playerPages = j.players || {}; this.leagues[lg].updated.playerPages = j.updated_at || null; }
    } catch (e) { this.errors.push({ league: lg, dataset: key, file: def[lg], error: String(e.message || e) }); }
  }

  /** Season / game log / career of a player from the Hunbasket player page (null when not collected). */
  playerPage(lg, id) { return this.leagues[lg].playerPages[id] || null; }

  /** Roster, coaches, records … of a club from the Hunbasket team page (null when not collected). */
  teamPage(lg, id) { return this.leagues[lg].teamPages[id] || null; }

  excelInfo(lg) {
    const x = this.excel[lg];
    if (!x) return null;
    const m = x.meta || {};
    const files = m.files || (m.file ? [{ name: m.file, modified: m.modified }] : []);
    const times = files.map(f => f.modified).filter(Boolean).sort();
    return {
      enabled: x.enabled !== false, files, file: files.map(f => f.name).join(', ') || '—', modified: times.at(-1) || null,
      teams: Object.keys(x.team || {}).length, playerTeams: Object.keys(x.players || {}).length, cups: Object.keys(x.cups || {}).length,
    };
  }

  /** Age in hours of each dataset, plus a stale flag. */
  freshness(lg) {
    const out = {};
    for (const [k, v] of Object.entries(this.leagues[lg].updated)) {
      const checked = this.leagues[lg].checked[k];
      const t = v ? Date.parse(v) : NaN;
      const tc = checked ? Date.parse(checked) : NaN;
      // a source that was checked recently is fresh even when its content did not change (e.g. the table during a break)
      const fresh = Number.isFinite(tc) ? Math.max(Number.isFinite(t) ? t : 0, tc) : t;
      const hours = Number.isFinite(fresh) ? (this.now - fresh) / 36e5 : null;
      out[k] = { updated_at: v, checked_at: checked || null, hours, stale: hours === null || hours > STALE_HOURS };
    }
    return out;
  }
}

/** fetchJson(fileName) must return parsed JSON or throw. */
export async function loadDashboard(fetchJson, now = new Date()) {
  const raw = { men: {}, women: {}, errors: [] };
  const jobs = [];
  for (const [key, def] of Object.entries(SOURCES)) {
    if (def.lazy) continue; // big files are loaded when a graphic needs them (loadLazy)
    for (const lg of Object.keys(LEAGUES)) {
      jobs.push(fetchJson(def[lg]).then(j => { raw[lg][key] = j; })
        .catch(e => def.optional || raw.errors.push({ league: lg, dataset: key, file: def[lg], error: String(e.message || e) })));
    }
  }
  await Promise.all(jobs);
  return new Store(raw, now);
}

export { num };
