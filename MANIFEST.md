# MANIFEST – NB I/A Közvetítőhub + Graphics Studio

Living record of **what exists, what was agreed and what is finished**. Kept up to date with every change.
Rule: anything under **LOCKED** is finished and agreed – it is used as it is and is **not reworked** unless the owner explicitly asks.
See also: `DESIGN-SYSTEM.md` (look & feel rules), `graphics/README.md` (feature guide, Hungarian), `graphics/HASZNALATI-UTMUTATO.md` (user guide).

## 0. Platform priority (owner decision 2026-11-23)
**Desktop first.** The tools are used on desktop; design, polish and test the desktop version only. The mobile/phone versions stay as they are (existing tests keep passing) but get no new work, no real-phone testing and no mobile screenshots unless the owner asks.

## 0b. Handoff (where we stopped, 2026-11-23)
- Everything is committed and pushed on `claude/focused-dirac-vkihwr`; PR #28 holds the latest work (head to head 6 rows, photo roster in the ZIP, intro rank shown, package defaults, sidebar splitter, key-players fixes). The owner merges; check CI is green first (`/check`).
- Awaiting the owner's review (REVIEW rows below): resizable frames with the court fit rule, key players (photos, upload, ranks), logo line, Csapatok layout + printable team sheet, studio sidebar splitter.
- Owner's view on weak spots: **Kulcsjátékosok** (data gaps – ask for a concrete match to analyse), **Játékos-különleges**, **Intro** (position line now shown) – unticked in the ZIP by default.
- Working style the owner wants: short sessions, one feature per session, restate the rule first, desktop only, no rework of LOCKED items, fewer e-mails (CI runs on pull requests only).
- Start a new session with `/start <task>`; end with `/finish`.

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
| Flags (roster graphics) | one SVG per nationality in `graphics/assets/flags/`; Hungarian players get no flag by design; the team-pages job now downloads the flag of any new nationality automatically; Hunbasket lists no nationality (`-`) for one player (Sopron Basket, JANKOVIC Masa) → no flag |

## 3. Graphics Studio – templates (17 per league)
Status legend: **LOCKED** = agreed & finished · **REVIEW** = delivered, waiting for the owner's check · **OPEN** = not done.

| Graphic | Status | Notes |
|---|---|---|
| Csapatok összevetése (comparison) | REVIEW | frame resizable; Excel/Hunbasket data; source-name colour option |
| Kulcsjátékosok összehasonlítása / szemtől szemben (playercompare; was "Csillagjátékosok") | REVIEW | **choose the stat categories (rows); the panel = court frame shape sized to the rows**, row labels are texts, logo strip (`templates/playercompare-<lg>/strip.png`, cropped from the old baked background) sits under the panel; any player selectable (dropdown bug fixed), ranks also for players with few games (among all who played, noted in the field), own photo upload per side (wins over Hunbasket photo/logo, with background removal; **default 900 px tall standing on the panel's bottom edge, corner-handle resizable**), photos instead of logos (option), levelled + mirrored rows, source-name colour; columns the Excel lacks (2P/3P/FT %) are completed per player from Hunbasket (flagged in the source label) |
| Csapatstatisztika | REVIEW | |
| Eredmények / Eredmények (színes sorok) / Menetrend | REVIEW | editable rows (delete/add/reorder at once); schedule starts with the game after the next; rows reset on team change |
| Intro | REVIEW | position + W-L line ("(3. hely - 5-2)") is now shown by default (the PSD has it hidden); two-line names make room for it |
| Játékos-különleges | REVIEW | per-column data source (manual / season / career / last N); columns movable as units; AI background removal for the photo |
| Keret (táblás) / Keret (fotókkal) | REVIEW | name order rule (below); jersey-number and flag size fields; row moving |
| Forma / Forma (két csapat) | **LOCKED** | GY / V badges, @ before the score for away games, ≤ ¼ of the picture, no text caption |
| Egymás ellen (head to head) | **LOCKED** (look) | last up to **6** meetings: date · badge · score · badge; the box is exactly as tall as the list; score green / red from the match's HOME team's point of view ("we work for the home team"); data covers 7 seasons only |
| Extra (MKOSZ) | **LOCKED** | photo frame + QR frame, free / proportional resize, uploads |
| Következik | REVIEW | |
| Élő statisztika (játékos) (livestat) | REVIEW | **new 2026-11-23, resized 2026-11-24 ("way too big" → small pop-up 614×269, corner top-left or bottom-left, clear of the broadcaster's score bug zone bottom-right):** compact court-frame panel: official roster photo, name (Hungarian "SURNAME Given" / foreign "Given SURNAME" from the Hunbasket roster), `#number · score · period`, club logo, and stats of the chosen live-game player; variants **Alap** (PTS·REB·AST), **Dobások** (2P·3P·BT with %), **Teljes sor** (PERC·PTS·REB·AST·STL·BLK·TOV·FAULT·EFF). Data = live boxscore (section 5b); loaded by link/code (auto refresh 5 s via the local relay) or pasted; every value carries the freshness in its source label; nothing is invented. Not in the ZIP package (it is a live insert). |
| Játékvezetők | REVIEW | men's PSD uses Satoshi, but the font rule is League Gothic only (owner's decision: everything in League Gothic) – rendered in League Gothic |

Studio layout: desktop sidebar width is draggable (splitter, remembered, double click resets); controls wrap instead of overflowing – REVIEW.

Other studio features: ZIP package of all graphics of a match (includes the photo roster; **Intro, Csillagjátékosok and Játékos-különleges are unticked by default** – owner decision, they can be ticked per download), presets, layout editor with saved "alap" (benchmark), Excel/CSV import, mobile version (+ manual desktop/mobile switch), PWA manifest (`graphics/manifest.webmanifest`).

## 4. Közvetítőhub – status
| Area | Status |
|---|---|
| Menetrend: newest result first, last 2 rounds, next 3 rounds | **LOCKED** |
| Csapatok tab: Keret + all Hunbasket team/player stats | **LOCKED** (data refresh every 3 h) |
| Csapatok tab layout: open button in the card's header row (top right), "← Vissza a csapatokhoz" back button, "Teljes csapatlap nyomtatása" (one A4 landscape team sheet: last games, roster, 3 stat tables, records/zones, matches), clean transparent crests everywhere (`graphics/logos`, old `logos/` only as fallback) | REVIEW |
| Meccslap (one-page A4 match sheet) | REVIEW |
| Logo line (club crest rail under the header, men + women) | REVIEW | tiles with the clean transparent studio logos, optical size normalisation, league label + accent (men green / women red), hover accent in the club colour, swipeable row on phones, click = player statistics |
| Mobile version + view switch | PARKED (desktop first; kept working, no further work) |
| Shared notes (Supabase, project "Kosárlabda Jegyzetek") | REVIEWED read-only (2026-11-23), nothing changed: one table `public.matchup_notes` (5 rows, RLS on, length checks, version column). Anyone with the public anon key can read, insert and update every row (policies `using true`); delete is blocked. **Owner decision (2026-11-23): leave it as it is** – only the commentators who work with the owner use it. Not to be raised again unless the audience changes (then: access code or login). |

## 5. LOCKED decisions (do not revisit without being asked)
- Fonts: **League Gothic Regular/Italic only, everywhere in the graphics** (owner's rule; this also covers the men's referee graphic although its PSD uses Satoshi).
- Output: transparent 1920×1080 PNG; men and women never mixed; missing data flagged, never invented; data freshness always visible.
- **Frames:** every graphic frame is a shape = *Téglalap* (outline, freely resizable) + *kosárpálya* (court, locked aspect ratio). The court's upper and lower edge sit on the frame's upper and lower border, centred on the frame's axes; if the frame is wider it grows to cover. Court + outline move/scale as one unit. Outline colours: **men `#0b9444`, women `#ef4036`**.
- **Name order:** foreigners "Given SURNAME", Hungarians "SURNAME Given"; surname highlighted in capitals on photo cards. (Smuda is not Hungarian.)
- Forma look (see table), no text caption, never larger than a quarter of 1920×1080.
- Team-page / stat tables: "all the stats available on Hunbasket should be reachable".
- Working agreement: work on a branch, open PRs; the assistant may merge **only** what the owner asked for, once it is finished, tested and CI is green (owner decision 2026-11-23) – nothing unrequested; CI (unit + browser tests) must be green; docs (this file, README) updated with every change.

- **Score bug zone (owner 2026-11-24):** both feed versions carry the broadcaster's score bug bottom-right; no graphic may cover x ≥ 1200 / y ≥ 925 (rule in `DESIGN-SYSTEM.md`, preview guide in the studio). Only the live insert has been checked/resized so far; the big graphics (comparison, roster, intro …) are full-picture designs – ask the owner whether they need a safe-area variant.

## 5b. Live statistics insert (in progress, owner request 2026-11-23)
Goal: during timeouts / quarter breaks pick a player of the running game and show basic live statistics with the official roster photo, as transparent PNG (and later maybe an OBS browser source).
- **Source:** the MKOSZ netcasting page `https://netcasting4.webpont.com/?whun_<id>` (`whun_` = women, `hun_` = men). It loads `storage/full<gamecode>.html` (whole game) / `storage/last<gamecode>.html` (latest events), refreshed about every 5 s. Format: home-made `key|value#key|value` text, `%` between array items; three string replaces turn it into JSON (`graphics/js/live.js` `decodeFeed`). Contains roster (`players.home/away`: Hunbasket player code, name, number, photo URL), `i` (teams, score `hp`/`vp`, arena, referees, date) and the play-by-play `f` (codes: 1000 made shot, 1001 miss, 1002 def reb, 1003 off reb, 1004 steal, 1005 turnover, 1006 foul drawn, 1007 foul, 1008 assist, 1009 block, 1010 block against, 1020 technical, 1011 substitution, 1100 15 s tick, 1101 period end; `gt` = elapsed game seconds). Shot type 3 = three, 4 = free throw, 1/2/5 = two. **Player codes are Hunbasket player ids**, so `graphics/players/<id>.webp` fits directly.
- **Parser:** `graphics/js/live.js` (counts the stats like the netcasting page; counted points equal the official score), tests `tests/live.test.mjs` on a saved finished game (`tests/fixtures/live/whun_135563.full.txt`, ETO Basket – CEKK Cegléd 90–48).
- **Access:** the feed server sends **no CORS header** (a browser on GitHub Pages cannot read it) and **blocks cloud networks**: a Supabase Edge Function was tried and cannot reach it (IPv6 reset, IPv4 port 443 dropped, port 80 only redirects) – do not retry that route (the two stub functions `live-box` / `live-diag` in the Supabase project can be deleted in its dashboard). **Working route:** `python3 tools/serve.py` serves the studio and relays the feed at `/live?game=whun_135563&kind=full` (the owner's own connection is accepted). The sandbox reaches the feed only through the allowed host `netcasting4.webpont.com` of the environment.
- **Built:** the graphic `livestat-<men|women>` (see section 3). Open ideas: OBS browser-source page that refreshes by itself, team-level insert (team fouls, quarter scores), own photo upload per player. Coach interview graphic (owner will add a PSD prototype): data from Hunbasket preview links / BB1 (`bball1.hu`) preview article, always a photo upload.

## 6. Open items / ideas
Supabase RLS review · women's all-time head-to-head (eredmenyek.com paste would help) · more graphics (streak, social-media sizes).

## 7. Repo map
`index.html`+`css/dashboard.css` dashboard · `graphics/` studio (`js/` app, engine, templates, binders, panels, bgremove; `templates/<id>/` statics+thumbs; `assets/court/court.png`; `players/` photos; `models/`+`vendor/ort/` background removal) · `data/` collected JSON · `scripts/` collectors · `tools/` PSD extraction (`psd_extract.py`, `psd_frames.py`) · `tests/` (unit + browser) · `.github/workflows/` collectors + CI · `BROADCAST GRAPHICS/` the owner's PSDs (read-only source).
