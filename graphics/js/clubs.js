// League-scoped club registry for the graphics studio.
// Every lookup takes (league, name): a men's and a women's club are never
// confused, even when the names are identical ("NKA Universitas Pécs").
// IDs are the dashboard's logo ids (index.html clubBranding / logos/<league>/<id>.png).
// `brand` colours are copied from the dashboard's clubBranding table, except where
// a club's colour is defined by one of the broadcast designs (noted).

export function normalizeTeamName(n) {
  return String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// official: Hunbasket fixture/standings name. short: name used in the result/schedule rows.
export const CLUBS = {
  men: {
    albafehervar: { official: 'Alba Fehérvár', short: 'Alba Fehérvár', brand: '#1769ad', match: [/alba|fehervar/] },
    atomermomuse: { official: 'Atomerőmű SE', short: 'Atomerőmű', brand: '#b92732', match: [/atomerom|paks/] },
    deac: { official: 'DEAC', short: 'DEAC', brand: '#181818', match: [/^deac$|debrecen/] },
    szedeak: { official: 'Délút-SZTE-Szedeák', short: 'Szedeák', brand: '#1554a2', match: [/szedeak|szeged/] },
    kecskemet: { official: 'Duna Aszfalt-DTKH Kecskemét', short: 'Kecskemét', brand: '#2653a6', match: [/kecskemet/] },
    kormend: { official: 'Egis Körmend', short: 'Körmend', brand: '#c52630', match: [/kormend/] },
    bphonved: { official: 'Endo Plus Service-Honvéd', short: 'EPS-Honvéd', brand: '#b52032', match: [/honved/] },
    falcokc: { official: 'Falco-Vulcano Energia KC Szombathely', short: 'Falco-Vulcano KC', intro: 'Falco-Vulcano KC',
      brand: '#feed01', brandSource: 'Falco csapatstat PSD', match: [/falco|szombathely/] },
    kaposvar: { official: 'Kometa-KVGY Kaposvári KK', short: 'Kaposvár', brand: '#174d9c', match: [/kaposvar/] },
    szolnok: { official: 'NHSZ-Szolnoki Olajbányász', short: 'Szolnok', intro: 'Szolnoki Olajbányász', brand: '#c92c31', match: [/szolnok|olajbanyasz/] },
    nkapecs: { official: 'NKA Universitas Pécs', short: 'NKA Pécs', brand: '#194b91', match: [/nka|pecs/] },
    oroszlany: { official: 'OSE Lions', short: 'OSE Lions', brand: '#db7923', match: [/oroszlany|oselions/] },
    fot: { official: 'PHOENIX Fóti Tigrisek', short: 'Fóti Tigrisek', brand: '#175caa', match: [/phoenix|foti|^fot$/] },
    sopron: { official: 'Sopron KC', short: 'Sopron KC', brand: '#276c43', match: [/sopron/] },
  },
  women: {
    bkgprimaszigetszentmiklos: { official: 'BKG-PRIMA Szigetszentmiklós', short: 'BKG-Prima', intro: 'BKG-Prima', brand: '#b92b36', match: [/bkg|szigetszentmiklos/] },
    csatattk: { official: 'Csata TKK', short: 'Csata TKK', brand: '#bd2d35', match: [/csata/] },
    dvtkhuntherm: { official: 'DVTK HUNTHERM', short: 'DVTK Huntherm', brand: '#ca0001', brandSource: 'DVTK csapatstat PSD', match: [/dvtk|diosgyor/] },
    eltebeacujbuda: { official: 'ELTE BEAC Újbuda', short: 'BEAC Újbuda', brand: '#273c80', match: [/beac/] },
    sercounigyor: { official: 'ETO Basket', short: 'ETO Basket', brand: '#247d4e', match: [/gyor|etobasket|^eto/] },
    tarrkscszekszard: { official: 'KSC Szekszárd', short: 'KSC Szekszárd', brand: '#b83470', match: [/szekszard|ksc/] },
    nkauniversitaspecs: { official: 'NKA Universitas Pécs', short: 'NKA Pécs', brand: '#2156a0', match: [/nka|pecs/] },
    sopronbasket: { official: 'Sopron Basket', short: 'Sopron Basket', brand: '#17683b', match: [/sopron/] },
    tfse: { official: 'TFSE', short: 'TFSE', brand: '#2055a1', match: [/tfse/] },
    vasasakademia: { official: 'Vasas Akadémia', short: 'Vasas Akadémia', brand: '#d32b32', match: [/vasas/] },
    davidkornelka: { official: 'VBW CEKK Cegléd', short: 'VBW Cegléd', brand: '#2467ac', match: [/cekk|cegled|davidkornel|dkka/] },
  },
};

// Exact name variants seen in the dashboard's data files (Hunbasket + KosárStat).
const EXACT = {
  men: {
    sopron: 'sopron', sopronkc: 'sopron',
    nkapecs: 'nkapecs', nkauniversitaspecs: 'nkapecs',
    falcokc: 'falcokc', falcovulcanoenergiakcszombathely: 'falcokc', falcokcszombathely: 'falcokc',
    szolnok: 'szolnok', nhszszolnokiolajbanyasz: 'szolnok', szolnokiolajbanyasz: 'szolnok',
    kormend: 'kormend', egiskormend: 'kormend',
    oroszlany: 'oroszlany', oselions: 'oroszlany', mvmoselions: 'oroszlany',
    atomeromuse: 'atomermomuse', atomeromusepaks: 'atomermomuse',
    kecskemet: 'kecskemet', dunaaszfaltdtkhkecskemet: 'kecskemet', dunaaszfaltdtkkecskemet: 'kecskemet',
    bphonved: 'bphonved', endoplusservicehonved: 'bphonved', budapesthonved: 'bphonved', epshonved: 'bphonved',
    deac: 'deac',
    albafehervar: 'albafehervar',
    kaposvar: 'kaposvar', kometakvgykaposvarikk: 'kaposvar', kometakaposvarikk: 'kaposvar', kaposvarikk: 'kaposvar',
    szedeak: 'szedeak', delutszteszedeak: 'szedeak',
    fot: 'fot', phoenixfotitigrisek: 'fot', fotitigrisek: 'fot', foti: 'fot', tigrisek: 'fot',
    falco: 'falcokc', falcovulcano: 'falcokc', falcovulcanokc: 'falcokc', falcoszombathely: 'falcokc', szombathely: 'falcokc',
    alba: 'albafehervar', honved: 'bphonved', szeged: 'szedeak', lions: 'oroszlany', oroszlanyoselions: 'oroszlany',
    atomeromu: 'atomermomuse', paks: 'atomermomuse', pecs: 'nkapecs', debrecen: 'deac', kaposvari: 'kaposvar',
    szolnoki: 'szolnok', szolnokiolajbanyasz: 'szolnok', olajbanyasz: 'szolnok', egis: 'kormend',
    skc: 'sopron', olaj: 'szolnok', ose: 'oroszlany', nka: 'nkapecs',
    budapestihonvedsportegyesulet: 'bphonved', phoenixmtfot: 'fot', szteszedeak: 'szedeak',
    // earlier names of the same clubs (sponsor / name changes) as they appear in the Hunbasket head-to-head history (2020/21–): the club slot of a season
    // is exactly filled by the old name, so these are the same club. Clubs that are no longer in the league (Zalakerámia ZTE KK, HÜBNER Nyíregyháza BS, Jászberényi KSE) stay unresolved.
    arconicalbafehervar: 'albafehervar', deactungsram: 'deac', falcovolvoalpokautoszombathely: 'falcokc', naturtexszteszedeak: 'szedeak',
  },
  women: {
    bkgprimaszigetszentmiklos: 'bkgprimaszigetszentmiklos', bkgprima: 'bkgprimaszigetszentmiklos',
    csatattk: 'csatattk',
    dvtkhuntherm: 'dvtkhuntherm', dvtk: 'dvtkhuntherm',
    eltebeacujbuda: 'eltebeacujbuda', beacujbuda: 'eltebeacujbuda', eltebeac: 'eltebeacujbuda',
    etobasket: 'sercounigyor', sercounigyor: 'sercounigyor',
    kscszekszard: 'tarrkscszekszard', tarrkscszekszard: 'tarrkscszekszard',
    nkauniversitaspecs: 'nkauniversitaspecs', nkapecs: 'nkauniversitaspecs',
    sopronbasket: 'sopronbasket',
    tfse: 'tfse',
    vasasakademia: 'vasasakademia', vasas: 'vasasakademia',
    vbwcekkcegled: 'davidkornelka', cekkcegled: 'davidkornelka', vbwcegled: 'davidkornelka', cegled: 'davidkornelka', dkka: 'davidkornelka',
    csata: 'csatattk', csatatkkbudapest: 'csatattk', eto: 'sercounigyor', etogyor: 'sercounigyor', gyor: 'sercounigyor',
    beac: 'eltebeacujbuda', ujbuda: 'eltebeacujbuda', szekszard: 'tarrkscszekszard', ksc: 'tarrkscszekszard',
    diosgyor: 'dvtkhuntherm', huntherm: 'dvtkhuntherm', pecs: 'nkauniversitaspecs', bkg: 'bkgprimaszigetszentmiklos',
    szigetszentmiklos: 'bkgprimaszigetszentmiklos', akademia: 'vasasakademia',
    sopron: 'sopronbasket', nka: 'nkauniversitaspecs',
    // earlier names of the same clubs (see the men's block); NOT the same club: PINKK Pécsi 424 (another women's club in Pécs, owner 2026-11-24); not mapped: "Darazsak Sportakadémia", "ZTE Női Kosárlabda Klub" (unknown / not in the league)
    aluinventdvtk: 'dvtkhuntherm', atomeromukscszekszard: 'tarrkscszekszard', bkgprimanaturaszigetszentmiklos: 'bkgprimaszigetszentmiklos',
    eoneltebeac: 'eltebeacujbuda', ludovikacsata: 'csatattk', ludovikafcsmcsata: 'csatattk',
    nkauniversitaspeac: 'nkauniversitaspecs', peacpecs: 'nkauniversitaspecs', tfsemtk: 'tfse',
    unigyor: 'sercounigyor', unigyormelyut: 'sercounigyor',
  },
};

/** Exact match only: known name variants, official or short name. No fuzzy rules. */
export function clubIdStrict(league, name) {
  const clubs = CLUBS[league];
  if (!clubs) throw new Error('Unknown league ' + league);
  const n = normalizeTeamName(name);
  if (!n) return null;
  if (EXACT[league][n]) return EXACT[league][n];
  if (clubs[n]) return n;
  const hit = Object.entries(clubs).find(([, c]) => [c.official, c.short, c.intro].filter(Boolean).some(x => normalizeTeamName(x) === n));
  return hit ? hit[0] : null;
}

// In the head-to-head history "Dávid Kornél KA" / "Dávid Kornél Kosárlabda Akadémia" is ANOTHER club (it plays against VBW CEKK Cegléd in 2024/25 and 2025/26):
// its games must never be counted as Cegléd's (the club id `davidkornelka` and the older alias `dkka` stay as they are for the other data sources).
const HISTORY_OTHER = { women: new Set(['davidkornelka', 'davidkornelkosarlabdaakademia', 'dkka']) };
/** Club of a name in the Hunbasket head-to-head history (clubIdStrict minus the names that denote another, former club there). */
/**
 * Earlier crests of a club (owner 2026-11-28): CSATA TKK played as "Ludovika-FCSM Csata" / "Ludovika Csata" until the summer of 2025 (the head-to-head
 * data shows the last Ludovika game in 2023-03 and the first "Csata TKK" game on 2025-09-27) and then had another crest. A game played BEFORE `before`
 * shows the old crest (graphics/logos/<league>/<key>.png, outline in logos.json) in the head-to-head graphic; the club itself is still one club.
 */
export const FORMER_LOGOS = { women: { csatattk: [{ before: '2025-07-01', key: 'csatattk-ludovika', label: 'CSATA Ludovika' }] } };
/** Image key of a club's crest for a game on `date` (YYYY-MM-DD): an earlier crest when there is one for that time, else the current one. */
export function logoKeyFor(league, id, date) {
  const f = (FORMER_LOGOS[league]?.[id] || []).find(x => date && String(date).slice(0, 10) < x.before);
  return `${league}/${f ? f.key : id}`;
}
export function historyClubId(league, name) {
  if (HISTORY_OTHER[league]?.has(normalizeTeamName(name))) return null;
  return clubIdStrict(league, name);
}

/** Which league an exact name belongs to (for warnings), or null. */
export function leagueOfName(name) {
  const inLeagues = Object.keys(CLUBS).filter(lg => clubIdStrict(lg, name));
  return inLeagues.length === 1 ? inLeagues[0] : null;
}

/** Resolve a team name to a club id within one league. Returns null when unknown. */
export function clubId(league, name) {
  const clubs = CLUBS[league];
  if (!clubs) throw new Error('Unknown league ' + league);
  const n = normalizeTeamName(name);
  if (!n) return null;
  const exact = clubIdStrict(league, name);
  if (exact) return exact;
  // an exact club of the other league is never fuzzy-matched into this one
  // (e.g. "Sopron Basket" must not become the men's "Sopron KC")
  if (Object.keys(CLUBS).some(lg => lg !== league && clubIdStrict(lg, name))) return null;
  const hits = Object.entries(clubs).filter(([, c]) => c.match.some(rx => rx.test(n)));
  return hits.length === 1 ? hits[0][0] : null; // ambiguous → unresolved, never guessed
}

export function club(league, id) {
  const c = CLUBS[league]?.[id];
  return c ? { id, league, ...c, intro: c.intro || c.official } : null;
}
