// Binders turn dashboard data into template field values.
// Each field gets {text|src|color, source, missing, note}. A value that is not
// in the data is never filled in: it renders as "—" and is flagged `missing`
// until the operator types an override.
import { club } from './clubs.js';
import { STAT_ROWS, PS_STATS, PS_SMALL, TEAMSTAT_COLS, GREEN, RED, WIN, WHITE_TXT } from './templates.js';
import { num, gameKey } from './data.js';

export const MISSING = '—';

export const COMPETITIONS = {
  '': 'NB I/A (nincs logó)',
  'comp/euroleague-women': 'EuroLeague Women',
  'comp/eurocup-women': 'EuroCup Women',
  'comp/bcl': 'Basketball Champions League',
};

// Venues that appear in the designs; any other venue is entered once and remembered.
export const KNOWN_VENUES = {
  'men/sopron': 'Novomatic Aréna',
  'women/sercounigyor': 'Olimpiai Sport Park',
};

export const fmtDate = iso => (iso ? iso.replace(/-/g, '.') + '.' : null);

function fmt1(v) {
  if (v === null) return null;
  return Math.abs(v) < 1e-9 ? '0' : v.toFixed(1);
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Title colour + outline for the team-stat header (DVTK: red + white outline, Falco: yellow + dark outline). */
export function titleColors(c) {
  return { color: c.brand, outline: { size: 3, color: luminance(c.brand) > 0.35 ? '#1a1819' : '#ffffff', dx: 0, dy: 0 } };
}

const field = (text, source, extra = {}) => (text === null || text === undefined || text === ''
  ? { text: MISSING, source, missing: true, ...extra }
  : { text: String(text), source, ...extra });

const logo = (lg, id) => ({ src: `${lg}/${id}`, source: 'Logó a "logók 26-27" PSD-ből' });

// ───────────────────────── comparison ─────────────────────────
export function bindComparison(store, lg, homeId, awayId) {
  const L = store.league(lg);
  const fromExcel = STAT_ROWS.some(s => store.statSource(lg, homeId, s.key) === 'excel' || store.statSource(lg, awayId, s.key) === 'excel');
  const srcName = L.statSource === 'kosarstat' ? 'KosárStat' : 'Hunbasket';
  const site = fromExcel ? 'FULLFIELD.INFO' : (L.statSource === 'kosarstat' ? 'KOSARSTAT.HU' : 'HUNBASKET.HU');
  const excelOn = store.excelTeams(lg).length > 0;
  const missingFromExcel = excelOn ? [homeId, awayId].filter(id => !store.excelHasTeam(lg, id)).map(id => club(lg, id)?.official || id) : [];
  const v = {
    subtitle: {
      runs: [{ text: 'A mérkőző felek idei teljesítménye, statisztikai átlagszámokban - via ' }, { text: site, color: '#37b3fd' }],
      text: 'A mérkőző felek idei teljesítménye, statisztikai átlagszámokban - via ' + site,
      source: fromExcel ? 'FullField.info Excel (feltöltve)' : 'Adatforrás: ' + srcName,
      note: missingFromExcel.length ? `Nem szerepel a feltöltött FullField Excelben: ${missingFromExcel.join(', ')} – az ő értékei a ${srcName}-adatokból jönnek, ellenőrizd a feliratot.` : undefined,
    },
    'home.logo': logo(lg, homeId),
    'away.logo': logo(lg, awayId),
  };
  for (const s of STAT_ROWS) {
    const h = store.stat(lg, homeId, s.key), a = store.stat(lg, awayId, s.key);
    const f = x => (x === null ? null : x.toFixed(1) + (s.pct ? '%' : ''));
    let hc = WHITE_TXT, ac = WHITE_TXT;
    if (h !== null && a !== null) {
      const hb = s.lowerIsBetter ? h <= a : h >= a, ab = s.lowerIsBetter ? a <= h : a >= h;
      hc = hb ? GREEN : RED; ac = ab ? GREEN : RED;
    }
    const missingNote = x => (store.statSource(lg, x, s.key) === 'excel' ? undefined : (s.key === 'val'
      ? (lg === 'women' ? 'EFF: nincs a FullField Excelben ennél a csapatnál – a Hunbasket csapat-VAL szerepel (más képlettel)' : 'EFF: nincs a FullField Excelben ennél a csapatnál, és a KosárStat adatcsomagban sincs – töltsd fel Excelből, vagy írd be kézzel')
      : undefined));
    const note = missingNote(homeId) || missingNote(awayId);
    const lab = id => (store.statSource(lg, id, s.key) === 'excel' ? `Excel – ${s.label}` : `${srcName} – ${s.label}`);
    v[`home.${s.key}`] = field(f(h), lab(homeId), { color: hc, note });
    v[`away.${s.key}`] = field(f(a), lab(awayId), { color: ac, note });
    const hr = store.statRank(lg, homeId, s.key, s.lowerIsBetter), ar = store.statRank(lg, awayId, s.key, s.lowerIsBetter);
    const rankSrc = `Ligahelyezés ${Object.keys(L.teamStats).length} csapatból${s.lowerIsBetter ? ' (kevesebb = jobb)' : ''}`;
    v[`home.rank.${s.key}`] = field(hr === null ? null : `(${hr}.)`, rankSrc);
    v[`away.rank.${s.key}`] = field(ar === null ? null : `(${ar}.)`, rankSrc);
  }
  return v;
}

// ───────────────────────── team stats ─────────────────────────
/** Players in display order and which ones fit the design's rows. */
export function teamstatPlayers(store, lg, teamId, rows, selected) {
  const P = store.players(lg, teamId);
  if (!P) return { all: [], shown: [] };
  const all = P.players.map((p, i) => ({ key: `${p['#']}|${p['Játékos']}`, idx: i, p }))
    .sort((a, b) => (num(a.p['#']) ?? 999) - (num(b.p['#']) ?? 999) || a.p['Játékos'].localeCompare(b.p['Játékos'], 'hu'));
  let shown;
  if (selected) shown = all.filter(x => selected.includes(x.key));
  else if (all.length <= rows) shown = all;
  else {
    // more players than rows: keep the ones with most minutes per game
    const keep = new Set([...all].sort((a, b) => (num(b.p['Idő']) ?? 0) - (num(a.p['Idő']) ?? 0)).slice(0, rows).map(x => x.key));
    shown = all.filter(x => keep.has(x.key));
  }
  return { all, shown: shown.slice(0, rows) };
}

export function bindTeamstats(store, lg, teamId, tpl, measure, selected) {
  const c = club(lg, teamId);
  const cols = TEAMSTAT_COLS[lg];
  const g = tpl.geometry;
  const { all, shown } = teamstatPlayers(store, lg, teamId, tpl.rows, selected);
  const tc = titleColors(c);
  const v = { 'team.logo': logo(lg, teamId) };
  v['team.name'] = { text: c.official, source: 'Hivatalos csapatnév (Hunbasket)', color: tc.color, outline: tc.outline };
  // centre logo + name as a group, like the designs
  const nameEl = tpl.elements.find(e => e.id === 'team.name');
  const nameW = Math.min(measure(nameEl, c.official.toLocaleUpperCase('hu-HU')), g.nameMax);
  const [, ly, lw, lh] = g.logoBox;
  const groupCenter = lg === 'men' ? 927.5 : 936.5;
  const start = groupCenter - (lw + g.logoGap + nameW) / 2;
  v['team.logo'].geom = { box: [start + lw / 2, ly, lw, lh] };
  v['team.name'].geom = { x: start + lw + g.logoGap };
  for (const e of tpl.elements) if (e.defaultText) v[e.id] = { text: e.defaultText, source: 'Fix felirat a PSD-ből' };

  const P0 = store.players(lg, teamId);
  const src = P0?.source === 'excel' ? 'Excel – játékosstatisztika (meccsenkénti átlag)' : 'Hunbasket játékosstatisztika (meccsenkénti átlag)';
  const best = {};
  for (const col of cols) {
    const vals = shown.map(x => num(x.p[col.key])).filter(x => x !== null);
    if (col.best || col.worst) best[col.key] = vals.length ? Math.max(...vals) : null;
  }
  // jersey numbers: the feed repeats numbers (many players listed as 0) – a
  // number shared by several players of the team is not shown as fact
  const numCount = {};
  for (const x of all) numCount[x.p['#']] = (numCount[x.p['#']] || 0) + 1;
  shown.forEach((x, r) => {
    const unique = numCount[x.p['#']] === 1;
    v[`r${r}.num`] = field(unique ? x.p['#'] : null, src, unique ? {} : { note: `A mezszám („${x.p['#']}”) az adatokban több játékosnál is szerepel – kézzel add meg.` });
    v[`r${r}.name`] = field(x.p['Játékos'], src);
    for (const col of cols) {
      const n = num(x.p[col.key]);
      const text = col.key === 'M.' ? (n === null ? null : String(Math.round(n))) : fmt1(n);
      let color = '#ffffff';
      if (n !== null && n > 0 && best[col.key] !== null && n === best[col.key]) color = col.worst ? RED : WIN;
      v[`r${r}.${col.key}`] = field(text, src, { color });
    }
  });
  for (let r = shown.length; r < tpl.rows; r++) {
    for (const e of tpl.elements) if (e.id.startsWith(`r${r}.`)) v[e.id] = { text: '', source: 'Üres sor' };
  }
  return { values: v, players: all, shown, hidden: all.length - shown.length };
}

// ───────────────────────── row lists (results / schedule) ─────────────────────────
function matchName(lg, m) {
  const h = club(lg, m.homeId), a = club(lg, m.awayId);
  return `${h ? h.short : m.home} - ${a ? a.short : m.away}`;
}

/** `selected`: optional list of game keys the operator picked (otherwise the latest / next games). */
export function bindRowList(store, lg, teamId, tpl, selected = null, customs = []) {
  const c = club(lg, teamId);
  const type = tpl.type;
  const suffix = type === 'schedule' ? (lg === 'men' ? 'MENETRENDJE' : 'Következő MÉRKŐZÉSEI') : 'Eredményei';
  const v = {
    title: { text: `A ${c.official}\n${suffix}`, source: 'Hivatalos csapatnév (Hunbasket)' },
    'team.logo.left': logo(lg, teamId),
    'team.logo.right': logo(lg, teamId),
  };
  const candidates = type === 'schedule' ? store.upcomingGames(lg, teamId) : store.playedGames(lg, teamId);
  let games;
  if (selected) {
    // the operator's own list, in the operator's order: games of the data and free-text rows ("custom:…" keys)
    const byKey = new Map([...candidates, ...customs.map(c => ({ ...c, custom: true, url: c.key }))].map(m => [gameKey(m), m]));
    games = selected.map(k => byKey.get(k)).filter(Boolean).slice(0, tpl.rows);
  }
  else if (type === 'schedule') {
    // the very next game is usually the one the graphic is made for: the default list starts with the game after it
    // (it stays in the candidate list and can be ticked); with fewer than 5 games left after it, it is kept
    const start = candidates.length - 1 >= 5 ? 1 : 0;
    games = candidates.slice(start, start + tpl.rows);
  } else games = candidates.slice(-tpl.rows);
  const src = 'Hunbasket menetrend (NB I/A)';
  for (let r = 0; r < tpl.rows; r++) {
    const m = games[r];
    if (!m) {
      for (const e of tpl.elements) if (e.id.startsWith(`r${r}.`)) v[e.id] = e.type === 'image' ? { src: '' } : { text: '', source: 'Üres sor (nincs több mérkőzés az adatokban)' };
      continue;
    }
    if (type === 'schedule') {
      v[`r${r}.date`] = field(m.time ? `${fmtDate(m.date)} - ${m.time}` : fmtDate(m.date), src);
    } else {
      v[`r${r}.date`] = field(fmtDate(m.date), src);
    }
    if (m.custom) { // free-text row typed by the operator: shown exactly as typed
      const own = 'Kézzel beírt sor';
      v[`r${r}.date`] = { text: m.dateText || '', source: own };
      v[`r${r}.comp`] = { src: m.compKey || '', source: own };
      v[`r${r}.match`] = { text: m.matchText || '', source: own };
      if (type !== 'schedule') {
        const color = type === 'resultrows' ? WHITE_TXT : undefined;
        v[`r${r}.score`] = { text: m.scoreText || '', source: own, ...(color ? { color } : {}) };
        if (type === 'resultrows') { v[`r${r}.match`].color = WHITE_TXT; v[`r${r}.date`].color = WHITE_TXT; }
      }
      continue;
    }
    const cup = !!m.cup;
    const rsrc = cup ? `Feltöltött kupa-/európai meccs${m.competition ? ' – ' + m.competition : ''}` : src;
    if (cup) {
      v[`r${r}.date`].source = rsrc;
      v[`r${r}.comp`] = { src: m.compKey || '', source: m.compKey ? rsrc : 'Nincs logó ehhez a sorozathoz' + (m.competition ? ` (${m.competition})` : ''), ...(m.compKey ? {} : { note: 'Ehhez a sorozathoz nincs logó a PSD-kben – a sor logó nélkül jelenik meg (kézzel választható).' }) };
    } else v[`r${r}.comp`] = { src: '', source: 'NB I/A mérkőzés' };
    v[`r${r}.match`] = field(matchName(lg, m), rsrc);
    if (type !== 'schedule') {
      const won = m.homeId === teamId ? m.score.home > m.score.away : m.score.away > m.score.home;
      const color = won ? WIN : RED;
      v[`r${r}.score`] = field(`${m.score.home}-${m.score.away}`, rsrc, { color });
      if (type === 'resultrows') {
        v[`r${r}.match`].color = color;
        v[`r${r}.score`].color = color;
        v[`r${r}.date`].color = WHITE_TXT;
      }
    }
  }
  const missing = store.missingResults(lg, teamId).map(m => `${fmtDate(m.date)} ${matchName(lg, m)}`);
  return { values: v, games, candidates, missingResults: missing };
}

// ───────────────────────── intro ─────────────────────────
export function bindIntro(store, lg, m, venues = {}) {
  const h = club(lg, m.homeId), a = club(lg, m.awayId);
  const time = m.time ? m.time.replace(':', '.') : null;
  const parts = ['Alapszakasz', m.roundNo ? `${m.roundNo}. forduló` : null, fmtDate(m.date), time];
  const venueKey = `${lg}/${m.homeId}`;
  const dataVenue = store.matchStaff(lg, m)?.venue || null; // arena of this very game (neutral courts, moved games)
  const venue = dataVenue ?? venues[venueKey] ?? KNOWN_VENUES[venueKey] ?? null;
  const rank = id => {
    const s = store.standing(lg, id);
    return s ? `(${s.rank}. hely - ${s.wins}-${s.losses})` : null;
  };
  return {
    round: field(parts.includes(null) ? null : parts.join(' - '), 'Hunbasket menetrend', { note: 'A szakasz ("Alapszakasz") az adatokban nem szerepel – rájátszásnál írd át.' }),
    venue: field(venue, dataVenue ? 'Hunbasket teljes menetrend (helyszín)' : venue ? (venues[venueKey] ? 'Mentett helyszín' : 'Helyszín a PSD-ből') : 'Nincs helyszín-adat',
      dataVenue ? {} : { note: 'Ehhez a meccshez nincs helyszín az adatokban. A beírt helyszínt a stúdió a hazai csapathoz menti.' }),
    'home.name': field(h.intro, 'Csapatnév'),
    'away.name': field(a.intro, 'Csapatnév'),
    'home.logo': logo(lg, m.homeId),
    'away.logo': logo(lg, m.awayId),
    'home.rank': field(rank(m.homeId), 'Hunbasket tabella'),
    'away.rank': field(rank(m.awayId), 'Hunbasket tabella'),
  };
}

// ───────────────────────── next match ("Következik") ─────────────────────────
export function bindNextMatch(store, lg, m) {
  const time = m.time ? m.time.replace(':', '.') : null; // "12:30" → "12.30" as in the design
  return {
    title: { text: 'Következik', source: 'Fix felirat a PSD-ből' },
    time: field(time, 'Hunbasket menetrend', { note: 'A kezdési időpont nincs az adatokban – kézzel add meg.' }),
    'home.logo': logo(lg, m.homeId),
    'away.logo': logo(lg, m.awayId),
    frame: { src: 'nextmatch/frame', source: 'A PSD rejtett „TOP keret” rétege (alapból ki van kapcsolva)' },
  };
}

// ───────────────────────── referees ─────────────────────────
/** Referees + MKOSZ controller of a dashboard fixture from the Hunbasket full schedule; missing → flagged, manual. */
export function bindReferees(store, lg, m) {
  const staff = m && !m.custom ? store.matchStaff(lg, m) : null;
  const src = staff ? 'Hunbasket teljes menetrend (játékvezetők, ellenőr)' : 'Kézi bevitel';
  const why = !m ? 'Nincs kiválasztott mérkőzés.'
    : m.custom ? 'Egyéni párosításhoz nincs játékvezető-adat – kézzel add meg.'
      : !staff ? 'Ehhez a meccshez nincs játékvezető-adat.'
        : 'A Hunbasket még nem tett közzé játékvezetőt ennél a meccsnél.';
  const refs = staff?.referees || [];
  const v = {
    'controller.label': { text: 'MKOSZ Ellenőr:', source: 'Fix felirat a PSD-ből' },
    controller: field(staff?.controller || null, src, staff?.controller ? {} : { note: why }),
  };
  for (let i = 0; i < 3; i++) v[`ref${i + 1}`] = field(refs[i] || null, src, refs[i] ? {} : { note: why });
  return v;
}

// ───────────────────────── star-player comparison ─────────────────────────
// player table column of every comparison row (see STAT_ROWS)
export const PLAYER_COLS = { ppg: 'P.', fg2_pct: '2P %', fg3_pct: '3P %', ft_pct: 'BT %', reb: 'ÖLP', ast: 'GP', stl: 'SZL', tov: 'EL', val: 'VAL' };
const ATTEMPTS = { fg2_pct: '2P K', fg3_pct: '3P K', ft_pct: 'BT K' }; // a percentage counts in the ranking from 1 attempt / game

const pKey = p => `${p['#']}|${p['Játékos']}`;

/** Players of a team, best scorer first (the first one is the default "star"). */
export function playerOptions(store, lg, teamId) {
  const P = store.players(lg, teamId);
  return (P?.players || []).map(p => ({ key: pKey(p), name: p['Játékos'], p }))
    .sort((a, b) => (num(b.p['P.']) ?? -1) - (num(a.p['P.']) ?? -1) || a.name.localeCompare(b.name, 'hu'));
}

/** League-wide ranking pool: players with at least half of the games of the most active player. */
function rankPool(store, lg) {
  const all = [];
  for (const id of Object.keys(store.league(lg).players)) for (const x of playerOptions(store, lg, id)) all.push(x.p);
  const maxM = Math.max(0, ...all.map(p => num(p['M.']) ?? 0));
  const minM = Math.max(3, Math.round(maxM / 2));
  return { pool: all.filter(p => (num(p['M.']) ?? 0) >= minM), minM };
}

/** The chosen player, or by default the best scorer among players with enough games (so the ranking works). */
export function pickPlayer(store, lg, id, key, minM = rankPool(store, lg).minM) {
  const opts = playerOptions(store, lg, id);
  return opts.find(o => o.key === key) || opts.find(o => (num(o.p['M.']) ?? 0) >= minM) || opts[0] || null;
}

export function bindPlayerCompare(store, lg, homeId, awayId, sel = {}) {
  const L = store.league(lg);
  const { pool, minM } = rankPool(store, lg);
  const site = (store.players(lg, homeId)?.source === 'excel' || store.players(lg, awayId)?.source === 'excel') ? 'FULLFIELD.INFO' : 'HUNBASKET.HU';
  const pick = (id, key) => pickPlayer(store, lg, id, key, minM);
  const hp = pick(homeId, sel.home), ap = pick(awayId, sel.away);
  const nm = x => (x ? x.name : '—');
  const v = {
    title: { text: 'KULCSJÁTÉKOSOK', source: 'Fix felirat (a PSD-ben „Csapatok összevetése” állt)' },
    subtitle: {
      runs: [{ text: nm(hp), color: GREEN }, { text: ' – ' }, { text: nm(ap), color: RED }, { text: ' – idei átlagok, via ' }, { text: site, color: '#37b3fd' }],
      text: `${nm(hp)} – ${nm(ap)} – idei átlagok, via ${site}`,
      source: 'Kiválasztott játékosok', note: !hp || !ap ? 'Az egyik csapathoz nincs játékosstatisztika az adatokban.' : undefined,
    },
    'home.logo': logo(lg, homeId),
    'away.logo': logo(lg, awayId),
  };
  const rankOf = (p, col, s) => {
    if (!p || num(p[col]) === null) return null;
    const val = num(p[col]);
    if ((num(p['M.']) ?? 0) < minM) return null; // not enough games to be ranked
    if (ATTEMPTS[s.key] && (num(p[ATTEMPTS[s.key]]) ?? 0) < 1) return null;
    const rivals = pool.filter(q => num(q[col]) !== null && (!ATTEMPTS[s.key] || (num(q[ATTEMPTS[s.key]]) ?? 0) >= 1));
    return 1 + rivals.filter(q => (s.lowerIsBetter ? num(q[col]) < val : num(q[col]) > val)).length;
  };
  for (const s of STAT_ROWS) {
    const col = PLAYER_COLS[s.key];
    const h = hp ? num(hp.p[col]) : null, a = ap ? num(ap.p[col]) : null;
    const f = x => (x === null ? null : x.toFixed(1) + (s.pct ? '%' : ''));
    let hc = WHITE_TXT, ac = WHITE_TXT;
    if (h !== null && a !== null) {
      const hb = s.lowerIsBetter ? h <= a : h >= a, ab = s.lowerIsBetter ? a <= h : a >= h;
      hc = hb ? GREEN : RED; ac = ab ? GREEN : RED;
    }
    v[`home.${s.key}`] = field(f(h), `${nm(hp)} – ${s.label}`, { color: hc });
    v[`away.${s.key}`] = field(f(a), `${nm(ap)} – ${s.label}`, { color: ac });
    const hr = rankOf(hp?.p, col, s), ar = rankOf(ap?.p, col, s);
    const src = `Helyezés a liga ${pool.length} játékosa közül (min. ${minM} meccs${ATTEMPTS[s.key] ? ', min. 1 kísérlet/meccs' : ''}${s.lowerIsBetter ? '; kevesebb = jobb' : ''})`;
    v[`home.rank.${s.key}`] = field(hr === null ? null : `(${hr}.)`, src);
    v[`away.rank.${s.key}`] = field(ar === null ? null : `(${ar}.)`, src);
  }
  return v;
}

// ───────────────────────── player special ─────────────────────────
// column names of the Hunbasket player page (season / career tables and the game log), see scripts/update_player_pages.py
const PP_SEASON = ['M.', 'K.', 'P.', 'Idő', '2P S', '2P K', '2P %', '3P S', '3P K', '3P %', 'BT S', 'BT K', 'BT %', 'VLP', 'TLP', 'ÖLP', 'SZL', 'EL', 'Fault', 'Kih. fault', 'GP', 'Blokk', 'Kapott blokk', 'VAL'];
const PP_GAME = ['K.', 'P.', 'Idő', '2P S', '2P K', '2P %', '3P S', '3P K', '3P %', 'BT S', 'BT K', 'BT %', 'VLP', 'TLP', 'ÖLP', 'SZL', 'EL', 'Fault', 'Kih. fault', 'GP', 'Blokk', 'Kapott blokk', 'VAL'];
const normTok = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

/** Hunbasket player id of a player of the player-statistics list (matched by the words of the name within the team's roster). */
export function playerIdFor(store, lg, teamId, name) {
  const want = normTok(name);
  if (!want.length) return null;
  for (const p of rosterPlayers(store, lg, teamId)) {
    const have = normTok(p.name);
    if (want.every(w => have.includes(w))) return idOf(p.url);
  }
  return null;
}

/** Average of the last n games of the game log, as a map of the season column names (percentages from the sums). */
export function lastGamesMap(page, n) {
  const g = (page?.gamelog || []).slice(-n);
  if (!g.length) return null;
  const col = c => g.map(x => num(x.stats[PP_GAME.indexOf(c)]));
  const sum = c => col(c).reduce((a, b) => a + (b ?? 0), 0);
  const avg = c => sum(c) / g.length;
  const m = { 'M.': String(g.length), 'K.': String(g.filter(x => x.stats[0] === '*').length) };
  for (const c of ['P.', 'Idő', '2P S', '2P K', '3P S', '3P K', 'BT S', 'BT K', 'VLP', 'TLP', 'ÖLP', 'SZL', 'EL', 'Fault', 'Kih. fault', 'GP', 'Blokk', 'Kapott blokk', 'VAL']) m[c] = String(avg(c));
  for (const [pc, sc, kc] of [['2P %', '2P S', '2P K'], ['3P %', '3P S', '3P K'], ['BT %', 'BT S', 'BT K']]) m[pc] = sum(kc) ? String(100 * sum(sc) / sum(kc)) : null;
  return m;
}

/** Career averages (all seasons, regular season) of the player page + the span of the seasons. */
export function careerMap(page) {
  const rows = page?.career?.regular || [];
  const tot = rows.find(r => r.label === 'Összesítés');
  if (!tot) return null;
  const seasons = rows.filter(r => /^\d{4}\/\d{4}$/.test(r.label)).map(r => r.label).sort();
  return { map: Object.fromEntries(PP_SEASON.map((c, i) => [c, tot.average[i]])), seasons };
}

/** Name, the data columns (season / career / last N games) and the club logo come from the data; story, manual columns and photo are the operator's. */
export function bindPlayerSpecial(store, lg, teamId, playerKey, tpl) {
  const P = pickPlayer(store, lg, teamId, playerKey);
  const cfg = tpl.ps.cfg, n = cfg.cols;
  const manual = 'Kézzel töltendő';
  const seasonSrc = store.players(lg, teamId)?.source === 'excel' ? 'Excel – játékosstatisztika' : 'Hunbasket játékosstatisztika (idei átlag)';
  const pid = P ? playerIdFor(store, lg, teamId, P.name) : null;
  const page = pid ? store.playerPage(lg, pid) : null;
  const v = {
    title: P ? { text: P.name, source: seasonSrc } : field(null, seasonSrc),
    subtitle: { text: '', source: 'Kézzel írandó (a sztori, 1–2 sor)' },
    logo: logo(lg, teamId),
  };
  // one value map per data source
  const maps = {}, heads = {};
  if (P) {
    maps.season = Object.fromEntries(Object.keys(P.p).map(k => [k, P.p[k]]));
    const m = Math.round(num(P.p['M.']) ?? 0);
    heads.season = m ? `${m} idei\nmeccs` : '';
  }
  const car = careerMap(page);
  if (car) {
    maps.career = car.map;
    heads.career = car.seasons.length ? `Karrier\n${car.seasons[0].slice(0, 4)}–${car.seasons.at(-1).slice(5)}` : 'Karrier';
  }
  const last = lastGamesMap(page, cfg.lastN);
  if (last) { maps.last = last; heads.last = `Utolsó ${last['M.']}\nmeccs`; }
  const sample = tpl.elements.find(e => e.id === 'r0.c1');
  const rowSize = sample?.size || 96;
  const labelOf = { season: seasonSrc, career: 'Hunbasket játékosoldal – karrier (alapszakasz)', last: `Hunbasket játékosoldal – az utolsó ${cfg.lastN} meccs átlaga` };
  for (let k = 1; k <= n; k++) {
    const kind = cfg.colSrc[k - 1];
    v[`h${k}`] = kind !== 'manual' && heads[kind] ? { text: heads[kind], source: labelOf[kind] } : { text: '', source: kind === 'manual' ? manual : `Nincs ${kind === 'career' ? 'karrier' : 'meccsnapló'}-adat ehhez a játékoshoz (kézzel írható)` };
  }
  cfg.rows.forEach((key, i) => {
    const r = PS_STATS[key];
    v[`r${i}.label`] = { text: r.label, source: 'Sor felirata (átírható)' };
    for (let k = 1; k <= n; k++) {
      const id = `r${i}.c${k}`, kind = cfg.colSrc[k - 1], mp = kind === 'manual' ? null : maps[kind];
      if (!mp) { v[id] = { text: '', source: kind === 'manual' ? manual : 'Nincs adat ehhez a forráshoz' }; continue; }
      const x = num(mp[r.col]), src = labelOf[kind];
      if (r.made) {
        const ms = num(mp[r.made]), at = num(mp[r.att]);
        if (ms !== null && at !== null) {
          const main = `${ms.toFixed(1)}/${at.toFixed(1)}`, pct = x === null ? '' : `(${x.toFixed(1)}%)`;
          const small = PS_SMALL * rowSize / 96;
          // the percentage: smaller, vertically centred on the figures, right after them
          v[id] = { text: main + pct, runs: [{ text: main }, ...(pct ? [{ text: pct, size: small, dy: -(rowSize - small) * 0.365 }] : [])], source: src };
        } else v[id] = field(null, src);
      } else if (r.pct) v[id] = field(x === null ? null : x.toFixed(1) + '%', src);
      else if (r.int) v[id] = field(x === null ? null : String(Math.round(x)), src);
      else v[id] = field(x === null ? null : x.toFixed(1), src);
    }
  }); 
  return v;
}

// ───────────────────────── roster (Keret) ─────────────────────────
const flagKey = f => { const m = String(f || '').match(/\/([a-z]{2})\.svg$/i); return m ? `flag/${m[1].toLowerCase()}` : ''; };
const idOf = url => (String(url || '').match(/\/([A-Z]\d+)\//) || [])[1] || null;

// Hunbasket writes "SURNAME Given Names" (the surname in capitals, accented capitals sometimes lower case: "HORVáTH Roland Péter").
const isSurnameWord = w => { const rest = w.slice(1).replace(/[áéíóöőúüű]/g, ''); return rest.length > 0 && rest === rest.toUpperCase(); };
export function parseName(full) {
  const w = String(full || '').trim().split(/\s+/).filter(Boolean);
  let k = 0;
  while (k < w.length && isSurnameWord(w[k])) k++;
  if (k === 0) k = 1; // no capitals: the first word is the surname
  if (k === w.length && w.length > 1) k = 1; // all capitals: first word = surname, the rest given names
  return { surname: w.slice(0, k).join(' '), given: w.slice(k) };
}
export const isForeign = p => !!p.nationality && p.nationality !== 'HUN' && p.nationality !== '-';
/** The way the designs write names: Hungarian players "SURNAME Given Given", foreign players "Given SURNAME" (first given name only). */
export function displayName(p) {
  const n = parseName(p.name);
  if (isForeign(p)) return [n.given[0], n.surname].filter(Boolean).join(' ');
  return [n.surname, ...n.given.slice(0, 2)].join(' ');
}
export function shortName(name) { return parseName(name).surname + ' ' + parseName(name).given.slice(0, 2).join(' '); }

/** Players of a team page in shirt-number order (the order of the page for equal numbers). */
export function rosterPlayers(store, lg, teamId) {
  const page = store.teamPage(lg, teamId);
  if (!page) return [];
  return page.roster.map((p, i) => ({ ...p, i })).sort((a, b) => (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0) || a.i - b.i);
}

export function bindRoster(store, lg, teamId, tpl, photoIds = new Set()) {
  const page = store.teamPage(lg, teamId), c = club(lg, teamId);
  const players = rosterPlayers(store, lg, teamId);
  const src = 'Hunbasket csapatoldal (keret)';
  const grid = tpl.type === 'rostergrid';
  const v = { logo: logo(lg, teamId) };
  if (!page) return { values: v, players, missing: true };
  const head = page.coaches.find(x => /vezető/i.test(x.role)), assist = page.coaches.find(x => /másod|segéd/i.test(x.role));
  v['coach.label'] = { text: 'Vezetőedző:', source: 'Fix felirat a PSD-ből' };
  v['coach.name'] = head ? { text: head.name, source: src } : field(null, src);
  v['assist.label'] = { text: 'Segédedző:', source: 'Fix felirat a PSD-ből' };
  v['assist.name'] = assist ? { text: assist.name, source: src } : { text: '', source: 'Nincs adat (kézzel írható)' };
  v['assist2.name'] = { text: '', source: 'Kézzel írható' };
  if (!grid) {
    for (const [id, t] of [['hdr.num', '#'], ['hdr.name', 'NÉV'], ['hdr.pos', 'POSZT'], ['hdr.height', 'MAGASSÁG'], ['hdr.year', 'SZÜL. ÉV']]) v[id] = { text: t, source: 'Fix felirat a PSD-ből' };
  }
  const n = tpl.rosterN || players.length;
  for (let i = 0; i < n; i++) {
    const p = players[i];
    if (!p) { for (const e of tpl.elements) if (e.id.startsWith(`r${i}.`)) v[e.id] = e.type === 'image' ? { src: '' } : { text: '', source: 'Üres sor' }; continue; }
    v[`r${i}.num`] = field(p.number, src);
    const foreign = isForeign(p);
    v[`r${i}.flag`] = { src: foreign ? flagKey(p.flag) : '', source: foreign ? `Zászló (${p.nationality})` : 'Magyar játékos: nincs zászló' };
    const h = p.height ? String(p.height).replace(/\s*cm/i, ' cm') : null;
    if (grid) {
      const n = parseName(p.name);
      v[`r${i}.last`] = field(n.surname, src);
      v[`r${i}.first`] = { text: (isForeign(p) ? n.given.slice(0, 1) : n.given.slice(0, 2)).join(' '), source: src };
      v[`r${i}.info`] = { text: [p.position, h].filter(Boolean).join(' · '), source: src };
      const id = idOf(p.url);
      const has = !!(id && photoIds && photoIds.has(id));
      v[`r${i}.photo`] = { src: has ? `photo/${id}` : 'photo/none', source: has ? 'Hunbasket fotó' : 'Nincs fotó (helyőrző)' };
    } else {
      v[`r${i}.name`] = field(displayName(p), src);
      v[`r${i}.pos`] = field(p.position, src);
      v[`r${i}.height`] = field(h, src);
      v[`r${i}.year`] = field(p.birth_year, src);
    }
  }
  return { values: v, players, missing: false };
}


// ───────────────────────── form (last five games) ─────────────────────────
/** One row per team id: the last five played games (NB I/A and European), oldest left, the latest right. */
export function bindForm(store, lg, teamIds) {
  const v = {};
  const src = 'Hunbasket menetrend / eredmények (idei meccsek)';
  teamIds.forEach((teamId, r) => {
    const k = `t${r}`;
    v[`${k}.logo`] = teamId ? logo(lg, teamId) : { src: '' };
    const games = teamId ? store.playedGames(lg, teamId).slice(-5) : [];
    for (let i = 0; i < 5; i++) {
      const m = games[i - (5 - games.length)]; // right-aligned: with fewer games the left columns stay empty
      const e = ['badge', 'logo', 'name', 'score'].map(x => `${k}.g${i}.${x}`);
      if (!m) { v[e[0]] = { src: '' }; v[e[1]] = { src: '' }; v[e[2]] = { text: '', source: 'Nincs ennyi lejátszott meccs' }; v[e[3]] = { text: '', source: 'Nincs ennyi lejátszott meccs' }; continue; }
      const home = m.homeId === teamId, own = home ? m.score.home : m.score.away, opp = home ? m.score.away : m.score.home;
      const oppId = home ? m.awayId : m.homeId, oppName = home ? m.away : m.home;
      v[e[0]] = { src: own > opp ? 'form/win' : 'form/loss', source: own > opp ? 'Győzelem' : 'Vereség' };
      v[e[1]] = oppId ? logo(lg, oppId) : { src: '', source: 'Nincs logó ehhez a csapathoz' };
      v[e[2]] = { text: oppId ? '' : String(oppName || '').split(' ').slice(0, 2).join(' '), source: oppId ? 'Van logó' : `${oppName} (nincs logó)` };
      v[e[3]] = { text: `${home ? '' : '@ '}${own}–${opp}`, source: `${src}${home ? ' – hazai' : ' – idegenbeli (@)'}${m.cup ? ' – kupa/európai' : ''}` };
    }
  });
  return v;
}
