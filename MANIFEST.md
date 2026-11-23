# MANIFEST – NB I/A Közvetítőhub + Graphics Studio

Living record of **what exists, what was agreed and what is finished**. Kept up to date with every change.
Rule: anything under **LOCKED** is finished and agreed – it is used as it is and is **not reworked** unless the owner explicitly asks.
See also: `DESIGN-SYSTEM.md` (look & feel rules), `graphics/README.md` (feature guide, Hungarian), `graphics/HASZNALATI-UTMUTATO.md` (user guide).

## 1. Purpose
Basketball commentator tool for the Hungarian NB I/A (men + women, always separate):
1. **Közvetítőhub** (`index.html`, `css/dashboard.css`) – match preparation dashboard (schedule/results, standings, team pages, head-to-head, notes, news, match sheet).
2. **Graphics Studio** (`graphics/`) – browser-based broadcast graphics from the owner's PSD designs, exported as transparent 1920×1080 PNG (and a ZIP package per match).

## 2. Data (nothing is invented; missing data is flagged, freshness is shown)
| Source | What | Cadence / how |
|---|---|---|
| Hunbasket (official) | schedule/results, standings, team stats, player stats, team pages (rosters, coaches, records, zones, stat tables), player pages, referees/arenas, head-to-head history (2020/21–) | GitHub Actions; fixtures hourly, standings 30 min, team pages every 3 h, player pages/stats daily; files are written only when something changed |
| FullField.info Excel | team + player statistics (primary when uploaded; EFF = "Efficiency"/Val) | uploaded by the owner in the studio; unknown team names are reported, never guessed |
| eredmenyek.com | European/cup games | pasted into the studio (cannot be fetched automatically) |
| FIBA | European/cup fixtures | collector `scripts/update_cups.mjs` |
| KosárStat | all-time head-to-head, **men only** | collector |
| Hunbasket photos | player photos (MKOSZ gave permission) | `graphics/players/` (4 players have none → placeholder) |

## 3. Graphics Studio – templates (16 per league)
Status legend: **LOCKED** = agreed & finished · **REVIEW** = delivered, waiting for the owner's check · **OPEN** = not done.

| Graphic | Status | Notes |
|---|---|---|
| Csapatok összevetése (comparison) | REVIEW | frame resizable; Excel/Hunbasket data; source-name colour option |
| Csillagjátékosok / Kulcsjátékosok (playercompare) | REVIEW | player photos instead of logos (option), levelled + mirrored rows, source-name colour |
| Csapatstatisztika | REVIEW | |
| Eredmények / Eredmények (színes sorok) / Menetrend | REVIEW | editable rows (delete/add/reorder at once); schedule starts with the game after the next; rows reset on team change |
| Intro | REVIEW | |
| Játékos-különleges | REVIEW | per-column data source (manual / season / career / last N); columns movable as units; AI background removal for the photo |
| Keret (táblás) / Keret (fotókkal) | REVIEW | name order rule (below); jersey-number and flag size fields; row moving |
| Forma / Forma (két csapat) | **LOCKED** | GY / V badges, @ before the score for away games, ≤ ¼ of the picture, no text caption |
| Egymás ellen (head to head) | **LOCKED** (look) | last 5 meetings: date · badge · score · badge; data covers 7 seasons only |
| Extra (MKOSZ) | **LOCKED** | photo frame + QR frame, free / proportional resize, uploads |
| Következik | REVIEW | |
| Játékvezetők | REVIEW | men's PSD uses Satoshi, but the font rule is League Gothic only (owner's decision: everything in League Gothic) – rendered in League Gothic |

Other studio features: ZIP package of all graphics of a match, presets, layout editor with saved "alap" (benchmark), Excel/CSV import, mobile version (+ manual desktop/mobile switch), PWA manifest (`graphics/manifest.webmanifest`).

## 4. Közvetítőhub – status
| Area | Status |
|---|---|
| Menetrend: newest result first, last 2 rounds, next 3 rounds | **LOCKED** |
| Csapatok tab: Keret + all Hunbasket team/player stats | **LOCKED** (data refresh every 3 h) |
| Meccslap (one-page A4 match sheet) | REVIEW |
| Logo line (club crest rail under the header, men + women) | REVIEW | tiles with the clean transparent studio logos, optical size normalisation, league label + accent (men green / women red), hover accent in the club colour, swipeable row on phones, click = player statistics |
| Mobile version + view switch | REVIEW (not yet tested on a real phone) |
| Shared notes (Supabase) | OPEN – row-level-security review needs the owner's `pg_policies` output (never keys) |

## 5. LOCKED decisions (do not revisit without being asked)
- Fonts: **League Gothic Regular/Italic only, everywhere in the graphics** (owner's rule; this also covers the men's referee graphic although its PSD uses Satoshi).
- Output: transparent 1920×1080 PNG; men and women never mixed; missing data flagged, never invented; data freshness always visible.
- **Frames:** every graphic frame is a shape = *Téglalap* (outline, freely resizable) + *kosárpálya* (court, locked aspect ratio). The court's upper and lower edge sit on the frame's upper and lower border, centred on the frame's axes; if the frame is wider it grows to cover. Court + outline move/scale as one unit. Outline colours: **men `#0b9444`, women `#ef4036`**.
- **Name order:** foreigners "Given SURNAME", Hungarians "SURNAME Given"; surname highlighted in capitals on photo cards. (Smuda is not Hungarian.)
- Forma look (see table), no text caption, never larger than a quarter of 1920×1080.
- Team-page / stat tables: "all the stats available on Hunbasket should be reachable".
- Working agreement: work on a branch, open PRs, **the owner merges** (never merge/deploy by the assistant); CI (unit + browser tests) must be green; docs (this file, README) updated with every change.

## 6. Open items / ideas
Real-phone test of both mobile versions · Supabase RLS review · women's all-time head-to-head (eredmenyek.com paste would help) · more graphics (streak, social-media sizes).

## 7. Repo map
`index.html`+`css/dashboard.css` dashboard · `graphics/` studio (`js/` app, engine, templates, binders, panels, bgremove; `templates/<id>/` statics+thumbs; `assets/court/court.png`; `players/` photos; `models/`+`vendor/ort/` background removal) · `data/` collected JSON · `scripts/` collectors · `tools/` PSD extraction (`psd_extract.py`, `psd_frames.py`) · `tests/` (unit + browser) · `.github/workflows/` collectors + CI · `BROADCAST GRAPHICS/` the owner's PSDs (read-only source).
