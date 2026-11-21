// Binders turn dashboard data into template field values.
// Each field gets {text|src|color, source, missing, note}. A value that is not
// in the data is never filled in: it renders as "—" and is flagged `missing`
// until the operator types an override.
import { club } from './clubs.js';
import { STAT_ROWS, PLAYERSPECIAL_ROWS, TEAMSTAT_COLS, GREEN, RED, WIN, WHITE_TXT } from './templates.js';
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
  const v = {
    subtitle: {
      runs: [{ text: 'A mérkőző felek idei teljesítménye, statisztikai átlagszámokban - via ' }, { text: site, color: '#37b3fd' }],
      text: 'A mérkőző felek idei teljesítménye, statisztikai átlagszámokban - via ' + site,
      source: fromExcel ? 'Feltöltött Excel (a PSD mintában is FULLFIELD.INFO szerepel)' : 'Adatforrás: ' + srcName,
      note: fromExcel ? 'Az adatok a feltöltött Excelből jönnek – ha nem a FullField a forrás, írd át a feliratot.' : undefined,
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
    const note = s.key === 'val' ? (lg === 'women'
      ? 'EFF = Hunbasket csapat-VAL (a PSD mintában a FullField EFF szerepelt, más képlettel) – Excelből felülírható'
      : 'A KosárStat adatcsomagban nincs EFF/VAL mutató – töltsd fel Excelből, vagy írd be kézzel') : undefined;
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
export function bindRowList(store, lg, teamId, tpl, selected = null) {
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
  if (selected) { const set = new Set(selected); games = candidates.filter(m => set.has(gameKey(m))).slice(0, tpl.rows); }
  else games = type === 'schedule' ? candidates.slice(0, tpl.rows) : candidates.slice(-tpl.rows);
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
/** Name, current-season column and the club logo come from the data; story, other columns and photo are the operator's. */
export function bindPlayerSpecial(store, lg, teamId, playerKey, tpl) {
  const P = pickPlayer(store, lg, teamId, playerKey);
  const rows = PLAYERSPECIAL_ROWS[lg];
  const seasonCol = tpl.elements.filter(e => /^h\d$/.test(e.id)).length; // the last column is the current season
  const manual = 'Kézzel töltendő (az adatokban nincs ilyen időszak)';
  const src = store.players(lg, teamId)?.source === 'excel' ? 'Excel – játékosstatisztika' : 'Hunbasket játékosstatisztika (idei átlag)';
  const v = {
    title: P ? { text: P.name, source: src } : field(null, src),
    subtitle: { text: '', source: 'Kézzel írandó (a sztori, 1–2 sor)' },
    logo: logo(lg, teamId),
  };
  for (let k = 1; k <= seasonCol; k++) v[`h${k}`] = { text: '', source: manual };
  const m = P ? Math.round(num(P.p['M.']) ?? 0) : null;
  v[`h${seasonCol}`] = { text: m ? `${m} idei\nmeccs` : '', source: src };
  rows.forEach((r, i) => {
    v[`r${i}.label`] = { text: r.label, source: 'Fix felirat a PSD-ből' };
    for (let k = 1; k < seasonCol; k++) v[`r${i}.c${k}`] = { text: '', source: manual };
    const id = `r${i}.c${seasonCol}`;
    const n = P ? num(P.p[r.col]) : null;
    if (r.pct) {
      const pct = n === null ? null : n.toFixed(1) + '%';
      if (r.made && P && num(P.p[r.made]) !== null && num(P.p[r.att]) !== null) {
        const main = `${num(P.p[r.made]).toFixed(1)}/${num(P.p[r.att]).toFixed(1)}`;
        v[id] = { text: main + `(${pct})`, runs: [{ text: main }, { text: `(${pct})`, size: 40 }], source: src };
      } else v[id] = field(pct, src);
    } else v[id] = field(n === null ? null : n.toFixed(1), src);
  });
  return v;
}
