// Live boxscore of the MKOSZ netcasting page (netcasting4.webpont.com/?whun_<id>).
// The feed (storage/full<gamecode>.html, refreshed every ~5 s) is a play-by-play stream in a home-made text format:
//   "key|value#key|value" objects, "%" separates array items. The page decodes it with three string replaces, so do we.
// This module only parses and counts; it never invents a number (what the feed does not say stays null).
// Player codes of the feed (B32393 …) are Hunbasket player ids, so the studio's roster photos (graphics/players/<id>.webp) fit directly.

/** The decoded feed object, or null when the text is not a (complete) feed. */
export function decodeFeed(text) {
  if (!text || typeof text !== 'string') return null;
  let d;
  try { d = JSON.parse(text.replace(/#/g, '","').replace(/\|/g, '":"').replace(/%/g, '"},{"')); } catch { return null; }
  return d && typeof d.i === 'object' && d.i && Array.isArray(d.f) ? d : null;
}

/** The address of the feed of a game (what has to be opened in the browser, copied entirely and pasted into the studio). */
export const feedUrl = (code, kind = 'full') => (gameCode(code) ? `https://netcasting4.webpont.com/storage/${kind}${gameCode(code)}.html` : null);

/** Why a pasted text is not a usable feed: 'empty' | 'html' (the page itself, not the feed) | 'truncated' (starts like the feed but is cut) | 'unknown'; null = fine. */
export function feedProblem(text) {
  const t = String(text ?? '').trim();
  if (!t) return 'empty';
  if (decodeFeed(t)) return null;
  if (/^</.test(t) || /<html|<!doctype|<body|<script/i.test(t.slice(0, 2000))) return 'html';
  if (/^\{"i"/.test(t)) return 'truncated';
  return 'unknown';
}

/** The game code of a netcasting link / code: "https://netcasting4.webpont.com/?whun_135563" → "whun_135563". */
export function gameCode(s) {
  const m = String(s || '').match(/\b(w?hun[a-z0-9]*_\d{3,8})\b/i);
  return m ? m[1].toLowerCase() : null;
}

const clean = s => String(s ?? '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const trimCode = s => String(s ?? '').trim();
// type code of a shot → points (the page's own table): 1, 2, 5 = two pointers, 3 = three pointer, 4 = free throw
const SHOT_POINTS = { 1: 2, 2: 2, 3: 3, 4: 1, 5: 2 };

const blank = () => ({ pts: 0, fg2m: 0, fg2a: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, tov: 0, blk: 0, blkAgainst: 0, pf: 0, fouled: 0, techs: 0 });

/**
 * Parsed game: { id, league, round, date, arena, referees, finished, period, score:{home,away},
 *   teams:{home:{hunbasketId,name,short,color,...}, away}, players:[{code, side, name, number, photo, starter, seconds, stat}] , events }.
 * Stats are counted from the play-by-play (same rules as the netcasting page); `seconds` is the page's own playing time.
 */
export function parseGame(feed, code = null) {
  if (!feed) return null;
  const i = feed.i || {};
  const roster = { home: feed.players?.home || [], away: feed.players?.away || [] };
  const meta = {};
  for (const [code, v] of Object.entries(feed.p || {})) { // "1:33:Dul&nbsp;P.:1405:1" = on court at start : number : short name : seconds played : (reserved)
    const [starter, number, short, seconds] = String(v).split(':');
    meta[trimCode(code)] = { starter: starter === '1', number: number || '', short: clean(short), seconds: Number(seconds) || 0 };
  }
  const players = new Map(), order = [];
  const side = ha => (ha === 'h' ? 'home' : 'away');
  const get = (code, ha) => {
    code = trimCode(code);
    if (!code) return null;
    if (!players.has(code)) {
      const r = roster[side(ha)].find(x => trimCode(x.Jatekos) === code);
      const m = meta[code] || {};
      players.set(code, { code, side: side(ha), name: clean(r?.nev || m.short || code), number: String(r?.mez ?? m.number ?? ''), short: m.short || '', starter: !!m.starter, seconds: m.seconds ?? null, stat: blank() });
      order.push(code);
    }
    return players.get(code);
  };
  // everybody of the two rosters is a player of the game (the feed lists a "played" event, code 2, for those who got on the floor)
  for (const ha of ['h', 'a']) for (const r of roster[side(ha)]) get(r.Jatekos, ha);
  const team = { home: blank(), away: blank() };
  let periodEnds = 0, lastGt = 0, timeouts = { home: 0, away: 0 };
  for (const e of feed.f) {
    const ha = e[1] === '1' ? 'h' : 'a', s = side(ha), kod = Number(e[2]), type = Number(e[6]);
    const gt = Number(e.gt); if (Number.isFinite(gt) && gt > lastGt) lastGt = gt; // elapsed game time in seconds
    const p = e[3] ? get(e[3], ha) : null;
    const bump = (k, n = 1) => { if (p) p.stat[k] += n; team[s][k] += n; };
    switch (kod) {
      case 1000: { const pts = SHOT_POINTS[type] ?? 2; const k = pts === 3 ? 'fg3' : pts === 1 ? 'ft' : 'fg2'; bump(k + 'm'); bump(k + 'a'); bump('pts', pts); break; }
      case 1001: { const pts = SHOT_POINTS[type] ?? 2; bump((pts === 3 ? 'fg3' : pts === 1 ? 'ft' : 'fg2') + 'a'); break; }
      case 1002: bump('dreb'); break;
      case 1003: bump('oreb'); break;
      case 1004: bump('stl'); break;
      case 1005: bump('tov'); break;
      case 1006: bump('fouled'); break;
      case 1007: bump('pf'); break;
      case 1008: bump('ast'); break;
      case 1009: bump('blk'); break;
      case 1010: bump('blkAgainst'); break;
      case 1020: bump('techs'); break;
      // team events (no player): rebounds / turnovers of the team itself
      case 2002: team[s].dreb += 1; break;
      case 2003: team[s].oreb += 1; break;
      case 2005: team[s].tov += 1; break;
      case 2011: timeouts[s] += 1; break;
      case 1101: periodEnds += 1; break;
      default: break;
    }
  }
  const list = order.map(c => players.get(c));
  for (const p of list) { p.reb = p.stat.oreb + p.stat.dreb; p.eff = efficiency(p.stat); }
  const hp = Number(i.hp), vp = Number(i.vp);
  const clubColor = c => (c?.bg ? `#${c.bg}` : null);
  const scoreFromEvents = { home: team.home.pts, away: team.away.pts };
  return {
    id: gameCode(code),
    league: feed.leaguenat || '',
    round: i.round || '', date: i.date || '', arena: i.arena || '',
    referees: (i.referees || []).map(r => clean(r.name)).filter(Boolean),
    clock: gameClock(lastGt),
    finished: periodEnds >= 4 && lastGt >= 2400 && hp !== vp,
    score: { home: Number.isFinite(hp) ? hp : scoreFromEvents.home, away: Number.isFinite(vp) ? vp : scoreFromEvents.away },
    scoreFromEvents,
    teams: {
      home: { hunbasketId: i.hid || null, name: clean(i.h2 || i.h), short: clean(i.h), color: clubColor(i.hcolors), team: team.home, timeouts: timeouts.home },
      away: { hunbasketId: i.aid || null, name: clean(i.a2 || i.a), short: clean(i.a), color: clubColor(i.acolors), team: team.away, timeouts: timeouts.away },
    },
    players: list,
    eventCount: feed.f.length,
  };
}

/** Period and elapsed time from the game seconds of the feed (4 × 10 min, overtimes 5 min). */
export function gameClock(gt) {
  const period = gt <= 2400 ? Math.max(1, Math.ceil(gt / 600)) : 4 + Math.ceil((gt - 2400) / 300);
  const start = period <= 4 ? (period - 1) * 600 : 2400 + (period - 5) * 300;
  return { period, elapsed: Math.max(0, gt - start), seconds: gt };
}

/** Efficiency (Val) with the usual formula: pts + reb + ast + stl + blk + fouls drawn − missed shots − turnovers − blocks against − fouls. */
export function efficiency(s) {
  const missed = (s.fg2a - s.fg2m) + (s.fg3a - s.fg3m) + (s.fta - s.ftm);
  return s.pts + s.oreb + s.dreb + s.ast + s.stl + s.blk + s.fouled - missed - s.tov - s.blkAgainst - s.pf;
}

/** Players of one side that actually played (seconds on court > 0 or any counted action), best scorer first. */
export function playedPlayers(game, side) {
  const acted = p => Object.values(p.stat).some(v => v > 0);
  return game.players.filter(p => p.side === side && ((p.seconds ?? 0) > 0 || acted(p)))
    .sort((a, b) => b.stat.pts - a.stat.pts || b.reb - a.reb || a.name.localeCompare(b.name, 'hu'));
}

/** "23:25" from seconds. */
export const mmss = sec => (Number.isFinite(sec) ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}` : '');
